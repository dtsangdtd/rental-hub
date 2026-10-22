# RentalHub 🏠

A microservices platform for **managing rental homes**: properties, units, tenants and leases, plus **accounting** (invoices, payments, expenses, P&L reports) and a small **e-commerce** store (products and orders).

Built with Node.js + TypeScript, PostgreSQL (one database per service), RabbitMQ and Docker Compose.
It is designed so **AI agents can work on it on their own**; see [AGENTS.md](AGENTS.md).

## Quick start

```bash
cp .env.example .env      # optional
npm install
npm run up                # build and start everything in Docker
```

The gateway runs at http://localhost:8080 and the RabbitMQ UI at http://localhost:15672 (login `rental` / `rental`).

### Frontend (Angular)
```bash
npm run dev:frontend      # starts Angular at http://localhost:4200 (proxies /api to :8080)
# or build for production:
npm run build:frontend
```

### Try it (PowerShell)
```powershell
$t = (irm -Method Post http://localhost:8080/api/auth/login -ContentType 'application/json' `
      -Body '{"email":"admin@rental.local","password":"admin12345"}').accessToken
$h = @{ Authorization = "Bearer $t" }
$p = irm -Method Post http://localhost:8080/api/property/properties -Headers $h -ContentType 'application/json' `
      -Body '{"name":"Sunrise House","address":"12 Le Loi, District 1"}'
irm http://localhost:8080/api/property/properties -Headers $h
```

## Docs
- [AGENTS.md](AGENTS.md): rules and workflows for AI agents (and humans)
- [docs/architecture.md](docs/architecture.md)
- [docs/events.md](docs/events.md)
- [docs/api.md](docs/api.md)
