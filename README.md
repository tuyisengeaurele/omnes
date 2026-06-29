# OMNES ERP

Enterprise Resource Planning system for brick/clay manufacturing companies.

## Modules

- **Human Resources** — employees, attendance, leave, payroll
- **Production** — batch tracking, kiln management, product types
- **Inventory** — raw materials, stock movements
- **Procurement** — suppliers, purchase orders, goods receiving
- **Sales** — customers, invoices, proformas, payments
- **Finance** — chart of accounts, journal entries, expenses
- **Assets** — fixed assets, depreciation, maintenance
- **Reports** — production, sales, P&L, inventory reports

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Shadcn/ui, TanStack Query, Recharts  
**Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL 15  
**Auth:** JWT (access 15m / refresh 7d with single-use rotation)

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 15 (running locally)
- npm 10+

### Setup

```bash
# 1. Install all dependencies
npm install

# 2. Create environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Edit both .env files with your local values

# 3. Create the database
createdb omnes_erp

# 4. Run database migrations
cd apps/api
npx prisma migrate dev --name init

# 5. Seed the database (creates admin user + company settings)
npx prisma db seed

# 6. Start both servers from the root
cd ../..
npm run dev
```

### Default Credentials

- **URL:** http://localhost:5173
- **Email:** admin@omnes.rw
- **Password:** Admin@2025!

### API

- **Base URL:** http://localhost:3001/api
- **Health check:** http://localhost:3001/api/health

## Project Structure

```
omnes/
├── apps/
│   ├── api/          # Express + Prisma backend
│   └── web/          # React + Vite frontend
├── docs/
└── package.json      # Root workspace config
```

## Currency

All monetary values are in RWF (Rwandan Franc). Format: `RWF 1,234,567`

## License

Proprietary — OMNES Manufacturing Ltd
