# Appointment Agent Runtime

Voice and text runtime for the `Appointment Agent` template.

This runtime is modeled after the downstream `aibot` shape:

- websocket endpoint for browser/gateway audio sessions
- OpenAI realtime connection for speech in/out
- appointment-specific tool execution through `fonotp-web`
- final transcript persistence back into `fonotp-web`

`fonotp-web` remains the source of truth for workers, clients, appointments, and completed call records.

## Start

From the repo root:

```bash
npm run start:appointment-agent-runtime
```

For local development:

```bash
npm run dev:appointment-agent-runtime
```

Default runtime URL:

```text
ws://127.0.0.1:3011/ws
http://127.0.0.1:3011/health
```

## Environment

The runtime reads values from the repo root `.env`.

Important values:

```env
APPOINTMENT_AGENT_RUNTIME_HOST=127.0.0.1
APPOINTMENT_AGENT_RUNTIME_PORT=3011
APPOINTMENT_AGENT_RUNTIME_TOKEN=demo-appointment-runtime-secret
CONTROL_PLANE_BASE_URL=http://127.0.0.1:3001
CONTROL_PLANE_RUNTIME_TOKEN=demo-runtime-secret
OPENAI_API_KEY=...
OPENAI_URL=wss://api.openai.com/v1/realtime?model=gpt-realtime
```

## Endpoints

### `GET /health`

Health check for the runtime service.

### `POST /api/chat`

Authenticated text demo endpoint used by the dashboard text panel.

Header:

```text
Authorization: Bearer <APPOINTMENT_AGENT_RUNTIME_TOKEN>
```

Body:

```json
{
  "snapshot": {
    "workers": [],
    "clients": [],
    "appointments": [],
    "availableSlots": []
  },
  "message": "show slots"
}
```

### `WS /ws`

Downstream audio runtime endpoint used by `fonotp-gateway`.

Expected first frame:

```json
{
  "sessionId": "<callsession uuid>"
}
```

The runtime then:

1. resolves the appointment call session through `fonotp-web`
2. connects to OpenAI realtime
3. streams PCM audio in/out
4. executes appointment tools through internal control-plane APIs
5. persists the final call transcript back to `fonotp-web`

## Current Scope

Implemented tools:

- `list_workers`
- `list_clients`
- `list_appointments`
- `list_available_slots`
- `book_appointment`
- `cancel_appointment`

The runtime is voice-capable, but still an MVP. It is optimized for the doctor appointment browser demo path, not for full production scheduling complexity.
