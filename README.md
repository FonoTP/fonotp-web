# FonoTP Admin

Multi-tenant telephony-to-AI admin platform with:

- a React frontend
- a Node/Express API
- a PostgreSQL database

The platform is designed for organizations using SIP, WebRTC, API-triggered calls, AI voice services, and routing logic managed from one control plane.

## Product Scope

Core products represented in the UI:

- SIP Bridge
- WebRTC Gateway
- AI Bot Service
- Service Builder

Example flow:

1. A call is received via SIP or initiated via API.
2. Audio is routed through the SIP Bridge or WebRTC Gateway.
3. The stream is forwarded via WebSocket to the AI Bot Service.
4. AI processes audio and returns responses in real time.
5. Service Builder determines flow, behavior, and routing.
6. Audio is streamed back to the caller or client.

## Current Features

- Admin dashboard at `/dashboard`
- User portal at `/`
- User login
- User self-signup
- Admin login
- Multi-tenant organization management
- User creation and role assignment
- Call logs with stored transcript snippets
- Usage tracking for characters in and characters out
- Billing overview and invoice data
- JWT-based authentication
- Bcrypt password hashing
- Session persistence in browser local storage

## Local URLs

- Frontend user portal: `http://localhost:5173/`
- Frontend admin dashboard: `http://localhost:5173/dashboard`
- API: `http://127.0.0.1:3001`
- API health check: `http://127.0.0.1:3001/api/health`

## Environment Variables

Configured in [.env](/Users/euge/Startups/Marko/fonotp-web/.env).

Required values:

```env
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgres://localhost:5433/fonotp
VITE_API_BASE_URL=http://localhost:3001/api
JWT_SECRET=local-dev-secret
```

Template file:

- [.env.example](/Users/euge/Startups/Marko/fonotp-web/.env.example)

## Project Structure

- Frontend app: [src/App.tsx](/Users/euge/Startups/Marko/fonotp-web/src/App.tsx)
- Shared frontend API client: [src/api.ts](/Users/euge/Startups/Marko/fonotp-web/src/api.ts)
- Login UI: [src/components/LoginView.tsx](/Users/euge/Startups/Marko/fonotp-web/src/components/LoginView.tsx)
- Backend API: [server/index.js](/Users/euge/Startups/Marko/fonotp-web/server/index.js)
- Database schema: [server/db/schema.sql](/Users/euge/Startups/Marko/fonotp-web/server/db/schema.sql)
- Database seed data: [server/db/seed.sql](/Users/euge/Startups/Marko/fonotp-web/server/db/seed.sql)

## Installation

```bash
npm install
```

## Database Setup

Create the PostgreSQL database and load the schema and seed:

```bash
createdb -p 5433 fonotp
psql -p 5433 -d fonotp -f server/db/schema.sql
psql -p 5433 -d fonotp -f server/db/seed.sql
```

For the local environment currently used in this project:

- PostgreSQL runs on port `5433`
- database name is `fonotp`

If you use a different port or database name, update `DATABASE_URL` in `.env`.

## Run Order

1. Start PostgreSQL.
2. Load schema and seed data if needed.
3. Start the API.
4. Start the frontend.

## Run API

```bash
npm run start:server
```

Dev watch mode:

```bash
npm run dev:server
```

## Run Frontend

```bash
npm run dev
```

## Build Frontend

```bash
npm run build
```

## Database Reset

To reset the local database:

```bash
psql -p 5433 -d fonotp -f server/db/schema.sql
psql -p 5433 -d fonotp -f server/db/seed.sql
```

## Authentication

Implemented auth behavior:

- `POST /api/auth/signup` creates a user account
- `POST /api/auth/login` logs in admin or user accounts
- `GET /api/auth/me` returns the authenticated user
- `GET /api/me/account` returns the signed-in user's account payload

Notes:

- Passwords are hashed with `bcryptjs`
- Tokens are signed with `jsonwebtoken`
- Frontend stores auth token and portal type in local storage
- Admin endpoints require an authenticated admin-capable role

## Main API Areas

- `GET /api/health`
- `GET /api/organizations`
- `GET /api/organizations/:organizationId/summary`
- `GET /api/organizations/:organizationId/users`
- `POST /api/organizations/:organizationId/users`
- `GET /api/organizations/:organizationId/calls`
- `GET /api/organizations/:organizationId/billing`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/me/account`

## Demo Accounts

- Admin: `owner@fonotp.ai` / `demo-password`
- User: `mara@novahealth.example` / `demo-password`

## Seeded Demo Data

The seed currently includes:

- multiple organizations
- admin and user accounts
- call records
- transcript entries
- billing records

## What Works Now

- user signup creates real accounts in PostgreSQL
- user login works with hashed passwords
- admin login works with hashed passwords
- admin-created users are inserted into PostgreSQL
- user portal data is fetched from authenticated API endpoints
- admin dashboard data is fetched from PostgreSQL-backed endpoints

## Still Missing

- password reset flow
- change password flow
- email verification
- secure cookie sessions
- route guards with a full router
- production-grade authorization model
- audit logging

## Useful Commands

Install dependencies:

```bash
npm install
```

Start frontend:

```bash
npm run dev
```

Start backend:

```bash
npm run start:server
```

Build frontend:

```bash
npm run build
```
