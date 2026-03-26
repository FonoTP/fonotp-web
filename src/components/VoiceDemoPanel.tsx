import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";
import type { AgentRecord } from "../types";

const VOICE_RUNTIME_BASE_URL =
  import.meta.env.VITE_VOICE_RUNTIME_BASE_URL || "http://127.0.0.1:8090";

type VoiceTokenResponse = {
  voiceToken: string;
  expiresAt: string;
  runtimeUrl: string;
  iceServers: RTCIceServer[];
  agent: AgentRecord;
};

type RuntimeSessionResponse = {
  runtimeSessionId: string;
  answerSdp: string;
  reportToken: string;
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
  remoteStream: MediaStream;
  runtimeSessionId: string;
  reportToken: string;
  startedAt: string;
};

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

export function VoiceDemoPanel({ agents, onCallSaved }: VoiceDemoPanelProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  const activeSessionRef = useRef<ActiveSession | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!selectedAgentId && agents[0]?.id) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    return () => {
      const current = activeSessionRef.current;
      if (!current) {
        return;
      }

      for (const track of current.localStream.getTracks()) {
        track.stop();
      }
      current.peerConnection.close();
    };
  }, []);

  function appendEvent(message: string) {
    setEvents((current) => [message, ...current].slice(0, 8));
  }

  async function startVoiceSession() {
    if (!selectedAgentId || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setTranscript([]);
    setEvents([]);
    setStatus("Requesting voice session");

    try {
      const tokenData = await apiRequest<VoiceTokenResponse>("/voice/token", {
        method: "POST",
        body: { agentId: selectedAgentId },
      });

      appendEvent(`Voice token minted for ${tokenData.agent.name}`);
      setStatus("Requesting microphone");

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const peerConnection = new RTCPeerConnection({
        iceServers: tokenData.iceServers,
      });
      const remoteStream = new MediaStream();

      peerConnection.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks?.() ?? [event.track]) {
          remoteStream.addTrack(track);
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => {
            appendEvent("Remote audio is ready. Use the browser audio controls if playback is blocked.");
          });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        const nextState = peerConnection.connectionState;
        setStatus(`Peer ${nextState}`);
        appendEvent(`Peer connection ${nextState}`);
        setConnected(nextState === "connected");
      };

      const eventsChannel = peerConnection.createDataChannel("oai-events");
      eventsChannel.addEventListener("open", () => {
        appendEvent("Realtime events channel open");
      });
      eventsChannel.addEventListener("message", (rawEvent) => {
        try {
          const event = JSON.parse(rawEvent.data);

          if (event.type === "session.created") {
            setStatus("Session ready");
          }

          if (event.type === "input_audio_buffer.speech_started") {
            setStatus("Listening");
          }

          if (event.type === "response.created") {
            setStatus("Agent responding");
          }

          if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
            setTranscript((current) => [...current, { speaker: "User", text: event.transcript }]);
          }

          if (event.type === "response.output_audio_transcript.done" && event.transcript) {
            setTranscript((current) => [...current, { speaker: "Agent", text: event.transcript }]);
          }
        } catch (_error) {
          appendEvent("Received non-JSON realtime event");
        }
      });

      for (const track of localStream.getTracks()) {
        peerConnection.addTrack(track, localStream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      setStatus("Opening realtime session");
      const runtimeResponse = await fetch(`${VOICE_RUNTIME_BASE_URL}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voiceToken: tokenData.voiceToken,
          offerSdp: peerConnection.localDescription?.sdp,
          caller: `browser-client / ${window.location.host}`,
        }),
      });

      const runtimeData = (await runtimeResponse.json()) as RuntimeSessionResponse | { error?: string };
      if (!runtimeResponse.ok || !("answerSdp" in runtimeData)) {
        throw new Error(("error" in runtimeData && runtimeData.error) || "Failed to create runtime session.");
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: runtimeData.answerSdp,
      });

      activeSessionRef.current = {
        peerConnection,
        localStream,
        remoteStream,
        runtimeSessionId: runtimeData.runtimeSessionId,
        reportToken: runtimeData.reportToken,
        startedAt: new Date().toISOString(),
      };

      setConnected(true);
      setStatus(`Connected to ${runtimeData.agent.name}`);
      appendEvent(`Runtime session ${runtimeData.runtimeSessionId} created`);
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
      const reportResponse = await fetch(`${VOICE_RUNTIME_BASE_URL}/api/session/${current.runtimeSessionId}/report`, {
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
    } catch (_error) {
      appendEvent("Call ended locally, but saving summary failed");
    } finally {
      await stopRtcOnly();
      setBusy(false);
      setStatus("Idle");
    }
  }

  return (
    <article className="panel span-2 voice-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Voice Demo</p>
          <h3>Talk to a tenant agent over WebRTC</h3>
        </div>
      </div>

      <div className="voice-toolbar">
        <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button className="primary-button" disabled={!selectedAgentId || busy || connected} onClick={() => void startVoiceSession()}>
          Start voice session
        </button>
        <button className="secondary-button" disabled={!connected || busy} onClick={() => void endVoiceSession()}>
          End session
        </button>
      </div>

      <div className="voice-status-row">
        <span className={`status-pill ${connected ? "live" : ""}`}>{status}</span>
        <span className="muted">
          Runtime: <code>{VOICE_RUNTIME_BASE_URL}</code>
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
