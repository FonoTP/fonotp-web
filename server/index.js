import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

dotenv.config();

const app = express();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || "local-dev-secret";
const voiceTokenTtlSeconds = Number(process.env.VOICE_TOKEN_TTL_SECONDS || 300);
const internalRuntimeToken =
  process.env.VOICE_RUNTIME_INTERNAL_TOKEN || `${jwtSecret}-voice-runtime`;
const defaultIceServers = parseJsonEnv("VOICE_ICE_SERVERS", [{ urls: "stun:stun.l.google.com:19302" }]);

app.use(cors());
app.use(express.json());

const adminRoles = new Set(["Owner", "Admin", "Manager"]);

function signToken(user) {
  return jwt.sign(
    {
      userId: user.user_id,
      organizationId: user.organization_id,
      role: user.role,
      email: user.email,
    },
    jwtSecret,
    { expiresIn: "12h" },
  );
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function getBearerToken(header) {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

async function authMiddleware(req, res, next) {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const userQuery = await pool.query("SELECT * FROM platform_users WHERE user_id = $1 LIMIT 1", [
      payload.userId,
    ]);
    const user = userQuery.rows[0];

    if (!user) {
      return res.status(401).json({ error: "User session is invalid." });
    }

    req.authUser = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Authentication required." });
  }
}

function requireInternalService(req, res, next) {
  const token = getBearerToken(req.headers.authorization);

  if (!token || token !== internalRuntimeToken) {
    return res.status(401).json({ error: "Internal service authentication required." });
  }

  return next();
}

function adminOnly(req, res, next) {
  if (!adminRoles.has(req.authUser.role)) {
    return res.status(403).json({ error: "This account does not have dashboard access." });
  }
  return next();
}

function canManageOrganization(req, organizationId) {
  if (req.authUser.email === "owner@fonotp.ai") {
    return true;
  }

  return req.authUser.organization_id === organizationId && req.authUser.role === "Owner";
}

function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createOpaqueToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

function formatDuration(startedAt, endedAt = null) {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return "00:00";
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function mapUser(row) {
  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email,
    company: row.company,
    group: row.group_name,
    role: row.role,
    status: row.status,
    lastLogin: row.last_login,
  };
}

function mapAgent(row) {
  return {
    id: row.public_id,
    organizationId: row.organization_id,
    createdByUserId: row.created_by_user_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    channel: row.channel,
    sttType: row.stt_type,
    sttPrompt: row.stt_prompt,
    llmType: row.llm_type,
    llmPrompt: row.llm_prompt,
    ttsType: row.tts_type,
    ttsPrompt: row.tts_prompt,
    ttsVoice: row.tts_voice,
    runtimeUrl: row.runtime_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBilling(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    month: row.month,
    amount: row.amount,
    status: row.status,
    paymentMethod: row.payment_method,
  };
}

async function getOrganizationProducts(organizationId) {
  if (organizationId === "org-nova") {
    return ["SIP Bridge", "AI Bot Service", "Service Builder"];
  }
  if (organizationId === "org-axis") {
    return ["WebRTC Gateway", "AI Bot Service", "Service Builder"];
  }
  return ["SIP Bridge", "WebRTC Gateway"];
}

async function getOrganizations() {
  const query = `
    SELECT
      o.id,
      o.name,
      o.domain,
      o.plan,
      o.status,
      o.monthly_spend,
      o.active_calls,
      COUNT(u.user_id)::int AS users
    FROM organizations o
    LEFT JOIN platform_users u ON u.organization_id = o.id
    GROUP BY o.id
    ORDER BY o.name
  `;
  const { rows } = await pool.query(query);

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      plan: row.plan,
      status: row.status,
      monthlySpend: row.monthly_spend,
      activeCalls: row.active_calls,
      users: row.users,
      products: await getOrganizationProducts(row.id),
    })),
  );
}

async function getCallsByOrganization(organizationId) {
  return getCalls({ organizationId });
}

async function getCallsByOrganizationAndUser(organizationId, platformUserId) {
  return getCalls({ organizationId, platformUserId });
}

async function getCalls({ organizationId, platformUserId = null }) {
  const query = `
    SELECT
      s.*,
      a.public_id AS agent_public_id,
      a.name AS agent_name,
      COALESCE(
        json_agg(ase.line ORDER BY ase.position) FILTER (WHERE ase.line IS NOT NULL),
        '[]'::json
      ) AS transcript
    FROM agent_sessions s
    LEFT JOIN agents_defs a ON a.id = s.agent_id
    LEFT JOIN agent_session_events ase
      ON ase.agent_session_id = s.id
      AND ase.event_type = 'transcript'
    WHERE s.organization_id = $1
      AND ($2::text IS NULL OR s.platform_user_id = $2)
    GROUP BY s.id, a.public_id, a.name
    ORDER BY s.started_at DESC
  `;
  const { rows } = await pool.query(query, [organizationId, platformUserId]);
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_public_id,
    agentName: row.agent_name,
    platformUserId: row.platform_user_id,
    runtimeSessionId: row.runtime_session_id,
    caller: row.caller,
    direction: row.direction,
    channel: row.channel,
    flow: row.flow,
    duration: row.duration,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.session_status,
    summary: row.summary,
    charactersIn: row.characters_in,
    charactersOut: row.characters_out,
    transcript: row.transcript,
  }));
}

async function getOrganizationById(organizationId) {
  const organizationQuery = await pool.query("SELECT * FROM organizations WHERE id = $1 LIMIT 1", [
    organizationId,
  ]);
  const organizationRow = organizationQuery.rows[0];

  if (!organizationRow) {
    return null;
  }

  const userCountQuery = await pool.query(
    "SELECT COUNT(*)::int AS users FROM platform_users WHERE organization_id = $1",
    [organizationId],
  );

  return {
    id: organizationRow.id,
    name: organizationRow.name,
    domain: organizationRow.domain,
    plan: organizationRow.plan,
    status: organizationRow.status,
    monthlySpend: organizationRow.monthly_spend,
    activeCalls: organizationRow.active_calls,
    users: userCountQuery.rows[0].users,
    products: await getOrganizationProducts(organizationRow.id),
  };
}

async function getAgentByIdForOrganization(agentId, organizationId) {
  const { rows } = await pool.query(
    "SELECT * FROM agents_defs WHERE public_id = $1 AND organization_id = $2 LIMIT 1",
    [agentId, organizationId],
  );
  return rows[0] ?? null;
}

async function getAgentsByOrganization(organizationId) {
  const { rows } = await pool.query(
    "SELECT * FROM agents_defs WHERE organization_id = $1 ORDER BY name",
    [organizationId],
  );
  return rows;
}

function slugifyAgentName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function slugifyOrganizationName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

app.get("/api/health", async (_req, res) => {
  const result = await pool.query("SELECT 1 AS ok");
  res.json({ ok: result.rows[0]?.ok === 1 });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password, portal } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { rows } = await pool.query(
    "SELECT * FROM platform_users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );

  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  if (portal === "admin" && !adminRoles.has(user.role)) {
    return res.status(403).json({ error: "This account does not have dashboard access." });
  }

  await pool.query("UPDATE platform_users SET last_login = $1 WHERE user_id = $2", [
    new Date().toISOString(),
    user.user_id,
  ]);

  user.last_login = new Date().toISOString();
  return res.json({ user: mapUser(user), token: signToken(user) });
});

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password, organizationName } = req.body ?? {};

  if (!name || !email || !password || !organizationName) {
    return res.status(400).json({ error: "name, email, password, and organizationName are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const existingUser = await pool.query(
    "SELECT user_id FROM platform_users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );

  if (existingUser.rows[0]) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const orgSlugBase = slugifyOrganizationName(organizationName);
  if (!orgSlugBase) {
    return res.status(400).json({ error: "organizationName must contain letters or numbers." });
  }

  const existingOrgQuery = await pool.query(
    "SELECT COUNT(*)::int AS count FROM organizations WHERE id LIKE $1",
    [`org-${orgSlugBase}%`],
  );
  const duplicateCount = existingOrgQuery.rows[0]?.count ?? 0;
  const organizationId = duplicateCount === 0 ? `org-${orgSlugBase}` : `org-${orgSlugBase}-${duplicateCount + 1}`;
  const domain = `${organizationId.replace(/^org-/, "")}.example`;

  await pool.query(
    `INSERT INTO organizations (
      id, name, domain, plan, status, monthly_spend, active_calls
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [organizationId, organizationName, domain, "Trial", "Active", 0, 0],
  );

  const userId = `usr-${Date.now()}`;
  const inserted = await pool.query(
    `INSERT INTO platform_users (
      user_id, organization_id, name, email, password_hash, company, group_name, role, status, last_login
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [
      userId,
      organizationId,
      name,
      email,
      passwordHash,
      organizationName,
      "Founders",
      "Owner",
      "Active",
      "Just created",
    ],
  );

  return res.status(201).json({ user: mapUser(inserted.rows[0]), token: signToken(inserted.rows[0]) });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  return res.json({ user: mapUser(req.authUser) });
});

app.get("/api/agents", authMiddleware, async (req, res) => {
  const agents = await getAgentsByOrganization(req.authUser.organization_id);
  return res.json({ agents: agents.map(mapAgent) });
});

app.post("/api/agents", authMiddleware, async (req, res) => {
  const {
    name,
    status = "Active",
    channel = "WebRTC",
    sttType,
    sttPrompt,
    llmType,
    llmPrompt,
    ttsType,
    ttsPrompt,
    ttsVoice,
    runtimeUrl,
  } = req.body ?? {};

  if (!name || !sttType || !sttPrompt || !llmType || !llmPrompt || !ttsType || !ttsPrompt || !ttsVoice || !runtimeUrl) {
    return res.status(400).json({
      error:
        "name, sttType, sttPrompt, llmType, llmPrompt, ttsType, ttsPrompt, ttsVoice, and runtimeUrl are required.",
    });
  }

  const slugBase = slugifyAgentName(name);
  if (!slugBase) {
    return res.status(400).json({ error: "Agent name must contain letters or numbers." });
  }

  const existingSlugQuery = await pool.query(
    "SELECT COUNT(*)::int AS count FROM agents_defs WHERE organization_id = $1 AND slug LIKE $2",
    [req.authUser.organization_id, `${slugBase}%`],
  );
  const duplicateCount = existingSlugQuery.rows[0]?.count ?? 0;
  const slug = duplicateCount === 0 ? slugBase : `${slugBase}-${duplicateCount + 1}`;
  const agentId = `agent-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();

  const { rows } = await pool.query(
    `INSERT INTO agents_defs (
      public_id,
      organization_id,
      created_by_user_id,
      name,
      slug,
      status,
      channel,
      runtime_url,
      stt_type,
      stt_prompt,
      llm_type,
      llm_prompt,
      tts_type,
      tts_prompt,
      tts_voice,
      created_at,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *`,
    [
      agentId,
      req.authUser.organization_id,
      req.authUser.user_id,
      name,
      slug,
      status,
      channel,
      runtimeUrl,
      sttType,
      sttPrompt,
      llmType,
      llmPrompt,
      ttsType,
      ttsPrompt,
      ttsVoice,
      nowIso,
      nowIso,
    ],
  );

  return res.status(201).json({ agent: mapAgent(rows[0]) });
});

app.post("/api/voice/token", authMiddleware, async (req, res) => {
  const { agentId } = req.body ?? {};

  if (!agentId) {
    return res.status(400).json({ error: "agentId is required." });
  }

  const agent = await getAgentByIdForOrganization(agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.status !== "Active") {
    return res.status(409).json({ error: "Agent is not active." });
  }

  const voiceToken = createOpaqueToken("voice");
  const expiresAt = new Date(Date.now() + voiceTokenTtlSeconds * 1000).toISOString();

  await pool.query(
    `INSERT INTO voice_session_tokens (
      token_hash, organization_id, platform_user_id, agent_id, expires_at
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      hashOpaqueToken(voiceToken),
      req.authUser.organization_id,
      req.authUser.user_id,
      agent.id,
      expiresAt,
    ],
  );

  return res.status(201).json({
    voiceToken,
    expiresAt,
    runtimeUrl: agent.runtime_url,
    iceServers: defaultIceServers,
    agent: mapAgent(agent),
  });
});

app.get("/api/organizations", async (_req, res) => {
  const organizations = await getOrganizations();
  res.json({ organizations });
});

app.get("/api/organizations/:organizationId/users", authMiddleware, async (req, res) => {
  if (!canManageOrganization(req, req.params.organizationId)) {
    return res.status(403).json({ error: "Only the organization owner can view organization users." });
  }

  const { rows } = await pool.query(
    "SELECT * FROM platform_users WHERE organization_id = $1 ORDER BY name",
    [req.params.organizationId],
  );
  res.json({ users: rows.map(mapUser) });
});

app.post("/api/organizations/:organizationId/users", authMiddleware, async (req, res) => {
  if (!canManageOrganization(req, req.params.organizationId)) {
    return res.status(403).json({ error: "Only the organization owner can invite users." });
  }

  const { name, email, password, group, role } = req.body ?? {};

  if (!name || !email || !password || !group || !role) {
    return res.status(400).json({ error: "name, email, password, group, and role are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const orgQuery = await pool.query("SELECT * FROM organizations WHERE id = $1 LIMIT 1", [
    req.params.organizationId,
  ]);

  const organization = orgQuery.rows[0];

  if (!organization) {
    return res.status(404).json({ error: "Organization not found." });
  }

  const existingUser = await pool.query(
    "SELECT user_id FROM platform_users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );

  if (existingUser.rows[0]) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const userId = `usr-${Date.now()}`;
  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await pool.query(
    `INSERT INTO platform_users (
      user_id, organization_id, name, email, password_hash, company, group_name, role, status, last_login
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [
      userId,
      req.params.organizationId,
      name,
      email,
      passwordHash,
      organization.name,
      group,
      role,
      "Invited",
      "Pending",
    ],
  );

  return res.status(201).json({ user: mapUser(inserted.rows[0]) });
});

app.get("/api/organizations/:organizationId/calls", authMiddleware, adminOnly, async (req, res) => {
  const calls = await getCallsByOrganization(req.params.organizationId);
  res.json({ calls });
});

app.get("/api/organizations/:organizationId/billing", authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM billing_records WHERE organization_id = $1 ORDER BY month DESC",
    [req.params.organizationId],
  );
  res.json({ billing: rows.map(mapBilling) });
});

app.get("/api/organizations/:organizationId/summary", authMiddleware, adminOnly, async (req, res) => {
  const organization = await getOrganizationById(req.params.organizationId);

  if (!organization) {
    return res.status(404).json({ error: "Organization not found." });
  }

  const calls = await getCallsByOrganization(req.params.organizationId);
  const billingQuery = await pool.query(
    "SELECT * FROM billing_records WHERE organization_id = $1 ORDER BY month DESC",
    [req.params.organizationId],
  );

  return res.json({
    organization,
    calls,
    billing: billingQuery.rows.map(mapBilling),
  });
});

app.get("/api/me/account", authMiddleware, async (req, res) => {
  const organization = await getOrganizationById(req.authUser.organization_id);
  const calls = await getCallsByOrganizationAndUser(
    req.authUser.organization_id,
    req.authUser.user_id,
  );
  const billingQuery = await pool.query(
    "SELECT * FROM billing_records WHERE organization_id = $1 ORDER BY month DESC",
    [req.authUser.organization_id],
  );

  return res.json({
    user: mapUser(req.authUser),
    organization,
    calls,
    billing: billingQuery.rows.map(mapBilling),
  });
});

app.patch("/api/me/account", authMiddleware, async (req, res) => {
  const { name, email, company, group, password } = req.body ?? {};

  if (!name || !email || !company || !group) {
    return res.status(400).json({ error: "name, email, company, and group are required." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail) {
    return res.status(400).json({ error: "email is required." });
  }

  if (password && String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const emailConflictQuery = await pool.query(
    "SELECT user_id FROM platform_users WHERE lower(email) = lower($1) AND user_id <> $2 LIMIT 1",
    [normalizedEmail, req.authUser.user_id],
  );

  if (emailConflictQuery.rows[0]) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const nextPasswordHash = password
    ? await bcrypt.hash(String(password), 10)
    : req.authUser.password_hash;

  const { rows } = await pool.query(
    `UPDATE platform_users
    SET name = $1,
        email = $2,
        company = $3,
        group_name = $4,
        password_hash = $5
    WHERE user_id = $6
    RETURNING *`,
    [String(name).trim(), normalizedEmail, String(company).trim(), String(group).trim(), nextPasswordHash, req.authUser.user_id],
  );

  return res.json({ user: mapUser(rows[0]) });
});

app.post("/api/internal/voice/resolve-token", requireInternalService, async (req, res) => {
  const { voiceToken } = req.body ?? {};

  if (!voiceToken) {
    return res.status(400).json({ error: "voiceToken is required." });
  }

  const { rows } = await pool.query(
    `SELECT
      vst.id,
      vst.organization_id,
      vst.platform_user_id,
      vst.agent_id,
      vst.expires_at,
      o.name AS organization_name,
      pu.name AS user_name,
      pu.email,
      a.public_id AS agent_public_id,
      a.created_by_user_id,
      a.name AS agent_name,
      a.slug,
      a.stt_type,
      a.stt_prompt,
      a.llm_type,
      a.llm_prompt,
      a.tts_type,
      a.tts_prompt,
      a.tts_voice,
      a.runtime_url
    FROM voice_session_tokens vst
    JOIN organizations o ON o.id = vst.organization_id
    JOIN platform_users pu ON pu.user_id = vst.platform_user_id
    JOIN agents_defs a ON a.id = vst.agent_id
    WHERE vst.token_hash = $1
      AND vst.revoked_at IS NULL
      AND vst.expires_at > now()
    LIMIT 1`,
    [hashOpaqueToken(voiceToken)],
  );

  const row = rows[0];

  if (!row) {
    return res.status(404).json({ error: "Voice token not found or expired." });
  }

  await pool.query(
    "UPDATE voice_session_tokens SET consumed_at = COALESCE(consumed_at, now()) WHERE id = $1",
    [row.id],
  );

  return res.json({
    organization: {
      id: row.organization_id,
      name: row.organization_name,
    },
    user: {
      userId: row.platform_user_id,
      name: row.user_name,
      email: row.email,
    },
    agent: {
      id: row.agent_public_id,
      createdByUserId: row.created_by_user_id,
      name: row.agent_name,
      slug: row.slug,
      sttType: row.stt_type,
      sttPrompt: row.stt_prompt,
      llmType: row.llm_type,
      llmPrompt: row.llm_prompt,
      ttsType: row.tts_type,
      ttsPrompt: row.tts_prompt,
      ttsVoice: row.tts_voice,
      runtimeUrl: row.runtime_url,
    },
    expiresAt: row.expires_at,
  });
});

app.post("/api/internal/voice/callsessions", requireInternalService, async (req, res) => {
  const { organizationId, platformUserId, agentId, runtimeSessionId, language, sttProvider } = req.body ?? {};

  if (!organizationId || !platformUserId || !agentId || !runtimeSessionId) {
    return res.status(400).json({
      error: "organizationId, platformUserId, agentId, and runtimeSessionId are required.",
    });
  }

  const agent = await getAgentByIdForOrganization(agentId, organizationId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found for organization." });
  }

  const userQuery = await pool.query(
    "SELECT user_id FROM platform_users WHERE user_id = $1 AND organization_id = $2 LIMIT 1",
    [platformUserId, organizationId],
  );
  if (!userQuery.rows[0]) {
    return res.status(404).json({ error: "User not found for organization." });
  }

  const { rows } = await pool.query(
    `INSERT INTO callsessions (
      agent_id,
      organization_id,
      platform_user_id,
      runtime_session_id,
      language,
      stt_provider
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (runtime_session_id)
    DO UPDATE SET
      agent_id = EXCLUDED.agent_id,
      organization_id = EXCLUDED.organization_id,
      platform_user_id = EXCLUDED.platform_user_id,
      language = EXCLUDED.language,
      stt_provider = EXCLUDED.stt_provider
    RETURNING id`,
    [agent.id, organizationId, platformUserId, runtimeSessionId, language ?? null, sttProvider ?? null],
  );

  return res.status(201).json({
    callSessionId: rows[0].id,
  });
});

app.post("/api/internal/voice/resolve-callsession", requireInternalService, async (req, res) => {
  const { callSessionId } = req.body ?? {};

  if (!callSessionId) {
    return res.status(400).json({ error: "callSessionId is required." });
  }

  const { rows } = await pool.query(
    `SELECT
      cs.id,
      cs.runtime_session_id,
      cs.language,
      cs.stt_provider,
      cs.organization_id,
      cs.platform_user_id,
      ad.id AS agent_def_id,
      ad.public_id AS agent_public_id,
      ad.name AS agent_name,
      ad.slug,
      ad.runtime_url,
      ad.stt_type,
      ad.stt_prompt,
      ad.llm_type,
      ad.llm_prompt,
      ad.tts_type,
      ad.tts_prompt,
      ad.tts_voice
    FROM callsessions cs
    JOIN agents_defs ad ON ad.id = cs.agent_id
    WHERE cs.id = $1
    LIMIT 1`,
    [callSessionId],
  );

  const row = rows[0];
  if (!row) {
    return res.status(404).json({ error: "Call session not found." });
  }

  return res.json({
    callSession: {
      id: row.id,
      runtimeSessionId: row.runtime_session_id,
      organizationId: row.organization_id,
      platformUserId: row.platform_user_id,
      language: row.language,
      sttProvider: row.stt_provider,
    },
    agent: {
      agentDefId: row.agent_def_id,
      id: row.agent_public_id,
      name: row.agent_name,
      slug: row.slug,
      runtimeUrl: row.runtime_url,
      sttType: row.stt_type,
      sttPrompt: row.stt_prompt,
      llmType: row.llm_type,
      llmPrompt: row.llm_prompt,
      ttsType: row.tts_type,
      ttsPrompt: row.tts_prompt,
      ttsVoice: row.tts_voice,
    },
  });
});

app.post("/api/internal/voice/calls", requireInternalService, async (req, res) => {
  const {
    runtimeSessionId,
    organizationId,
    platformUserId,
    agentId,
    caller,
    status,
    summary,
    transcript,
    startedAt,
    endedAt,
    charactersIn,
    charactersOut,
    language,
    sttProvider,
  } = req.body ?? {};

  if (!runtimeSessionId || !organizationId || !platformUserId || !agentId || !caller || !status || !startedAt) {
    return res.status(400).json({
      error:
        "runtimeSessionId, organizationId, platformUserId, agentId, caller, status, and startedAt are required.",
    });
  }

  const agent = await getAgentByIdForOrganization(agentId, organizationId);
  if (!agent) {
    return res.status(404).json({ error: "Agent not found for organization." });
  }

  const userQuery = await pool.query(
    "SELECT user_id FROM platform_users WHERE user_id = $1 AND organization_id = $2 LIMIT 1",
    [platformUserId, organizationId],
  );
  if (!userQuery.rows[0]) {
    return res.status(404).json({ error: "User not found for organization." });
  }

  const agentSessionId = `session-${runtimeSessionId}`;
  const transcriptLines = Array.isArray(transcript)
    ? transcript.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];

  await pool.query(
    `INSERT INTO agent_sessions (
      id,
      organization_id,
      agent_id,
      platform_user_id,
      runtime_session_id,
      caller,
      direction,
      channel,
      session_status,
      language,
      stt_provider,
      flow,
      duration,
      started_at,
      ended_at,
      summary,
      characters_in,
      characters_out,
      agent_stt_type,
      agent_stt_prompt,
      agent_llm_type,
      agent_llm_prompt,
      agent_tts_type,
      agent_tts_prompt,
      agent_tts_voice,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    ON CONFLICT (runtime_session_id)
    DO UPDATE SET
      caller = EXCLUDED.caller,
      session_status = EXCLUDED.session_status,
      ended_at = EXCLUDED.ended_at,
      summary = EXCLUDED.summary,
      duration = EXCLUDED.duration,
      characters_in = EXCLUDED.characters_in,
      characters_out = EXCLUDED.characters_out,
      flow = EXCLUDED.flow,
      language = EXCLUDED.language,
      stt_provider = EXCLUDED.stt_provider,
      agent_stt_type = EXCLUDED.agent_stt_type,
      agent_stt_prompt = EXCLUDED.agent_stt_prompt,
      agent_llm_type = EXCLUDED.agent_llm_type,
      agent_llm_prompt = EXCLUDED.agent_llm_prompt,
      agent_tts_type = EXCLUDED.agent_tts_type,
      agent_tts_prompt = EXCLUDED.agent_tts_prompt,
      agent_tts_voice = EXCLUDED.agent_tts_voice,
      updated_at = EXCLUDED.updated_at`,
    [
      agentSessionId,
      organizationId,
      agent.id,
      platformUserId,
      runtimeSessionId,
      caller,
      "Inbound",
      "WebRTC",
      status,
      language ?? null,
      sttProvider ?? null,
      agent.name,
      formatDuration(startedAt, endedAt),
      startedAt,
      endedAt ?? null,
      summary ?? null,
      Number.isFinite(Number(charactersIn)) ? Number(charactersIn) : 0,
      Number.isFinite(Number(charactersOut)) ? Number(charactersOut) : 0,
      agent.stt_type,
      agent.stt_prompt,
      agent.llm_type,
      agent.llm_prompt,
      agent.tts_type,
      agent.tts_prompt,
      agent.tts_voice,
      new Date().toISOString(),
    ],
  );

  await pool.query("DELETE FROM agent_session_events WHERE agent_session_id = $1", [agentSessionId]);

  for (const [index, line] of transcriptLines.entries()) {
    await pool.query(
      "INSERT INTO agent_session_events (agent_session_id, position, event_type, line) VALUES ($1, $2, $3, $4)",
      [agentSessionId, index + 1, "transcript", line],
    );
  }

  return res.status(201).json({
    callId: agentSessionId,
    runtimeSessionId,
    transcriptEntries: transcriptLines.length,
  });
});

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
