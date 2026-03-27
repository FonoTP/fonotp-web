import { useEffect, useState } from "react";
import { apiRequest, clearStoredSession, getStoredToken, setStoredSession } from "./api";
import { KpiCard } from "./components/KpiCard";
import { LoginView } from "./components/LoginView";
import { Sidebar } from "./components/Sidebar";
import { VoiceDemoPanel } from "./components/VoiceDemoPanel";
import { AgentRecord, BillingRecord, CallRecord, Organization, PlatformUser, UserRole } from "./types";

const roleOptions: UserRole[] = ["Owner", "Admin", "Manager", "Agent", "Billing"];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function App() {
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");
  const [userEmail, setUserEmail] = useState("mara@novahealth.example");
  const [userPassword, setUserPassword] = useState("demo-password");
  const [signupMode, setSignupMode] = useState(false);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupOrganizationName, setSignupOrganizationName] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [billing, setBilling] = useState<BillingRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [userError, setUserError] = useState("");
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    company: "",
    group: "Operations",
    role: "Agent" as UserRole,
  });
  const [accountForm, setAccountForm] = useState({
    name: "",
    email: "",
    company: "",
    group: "",
    password: "",
  });
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  const signedInUser = currentUser;
  const userOrg = organizations.find((org) => org.id === currentUser?.organizationId) ?? null;
  const isOrganizationOwner = signedInUser?.role === "Owner";
  const userTabs = isOrganizationOwner
    ? ["Overview", "Account", "Organization", "Calls", "Billing"]
    : ["Overview", "Account", "Calls", "Billing"];

  const recentTranscriptCalls = calls.filter((call) => call.transcript.length > 0).slice(0, 5);
  const [expandedCallIds, setExpandedCallIds] = useState<Set<string>>(new Set());

  const toggleCall = (id: string) =>
    setExpandedCallIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const userCharactersIn = calls.reduce((total, call) => total + call.charactersIn, 0);
  const userCharactersOut = calls.reduce((total, call) => total + call.charactersOut, 0);

  const loadOrganizationUsers = async (organizationId: string) => {
    const response = await apiRequest<{ users: PlatformUser[] }>(`/organizations/${organizationId}/users`);
    setUsers(response.users);
  };

  const loadUserAccount = async () => {
    const response = await apiRequest<{
      user: PlatformUser;
      organization: Organization;
      calls: CallRecord[];
      billing: BillingRecord[];
    }>("/me/account");

    setCurrentUser(response.user);
    setCalls(response.calls);
    setBilling(response.billing);
    setOrganizations((current) => {
      const withoutCurrent = current.filter((org) => org.id !== response.organization.id);
      return [response.organization, ...withoutCurrent];
    });
  };

  const loadAgents = async () => {
    const response = await apiRequest<{ agents: AgentRecord[] }>("/agents");
    setAgents(response.agents);
  };

  useEffect(() => {
    window.history.replaceState({}, "", "/dashboard");

    void (async () => {
      try {
        const token = getStoredToken();
        if (token) {
          await Promise.all([loadUserAccount(), loadAgents()]);
          setIsUserLoggedIn(true);
        }
      } catch (_error) {
        clearStoredSession();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isUserLoggedIn || !userOrg || !isOrganizationOwner) {
      setUsers([]);
      return;
    }
    void loadOrganizationUsers(userOrg.id);
  }, [isUserLoggedIn, userOrg?.id, isOrganizationOwner]);

  useEffect(() => {
    if (!signedInUser) return;
    setAccountForm({
      name: signedInUser.name,
      email: signedInUser.email,
      company: signedInUser.company,
      group: signedInUser.group,
      password: "",
    });
  }, [signedInUser]);

  const handleUserLogin = async () => {
    try {
      setUserError("");
      const response = await apiRequest<{ user: PlatformUser; token: string }>("/auth/login", {
        method: "POST",
        body: { email: userEmail, password: userPassword, portal: "user" },
      });
      setStoredSession(response.token, "user");
      setCurrentUser(response.user);
      await Promise.all([loadUserAccount(), loadAgents()]);
      setIsUserLoggedIn(true);
      setActiveTab("Overview");
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const handleUserSignup = async () => {
    try {
      setUserError("");
      const response = await apiRequest<{ user: PlatformUser; token: string }>("/auth/signup", {
        method: "POST",
        body: {
          name: signupName,
          email: signupEmail,
          password: signupPassword,
          organizationName: signupOrganizationName,
        },
      });
      setStoredSession(response.token, "user");
      setCurrentUser(response.user);
      await Promise.all([loadUserAccount(), loadAgents()]);
      setIsUserLoggedIn(true);
      setActiveTab("Overview");
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Signup failed.");
    }
  };

  const handleCreateUserSubmit = async () => {
    const targetOrganizationId = userOrg?.id || "";
    if (!newUser.name || !newUser.email || !newUser.password || !targetOrganizationId) {
      return;
    }
    await apiRequest<{ user: PlatformUser }>(`/organizations/${targetOrganizationId}/users`, {
      method: "POST",
      body: {
        name: newUser.name,
        email: newUser.email,
        password: newUser.password,
        group: newUser.group,
        role: newUser.role,
      },
    });
    await loadOrganizationUsers(targetOrganizationId);
    setNewUser({
      name: "",
      email: "",
      password: "",
      company: userOrg?.name || "",
      group: "Operations",
      role: "Agent",
    });
    setActiveTab("Organization");
  };

  const handleAccountSave = async () => {
    try {
      setSavingAccount(true);
      setAccountError("");
      setAccountMessage("");
      const response = await apiRequest<{ user: PlatformUser }>("/me/account", {
        method: "PATCH",
        body: {
          name: accountForm.name,
          email: accountForm.email,
          company: accountForm.company,
          group: accountForm.group,
          password: accountForm.password || undefined,
        },
      });
      setCurrentUser(response.user);
      setAccountForm((current) => ({ ...current, password: "" }));
      setAccountMessage("Account details saved.");
      await loadUserAccount();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "Failed to save account.");
    } finally {
      setSavingAccount(false);
    }
  };

  if (loading) {
    return <main className="loading-shell">Loading…</main>;
  }

  if (!isUserLoggedIn) {
    return (
      <LoginView
        eyebrow="User Account"
        title="Sign in to your telephony-to-AI account."
        description="Each user gets an individual portal to review account details, call activity, transcript usage, and billing information for their organization."
        formTitle={signupMode ? "Create account" : "User access"}
        buttonLabel={signupMode ? "Create account" : "Open my account"}
        submitNote={
          signupMode
            ? "Create your organization and owner account. Invited users will sign in later with the credentials you create for them."
            : "Use your account email and password to continue."
        }
        email={signupMode ? signupEmail : userEmail}
        password={signupMode ? signupPassword : userPassword}
        onEmailChange={signupMode ? setSignupEmail : setUserEmail}
        onPasswordChange={signupMode ? setSignupPassword : setUserPassword}
        onSubmit={() => void (signupMode ? handleUserSignup() : handleUserLogin())}
        error={userError}
      >
        {signupMode ? (
          <>
            <label>
              Full Name
              <input
                type="text"
                value={signupName}
                onChange={(event) => setSignupName(event.target.value)}
                placeholder="Jane Smith"
              />
            </label>
            <label>
              Organization Name
              <input
                type="text"
                value={signupOrganizationName}
                onChange={(event) => setSignupOrganizationName(event.target.value)}
                placeholder="Acme Support"
              />
            </label>
          </>
        ) : null}
        <button
          className="link-button"
          type="button"
          onClick={() => {
            setUserError("");
            setSignupMode((current) => !current);
          }}
        >
          {signupMode ? "I already have an account" : "Create a new account"}
        </button>
      </LoginView>
    );
  }

  if (!signedInUser || !userOrg) {
    return <main className="loading-shell">Loading account…</main>;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={userTabs}
        eyebrow="User Workspace"
        title="Organization Dashboard"
        copy="Review your account, work with voice agents, and manage your invited users from one place."
      />

      <main className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">User Overview</p>
            <h2>{signedInUser.name}</h2>
            <p className="muted">
              {signedInUser.role} at {userOrg.name} · Group: {signedInUser.group}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setIsUserLoggedIn(false);
                setCurrentUser(null);
                clearStoredSession();
              }}
            >
              Log out
            </button>
          </div>
        </header>

        {(activeTab === "Overview" || activeTab === "Calls") && (
          <section className="kpi-grid">
            <KpiCard label="My Calls" value={String(calls.length)} detail="Recent sessions" />
            <KpiCard label="Chars In" value={userCharactersIn.toLocaleString()} detail="Inbound usage" />
            <KpiCard label="Chars Out" value={userCharactersOut.toLocaleString()} detail="AI response usage" />
            <KpiCard label="Account Status" value={signedInUser.status} detail={`Last login ${signedInUser.lastLogin}`} />
          </section>
        )}

        {activeTab === "Overview" && (
          <section className="content-grid">
            <VoiceDemoPanel agents={agents} onCallSaved={loadUserAccount} />

            <article className="panel full-span">
              <p className="eyebrow">My Usage</p>
              <h3>Call activity and transcripts</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Call</th>
                      <th>Flow</th>
                      <th>Started</th>
                      <th>Chars In</th>
                      <th>Chars Out</th>
                      <th>Status</th>
                      <th>Transcript</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((call) => (
                      <tr key={call.id}>
                        <td>{call.id}</td>
                        <td>{call.flow}</td>
                        <td>{call.startedAt}</td>
                        <td>{call.charactersIn.toLocaleString()}</td>
                        <td>{call.charactersOut.toLocaleString()}</td>
                        <td>{call.status}</td>
                        <td>{call.transcript[0] ?? call.summary ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel full-span">
              <p className="eyebrow">Recent Transcripts</p>
              <h3>Latest conversation lines</h3>
              <div className="transcript-list">
                {recentTranscriptCalls.length === 0 ? (
                  <p>No saved call transcripts yet.</p>
                ) : (
                  recentTranscriptCalls.map((call) => (
                    <div key={call.id}>
                      <strong>
                        {call.flow} · {call.startedAt}
                      </strong>
                      {call.transcript.map((line, index) => (
                        <p key={`${call.id}-${index}`}>{line}</p>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>
        )}

        {activeTab === "Account" && (
          <section className="content-grid">
            <article className="panel full-span">
              <p className="eyebrow">User Portal</p>
              <h3>Account details</h3>
              <div className="form-grid">
                <label>
                  Full name
                  <input
                    type="text"
                    value={accountForm.name}
                    placeholder="Jane Smith"
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={accountForm.email}
                    placeholder="you@company.com"
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Company
                  <input
                    type="text"
                    value={accountForm.company}
                    placeholder="Acme Corp"
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, company: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Group
                  <input
                    type="text"
                    value={accountForm.group}
                    placeholder="Operations"
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, group: event.target.value }))
                    }
                  />
                </label>
                <label>
                  New password <span className="muted">(optional)</span>
                  <input
                    type="password"
                    value={accountForm.password}
                    placeholder="Leave blank to keep current"
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, password: event.target.value }))
                    }
                  />
                </label>
                <label>
                  User ID
                  <input type="text" value={signedInUser.userId} readOnly />
                </label>
                <label>
                  Organization
                  <input type="text" value={userOrg.name} readOnly />
                </label>
                <label>
                  Role
                  <input type="text" value={signedInUser.role} readOnly />
                </label>
                {accountError ? <p className="error-text">{accountError}</p> : null}
                {accountMessage ? <p className="muted">{accountMessage}</p> : null}
                <button className="primary-button" onClick={() => void handleAccountSave()} disabled={savingAccount}>
                  {savingAccount ? "Saving..." : "Save account"}
                </button>
              </div>
            </article>
          </section>
        )}

        {activeTab === "Organization" && isOrganizationOwner && (
          <section className="content-grid-2">
            <article className="panel">
              <p className="eyebrow">Organization</p>
              <h3>{userOrg.name}</h3>
              <dl className="account-meta">
                <div>
                  <dt>ID</dt>
                  <dd>{userOrg.id}</dd>
                </div>
                <div>
                  <dt>Domain</dt>
                  <dd>{userOrg.domain}</dd>
                </div>
                <div>
                  <dt>Plan</dt>
                  <dd>{userOrg.plan}</dd>
                </div>
              </dl>
            </article>

            <article className="panel">
              <p className="eyebrow">Invite Users</p>
              <h3>Create simple user accounts</h3>
              <div className="form-grid">
                <label>
                  Full name
                  <input
                    type="text"
                    value={newUser.name}
                    placeholder="Jane Smith"
                    onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  Work email
                  <input
                    type="email"
                    value={newUser.email}
                    placeholder="jane@company.com"
                    onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label>
                  Temporary password
                  <input
                    type="password"
                    value={newUser.password}
                    placeholder="Temporary password"
                    onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                  />
                </label>
                <label>
                  Group
                  <input
                    type="text"
                    value={newUser.group}
                    placeholder="Operations"
                    onChange={(event) => setNewUser((current) => ({ ...current, group: event.target.value }))}
                  />
                </label>
                <label>
                  Role
                  <select
                    value={newUser.role}
                    onChange={(event) =>
                      setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))
                    }
                  >
                    {roleOptions.filter((role) => role !== "Owner").map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="primary-button" onClick={() => void handleCreateUserSubmit()}>
                Invite user
              </button>
            </article>

            <article className="panel full-span">
              <p className="eyebrow">Users</p>
              <h3>Invited organization members</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Group</th>
                      <th>Role</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.userId}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>{user.group}</td>
                        <td>{user.role}</td>
                        <td>{user.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === "Calls" && (
          <section className="calls-list">
            {calls.map((call) => {
              const expanded = expandedCallIds.has(call.id);
              return (
                <article
                  className="panel call-card"
                  key={call.id}
                  onClick={() => toggleCall(call.id)}
                >
                  <div className="call-header">
                    <div>
                      <p className="eyebrow">{call.id}</p>
                      <h3>{call.flow}</h3>
                    </div>
                    <div className="call-header-right">
                      <span className={`status-pill ${call.status.toLowerCase()}`}>{call.status}</span>
                      <span className="call-expand-icon">{expanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  <p className="call-meta">
                    {call.direction} via {call.channel} · {call.duration} · {call.startedAt}
                  </p>
                  <div className="usage-inline">
                    <span className="muted">In: {call.charactersIn.toLocaleString()}</span>
                    <span className="muted">Out: {call.charactersOut.toLocaleString()}</span>
                  </div>
                  {expanded && (
                    <div className="transcript-list" onClick={(e) => e.stopPropagation()}>
                      {call.transcript.length === 0 ? (
                        <p>No transcript saved for this session yet.</p>
                      ) : (
                        call.transcript.map((line, index) => <p key={`${call.id}-${index}`}>{line}</p>)
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {activeTab === "Billing" && (
          <section className="panel full-span">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Billing</p>
                <h3>Organization charges</h3>
              </div>
            </div>
            <div className="usage-stack">
              {billing.map((bill) => (
                <div key={bill.id}>
                  <strong>{currency.format(bill.amount)}</strong>
                  <span>
                    {bill.month} · {bill.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
