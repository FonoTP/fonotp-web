# Run Voice Runtime Demo

This runbook starts the browser voice demo with:

- `fonotp-web` as the control plane and product DB
- `fonotp-gateway` as the only browser-facing WebRTC gateway
- `voice-runtime-demo` as the downstream `/ws` bot backend

This is the current supported local demo path for:

```text
browser -> fonotp-gateway -> voice-runtime-demo -> OpenAI
browser <- fonotp-gateway <- voice-runtime-demo <- OpenAI
```

`voice-runtime-demo` now follows the same downstream contract as `aibot`:

- `fonotp-gateway` creates a locked `callsessions` row in `fonotp-web`
- the gateway sends only the `callsession` UUID over `/ws`
- `voice-runtime-demo` resolves the session from the control plane instead of trusting websocket overrides

## Repos

- `fonotp-web`: `/Users/euge/Startups/Marko/github/fonotp-web`
- `fonotp-gateway`: `/Users/euge/Startups/Marko/github/fonotp-gateway`
- `voice-runtime-demo`: `/Users/euge/Startups/Marko/github/fonotp-web/voice-runtime-demo`

## Ports

- `fonotp-web` API: `3001`
- frontend dev server: `5173`
- `fonotp-gateway`: `8080`
- `voice-runtime-demo`: `8000`
- Postgres: `5433`

## 1. Configure `fonotp-web`

Create [/.env](/Users/euge/Startups/Marko/github/fonotp-web/.env):

```env
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgres://localhost:5433/fonotp
VITE_API_BASE_URL=http://127.0.0.1:3001/api
VITE_VOICE_GATEWAY_BASE_URL=http://127.0.0.1:8080
JWT_SECRET=local-dev-secret
VOICE_TOKEN_TTL_SECONDS=300
VOICE_RUNTIME_INTERNAL_TOKEN=demo-runtime-secret
VOICE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

## 2. Configure `fonotp-gateway`

Create [/Users/euge/Startups/Marko/github/fonotp-gateway/.env](/Users/euge/Startups/Marko/github/fonotp-gateway/.env):

```env
HOST=127.0.0.1
PORT=8080
LOG_LEVEL=info
CONTROL_PLANE_BASE_URL=http://127.0.0.1:3001
CONTROL_PLANE_RUNTIME_TOKEN=demo-runtime-secret
SESSION_TTL_SECONDS=900
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
ALLOWED_BROWSER_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
ALLOWED_SERVICE_ORIGINS=ws://127.0.0.1:8000
SONIOX_API_KEY=your_soniox_key
SONIOX_REALTIME_MODEL=stt-rt-preview
```

Notes:

- `ALLOWED_SERVICE_ORIGINS` must contain the websocket origin only
- do not include `/ws`

## 3. Configure `voice-runtime-demo`

Create [voice-runtime-demo/.env](/Users/euge/Startups/Marko/github/fonotp-web/voice-runtime-demo/.env):

```env
HOST=127.0.0.1
PORT=8000
OPENAI_API_KEY=your_openai_key
OPENAI_REALTIME_MODEL=gpt-realtime
CONTROL_PLANE_BASE_URL=http://127.0.0.1:3001
CONTROL_PLANE_RUNTIME_TOKEN=demo-runtime-secret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SONIOX_API_KEY=your_soniox_key
SONIOX_REALTIME_MODEL=stt-rt-preview
```

Notes:

- `voice-runtime-demo` now runs on `8000` by default
- this matches the same port convention used for `aibot`
- run either `voice-runtime-demo` or `aibot` on `8000`, not both at the same time
- `voice-runtime-demo` loads its own `voice-runtime-demo/.env`
- it should not try to use the root app `PORT=3001`

## 4. Reset and seed the `fonotp-web` database

From `/Users/euge/Startups/Marko/github/fonotp-web`:

```bash
set -a
source .env
set +a
npm run db:setup
```

The main product tables used by this demo are:

- `platform_users`
- `agents_defs`
- `voice_session_tokens`
- `callsessions`
- `agent_sessions`
- `agent_session_events`

## 5. Point an agent at `voice-runtime-demo`

The current seed should use `8000`, but verify or force it.

Run:

```bash
psql -p 5433 -d fonotp -c "update agents_defs set runtime_url = 'ws://127.0.0.1:8000/ws' where public_id = 'agent-nova-intake';"
```

To confirm:

```bash
psql -p 5433 -d fonotp -c "select public_id, runtime_url from agents_defs;"
```

Expected for the test agent:

```text
agent-nova-intake | ws://127.0.0.1:8000/ws
```

## 6. Install dependencies

### `fonotp-web`

From `/Users/euge/Startups/Marko/github/fonotp-web`:

```bash
npm install
```

### `fonotp-gateway`

From `/Users/euge/Startups/Marko/github/fonotp-gateway`:

```bash
npm install
```

### `voice-runtime-demo`

From `/Users/euge/Startups/Marko/github/fonotp-web`:

```bash
npm --prefix voice-runtime-demo install
```

## 7. Start all services

Use four terminals.

If old processes are still running, stop them first so ports are free:

- `3001` for `fonotp-web`
- `5173` for the frontend
- `8080` for `fonotp-gateway`
- `8000` for `voice-runtime-demo`

### Terminal 1: `fonotp-web` API

```bash
cd /Users/euge/Startups/Marko/github/fonotp-web
npm run start:server
```

### Terminal 2: `fonotp-web` frontend

```bash
cd /Users/euge/Startups/Marko/github/fonotp-web
npm run dev
```

### Terminal 3: `fonotp-gateway`

```bash
cd /Users/euge/Startups/Marko/github/fonotp-gateway
npm start
```

Expected line:

```text
Server listening at http://127.0.0.1:8080
```

### Terminal 4: `voice-runtime-demo`

```bash
cd /Users/euge/Startups/Marko/github/fonotp-web
npm run start:voice-runtime-demo
```

Expected line:

```text
voice-runtime-demo listening on http://127.0.0.1:8000
```

## 8. Quick rerun order

After the first setup, the normal rerun sequence is just:

1. Start `fonotp-web` API
2. Start `fonotp-gateway`
3. Start `voice-runtime-demo`
4. Start the frontend
5. Open `http://localhost:5173`

You only need to rerun `npm run db:setup` when:

- the schema changed
- the seed data changed
- you want a clean local reset

## 9. Health checks

### `fonotp-web`

```bash
curl -s http://127.0.0.1:3001/api/health
```

### `fonotp-gateway`

```bash
curl -s http://127.0.0.1:8080/health
```

### `voice-runtime-demo`

```bash
curl -s http://127.0.0.1:8000/health
```

## 10. Log in to the app

Open:

```text
http://localhost:5173
```

Use:

- email: `mara@novahealth.example`
- password: `demo-password`

## 11. First test sequence

In the Voice Demo panel:

1. Select agent `Nova Intake Assistant`
2. Set language to `English`
3. Set STT mode to `OpenAI`
4. Click `Start voice session`
5. Allow microphone access
6. Speak a short sentence

Start with `OpenAI` STT first. Do not start with `Soniox`.

## 12. What should happen

Expected path:

1. Browser connects to `fonotp-gateway`
2. `fonotp-gateway` resolves the `voiceToken` against `fonotp-web`
3. `fonotp-gateway` creates a `callsessions` row in `fonotp-web`
4. `fonotp-gateway` opens `ws://127.0.0.1:8000/ws`
5. `voice-runtime-demo` receives only the `callsession` UUID and resolves the runtime config from the control plane
5. Audio should return through `fonotp-gateway` back to the browser

## 13. If you want to test `Soniox`

Only test this after the `OpenAI` STT path works.

Requirements:

- valid `SONIOX_API_KEY` in `fonotp-gateway/.env`
- valid `SONIOX_API_KEY` in `voice-runtime-demo/.env`

Then in the UI:

1. keep the same agent
2. change STT mode to `Soniox`
3. start a fresh voice session

## 14. Common failure cases

### CORS preflight fails on gateway

Symptom in `fonotp-gateway` logs:

```text
Route OPTIONS:/api/webrtc/session not found
```

Fix:

- make sure `ALLOWED_BROWSER_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
- restart `fonotp-gateway`

### Gateway rejects the bot backend

Symptom in `fonotp-gateway` logs:

```text
Service origin ws://127.0.0.1:8000 is not allowed
```

Fix:

- set `ALLOWED_SERVICE_ORIGINS=ws://127.0.0.1:8000`
- restart `fonotp-gateway`

Important:

- do not put `/ws` in `ALLOWED_SERVICE_ORIGINS`

### Gateway tries to connect to the wrong port

Symptom in `fonotp-gateway` logs:

```text
connect ECONNREFUSED 127.0.0.1:8090
```

Cause:

- the agent `runtime_url` in the DB still points to `ws://127.0.0.1:8090/ws`

Fix:

```bash
psql -p 5433 -d fonotp -c "update agents_defs set runtime_url = 'ws://127.0.0.1:8000/ws' where runtime_url = 'ws://127.0.0.1:8090/ws';"
```

### Browser gets no audio

Check:

- `voice-runtime-demo` is actually running on `8000`
- the selected agent points to `ws://127.0.0.1:8000/ws`
- browser transcript/events panel shows the remote track attach event

### `voice-runtime-demo` binds to `3001`

Cause:

- it loaded the root `.env` instead of `voice-runtime-demo/.env`

This was patched. If you still see it, restart from the updated code and confirm:

```env
voice-runtime-demo/.env -> PORT=8000
```

### No rows appear for the new session in the DB

The current runtime persistence writes to:

- `agent_sessions`
- `agent_session_events`

Check:

```bash
psql -p 5433 -d fonotp -c "select id, runtime_session_id, agent_id, session_status, started_at from agent_sessions order by created_at desc limit 10;"
```

And transcript/event lines:

```bash
psql -p 5433 -d fonotp -c "select agent_session_id, position, event_type, line from agent_session_events order by created_at desc limit 20;"
```

## 15. Logs to inspect when debugging

If the call still fails, capture:

### `fonotp-gateway` log

Look for:

- `POST /api/webrtc/session`
- websocket connect errors to `127.0.0.1:8000`
- service-origin allowlist errors

### `voice-runtime-demo` log

Look for:

- downstream websocket session start
- OpenAI realtime connect errors
- Soniox errors if using that mode

### Browser UI

Look for:

- user transcript lines
- agent transcript lines
- remote audio attached events

## 16. Current architecture

Single product DB:

- `fonotp-web` owns users, `agents_defs`, voice tokens, agent sessions, and transcripts

No product DB in:

- `fonotp-gateway`
- `voice-runtime-demo`
