# Voice Runtime Demo

Minimal runtime service for browser voice sessions.

Responsibilities:

- accepts browser SDP offers plus `voiceToken`
- resolves `voiceToken` against `fonotp-web`
- creates an OpenAI Realtime WebRTC session
- returns the SDP answer to the browser
- accepts final transcript/call reports from the browser
- persists the call summary back into `fonotp-web`

## Environment

```env
HOST=127.0.0.1
PORT=8090
OPENAI_API_KEY=your-openai-key
OPENAI_REALTIME_MODEL=gpt-realtime
CONTROL_PLANE_BASE_URL=http://127.0.0.1:3001
CONTROL_PLANE_RUNTIME_TOKEN=demo-runtime-secret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Run

```bash
npm install
npm start
```

## API

### `GET /health`

Returns service health and whether `OPENAI_API_KEY` is configured.

### `POST /api/session`

Input:

```json
{
  "voiceToken": "voice_...",
  "offerSdp": "v=0\r\n...",
  "caller": "browser-client / localhost:5173"
}
```

Output:

```json
{
  "runtimeSessionId": "rt-...",
  "reportToken": "...",
  "answerSdp": "v=0\r\n...",
  "agent": {
    "id": "agent-nova-intake",
    "name": "Nova Intake Assistant",
    "voice": "alloy",
    "model": "gpt-realtime"
  }
}
```

### `POST /api/session/:runtimeSessionId/report`

Input:

```json
{
  "reportToken": "...",
  "transcript": [
    "User: I need help getting started.",
    "Agent: I can help with intake and next steps."
  ],
  "summary": "User connected from the browser and got intake guidance.",
  "startedAt": "2026-03-26T18:20:00.000Z",
  "endedAt": "2026-03-26T18:21:15.000Z",
  "status": "Completed",
  "charactersIn": 143,
  "charactersOut": 188
}
```
