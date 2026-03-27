CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP TABLE IF EXISTS agent_session_events;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS callsessions;
DROP TABLE IF EXISTS agents_defs;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS call_transcript_entries;
DROP TABLE IF EXISTS calls;
DROP TABLE IF EXISTS billing_records;
DROP TABLE IF EXISTS voice_session_tokens;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS platform_users;
DROP TABLE IF EXISTS organizations;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  monthly_spend INTEGER NOT NULL,
  active_calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE platform_users (
  user_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  company TEXT NOT NULL,
  group_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  last_login TEXT NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL,
  runtime_url TEXT NOT NULL,
  stt_type TEXT NOT NULL,
  stt_prompt TEXT NOT NULL,
  llm_type TEXT NOT NULL,
  llm_prompt TEXT NOT NULL,
  tts_type TEXT NOT NULL,
  tts_prompt TEXT NOT NULL,
  tts_voice TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE agents_defs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  stt_type TEXT NOT NULL,
  stt_prompt TEXT NOT NULL,
  llm_type TEXT NOT NULL,
  llm_prompt TEXT NOT NULL,
  tts_type TEXT NOT NULL,
  tts_prompt TEXT NOT NULL,
  tts_voice TEXT NOT NULL
);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  platform_user_id TEXT REFERENCES platform_users(user_id) ON DELETE SET NULL,
  runtime_session_id TEXT UNIQUE,
  caller TEXT NOT NULL,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  session_status TEXT NOT NULL,
  language TEXT,
  stt_provider TEXT,
  flow TEXT NOT NULL,
  duration TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  characters_in INTEGER NOT NULL DEFAULT 0,
  characters_out INTEGER NOT NULL DEFAULT 0,
  agent_stt_type TEXT NOT NULL,
  agent_stt_prompt TEXT NOT NULL,
  agent_llm_type TEXT NOT NULL,
  agent_llm_prompt TEXT NOT NULL,
  agent_tts_type TEXT NOT NULL,
  agent_tts_prompt TEXT NOT NULL,
  agent_tts_voice TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE callsessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id INTEGER NOT NULL REFERENCES agents_defs(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  platform_user_id TEXT REFERENCES platform_users(user_id) ON DELETE SET NULL,
  runtime_session_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
);

CREATE TABLE agent_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'transcript',
  line TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_method TEXT NOT NULL
);

CREATE TABLE voice_session_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform_user_id TEXT NOT NULL REFERENCES platform_users(user_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_session_tokens_agent_id_idx ON voice_session_tokens(agent_id);
CREATE INDEX voice_session_tokens_user_id_idx ON voice_session_tokens(platform_user_id);
CREATE INDEX voice_session_tokens_expires_at_idx ON voice_session_tokens(expires_at);
CREATE INDEX callsessions_agent_id_idx ON callsessions(agent_id);
CREATE INDEX callsessions_runtime_session_id_idx ON callsessions(runtime_session_id);
CREATE INDEX agent_sessions_org_started_at_idx ON agent_sessions(organization_id, started_at DESC);
CREATE INDEX agent_sessions_agent_started_at_idx ON agent_sessions(agent_id, started_at DESC);
CREATE INDEX agent_session_events_session_position_idx ON agent_session_events(agent_session_id, position);
