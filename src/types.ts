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

export type CallRecord = {
  id: string;
  organizationId: string;
  caller: string;
  direction: "Inbound" | "Outbound";
  channel: "SIP" | "API" | "WebRTC";
  flow: string;
  duration: string;
  startedAt: string;
  status: "Completed" | "Live" | "Escalated";
  charactersIn: number;
  charactersOut: number;
  transcript: string[];
};

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
