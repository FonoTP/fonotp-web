import { useEffect, useMemo, useState } from "react";
import { apiRequest, clearStoredSession, getStoredPortal, getStoredToken, setStoredSession } from "./api";
import { KpiCard } from "./components/KpiCard";
import { LoginView } from "./components/LoginView";
import { Sidebar } from "./components/Sidebar";
import { VoiceDemoPanel } from "./components/VoiceDemoPanel";
import { AgentRecord, BillingRecord, CallRecord, DashboardSummary, Organization, PlatformUser, UserRole } from "./types";

const roleOptions: UserRole[] = ["Owner", "Admin", "Manager", "Agent", "Billing"];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState("Overview");
  const [email, setEmail] = useState("owner@fonotp.ai");
  const [password, setPassword] = useState("demo-password");
  const [userEmail, setUserEmail] = useState("mara@novahealth.example");
  const [userPassword, setUserPassword] = useState("demo-password");
  const [signupMode, setSignupMode] = useState(false);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupOrganizationName, setSignupOrganizationName] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [billing, setBilling] = useState<BillingRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [adminError, setAdminError] = useState("");
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

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? organizations[0];
  const signedInUser = currentUser;
  const userOrg = organizations.find((org) => org.id === currentUser?.organizationId) ?? null;
  const isOrganizationOwner = signedInUser?.role === "Owner";
  const userTabs = isOrganizationOwner
    ? ["Overview", "Account", "Organization", "Calls", "Billing"]
    : ["Overview", "Account", "Calls", "Billing"];

  const filteredUsers = useMemo(
    () => users.filter((user) => user.organizationId === selectedOrgId),
    [selectedOrgId, users],
  );

  const filteredCalls = calls;
  const filteredBilling = billing;
  const userCalls = calls;
  const userBilling = billing;

  const totalCharactersIn = filteredCalls.reduce((total, call) => total + call.charactersIn, 0);
  const totalCharactersOut = filteredCalls.reduce((total, call) => total + call.charactersOut, 0);
  const userCharactersIn = userCalls.reduce((total, call) => total + call.charactersIn, 0);
  const userCharactersOut = userCalls.reduce((total, call) => total + call.charactersOut, 0);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPathname(nextPath);
  };

  const loadOrganizations = async () => {
    const response = await apiRequest<{ organizations: Organization[] }>("/organizations");
    setOrganizations(response.organizations);
    setSelectedOrgId((current) => current || response.organizations[0]?.id || "");
    setNewUser((current) => ({
      ...current,
      company: response.organizations[0]?.name || "",
    }));
  };

  const loadOrganizationSummary = async (organizationId: string) => {
    const response = await apiRequest<DashboardSummary>(`/organizations/${organizationId}/summary`);
    setCalls(response.calls);
    setBilling(response.billing);
  };

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
    void (async () => {
      try {
        const token = getStoredToken();
        const portal = getStoredPortal();

        if (token && portal === "user") {
          await Promise.all([loadUserAccount(), loadAgents()]);
          setIsUserLoggedIn(true);
          setPathname("/dashboard");
          window.history.replaceState({}, "", "/dashboard");
        }

        if (token && portal === "admin") {
          await loadOrganizations();
          const authResponse = await apiRequest<{ user: PlatformUser }>("/auth/me");
          setCurrentUser(authResponse.user);
          setIsAdminLoggedIn(true);
          setPathname("/dashboard");
          window.history.replaceState({}, "", "/dashboard");
        }
      } catch (_error) {
        clearStoredSession();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrgId || pathname !== "/dashboard" || !isAdminLoggedIn) {
      return;
    }

    void (async () => {
      await Promise.all([loadOrganizationSummary(selectedOrgId), loadOrganizationUsers(selectedOrgId)]);
      setNewUser((current) => ({
        ...current,
        company: selectedOrg?.name || current.company,
      }));
    })();
  }, [selectedOrgId, pathname, isAdminLoggedIn]);

  useEffect(() => {
    if (!isUserLoggedIn || !userOrg || !isOrganizationOwner) {
      setUsers([]);
      return;
    }

    void loadOrganizationUsers(userOrg.id);
  }, [isUserLoggedIn, userOrg?.id, isOrganizationOwner]);

  const handleAdminLogin = async () => {
    try {
      setAdminError("");
      const response = await apiRequest<{ user: PlatformUser; token: string }>("/auth/login", {
        method: "POST",
        body: { email, password, portal: "admin" },
      });
      setStoredSession(response.token, "admin");
      setCurrentUser(response.user);
      await loadOrganizations();
      setIsAdminLoggedIn(true);
      setActiveTab("Overview");
      navigate("/dashboard");
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Login failed.");
    }
  };

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
      navigate("/dashboard");
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const handleCreateUserSubmit = async () => {
    const targetOrganizationId = selectedOrgId || userOrg?.id || "";

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
      company: selectedOrg?.name || "",
      group: "Operations",
      role: "Agent",
    });
    setActiveTab("Organization");
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
      navigate("/dashboard");
    } catch (error) {
      setUserError(error instanceof Error ? error.message : "Signup failed.");
    }
  };

  if (loading) {
    return <main className="loading-shell">Loading platform data...</main>;
  }

  if (pathname !== "/dashboard" && !isUserLoggedIn) {
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

  if (pathname === "/dashboard" && signedInUser && userOrg && !isAdminLoggedIn) {
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
                  navigate("/");
                }}
              >
                Log out
              </button>
            </div>
          </header>

          {activeTab === "Overview" || activeTab === "Calls" ? (
            <section className="kpi-grid">
              <KpiCard label="My Calls" value={String(userCalls.length)} detail="Recent sessions" />
              <KpiCard label="Chars In" value={userCharactersIn.toLocaleString()} detail="Inbound usage" />
              <KpiCard label="Chars Out" value={userCharactersOut.toLocaleString()} detail="AI response usage" />
              <KpiCard label="Account Status" value={signedInUser.status} detail={`Last login ${signedInUser.lastLogin}`} />
            </section>
          ) : null}

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
                        <th>Characters In</th>
                        <th>Characters Out</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userCalls.map((call) => (
                        <tr key={call.id}>
                          <td>{call.id}</td>
                          <td>{call.flow}</td>
                          <td>{call.startedAt}</td>
                          <td>{call.charactersIn.toLocaleString()}</td>
                          <td>{call.charactersOut.toLocaleString()}</td>
                          <td>{call.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          )}

          {activeTab === "Account" && (
            <section className="content-grid">
              <article className="panel full-span">
                <p className="eyebrow">User Portal</p>
                <h3>Account details</h3>
                <div className="usage-stack">
                  <div>
                    <strong>{signedInUser.userId}</strong>
                    <span>User ID</span>
                  </div>
                  <div>
                    <strong>{signedInUser.email}</strong>
                    <span>Email</span>
                  </div>
                  <div>
                    <strong>{userOrg.name}</strong>
                    <span>Organization</span>
                  </div>
                </div>
              </article>
            </section>
          )}

          {activeTab === "Organization" && isOrganizationOwner && (
            <section className="content-grid">
              <article className="panel">
                <p className="eyebrow">Organization</p>
                <h3>{userOrg.name}</h3>
                <div className="usage-stack">
                  <div>
                    <strong>{userOrg.id}</strong>
                    <span>Organization ID</span>
                  </div>
                  <div>
                    <strong>{userOrg.domain}</strong>
                    <span>Domain</span>
                  </div>
                  <div>
                    <strong>{userOrg.plan}</strong>
                    <span>Plan</span>
                  </div>
                </div>
              </article>

              <article className="panel">
                <p className="eyebrow">Invite Users</p>
                <h3>Create simple user accounts</h3>
                <div className="form-grid">
                  <input
                    type="text"
                    value={newUser.name}
                    placeholder="Full name"
                    onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
                  />
                  <input
                    type="email"
                    value={newUser.email}
                    placeholder="Work email"
                    onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                  />
                  <input
                    type="password"
                    value={newUser.password}
                    placeholder="Temporary password"
                    onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                  />
                  <input
                    type="text"
                    value={newUser.group}
                    placeholder="Group"
                    onChange={(event) => setNewUser((current) => ({ ...current, group: event.target.value }))}
                  />
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
            <section className="panel full-span">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Calls</p>
                  <h3>Recent sessions</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Call</th>
                      <th>Flow</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userCalls.map((call) => (
                      <tr key={call.id}>
                        <td>{call.id}</td>
                        <td>{call.flow}</td>
                        <td>{call.startedAt}</td>
                        <td>{call.duration}</td>
                        <td>{call.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                {userBilling.map((bill) => (
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

  if (pathname !== "/dashboard") {
    return null;
  }

  if (!isAdminLoggedIn) {
    return (
      <LoginView
        eyebrow="Admin Control"
        title="Access the multi-tenant operations dashboard."
        description="Create organizations, manage users and roles, inspect call logs, and review usage and billing across the platform."
        formTitle="Admin access"
        buttonLabel="Open dashboard"
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={() => void handleAdminLogin()}
        error={adminError}
        submitNote="Admin access requires an authorized owner, admin, or manager account."
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Tenant Scope</p>
            <h2>{selectedOrg.name}</h2>
            <p className="muted">{selectedOrg.domain}</p>
          </div>

          <div className="topbar-actions">
            <select value={selectedOrgId} onChange={(event) => setSelectedOrgId(event.target.value)}>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <button className="secondary-button" onClick={() => navigate("/")}>
              User portal
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setIsAdminLoggedIn(false);
                setCurrentUser(null);
                clearStoredSession();
                navigate("/dashboard");
              }}
            >
              Log out
            </button>
          </div>
        </header>

        <section className="kpi-grid">
          <KpiCard
            label="Monthly Spend"
            value={currency.format(selectedOrg.monthlySpend)}
            detail={`${selectedOrg.plan} plan`}
          />
          <KpiCard
            label="Active Calls"
            value={String(selectedOrg.activeCalls)}
            detail="Current live sessions"
          />
          <KpiCard
            label="Chars In"
            value={totalCharactersIn.toLocaleString()}
            detail="Inbound transcript characters"
          />
          <KpiCard
            label="Chars Out"
            value={totalCharactersOut.toLocaleString()}
            detail="AI response characters"
          />
        </section>

        {activeTab === "Overview" && (
          <section className="content-grid">
            <article className="panel span-2">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Platform Summary</p>
                  <h3>Four products, one tenant-aware control plane</h3>
                </div>
              </div>
              <div className="product-grid">
                {selectedOrg.products.map((product) => (
                  <div className="product-tile" key={product}>
                    <strong>{product}</strong>
                    <span>
                      {product === "SIP Bridge" && "Connects trunks, carriers, and PBX flows."}
                      {product === "WebRTC Gateway" &&
                        "Supports browser voice sessions and embedded clients."}
                      {product === "AI Bot Service" &&
                        "Streams audio to AI and returns speech in real time."}
                      {product === "Service Builder" &&
                        "Controls call logic, routing, and escalation rules."}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <p className="eyebrow">Admin Tasks</p>
              <h3>Create and assign users</h3>
              <div className="form-grid">
                <input
                  type="text"
                  value={newUser.name}
                  placeholder="Full name"
                  onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
                />
                <input
                  type="email"
                  value={newUser.email}
                  placeholder="Work email"
                  onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                />
                <input
                  type="password"
                  value={newUser.password}
                  placeholder="Temporary password"
                  onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                />
                <input
                  type="text"
                  value={newUser.group}
                  placeholder="Group"
                  onChange={(event) => setNewUser((current) => ({ ...current, group: event.target.value }))}
                />
                <select
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))
                  }
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <button className="primary-button" onClick={() => void handleCreateUserSubmit()}>
                Create user
              </button>
            </article>
          </section>
        )}

        {activeTab === "Organizations" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Organizations</p>
                <h3>Multi-tenant portfolio</h3>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Products</th>
                    <th>Users</th>
                    <th>Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <strong>{org.name}</strong>
                        <span>{org.domain}</span>
                      </td>
                      <td>{org.plan}</td>
                      <td>{org.status}</td>
                      <td>{org.products.join(", ")}</td>
                      <td>{org.users}</td>
                      <td>{currency.format(org.monthlySpend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "Users" && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Users</p>
                <h3>User DB and role assignment</h3>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Company</th>
                    <th>Group</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last Login</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.userId}>
                      <td>{user.userId}</td>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.company}</td>
                      <td>{user.group}</td>
                      <td>{user.role}</td>
                      <td>{user.status}</td>
                      <td>{user.lastLogin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "Calls" && (
          <section className="content-grid">
            {filteredCalls.map((call) => (
              <article className="panel" key={call.id}>
                <div className="call-header">
                  <div>
                    <p className="eyebrow">{call.id}</p>
                    <h3>{call.flow}</h3>
                  </div>
                  <span className={`status-pill ${call.status.toLowerCase()}`}>{call.status}</span>
                </div>
                <p className="call-meta">
                  {call.direction} via {call.channel} | {call.duration} | {call.startedAt}
                </p>
                <p className="muted">{call.caller}</p>
                <div className="usage-inline">
                  <span>Chars in: {call.charactersIn.toLocaleString()}</span>
                  <span>Chars out: {call.charactersOut.toLocaleString()}</span>
                </div>
                <div className="transcript-list">
                  {call.transcript.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </article>
            ))}
          </section>
        )}

        {activeTab === "Usage" && (
          <section className="content-grid">
            <article className="panel">
              <p className="eyebrow">Usage Totals</p>
              <h3>Character consumption</h3>
              <div className="usage-stack">
                <div>
                  <strong>{totalCharactersIn.toLocaleString()}</strong>
                  <span>Input characters</span>
                </div>
                <div>
                  <strong>{totalCharactersOut.toLocaleString()}</strong>
                  <span>Output characters</span>
                </div>
                <div>
                  <strong>{(totalCharactersIn + totalCharactersOut).toLocaleString()}</strong>
                  <span>Total transcript volume</span>
                </div>
              </div>
            </article>

            <article className="panel span-2">
              <p className="eyebrow">Recent Sessions</p>
              <h3>Usage by call</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Call</th>
                      <th>Flow</th>
                      <th>Characters In</th>
                      <th>Characters Out</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCalls.map((call) => (
                      <tr key={call.id}>
                        <td>{call.id}</td>
                        <td>{call.flow}</td>
                        <td>{call.charactersIn.toLocaleString()}</td>
                        <td>{call.charactersOut.toLocaleString()}</td>
                        <td>{(call.charactersIn + call.charactersOut).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeTab === "Billing" && (
          <section className="content-grid">
            <article className="panel">
              <p className="eyebrow">Billing Profile</p>
              <h3>{selectedOrg.name}</h3>
              <div className="usage-stack">
                <div>
                  <strong>{selectedOrg.plan}</strong>
                  <span>Subscription tier</span>
                </div>
                <div>
                  <strong>{currency.format(selectedOrg.monthlySpend)}</strong>
                  <span>Projected month spend</span>
                </div>
                <div>
                  <strong>{selectedOrg.status}</strong>
                  <span>Account state</span>
                </div>
              </div>
            </article>

            <article className="panel span-2">
              <p className="eyebrow">Invoices</p>
              <h3>Billing records</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Month</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Payment Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBilling.map((record) => (
                      <tr key={record.id}>
                        <td>{record.id}</td>
                        <td>{record.month}</td>
                        <td>{currency.format(record.amount)}</td>
                        <td>{record.status}</td>
                        <td>{record.paymentMethod}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
