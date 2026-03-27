CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP TABLE IF EXISTS call_transcript_entries;
DROP TABLE IF EXISTS billing_records;
DROP TABLE IF EXISTS voice_session_tokens;
DROP TABLE IF EXISTS calls;
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
  stt_type TEXT NOT NULL,
  stt_prompt TEXT NOT NULL,
  llm_type TEXT NOT NULL,
  llm_prompt TEXT NOT NULL,
  tts_type TEXT NOT NULL,
  tts_prompt TEXT NOT NULL,
  tts_voice TEXT NOT NULL,
  runtime_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, slug)
);

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  platform_user_id TEXT REFERENCES platform_users(user_id) ON DELETE SET NULL,
  runtime_session_id TEXT UNIQUE,
  caller TEXT NOT NULL,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  flow TEXT NOT NULL,
  duration TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  characters_in INTEGER NOT NULL,
  characters_out INTEGER NOT NULL
);

CREATE TABLE call_transcript_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  line TEXT NOT NULL
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
