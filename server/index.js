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
const appointmentAgentTimezone =
  process.env.APPOINTMENT_AGENT_TIMEZONE || "America/Indiana/Indianapolis";
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
    templateKey: row.template_key,
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

function mapAgentTemplate(row) {
  return {
    templateKey: row.template_key,
    name: row.name,
    description: row.description,
    category: row.category,
    defaultChannel: row.default_channel,
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

function mapAppointmentWorker(row) {
  return {
    id: row.id,
    name: row.name,
    roleLabel: row.role_label,
    specialty: row.specialty,
    locationLabel: row.location_label,
    availabilitySummary: row.availability_summary,
    status: row.status,
  };
}

function mapAppointmentClient(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
  };
}

function mapAppointment(row) {
  return {
    id: row.id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    clientId: row.client_id,
    clientName: row.client_name,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    summary: row.summary,
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

async function getPlatformUserById(userId) {
  const { rows } = await pool.query("SELECT * FROM platform_users WHERE user_id = $1 LIMIT 1", [userId]);
  return rows[0] ?? null;
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

async function getAgentTemplates() {
  const { rows } = await pool.query("SELECT * FROM agent_templates ORDER BY name");
  return rows;
}

async function getAgentTemplateByKey(templateKey) {
  const { rows } = await pool.query("SELECT * FROM agent_templates WHERE template_key = $1 LIMIT 1", [
    templateKey,
  ]);
  return rows[0] ?? null;
}

async function getAppointmentWorkers(agentInternalId) {
  const { rows } = await pool.query(
    "SELECT * FROM appointment_workers WHERE agent_id = $1 ORDER BY name",
    [agentInternalId],
  );
  return rows;
}

async function getAppointmentClients(agentInternalId) {
  const { rows } = await pool.query(
    "SELECT * FROM appointment_clients WHERE agent_id = $1 ORDER BY full_name",
    [agentInternalId],
  );
  return rows;
}

async function ensureAppointmentClientForUser(agentInternalId, authUser) {
  const normalizedEmail = String(authUser.email || "").trim().toLowerCase();
  const existingQuery = await pool.query(
    `SELECT * FROM appointment_clients
     WHERE agent_id = $1
       AND organization_id = $2
       AND lower(email) = lower($3)
     LIMIT 1`,
    [agentInternalId, authUser.organization_id, normalizedEmail],
  );

  if (existingQuery.rows[0]) {
    return existingQuery.rows[0];
  }

  const clientId = `client-${crypto.randomUUID()}`;
  const inserted = await pool.query(
    `INSERT INTO appointment_clients (
      id, organization_id, agent_id, full_name, phone, email, notes, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *`,
    [
      clientId,
      authUser.organization_id,
      agentInternalId,
      authUser.name,
      "Not provided",
      normalizedEmail,
      `Created automatically for signed-in user ${authUser.name}.`,
      new Date().toISOString(),
    ],
  );

  return inserted.rows[0];
}

async function getAppointments(agentInternalId) {
  const { rows } = await pool.query(
    `SELECT
      a.*,
      w.name AS worker_name,
      c.full_name AS client_name
    FROM appointments a
    JOIN appointment_workers w ON w.id = a.worker_id
    JOIN appointment_clients c ON c.id = a.client_id
    WHERE a.agent_id = $1
      AND a.status <> 'Cancelled'
    ORDER BY a.start_at`,
    [agentInternalId],
  );
  return rows;
}

async function userHasAppointmentAtTime(agentInternalId, clientId, startAt, endAt, excludeAppointmentId = null) {
  const values = [agentInternalId, clientId, startAt, endAt];
  let query = `
    SELECT id
    FROM appointments
    WHERE agent_id = $1
      AND client_id = $2
      AND status <> 'Cancelled'
      AND start_at < $4
      AND end_at > $3
  `;

  if (excludeAppointmentId) {
    values.push(excludeAppointmentId);
    query += ` AND id <> $5`;
  }

  query += ` LIMIT 1`;
  const { rows } = await pool.query(query, values);
  return rows[0] ?? null;
}

async function workerHasAppointmentAtTime(agentInternalId, workerId, startAt, endAt, excludeAppointmentId = null) {
  const values = [agentInternalId, workerId, startAt, endAt];
  let query = `
    SELECT id
    FROM appointments
    WHERE agent_id = $1
      AND worker_id = $2
      AND status <> 'Cancelled'
      AND start_at < $4
      AND end_at > $3
  `;

  if (excludeAppointmentId) {
    values.push(excludeAppointmentId);
    query += ` AND id <> $5`;
  }

  query += ` LIMIT 1`;
  const { rows } = await pool.query(query, values);
  return rows[0] ?? null;
}

async function getAppointmentByIdForClient(agentInternalId, appointmentId, clientId) {
  const { rows } = await pool.query(
    `SELECT
      a.*,
      w.name AS worker_name,
      c.full_name AS client_name
    FROM appointments a
    JOIN appointment_workers w ON w.id = a.worker_id
    JOIN appointment_clients c ON c.id = a.client_id
    WHERE a.agent_id = $1
      AND a.id = $2
      AND a.client_id = $3
    LIMIT 1`,
    [agentInternalId, appointmentId, clientId],
  );
  return rows[0] ?? null;
}

async function createAppointmentWithChecks({
  organizationId,
  agentId,
  clientId,
  workerId,
  workerName,
  startAt,
  endAt,
  summary,
  status = "Scheduled",
}) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      "worker-slot",
      `${agentId}:${workerId}:${startAt}`,
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      "client-slot",
      `${agentId}:${clientId}:${startAt}`,
    ]);

    const workerConflict = await db.query(
      `SELECT id
       FROM appointments
       WHERE agent_id = $1
         AND worker_id = $2
         AND status <> 'Cancelled'
         AND start_at < $4
         AND end_at > $3
       LIMIT 1`,
      [agentId, workerId, startAt, endAt],
    );
    if (workerConflict.rows[0]) {
      throw new Error(`${workerName} is no longer available at that time.`);
    }

    const clientConflict = await db.query(
      `SELECT id
       FROM appointments
       WHERE agent_id = $1
         AND client_id = $2
         AND status <> 'Cancelled'
         AND start_at < $4
         AND end_at > $3
       LIMIT 1`,
      [agentId, clientId, startAt, endAt],
    );
    if (clientConflict.rows[0]) {
      throw new Error("You already have an appointment during that time.");
    }

    const appointmentId = `appt-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    await db.query(
      `INSERT INTO appointments (
        id, organization_id, agent_id, worker_id, client_id, status, start_at, end_at, summary, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [appointmentId, organizationId, agentId, workerId, clientId, status, startAt, endAt, summary, nowIso, nowIso],
    );
    await db.query("COMMIT");
    return { appointmentId };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function rescheduleAppointmentWithChecks({
  agentId,
  appointmentId,
  clientId,
  workerId,
  workerName,
  startAt,
  endAt,
  summary,
}) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const appointmentQuery = await db.query(
      `SELECT *
       FROM appointments
       WHERE agent_id = $1
         AND id = $2
         AND client_id = $3
       LIMIT 1
       FOR UPDATE`,
      [agentId, appointmentId, clientId],
    );
    const appointment = appointmentQuery.rows[0];
    if (!appointment) {
      throw new Error("Appointment not found for the signed-in user.");
    }

    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      "worker-slot",
      `${agentId}:${workerId}:${startAt}`,
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      "client-slot",
      `${agentId}:${clientId}:${startAt}`,
    ]);

    const workerConflict = await db.query(
      `SELECT id
       FROM appointments
       WHERE agent_id = $1
         AND worker_id = $2
         AND status <> 'Cancelled'
         AND start_at < $4
         AND end_at > $3
         AND id <> $5
       LIMIT 1`,
      [agentId, workerId, startAt, endAt, appointmentId],
    );
    if (workerConflict.rows[0]) {
      throw new Error(`${workerName} is no longer available at that time.`);
    }

    const clientConflict = await db.query(
      `SELECT id
       FROM appointments
       WHERE agent_id = $1
         AND client_id = $2
         AND status <> 'Cancelled'
         AND start_at < $4
         AND end_at > $3
         AND id <> $5
       LIMIT 1`,
      [agentId, clientId, startAt, endAt, appointmentId],
    );
    if (clientConflict.rows[0]) {
      throw new Error("You already have an appointment during that time.");
    }

    await db.query(
      `UPDATE appointments
       SET worker_id = $1,
           status = $2,
           start_at = $3,
           end_at = $4,
           summary = $5,
           updated_at = $6
       WHERE id = $7 AND agent_id = $8`,
      [workerId, "Rescheduled", startAt, endAt, summary, new Date().toISOString(), appointmentId, agentId],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function cancelAppointmentForClient(agentId, appointmentId, clientId) {
  const { rows } = await pool.query(
    `UPDATE appointments
     SET status = $1, updated_at = $2
     WHERE agent_id = $3
       AND id = $4
       AND client_id = $5
     RETURNING id`,
    ["Cancelled", new Date().toISOString(), agentId, appointmentId, clientId],
  );
  return rows[0] ?? null;
}

function titleCaseWords(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildSlotLabel(workerName, startAt) {
  const date = new Date(startAt);
  return `${workerName} · ${date.toLocaleString("en-US", {
    timeZone: appointmentAgentTimezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function buildAvailableSlots(workers, appointments) {
  const bookedKeys = new Set(
    appointments
      .filter((appointment) => appointment.status !== "Cancelled")
      .map((appointment) => `${appointment.worker_id}:${appointment.start_at}`),
  );

  const slots = [];
  const today = new Date();
  const baseDate = new Date(today);
  baseDate.setHours(0, 0, 0, 0);
  const dayOfWeek = baseDate.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  baseDate.setDate(baseDate.getDate() + mondayOffset);

  for (const worker of workers) {
    const workerSlots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];

    for (let dayOffset = 0; dayOffset < 56; dayOffset += 1) {
      const day = new Date(baseDate);
      day.setDate(baseDate.getDate() + dayOffset);

      for (const slotTime of workerSlots) {
        const [hours, minutes] = slotTime.split(":").map(Number);
        const slotStart = new Date(day);
        slotStart.setHours(hours, minutes, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
        const slotStartIso = slotStart.toISOString();
        const bookingKey = `${worker.id}:${slotStartIso}`;

        if (bookedKeys.has(bookingKey)) {
          continue;
        }

        const dayPart = dayOffset === 1 ? "tomorrow" : `in ${dayOffset} days`;
        const clockPart = slotStart.toLocaleTimeString("en-US", {
          timeZone: appointmentAgentTimezone,
          hour: "numeric",
          minute: "2-digit",
        });
        slots.push({
          id: `slot-${worker.id}-${slotStartIso}`,
          workerId: worker.id,
          workerName: worker.name,
          startAt: slotStartIso,
          endAt: slotEnd.toISOString(),
          label: `${buildSlotLabel(worker.name, slotStartIso)} (${dayPart} at ${clockPart})`,
        });
      }
    }
  }

  return slots.sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function getLocalDateParts(value) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: appointmentAgentTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(value));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "0"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "0"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "0"),
  };
}

function getLocalHour(value) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: appointmentAgentTimezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date(value)),
  );
}

function isoDateFromParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getNowLocalParts() {
  return getLocalDateParts(new Date().toISOString());
}

function parseRequestedHour(message) {
  const normalized = String(message || "").toLowerCase();
  let match = normalized.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/);
  if (match) {
    let hour = Number(match[1]) % 12;
    if (match[2] === "pm") {
      hour += 12;
    }
    return hour;
  }
  match = normalized.match(/\bat\s+(\d{1,2})\b/);
  if (match) {
    const hour = Number(match[1]);
    if (hour >= 9 && hour <= 16) {
      return hour;
    }
  }
  return null;
}

function parseRequestedDate(message) {
  const normalized = String(message || "").toLowerCase();
  const now = getNowLocalParts();
  const monthMap = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  };

  for (const [name, month] of Object.entries(monthMap)) {
    const match = normalized.match(new RegExp(`\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`));
    if (match) {
      const day = Number(match[1]);
      let year = match[2] ? Number(match[2]) : now.year;
      let candidate = isoDateFromParts(year, month, day);
      if (!match[2] && candidate < isoDateFromParts(now.year, now.month, now.day)) {
        year += 1;
        candidate = isoDateFromParts(year, month, day);
      }
      return candidate;
    }
  }

  if (normalized.includes("tomorrow")) {
    const base = new Date();
    base.setDate(base.getDate() + 1);
    return isoDateFromParts(base.getFullYear(), base.getMonth() + 1, base.getDate());
  }
  if (normalized.includes("today")) {
    return isoDateFromParts(now.year, now.month, now.day);
  }

  const ordinalMatch = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (ordinalMatch) {
    const day = Number(ordinalMatch[1]);
    let month = now.month;
    let year = now.year;
    let candidate = isoDateFromParts(year, month, day);
    if (candidate < isoDateFromParts(now.year, now.month, now.day)) {
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
      candidate = isoDateFromParts(year, month, day);
    }
    return candidate;
  }

  return null;
}

function findWorkerFromMessage(snapshot, message) {
  const normalized = String(message || "").toLowerCase();
  const matches = snapshot.workers.filter((worker) => {
    const full = String(worker.name || "").toLowerCase();
    const last = full.split(/\s+/).filter(Boolean).at(-1) || "";
    return full.includes(normalized) || normalized.includes(full) || (last && normalized.includes(last));
  });
  return matches.length === 1 ? matches[0] : null;
}

function slotMatchesDate(slot, requestedDate) {
  const parts = getLocalDateParts(slot.startAt);
  return isoDateFromParts(parts.year, parts.month, parts.day) === requestedDate;
}

function filterMyAppointments(snapshot, currentClient, workerName = "") {
  const currentName = String(currentClient.fullName || "").trim().toLowerCase();
  const requestedWorker = String(workerName || "").trim().toLowerCase();
  return snapshot.appointments
    .filter((appointment) => {
      if (String(appointment.clientName || "").trim().toLowerCase() !== currentName) {
        return false;
      }
      if (requestedWorker && !String(appointment.workerName || "").toLowerCase().includes(requestedWorker)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function checkAvailability(snapshot, { workerName, requestedDate, requestedHour }) {
  const matches = snapshot.availableSlots
    .filter((slot) => {
      if (workerName && !String(slot.workerName || "").toLowerCase().includes(String(workerName).toLowerCase())) {
        return false;
      }
      if (requestedDate && !slotMatchesDate(slot, requestedDate)) {
        return false;
      }
      if (requestedHour !== null && getLocalHour(slot.startAt) !== requestedHour) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt));

  const alternatives = snapshot.availableSlots
    .filter((slot) => {
      if (workerName && !String(slot.workerName || "").toLowerCase().includes(String(workerName).toLowerCase())) {
        return false;
      }
      if (requestedDate && !slotMatchesDate(slot, requestedDate)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .slice(0, 4);

  return {
    slot: matches[0] ?? null,
    alternatives,
  };
}

function interpretAppointmentTextCommand(snapshot, message, currentClient) {
  const normalized = String(message || "").toLowerCase();
  const worker = findWorkerFromMessage(snapshot, message);
  const requestedDate = parseRequestedDate(message);
  const requestedHour = parseRequestedHour(message);
  const myAppointments = filterMyAppointments(snapshot, currentClient, worker?.name ?? "");

  if (/(delete|cancel|remove)/.test(normalized)) {
    let matching = myAppointments;
    if (requestedDate) {
      matching = matching.filter((appointment) => slotMatchesDate({ startAt: appointment.startAt }, requestedDate));
    }
    if (normalized.includes("all")) {
      if (matching.length === 0) {
        return { reply: "I could not find any of your appointments matching that request.", operation: null };
      }
      return {
        reply: `Cancelled ${matching.length} appointment(s).`,
        operation: { type: "cancel_many", appointmentIds: matching.map((appointment) => appointment.id) },
      };
    }
    if (matching.length === 1) {
      return {
        reply: `Cancelled your appointment with ${matching[0].workerName}.`,
        operation: { type: "cancel", appointmentId: matching[0].id },
      };
    }
    if (matching.length > 1) {
      return { reply: "I found multiple matching appointments. Be more specific with the worker or date.", operation: null };
    }
    return { reply: "I could not find any of your appointments matching that request.", operation: null };
  }

  if (/(move|reschedule)/.test(normalized)) {
    if (!requestedDate || requestedHour === null) {
      return { reply: "Tell me the new date and time you want for the move.", operation: null };
    }
    if (myAppointments.length !== 1) {
      return { reply: "I could not uniquely identify which of your appointments to move.", operation: null };
    }
    const targetWorkerName = worker?.name ?? myAppointments[0].workerName;
    const availability = checkAvailability(snapshot, {
      workerName: targetWorkerName,
      requestedDate,
      requestedHour,
    });
    if (!availability.slot) {
      return { reply: `${targetWorkerName} is not available at that new time.`, operation: null };
    }
    return {
      reply: `Moved your appointment to ${availability.slot.label}.`,
      operation: {
        type: "reschedule",
        appointmentId: myAppointments[0].id,
        slotId: availability.slot.id,
      },
    };
  }

  if (/(book|schedule|add)/.test(normalized)) {
    if (!worker) {
      return { reply: "Tell me which worker you want, for example Warren.", operation: null };
    }
    if (!requestedDate || requestedHour === null) {
      return { reply: "Tell me the date and time you want, for example April 1 at 9 am.", operation: null };
    }
    const availability = checkAvailability(snapshot, {
      workerName: worker.name,
      requestedDate,
      requestedHour,
    });
    if (availability.slot) {
      return {
        reply: `Booked you with ${worker.name} for ${availability.slot.label}.`,
        operation: { type: "book", slotId: availability.slot.id },
      };
    }
    if (availability.alternatives.length > 0) {
      return {
        reply: `${worker.name} is not available then. Nearby options are:\n${availability.alternatives.map((slot) => `- ${slot.label}`).join("\n")}`,
        operation: null,
      };
    }
    return { reply: `${worker.name} is not available at that time.`, operation: null };
  }

  return null;
}

async function seedAppointmentAgentDemoData({ organizationId, agentInternalId }) {
  const workers = [
    {
      id: `worker-${crypto.randomUUID()}`,
      name: "Dr. Elise Warren",
      roleLabel: "Physician",
      specialty: "Primary care",
      locationLabel: "North Clinic",
      availabilitySummary: "Daily · 9:00 AM - 5:00 PM",
    },
    {
      id: `worker-${crypto.randomUUID()}`,
      name: "Jordan Park",
      roleLabel: "Nurse practitioner",
      specialty: "Follow-up visits",
      locationLabel: "North Clinic",
      availabilitySummary: "Daily · 9:00 AM - 5:00 PM",
    },
    {
      id: `worker-${crypto.randomUUID()}`,
      name: "Mina Alvarez",
      roleLabel: "Care coordinator",
      specialty: "New patient intake",
      locationLabel: "Virtual",
      availabilitySummary: "Daily · 9:00 AM - 5:00 PM",
    },
  ];

  const clients = [
    {
      id: `client-${crypto.randomUUID()}`,
      fullName: "Amelia Stone",
      phone: "+1 (317) 555-0177",
      email: "amelia.stone@example.com",
      notes: "Prefers morning appointments.",
    },
    {
      id: `client-${crypto.randomUUID()}`,
      fullName: "Marcus Lee",
      phone: "+1 (317) 555-0182",
      email: "marcus.lee@example.com",
      notes: "Needs follow-up after annual physical.",
    },
    {
      id: `client-${crypto.randomUUID()}`,
      fullName: "Priya Nair",
      phone: "+1 (317) 555-0194",
      email: "priya.nair@example.com",
      notes: "Virtual visit requested.",
    },
  ];

  const nextDay = new Date();
  nextDay.setDate(nextDay.getDate() + 1);
  nextDay.setHours(14, 0, 0, 0);

  const secondDay = new Date();
  secondDay.setDate(secondDay.getDate() + 2);
  secondDay.setHours(13, 0, 0, 0);

  const appointments = [
    {
      id: `appt-${crypto.randomUUID()}`,
      workerId: workers[0].id,
      clientId: clients[0].id,
      status: "Scheduled",
      startAt: nextDay.toISOString(),
      endAt: new Date(nextDay.getTime() + 60 * 60 * 1000).toISOString(),
      summary: "Primary care follow-up for Amelia Stone with Dr. Elise Warren.",
    },
    {
      id: `appt-${crypto.randomUUID()}`,
      workerId: workers[1].id,
      clientId: clients[1].id,
      status: "Confirmed",
      startAt: secondDay.toISOString(),
      endAt: new Date(secondDay.getTime() + 60 * 60 * 1000).toISOString(),
      summary: "Follow-up visit for Marcus Lee with Jordan Park.",
    },
  ];

  const nowIso = new Date().toISOString();

  for (const worker of workers) {
    await pool.query(
      `INSERT INTO appointment_workers (
        id, organization_id, agent_id, name, role_label, specialty, location_label, availability_summary, status, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        worker.id,
        organizationId,
        agentInternalId,
        worker.name,
        worker.roleLabel,
        worker.specialty,
        worker.locationLabel,
        worker.availabilitySummary,
        "Active",
        nowIso,
      ],
    );
  }

  for (const client of clients) {
    await pool.query(
      `INSERT INTO appointment_clients (
        id, organization_id, agent_id, full_name, phone, email, notes, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [client.id, organizationId, agentInternalId, client.fullName, client.phone, client.email, client.notes, nowIso],
    );
  }

  for (const appointment of appointments) {
    await pool.query(
      `INSERT INTO appointments (
        id, organization_id, agent_id, worker_id, client_id, status, start_at, end_at, summary, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        appointment.id,
        organizationId,
        agentInternalId,
        appointment.workerId,
        appointment.clientId,
        appointment.status,
        appointment.startAt,
        appointment.endAt,
        appointment.summary,
        nowIso,
        nowIso,
      ],
    );
  }
}

function buildAppointmentSnapshot({ workers, clients, appointments }) {
  return {
    workers: workers.map(mapAppointmentWorker),
    clients: clients.map(mapAppointmentClient),
    appointments: appointments.map(mapAppointment),
    availableSlots: buildAvailableSlots(workers, appointments),
  };
}

async function getAppointmentAgentSnapshot(agent) {
  const [workers, clients, appointments] = await Promise.all([
    getAppointmentWorkers(agent.id),
    getAppointmentClients(agent.id),
    getAppointments(agent.id),
  ]);

  return buildAppointmentSnapshot({ workers, clients, appointments });
}

function findByName(rows, accessor, message) {
  return rows.find((row) => message.includes(accessor(row).toLowerCase()));
}

async function getAppointmentCallSession(callSessionId) {
  const { rows } = await pool.query(
    `SELECT
      cs.id,
      cs.organization_id,
      cs.platform_user_id,
      cs.runtime_session_id,
      cs.language,
      cs.stt_provider,
      ad.id AS agent_def_id,
      ad.public_id AS agent_public_id,
      ad.template_key,
      ad.name AS agent_name,
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

  return rows[0] ?? null;
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

app.get("/api/agent-templates", authMiddleware, async (_req, res) => {
  const templates = await getAgentTemplates();
  return res.json({ templates: templates.map(mapAgentTemplate) });
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

app.post("/api/agent-templates/:templateKey/create-agent", authMiddleware, async (req, res) => {
  const template = await getAgentTemplateByKey(req.params.templateKey);

  if (!template) {
    return res.status(404).json({ error: "Template not found." });
  }

  const requestedName = String(req.body?.name || template.name).trim();
  if (!requestedName) {
    return res.status(400).json({ error: "A name is required to create an agent from this template." });
  }

  const slugBase = slugifyAgentName(requestedName);
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
      template_key,
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
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      agentId,
      req.authUser.organization_id,
      req.authUser.user_id,
      template.template_key,
      requestedName,
      slug,
      "Active",
      template.default_channel,
      template.runtime_url,
      template.stt_type,
      template.stt_prompt,
      template.llm_type,
      template.llm_prompt,
      template.tts_type,
      template.tts_prompt,
      template.tts_voice,
      nowIso,
      nowIso,
    ],
  );

  await seedAppointmentAgentDemoData({
    organizationId: req.authUser.organization_id,
    agentInternalId: rows[0].id,
  });

  return res.status(201).json({ agent: mapAgent(rows[0]) });
});

app.get("/api/appointment-agent/:agentId/context", authMiddleware, async (req, res) => {
  const agent = await getAgentByIdForOrganization(req.params.agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "This agent is not an appointment agent." });
  }

  const snapshot = await getAppointmentAgentSnapshot(agent);
  return res.json({ snapshot });
});

app.post("/api/appointment-agent/:agentId/appointments", authMiddleware, async (req, res) => {
  const agent = await getAgentByIdForOrganization(req.params.agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "This agent is not an appointment agent." });
  }

  const { slotId } = req.body ?? {};
  if (!slotId) {
    return res.status(400).json({ error: "slotId is required." });
  }

  const snapshot = await getAppointmentAgentSnapshot(agent);
  const slot = snapshot.availableSlots.find((entry) => entry.id === slotId);
  const client = await ensureAppointmentClientForUser(agent.id, req.authUser);

  if (!slot) {
    return res.status(409).json({ error: "Slot not found in the current calendar." });
  }

  try {
    await createAppointmentWithChecks({
      organizationId: req.authUser.organization_id,
      agentId: agent.id,
      clientId: client.id,
      workerId: slot.workerId,
      workerName: slot.workerName,
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary: `${client.full_name} booked with ${slot.workerName}.`,
    });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Failed to book appointment." });
  }

  const nextSnapshot = await getAppointmentAgentSnapshot(agent);
  return res.status(201).json({ snapshot: nextSnapshot });
});

app.patch("/api/appointment-agent/:agentId/appointments/:appointmentId", authMiddleware, async (req, res) => {
  const agent = await getAgentByIdForOrganization(req.params.agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "This agent is not an appointment agent." });
  }

  const { slotId } = req.body ?? {};
  if (!slotId) {
    return res.status(400).json({ error: "slotId is required." });
  }

  const client = await ensureAppointmentClientForUser(agent.id, req.authUser);
  const appointment = await getAppointmentByIdForClient(agent.id, req.params.appointmentId, client.id);
  if (!appointment) {
    return res.status(404).json({ error: "Appointment not found for the signed-in user." });
  }

  const snapshot = await getAppointmentAgentSnapshot(agent);
  const slot = snapshot.availableSlots.find((entry) => entry.id === slotId);
  if (!slot) {
    return res.status(409).json({ error: "Slot not found in the current calendar." });
  }

  try {
    await rescheduleAppointmentWithChecks({
      agentId: agent.id,
      appointmentId: appointment.id,
      clientId: client.id,
      workerId: slot.workerId,
      workerName: slot.workerName,
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary: `${appointment.client_name} moved to ${slot.workerName}.`,
    });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Failed to reschedule appointment." });
  }

  const nextSnapshot = await getAppointmentAgentSnapshot(agent);
  return res.json({ snapshot: nextSnapshot });
});

app.delete("/api/appointment-agent/:agentId/appointments/:appointmentId", authMiddleware, async (req, res) => {
  const agent = await getAgentByIdForOrganization(req.params.agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "This agent is not an appointment agent." });
  }

  const client = await ensureAppointmentClientForUser(agent.id, req.authUser);
  const cancelled = await cancelAppointmentForClient(agent.id, req.params.appointmentId, client.id);
  if (!cancelled) {
    return res.status(404).json({ error: "Appointment not found for the signed-in user." });
  }

  const nextSnapshot = await getAppointmentAgentSnapshot(agent);
  return res.json({ snapshot: nextSnapshot });
});
app.post("/api/appointment-agent/:agentId/chat", authMiddleware, async (req, res) => {
  const agent = await getAgentByIdForOrganization(req.params.agentId, req.authUser.organization_id);

  if (!agent) {
    return res.status(404).json({ error: "Agent not found." });
  }

  if (agent.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "This agent is not an appointment agent." });
  }

  const message = String(req.body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ error: "message is required." });
  }

  const snapshot = await getAppointmentAgentSnapshot(agent);
  const currentClient = await ensureAppointmentClientForUser(agent.id, req.authUser);
  const localCommand = interpretAppointmentTextCommand(snapshot, message, {
    id: currentClient.id,
    fullName: currentClient.full_name,
    email: currentClient.email,
  });
  if (!localCommand) {
    return res.status(400).json({
      error: "I could not interpret that appointment command. Try booking, moving, or cancelling with a worker, date, and time.",
    });
  }
  const runtimeResult = localCommand;

  if (runtimeResult?.operation?.type === "book") {
    const slot = snapshot.availableSlots.find((entry) => entry.id === runtimeResult.operation.slotId);
    if (!slot) {
      return res.status(409).json({ error: "The runtime requested an invalid booking target." });
    }
    try {
      await createAppointmentWithChecks({
        organizationId: req.authUser.organization_id,
        agentId: agent.id,
        clientId: currentClient.id,
        workerId: slot.workerId,
        workerName: slot.workerName,
        startAt: slot.startAt,
        endAt: slot.endAt,
        summary: `${currentClient.fullName} booked with ${slot.workerName}.`,
      });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Failed to book appointment." });
    }
  } else if (runtimeResult?.operation?.type === "reschedule") {
    const slot = snapshot.availableSlots.find((entry) => entry.id === runtimeResult.operation.slotId);
    if (!slot) {
      return res.status(409).json({ error: "The runtime requested an invalid reschedule target." });
    }

    const appointment = await getAppointmentByIdForClient(
      agent.id,
      runtimeResult.operation.appointmentId,
      currentClient.id,
    );
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found for the signed-in user." });
    }

    try {
      await rescheduleAppointmentWithChecks({
        agentId: agent.id,
        appointmentId: appointment.id,
        clientId: currentClient.id,
        workerId: slot.workerId,
        workerName: slot.workerName,
        startAt: slot.startAt,
        endAt: slot.endAt,
        summary: `${appointment.client_name} moved to ${slot.workerName}.`,
      });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Failed to reschedule appointment." });
    }
  } else if (runtimeResult?.operation?.type === "cancel") {
    const appointmentId = runtimeResult.operation.appointmentId;
    const cancelled = await cancelAppointmentForClient(agent.id, appointmentId, currentClient.id);
    if (!cancelled) {
      return res.status(404).json({ error: "Appointment not found for the signed-in user." });
    }
  } else if (runtimeResult?.operation?.type === "cancel_many") {
    const appointmentIds = Array.isArray(runtimeResult.operation.appointmentIds)
      ? runtimeResult.operation.appointmentIds
      : [];
    if (appointmentIds.length === 0) {
      return res.status(409).json({ error: "The runtime requested an empty bulk cancellation." });
    }
    await pool.query(
      `UPDATE appointments
       SET status = $1, updated_at = $2
       WHERE agent_id = $3
         AND client_id = $4
         AND id = ANY($5::text[])`,
      ["Cancelled", new Date().toISOString(), agent.id, currentClient.id, appointmentIds],
    );
  }

  const nextSnapshot = await getAppointmentAgentSnapshot(agent);
  return res.json({ reply: runtimeResult.reply, snapshot: nextSnapshot });
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

app.post("/api/internal/appointment-agent/context", requireInternalService, async (req, res) => {
  const { callSessionId } = req.body ?? {};

  if (!callSessionId) {
    return res.status(400).json({ error: "callSessionId is required." });
  }

  const session = await getAppointmentCallSession(callSessionId);
  if (!session) {
    return res.status(404).json({ error: "Call session not found." });
  }

  if (session.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "Call session agent is not an appointment agent." });
  }

  const snapshot = await getAppointmentAgentSnapshot({
    id: session.agent_def_id,
  });

  return res.json({
    callSession: {
      id: session.id,
      organizationId: session.organization_id,
      platformUserId: session.platform_user_id,
      runtimeSessionId: session.runtime_session_id,
      language: session.language,
      sttProvider: session.stt_provider,
    },
    agent: {
      agentDefId: session.agent_def_id,
      id: session.agent_public_id,
      name: session.agent_name,
      templateKey: session.template_key,
      runtimeUrl: session.runtime_url,
      sttType: session.stt_type,
      sttPrompt: session.stt_prompt,
      llmType: session.llm_type,
      llmPrompt: session.llm_prompt,
      ttsType: session.tts_type,
      ttsPrompt: session.tts_prompt,
      ttsVoice: session.tts_voice,
    },
    snapshot,
  });
});

app.post("/api/internal/appointment-agent/book", requireInternalService, async (req, res) => {
  const { callSessionId, slotId } = req.body ?? {};

  if (!callSessionId || !slotId) {
    return res.status(400).json({ error: "callSessionId and slotId are required." });
  }

  const session = await getAppointmentCallSession(callSessionId);
  if (!session) {
    return res.status(404).json({ error: "Call session not found." });
  }

  if (session.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "Call session agent is not an appointment agent." });
  }

  const snapshot = await getAppointmentAgentSnapshot({ id: session.agent_def_id });
  const slot = snapshot.availableSlots.find((entry) => entry.id === slotId);
  const platformUser = await getPlatformUserById(session.platform_user_id);

  if (!slot) {
    return res.status(409).json({ error: "Slot not found in the current appointment snapshot." });
  }

  if (!platformUser) {
    return res.status(404).json({ error: "Platform user not found for call session." });
  }

  const client = await ensureAppointmentClientForUser(session.agent_def_id, platformUser);
  let appointmentId;
  try {
    const result = await createAppointmentWithChecks({
      organizationId: session.organization_id,
      agentId: session.agent_def_id,
      clientId: client.id,
      workerId: slot.workerId,
      workerName: slot.workerName,
      startAt: slot.startAt,
      endAt: slot.endAt,
      summary: `${client.full_name} booked with ${slot.workerName}.`,
    });
    appointmentId = result.appointmentId;
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Failed to book appointment." });
  }

  return res.status(201).json({
    appointmentId,
    summary: `Booked ${client.full_name} with ${slot.workerName} for ${slot.label}.`,
  });
});

app.post("/api/internal/appointment-agent/cancel", requireInternalService, async (req, res) => {
  const { callSessionId, appointmentId } = req.body ?? {};

  if (!callSessionId || !appointmentId) {
    return res.status(400).json({ error: "callSessionId and appointmentId are required." });
  }

  const session = await getAppointmentCallSession(callSessionId);
  if (!session) {
    return res.status(404).json({ error: "Call session not found." });
  }

  if (session.template_key !== "appointment-agent") {
    return res.status(409).json({ error: "Call session agent is not an appointment agent." });
  }

  const platformUser = await getPlatformUserById(session.platform_user_id);
  if (!platformUser) {
    return res.status(404).json({ error: "Platform user not found for call session." });
  }

  const client = await ensureAppointmentClientForUser(session.agent_def_id, platformUser);
  const result = await cancelAppointmentForClient(session.agent_def_id, appointmentId, client.id);

  if (!result) {
    return res.status(404).json({ error: "Appointment not found for this caller." });
  }

  return res.json({ appointmentId, summary: `Cancelled ${appointmentId}.` });
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
