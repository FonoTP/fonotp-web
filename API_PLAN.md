# API Plan For WebRTC Voice Agent Platform

## Goal

Use the existing patterns in:

- `/Users/euge/Startups/Marko/github/chatty`
- `/Users/euge/Startups/Marko/github/fonotp-gateway`
- `/Users/euge/Startups/Marko/github/fonotp-web`

to support a production API where any authorized tenant user can start a browser WebRTC voice session and talk to an AI agent, with the admin web app managing agents, access, usage, and call records.

This document is a plan only. It does not propose code yet.

## What Already Exists

### From `chatty`

- A working AI voice-agent pattern:
  - STT
  - chat completion / agent logic
  - TTS
  - tool-calling for scheduling actions
- Local assistant state and appointment CRUD APIs
- Realtime transcription session minting
- A clear server-side agent orchestration model

### From `fonotp-gateway`

- Browser microphone to backend WebRTC connection
- Backend peer connection management
- Backend bridge from WebRTC audio to downstream WebSocket service
- Session authorization against PostgreSQL
- Gateway session tracking

### From `fonotp-web`

- Multi-tenant org/user/admin model
- JWT login and signup
- Existing control-plane API
- PostgreSQL-backed admin/product surface

## Key Architectural Decision

Do not merge everything into one service immediately.

Use a 3-service model:

1. `fonotp-web` as control plane
   - organizations
   - users
   - agent definitions
   - credentials
   - usage, billing, reports

2. `fonotp-gateway` as realtime media gateway
   - browser WebRTC termination
   - session validation
   - media bridging
   - call/session state

3. New or upgraded agent runtime service
   - based on `chatty`
   - tenant-aware
   - receives audio stream over WebSocket
   - performs STT, LLM/tool orchestration, TTS
   - returns audio and control events

This is the cleanest way to turn the demo implementations into a reusable product API.

## Target Runtime Flow

1. User logs into `fonotp-web`.
2. Web app requests a short-lived voice access token for a selected agent.
3. Web app captures mic audio and creates a WebRTC offer.
4. Web app calls gateway session create API.
5. `fonotp-gateway` validates the short-lived token and agent authorization.
6. `fonotp-gateway` opens a downstream WebSocket connection to the agent runtime.
7. Browser audio flows to gateway over WebRTC.
8. Gateway forwards PCM frames to the agent runtime.
9. Agent runtime performs STT, reasoning/tool use, and TTS.
10. Agent runtime returns PCM audio plus control events.
11. Gateway streams audio back to the browser.
12. Control plane records call session, transcript, usage, and outcome.

## Separation Of Responsibility

## API / Control Plane (`fonotp-web`)

Owns:

- orgs, users, roles
- agent definitions
- web-issued access tokens
- agent authorization
- call records
- transcripts
- billing and usage aggregation
- admin configuration

Should not directly process live RTP/PCM audio.

## Realtime Gateway (`fonotp-gateway`)

Owns:

- WebRTC offer/answer handling
- ICE server config
- short-lived voice session validation
- media session lifecycle
- downstream WebSocket bridge
- connection-level status and cleanup

Should not own tenant business logic beyond validating the session and routing target.

## Agent Runtime (`chatty` evolved into service)

Owns:

- STT/TTS provider integration
- LLM prompting and tools
- agent instructions and voice config
- task execution
- event emission back to gateway/control plane

Should not be the source of truth for orgs, users, or billing.

## Required API Surface

### 1. Auth And User APIs

These mostly exist in `fonotp-web`, but need to become the source for voice access.

Keep:

- `POST /api/auth/login`
- `POST /api/auth/signup`
- `GET /api/auth/me`

Add:

- `POST /api/voice/token`
  - Creates a short-lived voice session token for the logged-in user
  - Input:
    - `agentId`
    - optional `metadata` like browser info or locale
  - Output:
    - `voiceToken`
    - `expiresAt`
    - `gatewayBaseUrl`
    - `iceServers`
    - `agentSessionId`

Purpose:

- Do not reuse the main long-lived JWT directly at the gateway for browser media sessions.
- Mint a scoped, short TTL token specifically for one voice session.

### 2. Agent Management APIs

Needed so any tenant can configure one or more AI agents.

Add:

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:agentId`
- `PATCH /api/agents/:agentId`
- `POST /api/agents/:agentId/publish`
- `GET /api/agents/:agentId/tools`
- `PUT /api/agents/:agentId/tools`
- `GET /api/agents/:agentId/voice`
- `PUT /api/agents/:agentId/voice`

Each agent should define:

- owning `organizationId`
- display name
- status
- system prompt / instructions
- default language
- STT provider and model
- TTS provider, model, and voice
- allowed tools
- routing target for the runtime service
- optional business context

### 3. Voice Session APIs

Some of this exists in `fonotp-gateway`, but it must become tenant-aware and agent-aware.

Gateway endpoints:

- `POST /api/webrtc/session`
  - Input:
    - `offerSdp`
    - `voiceToken`
    - optional client metadata
  - Output:
    - `sessionId`
    - `answerSdp`
    - `expiresAt`
    - `callId`

- `DELETE /api/webrtc/session/:sessionId`

- `GET /api/webrtc/session/:sessionId`
  - Returns current realtime status

Current gateway API uses:

- `Authorization: Bearer <token>`
- `serviceKey`
- optional `wsEndpoint`

Recommended production change:

- remove client-provided `wsEndpoint`
- do not let browser choose downstream service URL
- route only from validated control-plane metadata

The browser should provide only:

- WebRTC offer
- short-lived voice token

The gateway should derive:

- organization
- user
- agent
- downstream runtime target
- policy constraints

### 4. Call And Transcript APIs

Needed in `fonotp-web` as product APIs.

Add:

- `GET /api/calls`
- `GET /api/calls/:callId`
- `GET /api/calls/:callId/transcript`
- `GET /api/calls/:callId/events`
- `POST /api/calls/:callId/end`

Store and expose:

- session timestamps
- user identity
- organization
- agent used
- transcript turns
- call summary
- duration
- token usage
- TTS/STT usage
- end reason
- tool actions taken

### 5. Runtime Internal APIs

These do not need to be browser-facing.

Between gateway and agent runtime:

- WebSocket audio bridge
- JSON control events

Control events should be formalized, for example:

- `session.started`
- `session.ready`
- `transcript.partial`
- `transcript.final`
- `assistant.response.started`
- `assistant.response.completed`
- `tool.call.started`
- `tool.call.completed`
- `session.error`
- `session.ended`

Between control plane and runtime:

- `POST /internal/runtime/sessions`
- `POST /internal/runtime/sessions/:id/end`
- `POST /internal/runtime/events`

This gives a clean audit trail instead of burying state inside the gateway only.

## Web System Requirements

The web app needs both end-user and admin surfaces.

### End-User Web App

Needs:

- microphone permission flow
- device selection
- connect / disconnect controls
- connection status
- transcript panel
- speaking / listening indicators
- retry and error states
- network reconnect behavior

User flow:

1. User selects an agent.
2. Web app calls `POST /api/voice/token`.
3. Web app opens local microphone and creates WebRTC offer.
4. Web app calls gateway `POST /api/webrtc/session`.
5. Web app plays returned remote audio stream.
6. Web app shows live session and final transcript state from control events or polling.

### Admin Web App

Needs:

- agent creation/edit UI
- prompt/instruction management
- voice settings
- tool policy management
- allowed channels management
- call logs
- transcript viewer
- analytics and usage views
- per-org usage limits and status

## User Model Requirements

There are two distinct user concepts that must be explicit.

### Platform User

This already exists in `fonotp-web`.

Purpose:

- login to web portal
- administer org
- start or monitor voice sessions

Fields:

- `user_id`
- `organization_id`
- `role`
- auth credentials

### End Caller / Participant

This should be added as a separate concept.

Purpose:

- the human speaking to the AI during a call
- may be the logged-in platform user, or an external caller later

For browser voice chat, these may initially be the same person, but the schema should not assume that forever.

Recommended fields:

- `participant_id`
- `organization_id`
- `type` (`platform_user`, `guest`, `phone_caller`, `api_client`)
- `platform_user_id` nullable
- `display_name`
- `phone_number` nullable
- `email` nullable

## Database Requirements

`fonotp-web` currently has a lightweight org/user/call schema. It needs a runtime-aware data model.

### Keep Existing Core Tables

- `organizations`
- `platform_users`
- `calls`
- `call_transcript_entries`
- `billing_records`

### Add New Tables

#### `agents`

Stores tenant-defined AI agents.

Fields:

- `id`
- `organization_id`
- `name`
- `slug`
- `status`
- `channel_type` (`webrtc_web`, later `sip`, `phone`, `api`)
- `runtime_key`
- `system_prompt`
- `default_language`
- `stt_provider`
- `stt_model`
- `tts_provider`
- `tts_model`
- `tts_voice`
- `llm_provider`
- `llm_model`
- `created_by`
- `created_at`
- `updated_at`

#### `agent_tools`

Stores allowed tools and config.

Fields:

- `id`
- `agent_id`
- `tool_key`
- `enabled`
- `config_json`

#### `voice_session_tokens`

Short-lived, scoped token store for browser voice sessions.

Fields:

- `id`
- `organization_id`
- `platform_user_id`
- `agent_id`
- `token_hash`
- `expires_at`
- `revoked_at`
- `metadata_json`
- `created_at`

This replaces the current gateway-only `user_sessions` pattern for browser voice with a control-plane-issued token.

#### `realtime_sessions`

Logical voice sessions across control plane, gateway, and runtime.

Fields:

- `id`
- `organization_id`
- `agent_id`
- `platform_user_id`
- `participant_id`
- `gateway_session_id` nullable
- `status`
- `started_at`
- `connected_at` nullable
- `ended_at` nullable
- `end_reason`
- `client_metadata_json`
- `runtime_metadata_json`

#### `realtime_session_events`

Timeline of important session events.

Fields:

- `id`
- `session_id`
- `event_type`
- `event_ts`
- `payload_json`

#### `call_usage`

Normalized usage for cost and billing.

Fields:

- `id`
- `call_id`
- `session_id`
- `provider`
- `metric_type`
- `quantity`
- `unit`
- `cost_micros`
- `recorded_at`

Examples:

- STT seconds
- TTS characters
- input tokens
- output tokens
- audio minutes

#### `participants`

See user model section above.

## Changes Needed In Gateway Data Model

`fonotp-gateway` currently has:

- `users`
- `user_sessions`
- `service_authorizations`
- `gateway_sessions`

For production, that schema should either:

1. be removed in favor of `fonotp-web` as the single source of truth, or
2. be reduced to cache/session tables only

Recommended direction:

- keep only `gateway_sessions`-like runtime state in gateway storage
- move identity and authorization ownership to `fonotp-web`
- validate voice tokens against control-plane data

The current `service_authorizations.ws_endpoint` model is too low-level for a tenant product because it exposes routing concepts directly. Replace it with:

- `agent_id`
- `runtime_target`
- `organization policy`

resolved server-side only

## Security Requirements

### Required Changes

- Use short-lived voice tokens instead of exposing main portal JWTs to the gateway session contract
- Do not allow browser clients to submit arbitrary downstream WebSocket URLs
- Scope every voice token to:
  - one org
  - one user
  - one agent
  - short TTL
  - optional one-time use
- Enforce org isolation at every query boundary
- Add audit logging for:
  - token issuance
  - session start
  - session end
  - agent config changes
  - tool actions

### Recommended Later

- token revocation lists
- rate limiting per org and per user
- signed internal service-to-service auth
- encrypted transcript storage if needed for regulated tenants

## Agent Runtime Requirements

The `chatty` server is a strong prototype, but needs structural changes before it is reusable for all users.

### What To Reuse

- agent orchestration pattern
- tool-calling structure
- STT/TTS integration patterns
- realtime transcription session logic if still needed

### What Must Change

- remove local SQLite as source of truth for business data
- remove hardcoded worker/user defaults
- make prompts/config load by `agentId`
- move business data operations to control-plane APIs or shared DB
- support runtime session IDs provided by control plane/gateway
- emit structured events back to control plane
- support tenant-specific tool registries

## API Contract Recommendation

### Public Browser-Facing APIs

In `fonotp-web`:

- auth
- agent listing
- voice token minting
- call history and transcripts

In `fonotp-gateway`:

- create/retrieve/delete WebRTC session only

### Internal Service APIs

- control plane to gateway token/session validation
- gateway to runtime audio/control WebSocket
- runtime to control plane event reporting

This keeps the browser contract small and safer.

## Migration Path

### Phase 1: Productize Existing Demo Flow

- keep current gateway WebRTC structure
- build voice token issuance in `fonotp-web`
- make gateway validate issued voice tokens
- create tenant-aware `agents` table
- remove client ability to choose `wsEndpoint`

Outcome:

- logged-in tenant users can start a browser voice session with an assigned AI agent

### Phase 2: Persist Runtime Data

- add `realtime_sessions`
- add `realtime_session_events`
- add transcript and usage ingestion
- connect runtime events back to control plane

Outcome:

- complete call logs, transcripts, and billing inputs

### Phase 3: Move `chatty` To Multi-Tenant Runtime

- load agent config by `agentId`
- replace local scheduling data with tenant-backed APIs
- formalize runtime control event schema

Outcome:

- one runtime service can serve many orgs and agents

### Phase 4: Admin UX

- agent builder UI
- voice config UI
- transcript and analytics UI
- org-level quotas and policies

Outcome:

- full self-serve tenant product

## Minimum Viable Version

To get a first usable version live, the minimum required pieces are:

- `fonotp-web`
  - `agents` table
  - `voice_session_tokens` table
  - `POST /api/voice/token`
  - basic `GET /api/agents`
  - basic `GET /api/calls`

- `fonotp-gateway`
  - accept `voiceToken` instead of general bearer/service key combo
  - fetch or validate session + agent context
  - route to runtime target from server-side config only
  - persist gateway session state

- agent runtime
  - accept gateway audio WebSocket session
  - run STT -> LLM -> TTS loop
  - stream audio back
  - report transcript/events

- web app
  - agent selector
  - start/stop voice session
  - remote audio playback
  - basic transcript and status UI

## Main Risks

### 1. Browser-Controlled Routing

Current gateway allows optional client-provided `wsEndpoint`.

Risk:

- unsafe tenant bypass
- misrouting
- environment leakage

Fix:

- server-side routing only

### 2. Mixed Identity Models

Current gateway has its own `users` and `user_sessions`, while `fonotp-web` has `platform_users` and JWT auth.

Risk:

- duplicate auth systems
- inconsistent revocation
- hard-to-debug permissions

Fix:

- make `fonotp-web` the identity authority

### 3. Demo Agent State

`chatty` stores assistant business state locally in SQLite.

Risk:

- not tenant-safe
- not horizontally scalable
- data divergence

Fix:

- centralize business data and runtime event persistence

### 4. Billing Blind Spots

Current prototypes do not yet provide a normalized usage ledger.

Risk:

- no accurate per-org cost accounting

Fix:

- add `call_usage` and structured runtime reporting

## Recommended Final Direction

Build the production system around this rule:

- `fonotp-web` owns identity, tenancy, config, and reporting
- `fonotp-gateway` owns realtime browser media transport
- `chatty` evolves into a tenant-aware runtime service

That matches the existing codebases closely, avoids rewriting the working WebRTC path, and gives a clear path to support any authorized tenant user instead of a single demo user or hardcoded service session.
