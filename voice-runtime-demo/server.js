import crypto from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import wrtc from "@roamhq/wrtc";

dotenv.config();

const {
  RTCPeerConnection,
  RTCSessionDescription,
  nonstandard: { RTCAudioSink, RTCAudioSource },
} = wrtc;

const FRAME_SIZE = 480;
const app = express();
const port = Number(process.env.PORT || 8090);
const host = process.env.HOST || "127.0.0.1";
const openAiApiKey = process.env.OPENAI_API_KEY;
const controlPlaneBaseUrl = process.env.CONTROL_PLANE_BASE_URL || "http://127.0.0.1:3001";
const controlPlaneRuntimeToken = process.env.CONTROL_PLANE_RUNTIME_TOKEN || "demo-runtime-secret";
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const sonioxApiKey = process.env.SONIOX_API_KEY;
const sonioxRealtimeModel = process.env.SONIOX_REALTIME_MODEL || "stt-rt-preview";
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const supportedLanguages = {
  en: "English",
  it: "Italian",
  ko: "Korean",
};

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

function splitSamples(samples, frameSize) {
  const chunks = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const chunk = samples.subarray(offset, offset + frameSize);
    if (chunk.length === frameSize) {
      chunks.push(new Int16Array(chunk));
    }
  }

  return chunks;
}

async function waitForIceGatheringComplete(peerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, 2000);

    function onStateChange() {
      if (peerConnection.iceGatheringState !== "complete") {
        return;
      }

      clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function buildRealtimeSession(agent, { language, sttProvider }) {
  const languageCode = language in supportedLanguages ? language : "en";
  const languageLabel = supportedLanguages[languageCode];
  const session = {
    type: "realtime",
    model: realtimeModel,
    instructions:
      `${agent.systemPrompt}\n` +
      `Always reply in ${languageLabel} unless the user explicitly asks to switch languages. ` +
      "Keep responses concise and conversational. Speak naturally, and ask at most one follow-up question at a time.",
    audio: {
      output: {
        voice: agent.ttsVoice,
      },
    },
  };

  if (sttProvider !== "soniox") {
    session.audio.input = {
      turn_detection: {
        type: "server_vad",
        create_response: true,
        interrupt_response: true,
      },
      transcription: {
        model: agent.sttModel,
        language: languageCode,
      },
    };
  }

  return session;
}

function buildFallbackSummary(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return "WebRTC voice session completed without transcript lines.";
  }

  return transcript.slice(-2).join(" ").slice(0, 240);
}

function closeSessionMedia(session) {
  session.browserSink?.stop?.();
  session.browserOutboundTrack?.stop?.();
  session.openAiSink?.stop?.();
  session.openAiOutboundTrack?.stop?.();
  session.browserPeerConnection?.close?.();
  session.openAiPeerConnection?.close?.();
  session.gatewayDataChannel?.close?.();
  session.openAiDataChannel?.close?.();
}

function closeSession(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  closeSessionMedia(session);
  sessionStore.delete(sessionId);
}

function forwardToAudioSource(source, samples) {
  for (const chunk of splitSamples(samples, FRAME_SIZE)) {
    source.onData({
      samples: chunk,
      bitsPerSample: 16,
      channelCount: 1,
      sampleRate: 48000,
      numberOfFrames: chunk.length,
    });
  }
}

function attachGatewayDataChannel(session, channel) {
  session.gatewayDataChannel = channel;

  channel.addEventListener("open", () => {
    channel.send(
      JSON.stringify({
        type: "gateway.session.ready",
        sessionId: session.runtimeSessionId,
        sttProvider: session.sttProvider,
        language: session.language,
      }),
    );
  });

  channel.addEventListener("message", (rawEvent) => {
    try {
      const event = JSON.parse(rawEvent.data);

      if (event.type === "gateway.user_text" && session.openAiDataChannel?.readyState === "open") {
        session.openAiDataChannel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: String(event.text || "").trim(),
                },
              ],
            },
          }),
        );
        session.openAiDataChannel.send(JSON.stringify({ type: "response.create" }));
      }
    } catch {}
  });
}

function attachOpenAiDataChannel(session, channel) {
  session.openAiDataChannel = channel;

  channel.addEventListener("open", () => {
    if (session.gatewayDataChannel?.readyState === "open") {
      session.gatewayDataChannel.send(JSON.stringify({ type: "gateway.upstream.ready" }));
    }
  });

  channel.addEventListener("message", (rawEvent) => {
    if (session.gatewayDataChannel?.readyState === "open") {
      session.gatewayDataChannel.send(rawEvent.data);
    }
  });
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

async function createOpenAiPeerConnection({ agent, language, sttProvider }) {
  const peerConnection = new RTCPeerConnection();
  const outboundAudioSource = new RTCAudioSource();
  const outboundTrack = outboundAudioSource.createTrack();
  peerConnection.addTrack(outboundTrack);

  const eventsChannel = peerConnection.createDataChannel("oai-events");

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGatheringComplete(peerConnection);

  const formData = new FormData();
  formData.append("sdp", peerConnection.localDescription.sdp);
  formData.append("session", JSON.stringify(buildRealtimeSession(agent, { language, sttProvider })));

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

  await peerConnection.setRemoteDescription(
    new RTCSessionDescription({
      type: "answer",
      sdp: answerSdp,
    }),
  );

  return {
    peerConnection,
    outboundAudioSource,
    outboundTrack,
    eventsChannel,
  };
}

async function createGatewaySession({ offerSdp, caller, resolved, language, sttProvider }) {
  const browserPeerConnection = new RTCPeerConnection();
  const browserOutboundAudioSource = new RTCAudioSource();
  const browserOutboundTrack = browserOutboundAudioSource.createTrack();
  browserPeerConnection.addTrack(browserOutboundTrack);

  const openAi = await createOpenAiPeerConnection({
    agent: resolved.agent,
    language,
    sttProvider,
  });

  const runtimeSessionId = `rt-${crypto.randomUUID()}`;
  const reportToken = crypto.randomBytes(18).toString("base64url");
  const session = {
    runtimeSessionId,
    reportToken,
    startedAt: new Date().toISOString(),
    caller: caller || "browser-client / unknown",
    language: language in supportedLanguages ? language : "en",
    sttProvider: sttProvider === "soniox" ? "soniox" : "openai",
    organization: resolved.organization,
    user: resolved.user,
    agent: resolved.agent,
    browserPeerConnection,
    browserOutboundAudioSource,
    browserOutboundTrack,
    openAiPeerConnection: openAi.peerConnection,
    openAiOutboundAudioSource: openAi.outboundAudioSource,
    openAiOutboundTrack: openAi.outboundTrack,
    gatewayDataChannel: null,
    openAiDataChannel: null,
    browserSink: null,
    openAiSink: null,
  };

  sessionStore.set(runtimeSessionId, session);

  attachOpenAiDataChannel(session, openAi.eventsChannel);

  browserPeerConnection.ondatachannel = (event) => {
    attachGatewayDataChannel(session, event.channel);
  };

  browserPeerConnection.ontrack = (event) => {
    const [remoteStreamTrack] = event.streams[0]?.getAudioTracks?.() ?? [];
    const track = remoteStreamTrack ?? event.track;

    if (track.kind !== "audio") {
      return;
    }

    const sink = new RTCAudioSink(track);
    sink.ondata = (frame) => {
      if (session.sttProvider !== "soniox") {
        forwardToAudioSource(session.openAiOutboundAudioSource, frame.samples);
      }
    };
    session.browserSink = sink;
  };

  openAi.peerConnection.ontrack = (event) => {
    const [remoteStreamTrack] = event.streams[0]?.getAudioTracks?.() ?? [];
    const track = remoteStreamTrack ?? event.track;

    if (track.kind !== "audio") {
      return;
    }

    const sink = new RTCAudioSink(track);
    sink.ondata = (frame) => {
      forwardToAudioSource(session.browserOutboundAudioSource, frame.samples);
    };
    session.openAiSink = sink;
  };

  browserPeerConnection.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(browserPeerConnection.connectionState)) {
      closeSession(runtimeSessionId);
    }
  };

  openAi.peerConnection.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(openAi.peerConnection.connectionState)) {
      closeSession(runtimeSessionId);
    }
  };

  await browserPeerConnection.setRemoteDescription(
    new RTCSessionDescription({ type: "offer", sdp: offerSdp }),
  );
  const answer = await browserPeerConnection.createAnswer();
  await browserPeerConnection.setLocalDescription(answer);
  await waitForIceGatheringComplete(browserPeerConnection);

  return {
    runtimeSessionId,
    reportToken,
    answerSdp: browserPeerConnection.localDescription.sdp,
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
    mode: "gateway",
    controlPlaneBaseUrl,
    configured: Boolean(openAiApiKey),
    sonioxConfigured: Boolean(sonioxApiKey),
  });
});

app.post("/api/soniox-temporary-key", async (_req, res) => {
  if (!sonioxApiKey) {
    return res.status(500).json({ error: "SONIOX_API_KEY is required for Soniox STT." });
  }

  try {
    const response = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sonioxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: 60,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.error_message || payload?.error || "Failed to create Soniox temporary key.",
      });
    }

    return res.json({
      apiKey: payload.api_key,
      model: sonioxRealtimeModel,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected Soniox key error.",
    });
  }
});

app.post("/api/session", async (req, res) => {
  if (!openAiApiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is required." });
  }

  const { voiceToken, offerSdp, caller, language = "en", sttProvider = "openai" } = req.body ?? {};

  if (!voiceToken || !offerSdp) {
    return res.status(400).json({ error: "voiceToken and offerSdp are required." });
  }

  try {
    const resolved = await resolveVoiceToken(voiceToken);
    const gatewaySession = await createGatewaySession({
      offerSdp,
      caller,
      resolved,
      language,
      sttProvider,
    });

    return res.status(201).json({
      runtimeSessionId: gatewaySession.runtimeSessionId,
      reportToken: gatewaySession.reportToken,
      answerSdp: gatewaySession.answerSdp,
      agent: {
        id: resolved.agent.id,
        name: resolved.agent.name,
        voice: resolved.agent.ttsVoice,
        model: realtimeModel,
      },
      language: language in supportedLanguages ? language : "en",
      sttProvider: sttProvider === "soniox" ? "soniox" : "openai",
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
    closeSession(req.params.runtimeSessionId);
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
