import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  asyncHandler,
  conflict,
  currentUser,
  EventBus,
  Events,
  isUniqueViolation,
  notFound,
  requireAuth,
  requireRole,
  ROLES,
  signToken,
  unauthorized,
  UserRegisteredData,
  validate,
  AuthUser,
} from '@rental/common';
import { hashPassword, verifyPassword } from './password';

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(200),
  // Public sign-up may only create landlords or tenants.
  role: z.enum(['landlord', 'tenant']).default('tenant'),
});

const adminCreateSchema = registerSchema.extend({ role: z.enum(ROLES) });

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: AuthUser['role'];
  password_hash: string;
  created_at: string;
}

const toDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  createdAt: u.created_at,
});

export function buildRouter(deps: { pool: Pool; bus: EventBus; jwtSecret: string }): Router {
  const { pool, bus, jwtSecret } = deps;
  const router = Router();

  async function createUser(input: z.infer<typeof adminCreateSchema>) {
    try {
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.email, await hashPassword(input.password), input.fullName, input.role],
      );
      const user = rows[0];
      await bus.publish<UserRegisteredData>(Events.UserRegistered, {
        userId: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      });
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('EMAIL_TAKEN', 'Email already registered');
      throw err;
    }
  }

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const user = await createUser(validate(registerSchema, req.body));
      res.status(201).json(toDto(user));
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, password } = validate(loginSchema, req.body);
      const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        throw unauthorized('Invalid email or password');
      }
      const token = signToken({ id: user.id, email: user.email, role: user.role }, jwtSecret);
      res.json({ accessToken: token, tokenType: 'Bearer', user: toDto(user) });
    }),
  );

  router.get(
    '/me',
    requireAuth(jwtSecret),
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [
        currentUser(req).id,
      ]);
      if (!rows[0]) throw notFound('User');
      res.json(toDto(rows[0]));
    }),
  );

  // Admin: create staff accounts (accountants, other admins)
  router.post(
    '/users',
    requireAuth(jwtSecret),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const user = await createUser(validate(adminCreateSchema, req.body));
      res.status(201).json(toDto(user));
    }),
  );

  router.get(
    '/users',
    requireAuth(jwtSecret),
    requireRole('admin'),
    asyncHandler(async (_req, res) => {
      const { rows } = await pool.query<UserRow>('SELECT * FROM users ORDER BY created_at DESC');
      res.json({ items: rows.map(toDto) });
    }),
  );

  return router;
}

/** Ensure a bootstrap admin exists (from ADMIN_EMAIL / ADMIN_PASSWORD). */
export async function seedAdmin(pool: Pool, email: string, password: string): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Administrator', 'admin') ON CONFLICT (email) DO NOTHING`,
    [email.toLowerCase(), await hashPassword(password)],
  );
  return (res.rowCount ?? 0) > 0;
}
