import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8090);
const host = process.env.HOST || "127.0.0.1";
const openAiApiKey = process.env.OPENAI_API_KEY;
const controlPlaneBaseUrl = process.env.CONTROL_PLANE_BASE_URL || "http://127.0.0.1:3001";
const controlPlaneRuntimeToken = process.env.CONTROL_PLANE_RUNTIME_TOKEN || "demo-runtime-secret";
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const sessionStore = new Map();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

function buildRealtimeSession(agent) {
  return {
    type: "realtime",
    model: realtimeModel,
    instructions:
      `${agent.systemPrompt}\n` +
      "Keep responses concise and conversational. Speak naturally, and ask at most one follow-up question at a time.",
    audio: {
      input: {
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
        },
        transcription: {
          model: agent.sttModel,
        },
      },
      output: {
        voice: agent.ttsVoice,
      },
    },
  };
}

function buildFallbackSummary(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return "WebRTC voice session completed without transcript lines.";
  }

  return transcript.slice(-2).join(" ").slice(0, 240);
}

async function resolveVoiceToken(voiceToken) {
  const response = await fetch(`${controlPlaneBaseUrl}/api/internal/voice/resolve-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${controlPlaneRuntimeToken}`,
    },
    body: JSON.stringify({ voiceToken }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Failed to resolve voice token.");
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function createRealtimeCall({ offerSdp, agent }) {
  const formData = new FormData();
  formData.append("sdp", offerSdp);
  formData.append("session", JSON.stringify(buildRealtimeSession(agent)));

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: formData,
  });

  const answerSdp = await response.text();
  if (!response.ok) {
    const error = new Error(answerSdp || "Failed to create OpenAI realtime call.");
    error.statusCode = response.status;
    throw error;
  }

  return {
    answerSdp,
    openAiCallId: response.headers.get("x-request-id") || null,
  };
}

async function persistCallReport(session, report) {
  const response = await fetch(`${controlPlaneBaseUrl}/api/internal/voice/calls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${controlPlaneRuntimeToken}`,
    },
    body: JSON.stringify({
      runtimeSessionId: session.runtimeSessionId,
      organizationId: session.organization.id,
      platformUserId: session.user.userId,
      agentId: session.agent.id,
      caller: session.caller,
      status: report.status || "Completed",
      summary: report.summary || buildFallbackSummary(report.transcript),
      transcript: Array.isArray(report.transcript) ? report.transcript : [],
      startedAt: report.startedAt || session.startedAt,
      endedAt: report.endedAt || new Date().toISOString(),
      charactersIn: Number(report.charactersIn) || 0,
      charactersOut: Number(report.charactersOut) || 0,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Failed to persist call report.");
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "voice-runtime-demo",
    controlPlaneBaseUrl,
    configured: Boolean(openAiApiKey),
  });
});

app.post("/api/session", async (req, res) => {
  if (!openAiApiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is required." });
  }

  const { voiceToken, offerSdp, caller } = req.body ?? {};

  if (!voiceToken || !offerSdp) {
    return res.status(400).json({ error: "voiceToken and offerSdp are required." });
  }

  try {
    const resolved = await resolveVoiceToken(voiceToken);
    const realtime = await createRealtimeCall({
      offerSdp,
      agent: resolved.agent,
    });
    const runtimeSessionId = `rt-${crypto.randomUUID()}`;
    const reportToken = crypto.randomBytes(18).toString("base64url");

    sessionStore.set(runtimeSessionId, {
      runtimeSessionId,
      reportToken,
      startedAt: new Date().toISOString(),
      caller: caller || "browser-client / unknown",
      organization: resolved.organization,
      user: resolved.user,
      agent: resolved.agent,
      openAiCallId: realtime.openAiCallId,
    });

    return res.status(201).json({
      runtimeSessionId,
      reportToken,
      answerSdp: realtime.answerSdp,
      agent: {
        id: resolved.agent.id,
        name: resolved.agent.name,
        voice: resolved.agent.ttsVoice,
        model: realtimeModel,
      },
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || "Failed to create runtime session.",
    });
  }
});

app.post("/api/session/:runtimeSessionId/report", async (req, res) => {
  const session = sessionStore.get(req.params.runtimeSessionId);

  if (!session) {
    return res.status(404).json({ error: "Runtime session not found." });
  }

  if (req.body?.reportToken !== session.reportToken) {
    return res.status(401).json({ error: "Invalid report token." });
  }

  try {
    const result = await persistCallReport(session, req.body ?? {});
    sessionStore.delete(req.params.runtimeSessionId);
    return res.status(201).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || "Failed to persist runtime report.",
    });
  }
});

app.listen(port, host, () => {
  console.log(`Voice runtime demo listening on http://${host}:${port}`);
});
