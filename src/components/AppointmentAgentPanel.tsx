import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api";
import type {
  AgentRecord,
  AgentTemplateRecord,
  AppointmentAgentSnapshot,
} from "../types";

type AppointmentAgentPanelProps = {
  agents: AgentRecord[];
  onAgentsChanged: () => Promise<void>;
};

type ChatLine = {
  role: "User" | "Agent";
  text: string;
};

const emptySnapshot: AppointmentAgentSnapshot = {
  workers: [],
  clients: [],
  appointments: [],
  availableSlots: [],
};

const workerColorClasses = [
  "worker-tone-a",
  "worker-tone-b",
  "worker-tone-c",
  "worker-tone-d",
] as const;

function formatCalendarDayLabel(value: string) {
  const date = new Date(value);
  return {
    dayName: date.toLocaleDateString("en-US", { weekday: "short" }),
    dayNumber: date.toLocaleDateString("en-US", { day: "numeric" }),
    month: date.toLocaleDateString("en-US", { month: "short" }),
  };
}

function formatCalendarTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AppointmentAgentPanel({ agents, onAgentsChanged }: AppointmentAgentPanelProps) {
  const appointmentAgents = agents.filter((agent) => agent.templateKey === "appointment-agent");
  const [templates, setTemplates] = useState<AgentTemplateRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(appointmentAgents[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState<AppointmentAgentSnapshot>(emptySnapshot);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draftMessage, setDraftMessage] = useState("show slots");
  const [loadingContext, setLoadingContext] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const template = templates.find((entry) => entry.templateKey === "appointment-agent") ?? null;
  const workerToneById = new Map(
    snapshot.workers.map((worker, index) => [
      worker.id,
      workerColorClasses[index % workerColorClasses.length],
    ]),
  );
  const calendarDays = Array.from(
    snapshot.appointments.reduce(
      (groups, appointment) => {
        const dayKey = appointment.startAt.slice(0, 10);
        const current = groups.get(dayKey) ?? [];
        current.push(appointment);
        groups.set(dayKey, current);
        return groups;
      },
      new Map<string, AppointmentAgentSnapshot["appointments"]>(),
    ).entries(),
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 6);

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiRequest<{ templates: AgentTemplateRecord[] }>("/agent-templates");
        setTemplates(response.templates);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load agent templates.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedAgentId && appointmentAgents[0]?.id) {
      setSelectedAgentId(appointmentAgents[0].id);
    }
  }, [appointmentAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSnapshot(emptySnapshot);
      return;
    }

    void (async () => {
      try {
        setLoadingContext(true);
        setError("");
        const response = await apiRequest<{ snapshot: AppointmentAgentSnapshot }>(
          `/appointment-agent/${selectedAgentId}/context`,
        );
        setSnapshot(response.snapshot);
        setMessages([
          {
            role: "Agent",
            text:
              "Appointment Agent ready. Ask for workers, clients, appointments, or slots. To book, use a slot id and a client name.",
          },
        ]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load appointment agent context.");
      } finally {
        setLoadingContext(false);
      }
    })();
  }, [selectedAgentId]);

  async function handleCreateFromTemplate() {
    try {
      setCreating(true);
      setError("");
      const response = await apiRequest<{ agent: AgentRecord }>(
        "/agent-templates/appointment-agent/create-agent",
        {
          method: "POST",
          body: { name: `Appointment Agent ${appointmentAgents.length + 1}` },
        },
      );
      await onAgentsChanged();
      setSelectedAgentId(response.agent.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create appointment agent.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedAgentId || !draftMessage.trim()) {
      return;
    }

    const nextMessage = draftMessage.trim();
    try {
      setSending(true);
      setError("");
      setMessages((current) => [...current, { role: "User", text: nextMessage }]);
      setDraftMessage("");
      const response = await apiRequest<{ reply: string; snapshot: AppointmentAgentSnapshot }>(
        `/appointment-agent/${selectedAgentId}/chat`,
        {
          method: "POST",
          body: { message: nextMessage },
        },
      );
      setMessages((current) => [...current, { role: "Agent", text: response.reply }]);
      setSnapshot(response.snapshot);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="panel full-span">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Agent Template Demo</p>
          <h3>Appointment Agent</h3>
          <p className="muted">
            {template?.description ||
              "Book, reschedule, cancel, and inspect appointments between workers and clients."}
          </p>
        </div>
        <div className="agent-panel-actions">
          <button className="primary-button" onClick={() => void handleCreateFromTemplate()} disabled={creating}>
            {creating ? "Creating..." : "Create from template"}
          </button>
        </div>
      </div>

      <div className="appointment-agent-toolbar">
        <label>
          Active appointment agent
          <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
            {appointmentAgents.length === 0 ? <option value="">No appointment agents yet</option> : null}
            {appointmentAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <div className="appointment-agent-hints">
          <span>`show workers`</span>
          <span>`show clients`</span>
          <span>`show appointments`</span>
          <span>`show slots`</span>
          <span>`book slot-... for Amelia Stone`</span>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="appointment-agent-grid">
        <div className="appointment-agent-column">
          <h4>Demo chat</h4>
          <div className="appointment-chat-log">
            {messages.length === 0 ? (
              <p className="muted">{loadingContext ? "Loading appointment data..." : "Create or select an appointment agent to begin."}</p>
            ) : (
              messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`appointment-chat-line ${message.role.toLowerCase()}`}>
                  <strong>{message.role}</strong>
                  <p>{message.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="appointment-chat-form" onSubmit={(event) => void handleSubmit(event)}>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="Try: show slots"
              rows={3}
              disabled={!selectedAgentId || sending}
            />
            <button className="primary-button" type="submit" disabled={!selectedAgentId || sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </form>
        </div>

        <div className="appointment-agent-column">
          <h4>Booking calendar</h4>
          <div className="appointment-calendar">
            {calendarDays.length === 0 ? (
              <p className="muted">No booked appointments yet.</p>
            ) : (
              calendarDays.map(([dayKey, appointments]) => {
                const dayLabel = formatCalendarDayLabel(dayKey);
                return (
                  <div key={dayKey} className="appointment-calendar-day">
                    <div className="appointment-calendar-header">
                      <span>{dayLabel.dayName}</span>
                      <strong>{dayLabel.dayNumber}</strong>
                      <span>{dayLabel.month}</span>
                    </div>
                    <div className="appointment-calendar-events">
                      {appointments
                        .slice()
                        .sort((left, right) => left.startAt.localeCompare(right.startAt))
                        .map((appointment) => (
                          <div
                            key={appointment.id}
                            className={`appointment-calendar-entry ${workerToneById.get(appointment.workerId) ?? "worker-tone-a"}`}
                          >
                            <strong>{formatCalendarTime(appointment.startAt)}</strong>
                            <p>{appointment.workerName}</p>
                            <p>{appointment.clientName}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <h4>Worker colors</h4>
          <div className="appointment-worker-legend">
            {snapshot.workers.map((worker) => (
              <div key={worker.id} className="appointment-worker-legend-item">
                <span className={`appointment-worker-swatch ${workerToneById.get(worker.id) ?? "worker-tone-a"}`} />
                <div>
                  <strong>{worker.name}</strong>
                  <p>{worker.roleLabel}</p>
                </div>
              </div>
            ))}
          </div>

          <h4>Workers</h4>
          <div className="appointment-mini-list">
            {snapshot.workers.map((worker) => (
              <div key={worker.id}>
                <strong>{worker.name}</strong>
                <p>
                  {worker.roleLabel} · {worker.specialty}
                </p>
                <p>
                  {worker.locationLabel} · {worker.availabilitySummary}
                </p>
              </div>
            ))}
          </div>

          <h4>Clients</h4>
          <div className="appointment-mini-list">
            {snapshot.clients.map((client) => (
              <div key={client.id}>
                <strong>{client.fullName}</strong>
                <p>{client.phone}</p>
                <p>{client.notes}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="appointment-agent-column">
          <h4>Scheduled appointments</h4>
          <div className="appointment-mini-list">
            {snapshot.appointments.length === 0 ? (
              <p className="muted">No appointments yet.</p>
            ) : (
              snapshot.appointments.map((appointment) => (
                <div key={appointment.id}>
                  <strong>{appointment.id}</strong>
                  <p>
                    {appointment.clientName} with {appointment.workerName}
                  </p>
                  <p>
                    {appointment.startAt} · {appointment.status}
                  </p>
                </div>
              ))
            )}
          </div>

          <h4>Open slots</h4>
          <div className="appointment-mini-list">
            {snapshot.availableSlots.map((slot) => (
              <div key={slot.id}>
                <strong>{slot.id}</strong>
                <p>{slot.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
