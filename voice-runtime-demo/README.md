# Voice Runtime Demo

Minimal runtime service for browser voice sessions.

Responsibilities:

- accepts browser SDP offers plus `voiceToken`
- resolves `voiceToken` against `fonotp-web`
- terminates browser WebRTC on our gateway service
- creates a separate upstream OpenAI Realtime WebRTC session from the gateway
- bridges browser audio and AI audio through the gateway
- optionally mints Soniox temporary keys for browser-side Soniox STT
- returns the gateway SDP answer to the browser
- accepts final transcript/call reports from the browser
- persists the call summary back into `fonotp-web`

Agent config is loaded from the control-plane `agents` table using these DB field names:

- `stt_type`
- `stt_prompt`
- `llm_type`
- `llm_prompt`
- `tts_type`
- `tts_prompt`
- `tts_voice`

Compatibility:

- local built-in backend path: `ws://127.0.0.1:8000/ws`
- external `aibot` backend path: `ws://127.0.0.1:8000/ws`

The browser always connects to `voice-runtime-demo`, and `voice-runtime-demo` then bridges audio to the agent's `runtime_url` over `/ws`.

## Environment

```env
HOST=127.0.0.1
PORT=8000
OPENAI_API_KEY=your-openai-key
OPENAI_REALTIME_MODEL=gpt-realtime
SONIOX_API_KEY=your-soniox-api-key
SONIOX_REALTIME_MODEL=stt-rt-preview
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
  "caller": "browser-client / localhost:5173",
  "language": "en",
  "sttProvider": "openai"
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

### `POST /api/soniox-temporary-key`

Returns a short-lived Soniox API key for browser-side realtime STT when the user selects `Soniox`.

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
