import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import type { AgentRecord } from "../types";

const VOICE_GATEWAY_BASE_URL =
  import.meta.env.VITE_VOICE_RUNTIME_BASE_URL || "http://127.0.0.1:8000";

const languageOptions = [
  { value: "en", label: "English" },
  { value: "it", label: "Italian" },
  { value: "ko", label: "Korean" },
] as const;

type LanguageCode = (typeof languageOptions)[number]["value"];
type SttProvider = "openai" | "soniox";

type VoiceTokenResponse = {
  voiceToken: string;
  expiresAt: string;
  runtimeUrl: string;
  iceServers: RTCIceServer[];
  agent: AgentRecord;
};

type GatewaySessionResponse = {
  sessionId: string;
  answerSdp: string;
  reportToken: string;
  language: LanguageCode;
  sttProvider: SttProvider;
  agent: {
    id: string;
    name: string;
    voice: string;
    model: string;
  };
};

type TranscriptLine = {
  speaker: "User" | "Agent";
  text: string;
};

type VoiceDemoPanelProps = {
  agents: AgentRecord[];
  onCallSaved: () => Promise<void>;
};

type ActiveSession = {
  peerConnection: RTCPeerConnection;
  localStream: MediaStream;
  sessionId: string;
  reportToken: string;
  startedAt: string;
  eventsChannel: RTCDataChannel;
};

type SonioxRecording = {
  stop: () => Promise<void>;
  pause?: () => void;
  resume?: () => void;
  on: (eventName: string, handler: (...args: any[]) => void) => void;
};

let sonioxModulePromise: Promise<any> | null = null;

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, 1500);

    function onStateChange() {
      if (peerConnection.iceGatheringState !== "complete") {
        return;
      }

      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }

    peerConnection.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function buildSummary(lines: TranscriptLine[]) {
  if (lines.length === 0) {
    return "Voice session ended before transcript lines were captured.";
  }

  return lines
    .slice(-2)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join(" ")
    .slice(0, 240);
}

async function ensureSonioxModule() {
  if (!sonioxModulePromise) {
    sonioxModulePromise = new Function('return import("https://esm.sh/@soniox/client")')() as Promise<any>;
  }

  return sonioxModulePromise;
}

async function fetchSonioxTemporaryKey() {
  const response = await fetch(`${VOICE_GATEWAY_BASE_URL}/api/soniox-temporary-key`, {
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.apiKey) {
    throw new Error(payload?.error || "Failed to create Soniox temporary key.");
  }

  return payload as { apiKey: string; model: string };
}

export function VoiceDemoPanel({ agents, onCallSaved }: VoiceDemoPanelProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [language, setLanguage] = useState<LanguageCode>("en");
  const [sttProvider, setSttProvider] = useState<SttProvider>("openai");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const activeSessionRef = useRef<ActiveSession | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const sonioxRecordingRef = useRef<SonioxRecording | null>(null);
  const sonioxPausedForPlaybackRef = useRef(false);
  const pendingUserTextsRef = useRef<string[]>([]);
  const sonioxUtteranceRef = useRef("");
  const sonioxSeenFinalTokenKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedAgentId && agents[0]?.id) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    return () => {
      const current = activeSessionRef.current;
      if (current) {
        for (const track of current.localStream.getTracks()) {
          track.stop();
        }
        current.peerConnection.close();
      }

      if (sonioxRecordingRef.current) {
        void sonioxRecordingRef.current.stop();
      }
    };
  }, []);

  function appendEvent(message: string) {
    setEvents((current) => [message, ...current].slice(0, 10));
  }

  function appendTranscriptLine(speaker: TranscriptLine["speaker"], text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setTranscript((current) => [...current, { speaker, text: trimmed }]);
  }

  function flushPendingUserTexts() {
    const channel = activeSessionRef.current?.eventsChannel;
    if (!channel || channel.readyState !== "open" || pendingUserTextsRef.current.length === 0) {
      return;
    }

    const queued = [...pendingUserTextsRef.current];
    pendingUserTextsRef.current = [];

    for (const text of queued) {
      channel.send(JSON.stringify({ type: "gateway.user_text", text }));
      appendEvent(`Sent Soniox transcript to gateway: ${text.slice(0, 48)}`);
    }
  }

  function sendTranscriptToGateway(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const channel = activeSessionRef.current?.eventsChannel;
    if (!channel || channel.readyState !== "open") {
      pendingUserTextsRef.current.push(trimmed);
      appendEvent("Queued Soniox transcript until gateway channel is ready.");
      return;
    }

    channel.send(JSON.stringify({ type: "gateway.user_text", text: trimmed }));
    appendEvent(`Sent Soniox transcript to gateway: ${trimmed.slice(0, 48)}`);
  }

  function pauseSonioxCaptureForPlayback() {
    if (sttProvider !== "soniox" || sonioxPausedForPlaybackRef.current) {
      return;
    }

    sonioxRecordingRef.current?.pause?.();
    sonioxPausedForPlaybackRef.current = true;
    appendEvent("Paused Soniox capture while agent is speaking.");
  }

  function resumeSonioxCaptureAfterPlayback() {
    if (sttProvider !== "soniox" || !sonioxPausedForPlaybackRef.current) {
      return;
    }

    sonioxRecordingRef.current?.resume?.();
    sonioxPausedForPlaybackRef.current = false;
    appendEvent("Resumed Soniox capture after agent response.");
  }

  async function startSonioxRecording(languageCode: LanguageCode) {
    const { SonioxClient, BrowserPermissionResolver } = await ensureSonioxModule();
    const temporaryKey = await fetchSonioxTemporaryKey();

    const client = new SonioxClient({
      api_key: temporaryKey.apiKey,
      permissions: new BrowserPermissionResolver(),
    });

    const recording = (await client.realtime.record({
      model: temporaryKey.model,
      language_hints: [languageCode],
      enable_endpoint_detection: true,
    })) as SonioxRecording;

    sonioxUtteranceRef.current = "";
    sonioxSeenFinalTokenKeysRef.current = new Set();

    recording.on("result", (result: any) => {
      let liveText = "";

      for (const token of result?.tokens || []) {
        if (!token?.text || token.text === "<end>") {
          continue;
        }

        liveText += token.text;

        if (token.is_final) {
          const tokenKey = `${token.start_ms ?? ""}:${token.end_ms ?? ""}:${token.text}`;
          if (!sonioxSeenFinalTokenKeysRef.current.has(tokenKey)) {
            sonioxSeenFinalTokenKeysRef.current.add(tokenKey);
            sonioxUtteranceRef.current += token.text;
          }
        }
      }

      if (liveText.trim()) {
        setStatus(`Listening (${languageCode})`);
      }

      if (result?.finished) {
        const utterance = sonioxUtteranceRef.current.trim();
        sonioxUtteranceRef.current = "";
        sonioxSeenFinalTokenKeysRef.current = new Set();

        if (utterance) {
          appendTranscriptLine("User", utterance);
          sendTranscriptToGateway(utterance);
        }
      }
    });

    recording.on("endpoint", () => {
      const utterance = sonioxUtteranceRef.current.trim();
      sonioxUtteranceRef.current = "";
      sonioxSeenFinalTokenKeysRef.current = new Set();

      if (utterance) {
        appendTranscriptLine("User", utterance);
        sendTranscriptToGateway(utterance);
      }
    });

    recording.on("error", (recordingError: any) => {
      appendEvent(`Soniox error: ${recordingError?.message || recordingError}`);
    });

    sonioxRecordingRef.current = recording;
    sonioxPausedForPlaybackRef.current = false;
    appendEvent("Soniox live transcription connected");
  }

  function bindGatewayEvents(eventsChannel: RTCDataChannel) {
    eventsChannel.addEventListener("open", () => {
      appendEvent("Gateway events channel open");
      flushPendingUserTexts();
    });

    eventsChannel.addEventListener("message", (rawEvent) => {
      try {
        const event = JSON.parse(rawEvent.data);

        if (event.type === "gateway.session.ready") {
          setStatus("Gateway session ready");
          flushPendingUserTexts();
        }

        if (event.type === "gateway.upstream.ready") {
          appendEvent("Downstream agent ready");
        }

        if (event.type === "input_audio_buffer.speech_started") {
          setStatus("Listening");
        }

        if (event.type === "response.created") {
          setStatus("Agent responding");
          pauseSonioxCaptureForPlayback();
        }

        if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
          appendTranscriptLine("User", event.transcript);
        }

        if (event.type === "response.output_audio_transcript.done" && event.transcript) {
          appendTranscriptLine("Agent", event.transcript);
        }

        if (event.type === "response.output_audio.done" || event.type === "response.done") {
          resumeSonioxCaptureAfterPlayback();
        }
      } catch {
        appendEvent("Received non-JSON gateway event");
      }
    });
  }

  async function startVoiceSession() {
    if (!selectedAgentId || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setTranscript([]);
    setEvents([]);
    pendingUserTextsRef.current = [];
    setStatus("Requesting voice session");

    try {
      const tokenData = await apiRequest<VoiceTokenResponse>("/voice/token", {
        method: "POST",
        body: { agentId: selectedAgentId },
      });

      appendEvent(`Voice token minted for ${tokenData.agent.name}`);
      setStatus("Preparing media");

      const localStream =
        sttProvider === "soniox"
          ? new MediaStream()
          : await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
              },
            });

      const peerConnection = new RTCPeerConnection({
        iceServers: tokenData.iceServers,
      });

      if (sttProvider === "soniox") {
        peerConnection.addTransceiver("audio", { direction: "recvonly" });
      } else {
        for (const track of localStream.getTracks()) {
          peerConnection.addTrack(track, localStream);
        }
      }

      peerConnection.ontrack = (event) => {
        const [eventStream] = event.streams;
        const stream =
          eventStream ??
          remoteStreamRef.current ??
          new MediaStream(event.track ? [event.track] : []);

        if (!eventStream && event.track) {
          stream.addTrack?.(event.track);
        }

        remoteStreamRef.current = stream;

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {
            appendEvent("Remote audio is ready. Use the browser audio controls if playback is blocked.");
          });
        }

        appendEvent(`Remote audio stream attached (streamless=${event.streams.length === 0})`);
      };

      peerConnection.onconnectionstatechange = () => {
        const nextState = peerConnection.connectionState;
        setStatus(`Peer ${nextState}`);
        appendEvent(`Peer connection ${nextState}`);
        setConnected(nextState === "connected");
      };

      const eventsChannel = peerConnection.createDataChannel("gateway-events");
      bindGatewayEvents(eventsChannel);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const response = await fetch(`${VOICE_GATEWAY_BASE_URL}/api/webrtc/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voiceToken: tokenData.voiceToken,
          offerSdp: peerConnection.localDescription?.sdp,
          caller: `browser-client / ${window.location.host}`,
          language,
          sttProvider,
        }),
      });
      const payload = (await response.json()) as GatewaySessionResponse | { error?: string };

      if (!response.ok || !("answerSdp" in payload)) {
        throw new Error(("error" in payload && payload.error) || "Failed to create gateway session.");
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: payload.answerSdp,
      });

      activeSessionRef.current = {
        peerConnection,
        localStream,
        sessionId: payload.sessionId,
        reportToken: payload.reportToken,
        startedAt: new Date().toISOString(),
        eventsChannel,
      };

      if (sttProvider === "soniox") {
        setStatus("Connecting Soniox STT");
        await startSonioxRecording(language);
      }

      setConnected(true);
      setStatus(`Connected to ${payload.agent.name}`);
      appendEvent(`Gateway session ${payload.sessionId} created`);
    } catch (runtimeError) {
      const message = runtimeError instanceof Error ? runtimeError.message : "Voice session failed.";
      setError(message);
      setStatus("Idle");
      appendEvent(message);
      await stopRtcOnly();
    } finally {
      setBusy(false);
    }
  }

  async function stopRtcOnly() {
    const current = activeSessionRef.current;
    activeSessionRef.current = null;

    if (sonioxRecordingRef.current) {
      try {
        await sonioxRecordingRef.current.stop();
      } catch {
        // Ignore stop errors during teardown.
      }
      sonioxRecordingRef.current = null;
      sonioxPausedForPlaybackRef.current = false;
    }

    if (!current) {
      return;
    }

    for (const track of current.localStream.getTracks()) {
      track.stop();
    }
    current.peerConnection.close();

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    remoteStreamRef.current = null;
    setConnected(false);
  }

  async function endVoiceSession() {
    const current = activeSessionRef.current;

    if (!current || busy) {
      return;
    }

    setBusy(true);
    setStatus("Saving call");

    const transcriptLines = transcript.map((line) => `${line.speaker}: ${line.text}`);
    const charactersIn = transcript
      .filter((line) => line.speaker === "User")
      .reduce((total, line) => total + line.text.length, 0);
    const charactersOut = transcript
      .filter((line) => line.speaker === "Agent")
      .reduce((total, line) => total + line.text.length, 0);

    try {
      const reportResponse = await fetch(`${VOICE_GATEWAY_BASE_URL}/api/webrtc/session/${current.sessionId}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reportToken: current.reportToken,
          transcript: transcriptLines,
          summary: buildSummary(transcript),
          startedAt: current.startedAt,
          endedAt: new Date().toISOString(),
          status: transcriptLines.length > 0 ? "Completed" : "Escalated",
          charactersIn,
          charactersOut,
        }),
      });

      if (!reportResponse.ok) {
        const reportPayload = (await reportResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(reportPayload.error || "Failed to save call report.");
      }

      appendEvent("Call summary sent to control plane");
      await onCallSaved();
    } catch (reportError) {
      appendEvent(reportError instanceof Error ? reportError.message : "Call ended locally, but saving summary failed");
    } finally {
      await stopRtcOnly();
      setBusy(false);
      setStatus("Idle");
    }
  }

  return (
    <article className="panel full-span voice-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Voice Demo</p>
          <h3>Talk to a tenant agent over WebRTC</h3>
        </div>
      </div>

      <div className="voice-controls">
        <div className="voice-selects">
          <div className="voice-select-group">
            <span className="voice-select-label">Agent</span>
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={busy || connected}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="voice-select-group">
            <span className="voice-select-label">Language</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)} disabled={busy || connected}>
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="voice-select-group">
            <span className="voice-select-label">STT Provider</span>
            <select value={sttProvider} onChange={(event) => setSttProvider(event.target.value as SttProvider)} disabled={busy || connected}>
              <option value="openai">gpt-4o-mini-transcribe</option>
              <option value="soniox">Soniox</option>
            </select>
          </div>
        </div>

        <div className="voice-button-row">
          <button className="primary-button" disabled={!selectedAgentId || busy || connected} onClick={() => void startVoiceSession()}>
            {busy && !connected ? "Connecting…" : "Start voice session"}
          </button>
          <button className="secondary-button" disabled={!connected || busy} onClick={() => void endVoiceSession()}>
            {busy && connected ? "Saving…" : "End session"}
          </button>
        </div>
      </div>

      <div className="voice-status-row">
        <span className={`status-pill ${connected ? "live" : ""}`}>{status}</span>
        <span className="voice-status-info">
          Gateway: <code>{VOICE_GATEWAY_BASE_URL}</code>
          <span>·</span>
          STT: <code>{sttProvider === "soniox" ? "Soniox" : "OpenAI"}</code>
          <span>·</span>
          Lang: <code>{language}</code>
        </span>
      </div>

      <audio ref={remoteAudioRef} autoPlay controls className="voice-audio" />

      {error ? <p className="error-text">{error}</p> : null}

      <div className="voice-grid">
        <div>
          <p className="eyebrow">Transcript</p>
          <div className="transcript-list voice-transcript">
            {transcript.length === 0 ? (
              <p>Transcript will appear here after the first user and agent turns complete.</p>
            ) : (
              transcript.map((line, index) => (
                <p key={`${line.speaker}-${index}`}>
                  <strong>{line.speaker}</strong> · {line.text}
                </p>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="eyebrow">Events</p>
          <div className="transcript-list voice-events">
            {events.length === 0 ? (
              <p>Connection and session events will appear here.</p>
            ) : (
              events.map((line) => <p key={line}>{line}</p>)
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
