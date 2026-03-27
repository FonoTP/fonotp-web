# Run AIBOT Demo

This runbook starts the browser voice demo with:

- `fonotp-web` as the control plane and product DB
- `fonotp-gateway` as the only browser-facing WebRTC gateway
- `aibot` as the downstream `/ws` bot backend

## Repos

- `fonotp-web`: `/Users/euge/Startups/Marko/github/fonotp-web`
- `fonotp-gateway`: `/Users/euge/Startups/Marko/github/fonotp-gateway`
- `aibot`: `/Users/euge/Startups/Marko/github/aibot`

## Ports

- `fonotp-web` API: `3001`
- frontend dev server: `5173`
- `fonotp-gateway`: `8080`
- `aibot`: `8000`
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

- `ALLOWED_SERVICE_ORIGINS` must be the websocket origin only, not `/ws`
- for `aibot` on port `8000`, the allowed origin is `ws://127.0.0.1:8000`

## 3. Configure `aibot`

Create [/Users/euge/Startups/Marko/github/aibot/.env](/Users/euge/Startups/Marko/github/aibot/.env):

```env
OPENAI_API_KEY=your_openai_key
SONIOX_API_KEY=your_soniox_key
OPENAI_URL=wss://api.openai.com/v1/realtime?model=gpt-realtime
SONIOX_URL=wss://stt-rt.soniox.com/transcribe-websocket
```

Notes:

- `aibot` is now stateless for this flow
- it does not need its own product database
- `fonotp-gateway` sends the full agent config to `aibot` over `/ws`

## 4. Reset and seed the `fonotp-web` database

From `/Users/euge/Startups/Marko/github/fonotp-web`:

```bash
set -a
source .env
set +a
npm run db:setup
```

This loads the schema and seed data into:

- `postgres://localhost:5433/fonotp`

## 5. Point an agent at `aibot`

The current seed may already use `8000`, but verify or force it.

Run:

```bash
psql -p 5433 -d fonotp -c "update agents set runtime_url = 'ws://127.0.0.1:8000/ws' where id = 'agent-nova-intake';"
```

To confirm:

```bash
psql -p 5433 -d fonotp -c "select id, runtime_url from agents;"
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

### `aibot`

From `/Users/euge/Startups/Marko/github/aibot`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 7. Start all services

Use four terminals.

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

### Terminal 4: `aibot`

```bash
cd /Users/euge/Startups/Marko/github/aibot
source .venv/bin/activate
uvicorn ai_bot.ai_bot:app --host 127.0.0.1 --port 8000
```

Expected lines:

```text
Uvicorn running on http://127.0.0.1:8000
```

## 8. Health checks

### `fonotp-web`

```bash
curl -s http://127.0.0.1:3001/api/health
```

### `fonotp-gateway`

```bash
curl -s http://127.0.0.1:8080/health
```

### `aibot`

`aibot` does not expose a health route in this flow. A simple port check is enough:

```bash
python3 - <<'PY'
import socket
s = socket.socket()
print(s.connect_ex(("127.0.0.1", 8000)))
s.close()
PY
```

Expected output:

```text
0
```

## 9. Log in to the app

Open:

```text
http://localhost:5173
```

Use:

- email: `mara@novahealth.example`
- password: `demo-password`

## 10. First test sequence

In the Voice Demo panel:

1. Select agent `Nova Intake Assistant`
2. Set language to `English`
3. Set STT mode to `OpenAI`
4. Click `Start voice session`
5. Allow microphone access
6. Speak a short sentence

Start with `OpenAI` STT first. Do not start with `Soniox`. That removes one variable.

## 11. What should happen

Expected path:

1. Browser connects to `fonotp-gateway`
2. `fonotp-gateway` resolves the `voiceToken` against `fonotp-web`
3. `fonotp-gateway` opens `ws://127.0.0.1:8000/ws`
4. `fonotp-gateway` sends `aibot` the full agent config
5. `aibot` runs the realtime model
6. Audio should return from `aibot` through `fonotp-gateway` back to the browser

## 12. If you want to test `Soniox`

Only test this after the `OpenAI` STT path works.

Requirements:

- valid `SONIOX_API_KEY` in `fonotp-gateway/.env`
- valid `SONIOX_API_KEY` in `aibot/.env`

Then in the UI:

1. keep the same agent
2. change STT mode to `Soniox`
3. start a fresh voice session

## 13. Common failure cases

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
psql -p 5433 -d fonotp -c "update agents set runtime_url = 'ws://127.0.0.1:8000/ws' where runtime_url = 'ws://127.0.0.1:8090/ws';"
```

### `aibot` says unsupported STT or LLM

Previous symptom:

```text
Unsupported stt gpt-4o-mini-transcribe
```

This was patched. If you still see it, restart `aibot` from the updated code.

### `aibot` crashes with `InputTransport` missing `next`

Previous symptom:

```text
AttributeError: 'InputTransport' object has no attribute 'next'
```

Cause:

- pipeline initialization failed before all stages were connected

This was patched. If you still see it, restart `aibot` from the updated code.

## 14. Logs to inspect when debugging

If the call still fails, capture:

### `fonotp-gateway` log

Look for:

- `POST /api/webrtc/session`
- websocket connect errors to `127.0.0.1:8000`
- service-origin allowlist errors

### `aibot` log

Look for:

- `WebSocket connection accepted`
- startup errors in `pipeline.py`
- OpenAI websocket errors

### Browser UI

Look for:

- user transcript lines
- agent transcript lines
- remote audio attached events

## 15. Current architecture

Single product DB:

- `fonotp-web` owns users, agents, tokens, calls, and transcripts

No product DB in:

- `fonotp-gateway`
- `aibot`

Runtime flow:

```text
browser -> fonotp-gateway -> aibot -> OpenAI
browser <- fonotp-gateway <- aibot <- OpenAI
```
