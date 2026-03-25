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

function adminOnly(req, res, next) {
  if (!adminRoles.has(req.authUser.role)) {
    return res.status(403).json({ error: "This account does not have dashboard access." });
  }
  return next();
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
      COALESCE(
        json_agg(cte.line ORDER BY cte.position) FILTER (WHERE cte.line IS NOT NULL),
        '[]'::json
      ) AS transcript
    FROM calls c
    LEFT JOIN call_transcript_entries cte ON cte.call_id = c.id
    WHERE c.organization_id = $1
    GROUP BY c.id
    ORDER BY c.started_at DESC
  `;
  const { rows } = await pool.query(query, [organizationId]);
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    caller: row.caller,
    direction: row.direction,
    channel: row.channel,
    flow: row.flow,
    duration: row.duration,
    startedAt: row.started_at,
    status: row.status,
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

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});
