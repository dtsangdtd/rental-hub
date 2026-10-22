# API Reference (via gateway `http://localhost:8080`)

All routes except register/login need the header `Authorization: Bearer <token>`.
Errors are returned as `{ "error": { "code", "message", "details?" } }`.

## Auth — `/api/auth`
| Method | Path | Roles | Body |
|---|---|---|---|
| POST | `/register` | public | `{ email, password, fullName, role?: landlord\|tenant }` |
| POST | `/login` | public | `{ email, password }` → `{ accessToken, user }` |
| GET | `/me` | any | — |
| GET/POST | `/users` | admin | POST: `{ email, password, fullName, role }` |

## Property — `/api/property`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/properties` | admin, landlord, accountant | includes `unit_count`, `occupied_count`, master tariffs, and banking info |
| POST | `/properties` | admin, landlord | `{ name, address, description?, electricityRate?, waterRate?, internetRate?, cleaningRate?, parkingRate?, bankName?, bankAccountNumber?, bankAccountName? }` |
| GET | `/properties/:id` | read roles | includes `units`, master tariffs, and banking info |
| PATCH | `/properties/:id` | admin, landlord | `{ name?, address?, description?, electricityRate?, waterRate?, internetRate?, cleaningRate?, parkingRate?, bankName?, bankAccountNumber?, bankAccountName? }` |
| POST | `/properties/:id/units` | admin, landlord | `{ name, baseRent, areaM2? }` |
| PATCH | `/units/:id` | admin, landlord | `{ name?, baseRent?, areaM2?, status?: vacant\|maintenance }` |
| GET | `/units/:unitId/occupants` | read roles | list occupants residing in the unit |
| POST | `/units/:unitId/occupants` | admin, landlord | `{ fullName, phone?, idNumber?, birthDate?, gender?, relationship?, vehiclePlate?, isPrimary?, notes? }` |
| PATCH | `/occupants/:id` | admin, landlord | update occupant info (CCCD, phone, vehicle plate, etc.) |
| DELETE | `/occupants/:id` | admin, landlord | remove occupant from unit |
| GET | `/tenants` | read roles | list all tenants |
| POST | `/tenants` | admin, landlord | `{ fullName, phone?, email?, idNumber?, userId?, streetAddress?, ward?, district?, city?, idIssueDate?, gender?, birthDate?, nationality? }` |
| PATCH | `/tenants/:id` | admin, landlord | update tenant info, address, or CCCD |
| DELETE | `/tenants/:id` | admin, landlord | delete tenant (prevented if has active leases) |
| GET | `/leases` | read roles | includes `unit_name`, `property_name`, `tenant_name`, `occupant_count`, and property master tariffs |
| POST | `/leases` | admin, landlord | `{ unitId, tenantId, startDate, endDate?, monthlyRent?, deposit?, currency?, dueDay? }` |
| POST | `/leases/:id/terminate` | admin, landlord | |

## Accounting — `/api/accounting`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/invoices?status=&period=` | any (scoped) | |
| GET | `/invoices/:id` | any (scoped) | includes `payments` |
| POST | `/invoices` | admin, accountant, landlord | `{ description, amount, dueDate, customerId?, currency? }` |
| POST | `/invoices/generate-rent` | finance roles | `{ period: "YYYY-MM" }` (idempotent) |
| POST | `/invoices/:id/payments` | finance roles | `{ amount, method: cash\|bank_transfer\|card\|ewallet, note? }` |
| POST | `/invoices/:id/void` | finance roles | only when nothing has been paid |
| GET/POST | `/expenses` | finance roles | `{ category, description, amount, spentOn, propertyId?, currency? }` |
| GET | `/reports/summary?from=&to=` | finance roles | income, expenses, profit and outstanding balance per currency |

## Commerce — `/api/commerce`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/products?category=&q=` | any | |
| POST | `/products` | admin, landlord | `{ sku, name, price, stock?, category?, currency?, description? }` |
| PATCH | `/products/:id` | owner or admin | |
| GET | `/orders` | any (own; admin/accountant see all) | |
| POST | `/orders` | any | `{ items: [{ productId, quantity }], note? }` |
| POST | `/orders/:id/cancel` | owner, admin, accountant | pending orders only |
| POST | `/orders/:id/fulfill` | admin | paid orders only |
