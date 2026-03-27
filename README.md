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

Root app environment file:

- [.env](/Users/euge/Startups/Marko/github/fonotp-web/.env)

Required values:

```env
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgres://localhost:5433/fonotp
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_VOICE_RUNTIME_BASE_URL=http://127.0.0.1:8090
JWT_SECRET=local-dev-secret
VOICE_TOKEN_TTL_SECONDS=300
VOICE_RUNTIME_INTERNAL_TOKEN=demo-runtime-secret
VOICE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

Runtime service environment file:

- [voice-runtime-demo/.env](/Users/euge/Startups/Marko/github/fonotp-web/voice-runtime-demo/.env)

```env
HOST=127.0.0.1
PORT=8090
OPENAI_API_KEY=your-openai-key
OPENAI_REALTIME_MODEL=gpt-realtime
SONIOX_API_KEY=your-soniox-api-key
SONIOX_REALTIME_MODEL=stt-rt-preview
CONTROL_PLANE_BASE_URL=http://127.0.0.1:3001
CONTROL_PLANE_RUNTIME_TOKEN=demo-runtime-secret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

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
set -a
source .env
set +a
npm run db:setup
```

For the local environment currently used in this project:

- PostgreSQL runs on port `5433`
- database name is `fonotp`

If you use a different port or database name, update `DATABASE_URL` in `.env`.

Important:

- `npm run db:setup` uses the `DATABASE_URL` from your shell environment
- `source .env` is required before running `npm run db:setup`
- the Node API itself reads `.env` automatically through `dotenv`

## Run Order

1. Start PostgreSQL.
2. Load schema and seed data if needed.
3. Start the API.
4. Install runtime dependencies.
5. Start the runtime service.
6. Start the frontend.

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

## Run Voice Runtime Demo

Install its dependencies:

```bash
npm --prefix voice-runtime-demo install
```

Start it:

```bash
npm run start:voice-runtime-demo
```

The runtime requires:

- `voice-runtime-demo/.env`
- a valid `OPENAI_API_KEY`
- `CONTROL_PLANE_RUNTIME_TOKEN` to exactly match `VOICE_RUNTIME_INTERNAL_TOKEN` in the root `.env`

## Build Frontend

```bash
npm run build
```

## Full Demo Startup

From the repo root:

1. Create the root env file at [.env](/Users/euge/Startups/Marko/github/fonotp-web/.env).
2. Create the runtime env file at [voice-runtime-demo/.env](/Users/euge/Startups/Marko/github/fonotp-web/voice-runtime-demo/.env).
3. Start PostgreSQL on port `5433`.
4. Initialize the database:

   ```bash
   set -a
   source .env
   set +a
   npm run db:setup
   ```

5. Start the control-plane API:

   ```bash
   npm run start:server
   ```

6. Install runtime dependencies:

   ```bash
   npm --prefix voice-runtime-demo install
   ```

7. Start the voice runtime:

   ```bash
   npm run start:voice-runtime-demo
   ```

8. Start the frontend:

   ```bash
   npm run dev
   ```

9. Open:

   ```text
   http://localhost:5173
   ```

10. Log in with:

- user email: `mara@novahealth.example`
- password: `demo-password`

11. In the user portal, use the `Voice Demo` panel to start and stop a WebRTC AI voice session.

The `Voice Demo` panel now lets you choose:

- agent
- language: `English`, `Italian`, or `Korean`
- STT provider:
  - `gpt-4o-mini-transcribe`
  - `Soniox`

Gateway routing:

- all browser WebRTC sessions terminate on our runtime gateway first
- the browser does not connect directly to the AI provider over WebRTC
- `OpenAI` STT mode sends microphone audio through our gateway upstream to the AI session
- `Soniox` STT mode still keeps the browser connected to our gateway for AI audio, while finalized Soniox transcripts are sent into the same gateway session

## Demo Health Checks

Control plane API:

```bash
curl -s http://127.0.0.1:3001/api/health
```

Voice runtime:

```bash
curl -s http://127.0.0.1:8090/health
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
- `GET /api/agents`
- `POST /api/voice/token`
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

## Voice Demo Control Plane

This repo now provides the minimum control-plane APIs needed for a separate `voice-runtime-demo` service.

Public authenticated endpoints:

- `GET /api/agents`
  - returns agents for the signed-in user's organization
- `POST /api/agents`
  - creates an AI agent owned by the signed-in user
- `POST /api/voice/token`
  - input: `agentId`
  - returns:
    - `voiceToken`
    - `expiresAt`
    - `runtimeUrl`
    - `iceServers`
    - selected `agent`

Internal runtime endpoints:

- `POST /api/internal/voice/resolve-token`
  - auth: `Authorization: Bearer $VOICE_RUNTIME_INTERNAL_TOKEN`
  - input: `voiceToken`
  - returns org, user, and agent context for the runtime
- `POST /api/internal/voice/calls`
  - auth: `Authorization: Bearer $VOICE_RUNTIME_INTERNAL_TOKEN`
  - upserts a WebRTC/browser call record and transcript summary

Expected demo flow:

1. User logs into `fonotp-web`.
2. Browser calls `POST /api/voice/token` for a selected agent.
3. Browser opens a WebRTC session to the separate runtime gateway service using the returned `voiceToken`.
4. The runtime gateway resolves the token through `POST /api/internal/voice/resolve-token`.
5. The runtime gateway opens its own upstream realtime AI session.
6. Audio and realtime events are bridged through our gateway instead of direct browser-to-provider WebRTC.
7. The runtime gateway saves the final call summary and transcript through `POST /api/internal/voice/calls`.

The browser voice UI is available from the signed-in user portal and uses:

- control plane at `VITE_API_BASE_URL`
- runtime service at `VITE_VOICE_RUNTIME_BASE_URL`

## Agent Schema

Each AI agent is stored in the `agents` table and belongs to an organization and a creating user.

Required string fields:

- `stt_type`
- `stt_prompt`
- `llm_type`
- `llm_prompt`
- `tts_type`
- `tts_prompt`
- `tts_voice`

Other agent fields:

- `id`
- `organization_id`
- `created_by_user_id`
- `name`
- `slug`
- `status`
- `channel`
- `runtime_url`
- `created_at`
- `updated_at`

`runtime_url` should be a WebSocket endpoint using the shared downstream audio contract.

Examples:

- local built-in runtime: `ws://127.0.0.1:8090/ws`
- external `aibot`: `ws://127.0.0.1:8000/ws`

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
