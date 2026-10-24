# API Reference (via gateway `http://localhost:8080`)

All routes except register/login need the header `Authorization: Bearer <token>`.
Errors are returned as `{ "error": { "code", "message", "details?" } }`.

## Auth — `/api/auth`
| Method | Path | Roles | Body |
|---|---|---|---|
| POST | `/register` | public | `{ email, password, fullName, role?: landlord\|tenant }` |
| POST | `/login` | public | `{ email, password }` → `{ accessToken, user }` |
| GET | `/me` | any | — |
| GET | `/users?page=&limit=&q=` | admin | paginated list, search by name or email |
| POST | `/users` | admin | `{ email, password, fullName, role }` |

## Property — `/api/property`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/properties?page=&limit=&q=` | admin, landlord, accountant | paginated list, search by name/address/description, includes `unit_count`, `occupied_count`, master tariffs |
| POST | `/properties` | admin, landlord | `{ name, address, description?, electricityRate?, waterRate?, internetRate?, cleaningRate?, parkingRate?, bankName?, bankAccountNumber?, bankAccountName? }` |
| GET | `/properties/:id` | read roles | includes `units`, master tariffs, and banking info |
| PATCH | `/properties/:id` | admin, landlord | `{ name?, address?, description?, electricityRate?, waterRate?, internetRate?, cleaningRate?, parkingRate?, bankName?, bankAccountNumber?, bankAccountName? }` |
| POST | `/properties/:id/units` | admin, landlord | `{ name, baseRent, areaM2? }` |
| PATCH | `/units/:id` | admin, landlord | `{ name?, baseRent?, areaM2?, status?: vacant\|maintenance }` |
| GET | `/units/:unitId/occupants` | read roles | list occupants residing in the unit |
| POST | `/units/:unitId/occupants` | admin, landlord | `{ fullName, phone?, idNumber?, birthDate?, gender?, relationship?, vehiclePlate?, isPrimary?, notes? }` |
| PATCH | `/occupants/:id` | admin, landlord | update occupant info (CCCD, phone, vehicle plate, etc.) |
| DELETE | `/occupants/:id` | admin, landlord | remove occupant from unit |
| GET | `/tenants?page=&limit=&q=` | read roles | paginated list, search by name, phone, email, CCCD, address |
| POST | `/tenants` | admin, landlord | `{ fullName, phone?, email?, idNumber?, userId?, streetAddress?, ward?, district?, city?, idIssueDate?, gender?, birthDate?, nationality? }` |
| PATCH | `/tenants/:id` | admin, landlord | update tenant info, address, or CCCD |
| DELETE | `/tenants/:id` | admin, landlord | delete tenant (prevented if has active leases) |
| GET | `/leases?page=&limit=&status=&q=` | read roles | paginated list, search by room, property, tenant name, phone; includes tariffs & occupant count |
| POST | `/leases` | admin, landlord | `{ unitId, tenantId, startDate, endDate?, monthlyRent?, deposit?, currency?, dueDay? }` |
| POST | `/leases/:id/terminate` | admin, landlord | |
| GET | `/residence?page=&limit=&propertyId=&status=&search=&q=` | read roles | paginated list of residents (occupants & tenants), search by name, CCCD, phone, room, code |
| GET | `/residence/stats` | read roles | aggregated counts (total, not_registered, pending, registered, expiring_soon, expired, temporary_absence) |
| PUT | `/residence/:type/:id` | admin, landlord | `{ tempRegStatus, tempRegStartDate?, tempRegEndDate?, tempRegCode?, tempRegNotes?, tempAbsenceReason?, tempAbsenceDestination? }` |
| GET | `/residence/:type/:id/ct01` | read roles | pre-filled official Mẫu CT01 declaration data with resident, landlord, property and roommates |
| POST | `/internal/contracts/validate-tenant` | internal microservice | `{ propertyId, roomNumber, phoneNumber }` → validates active lease and occupant registry for zero-friction order verification |

## Accounting — `/api/accounting`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/invoices?page=&limit=&status=&period=&referenceId=&q=` | any (scoped) | paginated list, search by invoice # or description |
| GET | `/invoices/:id` | any (scoped) | includes `payments` |
| POST | `/invoices` | admin, accountant, landlord | `{ description, amount, dueDate, customerId?, currency? }` |
| POST | `/invoices/generate-rent` | finance roles | `{ period: "YYYY-MM" }` (idempotent) |
| POST | `/invoices/auto-generate` | finance roles | `{ period?: "YYYY-MM" }` (generates rent invoices on day 5 for active leases in auto_invoice properties) |
| POST | `/invoices/sync-bill` | finance roles | `{ leaseId, period, description, amount, metadata, ... }` (upsert/sync invoice from Rental Bill) |
| POST | `/invoices/:id/payments` | finance roles | `{ amount, method: cash\|bank_transfer\|card\|ewallet, note? }` |
| POST | `/invoices/:id/void` | finance roles | only when nothing has been paid |
| GET | `/expenses?page=&limit=&category=&search=&q=` | finance roles | paginated list, search by description |
| POST | `/expenses` | finance roles | `{ category, description, amount, spentOn, propertyId?, currency? }` |
| GET | `/reports/summary?from=&to=` | finance roles | income, expenses, profit and outstanding balance per currency |

## Commerce — `/api/commerce`
| Method | Path | Roles | Body / notes |
|---|---|---|---|
| GET | `/categories` | public / any | List active grocery and FMCG categories (includes `created_by` to identify landlord custom categories vs system defaults) |
| POST | `/categories` | admin, landlord | `{ name, slug?, iconName?, sortOrder?, propertyId?, description? }` (records `created_by = user.id`) |
| PATCH | `/categories/:id` | admin, landlord | `{ name?, slug?, iconName?, sortOrder?, isActive?, description? }` (ownership check: landlord only edits own categories) |
| DELETE | `/categories/:id` | admin, landlord | Soft delete / deactivate grocery category (landlord only deletes own categories) |
| GET | `/hubs` | public / any | List inventory hubs / buildings |
| POST | `/hubs` | admin, landlord | `{ propertyId, name, address, managerUserId? }` |
| GET | `/products?page=&limit=&category=&hubId=&isCombo=&q=&all=` | any | paginated list with multi-UOMs, live hub stock, and JOIN to `grocery_categories` table |
| GET | `/products/lookup-barcode?code=&hubId=` | any / POS | Fast barcode scanner lookup (matches packaging/UOM barcode, product barcode, or SKU) with packaging factor & hub stock |
| POST | `/products` | admin, landlord | `{ sku, name, price, categoryId (Foreign Key to grocery_categories), stock?, currency?, description?, isCombo?, barcode? }` |
| PATCH | `/products/:id` | owner or admin | update product details |
| POST | `/products/:id/uoms` | admin, landlord | `{ uomName, conversionFactor, retailPrice, wholesalePrice?, barcode?, isDefault? }` |
| POST | `/pos/checkout` | admin, landlord | Instant Counter POS Checkout: `{ hubId?, customerType: 'RETAIL'\|'TENANT', roomNumber?, recipientName?, recipientPhone?, paymentMethod: 'CASH'\|'VIETQR'\|'DEBT_ADDED_TO_RENT', cashGiven?, items: [{ productId, uomId?, quantity }] }` |
| POST | `/checkout` | public / any | Guest & Tenant checkout: `{ customerType: 'TENANT'\|'RETAIL', propertyId?, roomNumber?, recipientAddress?, recipientName, recipientPhone, deliveryType, paymentMethod: 'COD'\|'VIETQR'\|'DEBT_ADDED_TO_RENT', items, note? }` |
| GET | `/guest/orders?phone=` | public | Search past guest orders by recipient phone number |
| GET | `/orders/:id` | public / any | View order tracking and line items (guests can access directly by UUID) |
| GET | `/orders?page=&limit=&status=&startDate=&endDate=&source=&q=` | any (own; admin/accountant/landlord see all) | paginated list, filter by status, date range (ngày/tháng/năm), source (POS/TENANT/ONLINE) and search |
| GET | `/orders/revenue-stats?startDate=&endDate=&source=&propertyId=` | admin, landlord, accountant | Revenue analytics (today, month, year, selected period, payment breakdown by CASH/VIETQR/DEBT, daily breakdown) |
| POST | `/orders` | any | standard checkout: `{ items: [{ productId, quantity }], note? }` |
| POST | `/orders/:id/deliver` | admin, landlord | Mark order delivered. Publishes `tenant.debt.charge_requested` to accounting service to add grocery debt to room monthly invoice |
| POST | `/orders/:id/cancel` | owner, admin, accountant | pending orders only |
| POST | `/orders/:id/fulfill` | admin | paid orders only |
| POST | `/inventory/import-batch` | admin, landlord | `{ hubId, productId, batchNumber, expDate, quantity, costPrice?, mfgDate? }` |
| POST | `/inventory/barcode-import` | admin, landlord | Barcode Scanner Inbound Stocking: `{ hubId, barcode, quantity, batchNumber?, expDate, costPrice?, mfgDate?, note? }` (multiplies by packaging factor) |
| GET | `/inventory/batches?hubId=&productId=` | admin, landlord | list batches with near-expiry alerts |
| GET | `/events/orders-stream` | any (SSE) | Realtime Server-Sent Events stream for landlord chime sound and toast popups |

