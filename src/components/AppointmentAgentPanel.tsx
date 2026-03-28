import { FormEvent, Fragment, useEffect, useState } from "react";
import { apiRequest } from "../api";
import type {
  AgentRecord,
  AgentTemplateRecord,
  AppointmentAgentSnapshot,
  PlatformUser,
} from "../types";

type AppointmentAgentPanelProps = {
  agents: AgentRecord[];
  onAgentsChanged: () => Promise<void>;
  currentUser: PlatformUser;
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

function formatHourLabel(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + offset);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatWeekRange(start: Date, end: Date) {
  return `${start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

const calendarHours = Array.from({ length: 8 }, (_, index) => 9 + index);

export function AppointmentAgentPanel({ agents, onAgentsChanged, currentUser }: AppointmentAgentPanelProps) {
  const appointmentAgents = agents.filter((agent) => agent.templateKey === "appointment-agent");
  const [templates, setTemplates] = useState<AgentTemplateRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(appointmentAgents[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState<AppointmentAgentSnapshot>(emptySnapshot);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draftMessage, setDraftMessage] = useState("show slots");
  const [loadingContext, setLoadingContext] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [error, setError] = useState("");

  const template = templates.find((entry) => entry.templateKey === "appointment-agent") ?? null;
  const workerToneById = new Map(
    snapshot.workers.map((worker, index) => [
      worker.id,
      workerColorClasses[index % workerColorClasses.length],
    ]),
  );
  const weekStart = addDays(startOfWeek(new Date()), currentWeekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = weekDays[weekDays.length - 1];

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
              "Appointment Agent ready. Ask to book, move, reschedule, cancel, or review appointments for your signed-in account.",
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
          <span>`book me April 1 at 10 with Warren`</span>
          <span>`move my appointment with Warren to 2 pm`</span>
          <span>`cancel my appointment with Warren`</span>
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="appointment-agent-layout">
        <div className="appointment-agent-row">
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
              placeholder="Try: book me April 1 at 10 am with Warren"
              rows={3}
              disabled={!selectedAgentId || sending}
            />
            <button className="primary-button" type="submit" disabled={!selectedAgentId || sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </form>
        </div>

        <div className="appointment-agent-row">
          <div className="section-heading">
            <div>
              <h4>Booking calendar</h4>
              <p className="muted">One-hour appointments for the selected week.</p>
            </div>
          </div>

          <div className="appointment-calendar-controls">
            <div className="appointment-booking-user">
              <span className="eyebrow">Booking As</span>
              <strong>{currentUser.name}</strong>
              <p className="muted">{currentUser.email}</p>
            </div>

            <div className="appointment-week-nav">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCurrentWeekOffset((current) => current - 1)}
              >
                &lt;
              </button>
              <strong>{formatWeekRange(weekStart, weekEnd)}</strong>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCurrentWeekOffset((current) => current + 1)}
              >
                &gt;
              </button>
            </div>
          </div>

          <div className="appointment-week-grid">
            <div className="appointment-week-header appointment-week-header-empty">Time</div>
            {weekDays.map((day) => {
              const label = formatCalendarDayLabel(day.toISOString());
              return (
                <div key={day.toISOString()} className="appointment-week-header">
                  <span>{label.dayName}</span>
                  <strong>{label.dayNumber}</strong>
                  <span>{label.month}</span>
                </div>
              );
            })}

            {calendarHours.map((hour) => (
              <Fragment key={`hour-${hour}`}>
                <div className="appointment-week-time-label">
                  <strong>{formatHourLabel(hour)}</strong>
                </div>

                {weekDays.map((day) => {
                  const dayKey = day.toISOString().slice(0, 10);
                  const dayAppointments = snapshot.appointments
                    .filter(
                      (appointment) =>
                        appointment.startAt.slice(0, 10) === dayKey && new Date(appointment.startAt).getHours() === hour,
                    )
                    .sort((left, right) => left.startAt.localeCompare(right.startAt));
                  return (
                    <div key={`${dayKey}-${hour}`} className="appointment-week-cell">
                      {dayAppointments.map((appointment) => (
                        <div
                          key={appointment.id}
                          className={`appointment-calendar-entry ${workerToneById.get(appointment.workerId) ?? "worker-tone-a"}`}
                        >
                          <strong>{appointment.workerName}</strong>
                          <p>{formatCalendarTime(appointment.startAt)}</p>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>

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
        </div>
      </div>
    </article>
  );
}
