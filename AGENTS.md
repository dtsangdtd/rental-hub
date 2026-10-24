# AGENTS.md — Operating Manual for AI Agents

> This file is the **source of truth for any AI agent** (Antigravity, Gemini, Claude, Copilot, Cursor…)
> working in this repository. Read it fully before making changes. Human developers should follow it too.

---

## 1. Project at a glance

**RentalHub** — a microservice platform for **rental-home management, accounting and e-commerce**.

| Service | Port | DB | Owns (bounded context) |
|---|---|---|---|
| `api-gateway` | 8080 | — | Routing only. `/api/<service>/*` → service. No business logic. |
| `auth-service` | 4001 | `auth_db` | Users, passwords, JWT issuing, roles |
| `property-service` | 4002 | `property_db` | Properties, units, tenants, leases |
| `accounting-service` | 4003 | `accounting_db` | Invoices, payments, expenses, financial reports |
| `commerce-service` | 4004 | `commerce_db` | Product catalog, orders, stock |
| `packages/common` | — | — | Shared library: HTTP, DB, auth, events, **event contracts** |

Tech: Node 20 · TypeScript (strict) · Express · PostgreSQL 16 (raw SQL via `pg`) · RabbitMQ (topic exchange `rental.events`) · zod · pino · Docker Compose · npm workspaces.

Deeper docs: [`docs/architecture.md`](docs/architecture.md) · [`docs/events.md`](docs/events.md) · [`docs/api.md`](docs/api.md)

---

## 2. Golden rules (NEVER violate)

1. **Database per service.** A service may only connect to **its own** database. Never query another service's tables. Need data from another service? → consume its **events** and keep a local read-model (see `accounting-service` `lease_billing`), or call its HTTP API.
2. **No cross-service imports.** Services import only from `@rental/common` — never from `services/<other>/...`.
3. **Event contracts live in `packages/common/src/contracts.ts`.** Change them **backward-compatibly** only (add optional fields). Breaking change ⇒ new event name with `.v2`. Always update `docs/events.md`.
4. **Publish events only AFTER the DB transaction commits.** Pattern: `const x = await transaction(...); await bus.publish(...)`.
5. **Every event consumer must be idempotent** → wrap logic in `handleOnce(pool, event.id, async (db) => {...})`. Each consuming service has a `processed_events` table.
6. **Migrations are append-only.** Never edit an existing `migrations/NNN_*.sql`. Add `NNN+1_description.sql`.
7. **Validate all input with zod** via `validate(schema, data)`. Never trust `req.body`, `req.query`, `req.params`.
8. **Authorization on every route.** Services verify JWT themselves (`requireAuth`), then use `requireRole(...)` AND row-level ownership checks (landlord sees only `owner_id = user.id`).
9. **Parameterized SQL only** (`$1, $2…`). Never interpolate user input into SQL strings.
10. **Money:** `NUMERIC(14,2)` in DB, zod `.multipleOf(0.01)`, round with `Math.round(x * 100) / 100`. Always store `currency` next to amounts.
11. **No secrets in code.** Use `env('NAME', devDefault)`; production values come from env/`.env`.
12. **Do not use `console.log`** in services — use the pino `logger`.

---

## 3. Repository layout

```
rental-hub/
├── AGENTS.md                 ← you are here (AI rules)
├── GEMINI.md                 ← pointer to AGENTS.md
├── docker-compose.yml        ← full stack
├── docker/
│   ├── service.Dockerfile    ← ONE Dockerfile for all services (ARG SERVICE)
│   └── postgres-init.sh      ← creates one DB per service
├── docs/                     ← architecture, events, API reference
├── packages/common/src/
│   ├── config.ts   env(), sleep()
│   ├── logger.ts   createLogger()
│   ├── errors.ts   AppError + badRequest/notFound/forbidden/conflict…
│   ├── http.ts     createApp(), asyncHandler(), validate(), errorHandler()
│   ├── db.ts       createPool(), transaction(), handleOnce(), runMigrations()
│   ├── auth.ts     ROLES, signToken(), requireAuth(), requireRole(), currentUser()
│   ├── events.ts   EventBus (publish/subscribe)
│   └── contracts.ts  Events names + payload interfaces  ← cross-service API
└── services/<name>/
    ├── package.json          @rental/<name>
    ├── tsconfig.json
    ├── migrations/NNN_*.sql
    └── src/
        ├── index.ts          bootstrap ONLY: env, pool, migrations, bus, app, shutdown
        ├── routes.ts         buildRouter(deps) — HTTP endpoints
        ├── consumers.ts      registerConsumers() — event handlers (if any)
        └── *.ts              domain helpers (e.g. invoices.ts, password.ts)
```

---

## 4. Coding conventions

- **Naming:** files `kebab-case.ts`/lowercase; types `PascalCase`; vars/functions `camelCase`; SQL tables/columns `snake_case` (plural tables).
- **JSON API:** request bodies use `camelCase`. Responses currently return DB rows (`snake_case`) except auth DTOs — keep consistency **within a service**.
- **Route handlers** always: `asyncHandler(async (req, res) => { validate → authorize → db → publish → respond })`.
- **Errors:** throw `AppError` helpers. Error response shape is fixed: `{ "error": { "code", "message", "details?" } }`. Codes are `UPPER_SNAKE_CASE`.
- **Status codes:** 200 read/update · 201 create · 400 validation · 401 no/invalid token · 403 not allowed · 404 missing · 409 state conflict · 502 upstream down.
- **Dependency injection:** `buildRouter({ pool, bus, ... })` — never create pools/buses inside routes.
- **Transactions:** use `transaction(pool, async (client) => ...)` for multi-statement writes; use `SELECT ... FOR UPDATE` when checking-then-updating (stock, unit status, invoice balance).
- **Dates:** business dates are `DATE` / `'YYYY-MM-DD'` strings; timestamps are `TIMESTAMPTZ`.
- Keep functions small; prefer explicit SQL over abstractions; comment *why*, not *what*.
- TypeScript is strict — no `any` unless unavoidable (prefer `unknown` + narrowing).

---

## 5. Roles & authorization matrix

Roles: `admin`, `landlord`, `accountant`, `tenant` (defined in `common/src/auth.ts`).

| Capability | admin | landlord | accountant | tenant |
|---|---|---|---|---|
| Manage users (`POST /auth/users`) | ✅ | ❌ | ❌ | ❌ |
| Properties / units / tenants / leases — write | ✅ | own | ❌ | ❌ |
| Properties … — read | all | own | all | ❌ |
| Invoices — read | all | own (`owner_id`) | all | own (`customer_id`) |
| Payments / expenses / rent generation | ✅ | own | ✅ | ❌ |
| Financial reports | all | own | all | ❌ |
| Products / Hubs / UOMs — write (`/products`, `/hubs`) | ✅ | own | ❌ | ❌ |
| Public guest shopping (`/shop`, `/cart`, `/guest-orders`, `/orders/:id`) | ✅ | ✅ | ✅ | ✅ (unauthenticated guests included) |
| Commerce navigation (`/shop`, `/orders`) | ✅ | ✅ | ❌ | ✅ |
| Orders — create/cancel own | ✅ | own | ❌ | ✅ |
| Orders — see all / deliver / fulfill | ✅ / ✅ | own / ✅ | ❌ | ❌ |
| Categories — add / edit / delete (`/categories`) | ✅ | ✅ (own/building) | ❌ | ❌ (read all) |
| POS Counter Terminal & Barcode Inbound (`/pos/checkout`, `/inventory/barcode-import`) | ✅ | ✅ | ❌ | ❌ |
| Temporary residence & absence (`/residence`) | all | own | all | ❌ |

When adding an endpoint, **update this table**.

---

## 6. Business flows (event-driven)

```
property-service ──property.lease.created──────▶ accounting-service
                                                  • stores lease_billing read-model
                                                  • creates deposit invoice + first month rent invoice
property-service ──property.lease.terminated────▶ accounting-service (stop billing)
commerce-service ──commerce.order.placed────────▶ accounting-service (create order invoice)
commerce-service ──commerce.order.paid──────────▶ accounting-service (mark order invoice paid)
commerce-service ──commerce.order.cancelled─────▶ accounting-service (void unpaid invoice)
commerce-service ──tenant.debt.charge_requested─▶ accounting-service (charges grocery debt to tenant room invoice)
commerce-service ──notification.landlord.alert──▶ Web App (Ding-dong chime), Telegram Bot, Zalo Webhook
accounting-service ─accounting.invoice.paid─────▶ commerce-service (order → paid)
auth-service ─────auth.user.registered──────────▶ (no consumers yet)
```

Monthly rent: `POST /api/accounting/invoices/generate-rent { "period": "YYYY-MM" }` — idempotent (unique index on lease+period).

---

## 7. Standard workflows (follow step by step)

### 7.1 Add an endpoint to an existing service
1. Define a zod schema at the top of `routes.ts`.
2. Add the route inside `buildRouter` using `asyncHandler`, `validate`, `requireRole` + ownership check.
3. Writes touching >1 row → `transaction()`. Publish events after commit.
4. Schema change needed? → new migration file (§7.3).
5. Document in `docs/api.md` and update the role matrix (§5).
6. Run `npm run build` — must pass with zero errors.

### 7.2 Add / change an event
1. Add name to `Events` and payload interface in `packages/common/src/contracts.ts`.
2. Publisher: `await bus.publish<Payload>(Events.X, data)` after commit.
3. Consumer: add routing key to the `bus.subscribe([...])` list in `consumers.ts`, add a `case` inside `handleOnce`. Ensure the service has a `processed_events` table.
4. Update `docs/events.md` and the flow diagram (§6).

### 7.3 Add a database migration
1. Create `services/<svc>/migrations/<next 3-digit number>_<snake_description>.sql`.
2. Write forward-only SQL. Prefer additive changes (new nullable columns, new tables). Add indexes for new foreign keys/filters.
3. It runs automatically on service start (`runMigrations`).

### 7.4 Add a new microservice
1. Copy `services/commerce-service` structure → `services/<name>-service` (package name `@rental/<name>-service`).
2. Pick next free port (4005, 4006…). Set `SERVICE` constant and DB name `<name>_db`.
3. Add DB name to `docker/postgres-init.sh` (for existing volumes: `docker compose down -v` or create DB manually).
4. Add service block in `docker-compose.yml` (copy an existing one).
5. Add a route in `services/api-gateway/src/index.ts` + `*_SERVICE_URL` env in compose.
6. Add `-w @rental/<name>-service` to root `build` script and a `dev:<name>` script.
7. Update §1 table, §3, `docs/architecture.md`.

---

## 8. Commands

```bash
npm install                 # install all workspaces
npm run build               # type-check + compile everything  ← run before finishing ANY task
npm run dev:infra           # start only postgres + rabbitmq in docker
npm run dev:auth            # run one service locally with hot reload (also dev:property, dev:accounting, dev:commerce, dev:gateway)
npm run up                  # build & run full stack in docker  → http://localhost:8080
npm run logs / npm run down
```
RabbitMQ UI: http://localhost:15672 (rental / rental). Default admin: `admin@rental.local` / `admin12345`.

---

## 9. Definition of Done (checklist for every task)

- [ ] `npm run build` passes with no TypeScript errors.
- [ ] All new input validated with zod; all new routes have role + ownership checks.
- [ ] No cross-database queries, no cross-service imports.
- [ ] New schema changes are in a **new** migration file.
- [ ] Events published after commit; consumers idempotent.
- [ ] Docs updated: `docs/api.md`, `docs/events.md`, this file's tables if affected.
- [ ] No secrets, no `console.log`, no commented-out dead code.
- [ ] Summarize to the user: what changed, files touched, how to verify (curl example).

## 10. When unsure

- Prefer the **existing pattern** in the nearest similar file over inventing a new one.
- If a change requires breaking a golden rule (§2), **stop and ask the human** instead of proceeding.
- Do not add new dependencies without a clear reason; prefer Node built-ins and existing libs.
