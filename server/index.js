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
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    channel: row.channel,
    systemPrompt: row.system_prompt,
    llmModel: row.llm_model,
    sttModel: row.stt_model,
    ttsModel: row.tts_model,
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
  const query = `
    SELECT
      c.*,
      a.name AS agent_name,
      COALESCE(
        json_agg(cte.line ORDER BY cte.position) FILTER (WHERE cte.line IS NOT NULL),
        '[]'::json
      ) AS transcript
    FROM calls c
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN call_transcript_entries cte ON cte.call_id = c.id
    WHERE c.organization_id = $1
    GROUP BY c.id, a.name
    ORDER BY c.started_at DESC
  `;
  const { rows } = await pool.query(query, [organizationId]);
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
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
    status: row.status,
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
    "SELECT * FROM agents WHERE id = $1 AND organization_id = $2 LIMIT 1",
    [agentId, organizationId],
  );
  return rows[0] ?? null;
}

async function getAgentsByOrganization(organizationId) {
  const { rows } = await pool.query(
    "SELECT * FROM agents WHERE organization_id = $1 ORDER BY name",
    [organizationId],
  );
  return rows;
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
  const { name, email, password, organizationId } = req.body ?? {};

  if (!name || !email || !password || !organizationId) {
    return res.status(400).json({ error: "name, email, password, and organizationId are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const organization = await getOrganizationById(organizationId);

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

  const passwordHash = await bcrypt.hash(password, 10);
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
      organization.name,
      "General",
      "Agent",
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

app.get("/api/organizations/:organizationId/users", authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM platform_users WHERE organization_id = $1 ORDER BY name",
    [req.params.organizationId],
  );
  res.json({ users: rows.map(mapUser) });
});

app.post("/api/organizations/:organizationId/users", authMiddleware, adminOnly, async (req, res) => {
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
  const calls = await getCallsByOrganization(req.authUser.organization_id);
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
      a.name AS agent_name,
      a.slug,
      a.system_prompt,
      a.llm_model,
      a.stt_model,
      a.tts_model,
      a.tts_voice,
      a.runtime_url
    FROM voice_session_tokens vst
    JOIN organizations o ON o.id = vst.organization_id
    JOIN platform_users pu ON pu.user_id = vst.platform_user_id
    JOIN agents a ON a.id = vst.agent_id
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
      id: row.agent_id,
      name: row.agent_name,
      slug: row.slug,
      systemPrompt: row.system_prompt,
      llmModel: row.llm_model,
      sttModel: row.stt_model,
      ttsModel: row.tts_model,
      ttsVoice: row.tts_voice,
      runtimeUrl: row.runtime_url,
    },
    expiresAt: row.expires_at,
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

  const callId = `call-${runtimeSessionId}`;
  const transcriptLines = Array.isArray(transcript)
    ? transcript.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];

  await pool.query(
    `INSERT INTO calls (
      id,
      organization_id,
      agent_id,
      platform_user_id,
      runtime_session_id,
      caller,
      direction,
      channel,
      flow,
      duration,
      started_at,
      ended_at,
      status,
      summary,
      characters_in,
      characters_out
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (runtime_session_id)
    DO UPDATE SET
      caller = EXCLUDED.caller,
      status = EXCLUDED.status,
      ended_at = EXCLUDED.ended_at,
      summary = EXCLUDED.summary,
      duration = EXCLUDED.duration,
      characters_in = EXCLUDED.characters_in,
      characters_out = EXCLUDED.characters_out,
      flow = EXCLUDED.flow`,
    [
      callId,
      organizationId,
      agentId,
      platformUserId,
      runtimeSessionId,
      caller,
      "Inbound",
      "WebRTC",
      agent.name,
      formatDuration(startedAt, endedAt),
      startedAt,
      endedAt ?? null,
      status,
      summary ?? null,
      Number.isFinite(Number(charactersIn)) ? Number(charactersIn) : 0,
      Number.isFinite(Number(charactersOut)) ? Number(charactersOut) : 0,
    ],
  );

  await pool.query("DELETE FROM call_transcript_entries WHERE call_id = $1", [callId]);

  for (const [index, line] of transcriptLines.entries()) {
    await pool.query(
      "INSERT INTO call_transcript_entries (call_id, position, line) VALUES ($1, $2, $3)",
      [callId, index + 1, line],
    );
  }

  return res.status(201).json({
    callId,
    runtimeSessionId,
    transcriptEntries: transcriptLines.length,
  });
});

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
