CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DROP TABLE IF EXISTS call_transcript_entries;
DROP TABLE IF EXISTS billing_records;
DROP TABLE IF EXISTS calls;
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

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  caller TEXT NOT NULL,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  flow TEXT NOT NULL,
  duration TEXT NOT NULL,
  started_at TEXT NOT NULL,
  status TEXT NOT NULL,
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
