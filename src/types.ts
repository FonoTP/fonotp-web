export type ProductName =
  | "SIP Bridge"
  | "WebRTC Gateway"
  | "AI Bot Service"
  | "Service Builder";

export type UserRole = "Owner" | "Admin" | "Manager" | "Agent" | "Billing";

export type Organization = {
  id: string;
  name: string;
  domain: string;
  plan: string;
  status: "Active" | "Trial" | "Needs Review";
  monthlySpend: number;
  activeCalls: number;
  users: number;
  products: ProductName[];
};

export type PlatformUser = {
  userId: string;
  name: string;
  email: string;
  company: string;
  group: string;
  role: UserRole;
  organizationId: string;
  status: "Active" | "Invited" | "Suspended";
  lastLogin: string;
};

export type AgentRecord = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  templateKey?: string | null;
  name: string;
  slug: string;
  status: "Active" | "Draft" | "Disabled";
  channel: "WebRTC" | "SIP" | "API";
  sttType: string;
  sttPrompt: string;
  llmType: string;
  llmPrompt: string;
  ttsType: string;
  ttsPrompt: string;
  ttsVoice: string;
  runtimeUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentTemplateRecord = {
  templateKey: string;
  name: string;
  description: string;
  category: string;
  defaultChannel: "WebRTC" | "SIP" | "API";
};

export type AppointmentWorkerRecord = {
  id: string;
  name: string;
  roleLabel: string;
  specialty: string;
  locationLabel: string;
  availabilitySummary: string;
  status: string;
};

export type AppointmentClientRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  notes: string;
};

export type AppointmentRecord = {
  id: string;
  workerId: string;
  workerName: string;
  clientId: string;
  clientName: string;
  status: string;
  startAt: string;
  endAt: string;
  summary: string;
};

export type AppointmentSlotRecord = {
  id: string;
  workerId: string;
  workerName: string;
  startAt: string;
  endAt: string;
  label: string;
};

export type AppointmentAgentSnapshot = {
  workers: AppointmentWorkerRecord[];
  clients: AppointmentClientRecord[];
  appointments: AppointmentRecord[];
  availableSlots: AppointmentSlotRecord[];
};

export type AgentSessionRecord = {
  id: string;
  organizationId: string;
  agentId?: string | null;
  agentName?: string | null;
  platformUserId?: string | null;
  runtimeSessionId?: string | null;
  caller: string;
  direction: "Inbound" | "Outbound";
  channel: "SIP" | "API" | "WebRTC";
  flow: string;
  duration: string;
  startedAt: string;
  endedAt?: string | null;
  status: "Completed" | "Live" | "Escalated";
  summary?: string | null;
  charactersIn: number;
  charactersOut: number;
  transcript: string[];
};

export type CallRecord = AgentSessionRecord;

export type BillingRecord = {
  id: string;
  organizationId: string;
  month: string;
  amount: number;
  status: "Paid" | "Due" | "Processing";
  paymentMethod: string;
};

export type DashboardSummary = {
  organization: Organization;
  calls: CallRecord[];
  billing: BillingRecord[];
};
