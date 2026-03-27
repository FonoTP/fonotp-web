type SidebarProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  tabs?: string[];
  eyebrow?: string;
  title?: string;
  copy?: string;
};

const defaultTabs = [
  "Overview",
  "Organizations",
  "Users",
  "Calls",
  "Usage",
  "Billing",
];

export function Sidebar({
  activeTab,
  onTabChange,
  tabs = defaultTabs,
  eyebrow = "FonoTP Platform",
  title = "Telephony to AI Admin",
  copy = "Manage organizations, users, call activity, usage, and billing from one control plane.",
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="sidebar-copy">{copy}</p>
      </div>

      <nav className="nav-list" aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? "nav-item active" : "nav-item"}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="flow-card">
        <p className="eyebrow">End-to-End Flow</p>
        <ol>
          <li>SIP or API receives the call.</li>
          <li>Bridge or gateway normalizes audio.</li>
          <li>WebSocket forwards the stream to AI.</li>
          <li>AI returns live responses.</li>
          <li>Service Builder applies routing logic.</li>
          <li>Audio streams back to the caller.</li>
        </ol>
      </div>
    </aside>
  );
}
