import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  asyncHandler,
  AuthUser,
  badRequest,
  conflict,
  currentUser,
  EventBus,
  Events,
  forbidden,
  isUniqueViolation,
  LeaseCreatedData,
  LeaseTerminatedData,
  notFound,
  Queryable,
  requireRole,
  transaction,
  validate,
} from '@rental/common';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const money = z.number().nonnegative().multipleOf(0.01);

const propertySchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  electricityRate: money.default(3500),
  waterRate: money.default(25000),
  internetRate: money.default(100000),
  cleaningRate: money.default(50000),
  parkingRate: money.default(100000),
  bankName: z.string().max(100).optional(),
  bankAccountNumber: z.string().max(50).optional(),
  bankAccountName: z.string().max(200).optional(),
  bankQrCode: z.string().optional().nullable(),
});
const propertyPatchSchema = propertySchema.partial();
const unitSchema = z.object({
  name: z.string().min(1).max(100),
  areaM2: z.number().positive().optional(),
  baseRent: money,
});
const unitPatchSchema = unitSchema.partial().extend({
  status: z.enum(['vacant', 'maintenance']).optional(),
});
const tenantSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  idNumber: z.string().max(50).optional(),
  userId: uuid.optional(),
  streetAddress: z.string().max(300).optional(),
  ward: z.string().max(100).optional(),
  district: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  idIssueDate: isoDate.optional(),
  gender: z.string().max(20).optional(),
  birthDate: isoDate.optional(),
  nationality: z.string().max(50).default('Việt Nam'),
});
const tenantPatchSchema = tenantSchema.partial();
const leaseSchema = z.object({
  unitId: uuid,
  tenantId: uuid,
  startDate: isoDate,
  endDate: isoDate.optional(),
  monthlyRent: money.optional(), // defaults to unit.base_rent
  deposit: money.default(0),
  currency: z.string().length(3).toUpperCase().default('VND'),
  dueDay: z.number().int().min(1).max(28).default(5),
});

const occupantSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  idNumber: z.string().max(50).optional(),
  birthDate: isoDate.optional(),
  gender: z.string().max(20).optional(),
  relationship: z.string().max(100).default('Người ở cùng'),
  vehiclePlate: z.string().max(30).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
  tenantId: uuid.optional(),
});
const occupantPatchSchema = occupantSchema.partial();

/** Strictly check that the current user owns the property/resource */
function assertOwner(user: AuthUser, ownerId: string) {
  if (user.id !== ownerId) throw forbidden('You do not have permission to view or manage this property');
}

/** For list endpoints: strictly filter by owner so every user only sees their own properties/data */
function ownerFilter(user: AuthUser, column = 'owner_id', paramIndex = 1) {
  return { where: `${column} = $${paramIndex}`, params: [user.id] };
}

async function loadProperty(db: Queryable, id: string) {
  const { rows } = await db.query('SELECT * FROM properties WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Property');
  return rows[0];
}

export function buildRouter(deps: { pool: Pool; bus: EventBus }): Router {
  const { pool, bus } = deps;
  const router = Router();
  const manage = requireRole('admin', 'landlord');
  const read = requireRole('admin', 'landlord', 'accountant');

  // ---------- Properties ----------
  router.get(
    '/properties',
    read,
    asyncHandler(async (req, res) => {
      const f = ownerFilter(currentUser(req), 'p.owner_id');
      const { rows } = await pool.query(
        `SELECT p.*,
                COUNT(u.id)::int AS unit_count,
                COUNT(u.id) FILTER (WHERE u.status = 'occupied')::int AS occupied_count
           FROM properties p LEFT JOIN units u ON u.property_id = p.id
          WHERE ${f.where}
          GROUP BY p.id ORDER BY p.created_at DESC`,
        f.params,
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/properties',
    manage,
    asyncHandler(async (req, res) => {
      const body = validate(propertySchema, req.body);
      const { rows } = await pool.query(
        `INSERT INTO properties (owner_id, name, address, description, electricity_rate, water_rate, internet_rate, cleaning_rate, parking_rate, bank_name, bank_account_number, bank_account_name, bank_qr_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          currentUser(req).id,
          body.name,
          body.address,
          body.description ?? null,
          body.electricityRate,
          body.waterRate,
          body.internetRate,
          body.cleaningRate,
          body.parkingRate,
          body.bankName ?? null,
          body.bankAccountNumber ?? null,
          body.bankAccountName ?? null,
          body.bankQrCode ?? null,
        ],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/properties/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const body = validate(propertyPatchSchema, req.body);
      const property = await loadProperty(pool, id);
      assertOwner(currentUser(req), property.owner_id);

      const hasQr = body.bankQrCode !== undefined;
      const { rows } = await pool.query(
        `UPDATE properties SET
           name = COALESCE($2, name),
           address = COALESCE($3, address),
           description = COALESCE($4, description),
           electricity_rate = COALESCE($5, electricity_rate),
           water_rate = COALESCE($6, water_rate),
           internet_rate = COALESCE($7, internet_rate),
           cleaning_rate = COALESCE($8, cleaning_rate),
           parking_rate = COALESCE($9, parking_rate),
           bank_name = COALESCE($10, bank_name),
           bank_account_number = COALESCE($11, bank_account_number),
           bank_account_name = COALESCE($12, bank_account_name),
           bank_qr_code = CASE WHEN $13::boolean THEN $14 ELSE bank_qr_code END
         WHERE id = $1 RETURNING *`,
        [
          id,
          body.name ?? null,
          body.address ?? null,
          body.description ?? null,
          body.electricityRate ?? null,
          body.waterRate ?? null,
          body.internetRate ?? null,
          body.cleaningRate ?? null,
          body.parkingRate ?? null,
          body.bankName ?? null,
          body.bankAccountNumber ?? null,
          body.bankAccountName ?? null,
          hasQr,
          body.bankQrCode ? body.bankQrCode : null,
        ],
      );
      res.json(rows[0]);
    }),
  );

  router.get(
    '/properties/:id',
    read,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const property = await loadProperty(pool, id);
      assertOwner(currentUser(req), property.owner_id);
      const units = await pool.query(
        `SELECT u.*,
                (SELECT COUNT(*)::int FROM unit_occupants o WHERE o.unit_id = u.id) AS occupant_count
           FROM units u
          WHERE u.property_id = $1
          ORDER BY u.name`,
        [id],
      );
      res.json({ ...property, units: units.rows });
    }),
  );

  // ---------- Units ----------
  router.post(
    '/properties/:id/units',
    manage,
    asyncHandler(async (req, res) => {
      const propertyId = validate(uuid, req.params.id);
      const body = validate(unitSchema, req.body);
      const property = await loadProperty(pool, propertyId);
      assertOwner(currentUser(req), property.owner_id);
      try {
        const { rows } = await pool.query(
          `INSERT INTO units (property_id, name, area_m2, base_rent)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [propertyId, body.name, body.areaM2 ?? null, body.baseRent],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('UNIT_EXISTS', 'Unit name already used in this property');
        throw err;
      }
    }),
  );

  router.patch(
    '/units/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const body = validate(unitPatchSchema, req.body);
      const { rows } = await pool.query(
        `SELECT u.*, p.owner_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1`,
        [id],
      );
      const unit = rows[0];
      if (!unit) throw notFound('Unit');
      assertOwner(currentUser(req), unit.owner_id);
      if (body.status && unit.status === 'occupied') {
        throw conflict('UNIT_OCCUPIED', 'Terminate the active lease before changing unit status');
      }
      const updated = await pool.query(
        `UPDATE units SET
           name = COALESCE($2, name),
           area_m2 = COALESCE($3, area_m2),
           base_rent = COALESCE($4, base_rent),
           status = COALESCE($5, status)
         WHERE id = $1 RETURNING *`,
        [id, body.name ?? null, body.areaM2 ?? null, body.baseRent ?? null, body.status ?? null],
      );
      res.json(updated.rows[0]);
    }),
  );

  // ---------- Unit Occupants (Người ở trong phòng) ----------
  router.get(
    '/units/:unitId/occupants',
    read,
    asyncHandler(async (req, res) => {
      const unitId = validate(uuid, req.params.unitId);
      const user = currentUser(req);
      const { rows: unitRows } = await pool.query(
        `SELECT u.*, p.owner_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1`,
        [unitId],
      );
      const unit = unitRows[0];
      if (!unit) throw notFound('Unit');
      assertOwner(user, unit.owner_id);

      const { rows } = await pool.query(
        `SELECT * FROM unit_occupants WHERE unit_id = $1 ORDER BY is_primary DESC, created_at ASC`,
        [unitId],
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/units/:unitId/occupants',
    manage,
    asyncHandler(async (req, res) => {
      const unitId = validate(uuid, req.params.unitId);
      const body = validate(occupantSchema, req.body);
      const user = currentUser(req);

      const { rows: unitRows } = await pool.query(
        `SELECT u.*, p.owner_id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1`,
        [unitId],
      );
      const unit = unitRows[0];
      if (!unit) throw notFound('Unit');
      assertOwner(user, unit.owner_id);

      const { rows } = await pool.query(
        `INSERT INTO unit_occupants (unit_id, tenant_id, full_name, phone, id_number, birth_date, gender, relationship, vehicle_plate, is_primary, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          unitId,
          body.tenantId ?? null,
          body.fullName,
          body.phone ?? null,
          body.idNumber ?? null,
          body.birthDate ?? null,
          body.gender ?? null,
          body.relationship ?? 'Người ở cùng',
          body.vehiclePlate ?? null,
          body.isPrimary,
          body.notes ?? null,
        ],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/occupants/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const body = validate(occupantPatchSchema, req.body);
      const user = currentUser(req);

      const { rows: occRows } = await pool.query(
        `SELECT o.*, p.owner_id
           FROM unit_occupants o
           JOIN units u ON u.id = o.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE o.id = $1`,
        [id],
      );
      const occ = occRows[0];
      if (!occ) throw notFound('Occupant');
      assertOwner(user, occ.owner_id);

      const { rows } = await pool.query(
        `UPDATE unit_occupants SET
           full_name = COALESCE($2, full_name),
           phone = COALESCE($3, phone),
           id_number = COALESCE($4, id_number),
           birth_date = COALESCE($5, birth_date),
           gender = COALESCE($6, gender),
           relationship = COALESCE($7, relationship),
           vehicle_plate = COALESCE($8, vehicle_plate),
           is_primary = COALESCE($9, is_primary),
           notes = COALESCE($10, notes)
         WHERE id = $1 RETURNING *`,
        [
          id,
          body.fullName ?? null,
          body.phone ?? null,
          body.idNumber ?? null,
          body.birthDate ?? null,
          body.gender ?? null,
          body.relationship ?? null,
          body.vehiclePlate ?? null,
          body.isPrimary ?? null,
          body.notes ?? null,
        ],
      );
      res.json(rows[0]);
    }),
  );

  router.delete(
    '/occupants/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);

      const { rows: occRows } = await pool.query(
        `SELECT o.*, p.owner_id
           FROM unit_occupants o
           JOIN units u ON u.id = o.unit_id
           JOIN properties p ON p.id = u.property_id
          WHERE o.id = $1`,
        [id],
      );
      const occ = occRows[0];
      if (!occ) throw notFound('Occupant');
      assertOwner(user, occ.owner_id);

      await pool.query('DELETE FROM unit_occupants WHERE id = $1', [id]);
      res.json({ deleted: true, id });
    }),
  );

  // ---------- Tenants ----------
  router.get(
    '/tenants',
    read,
    asyncHandler(async (req, res) => {
      const f = ownerFilter(currentUser(req));
      const { rows } = await pool.query(
        `SELECT * FROM tenants WHERE ${f.where} ORDER BY created_at DESC`,
        f.params,
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/tenants',
    manage,
    asyncHandler(async (req, res) => {
      const b = validate(tenantSchema, req.body);
      const { rows } = await pool.query(
        `INSERT INTO tenants (
           owner_id, user_id, full_name, phone, email, id_number,
           street_address, ward, district, city, id_issue_date, gender, birth_date, nationality
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          currentUser(req).id,
          b.userId ?? null,
          b.fullName,
          b.phone ?? null,
          b.email ?? null,
          b.idNumber ?? null,
          b.streetAddress ?? null,
          b.ward ?? null,
          b.district ?? null,
          b.city ?? null,
          b.idIssueDate ?? null,
          b.gender ?? null,
          b.birthDate ?? null,
          b.nationality ?? 'Việt Nam',
        ],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/tenants/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(tenantPatchSchema, req.body);
      const user = currentUser(req);
      const tRes = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
      const tenant = tRes.rows[0];
      if (!tenant) throw notFound('Tenant');
      assertOwner(user, tenant.owner_id);

      const { rows } = await pool.query(
        `UPDATE tenants SET
           full_name = COALESCE($2, full_name),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           id_number = COALESCE($5, id_number),
           user_id = COALESCE($6, user_id),
           street_address = COALESCE($7, street_address),
           ward = COALESCE($8, ward),
           district = COALESCE($9, district),
           city = COALESCE($10, city),
           id_issue_date = COALESCE($11, id_issue_date),
           gender = COALESCE($12, gender),
           birth_date = COALESCE($13, birth_date),
           nationality = COALESCE($14, nationality)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.fullName ?? null,
          b.phone ?? null,
          b.email ?? null,
          b.idNumber ?? null,
          b.userId ?? null,
          b.streetAddress ?? null,
          b.ward ?? null,
          b.district ?? null,
          b.city ?? null,
          b.idIssueDate ?? null,
          b.gender ?? null,
          b.birthDate ?? null,
          b.nationality ?? null,
        ],
      );
      res.json(rows[0]);
    }),
  );

  router.delete(
    '/tenants/:id',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const tRes = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
      const tenant = tRes.rows[0];
      if (!tenant) throw notFound('Tenant');
      assertOwner(user, tenant.owner_id);

      const lRes = await pool.query(`SELECT COUNT(*)::int AS count FROM leases WHERE tenant_id = $1 AND status = 'active'`, [id]);
      if (lRes.rows[0].count > 0) throw conflict('TENANT_HAS_ACTIVE_LEASE', 'Không thể xóa khách thuê đang có hợp đồng thuê hiệu lực');

      await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
      res.json({ deleted: true, id });
    }),
  );

  // ---------- Leases ----------
  router.get(
    '/leases',
    read,
    asyncHandler(async (req, res) => {
      const f = ownerFilter(currentUser(req), 'l.owner_id');
      const { rows } = await pool.query(
        `SELECT l.*, u.name AS unit_name, p.name AS property_name, p.address AS property_address,
                t.full_name AS tenant_name, t.phone AS tenant_phone,
                p.id AS property_id,
                p.electricity_rate, p.water_rate, p.internet_rate, p.cleaning_rate, p.parking_rate,
                p.bank_name, p.bank_account_number, p.bank_account_name,
                (SELECT COUNT(*)::int FROM unit_occupants o WHERE o.unit_id = l.unit_id) AS occupant_count
           FROM leases l
           JOIN units u ON u.id = l.unit_id
           JOIN properties p ON p.id = u.property_id
           JOIN tenants t ON t.id = l.tenant_id
          WHERE ${f.where}
          ORDER BY l.created_at DESC`,
        f.params,
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/leases',
    manage,
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const b = validate(leaseSchema, req.body);
      if (b.endDate && b.endDate <= b.startDate) throw badRequest('endDate must be after startDate');

      const { lease, event } = await transaction(pool, async (client) => {
        const unitRes = await client.query(
          `SELECT u.*, p.owner_id, p.id AS property_id
             FROM units u JOIN properties p ON p.id = u.property_id
            WHERE u.id = $1 FOR UPDATE OF u`,
          [b.unitId],
        );
        const unit = unitRes.rows[0];
        if (!unit) throw notFound('Unit');
        assertOwner(user, unit.owner_id);
        if (unit.status !== 'vacant') throw conflict('UNIT_NOT_VACANT', `Unit is ${unit.status}`);

        const tenantRes = await client.query('SELECT * FROM tenants WHERE id = $1', [b.tenantId]);
        const tenant = tenantRes.rows[0];
        if (!tenant) throw notFound('Tenant');
        if (tenant.owner_id !== unit.owner_id) throw badRequest('Tenant belongs to another landlord');

        const rent = b.monthlyRent ?? unit.base_rent;
        const leaseRes = await client.query(
          `INSERT INTO leases (owner_id, unit_id, tenant_id, start_date, end_date, monthly_rent, deposit, currency, due_day)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [unit.owner_id, b.unitId, b.tenantId, b.startDate, b.endDate ?? null, rent, b.deposit, b.currency, b.dueDay],
        );
        await client.query(`UPDATE units SET status = 'occupied' WHERE id = $1`, [b.unitId]);
        const l = leaseRes.rows[0];
        const data: LeaseCreatedData = {
          leaseId: l.id,
          ownerId: l.owner_id,
          propertyId: unit.property_id,
          unitId: l.unit_id,
          tenantId: l.tenant_id,
          tenantUserId: tenant.user_id,
          monthlyRent: l.monthly_rent,
          deposit: l.deposit,
          currency: l.currency,
          startDate: l.start_date,
          endDate: l.end_date,
          dueDay: l.due_day,
        };
        return { lease: l, event: data };
      });

      // Publish only after commit
      await bus.publish(Events.LeaseCreated, event);
      res.status(201).json(lease);
    }),
  );

  router.post(
    '/leases/:id/terminate',
    manage,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const lease = await transaction(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM leases WHERE id = $1 FOR UPDATE', [id]);
        const l = rows[0];
        if (!l) throw notFound('Lease');
        assertOwner(user, l.owner_id);
        if (l.status !== 'active') throw conflict('LEASE_NOT_ACTIVE', 'Lease is already terminated');
        const updated = await client.query(
          `UPDATE leases SET status = 'terminated', terminated_at = now() WHERE id = $1 RETURNING *`,
          [id],
        );
        await client.query(`UPDATE units SET status = 'vacant' WHERE id = $1`, [l.unit_id]);
        return updated.rows[0];
      });
      await bus.publish<LeaseTerminatedData>(Events.LeaseTerminated, {
        leaseId: lease.id,
        ownerId: lease.owner_id,
        terminatedAt: new Date(lease.terminated_at).toISOString(),
      });
      res.json(lease);
    }),
  );

  return router;
}
