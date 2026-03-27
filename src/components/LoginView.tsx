import type { ReactNode } from "react";

type LoginViewProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  formTitle?: string;
  buttonLabel?: string;
  submitNote?: string;
  error?: string;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  children?: ReactNode;
};

export function LoginView({
  eyebrow = "FonoTP",
  title = "Central admin for telephony, web voice, and AI bots.",
  description = "Give each organization a dedicated tenant, control user access, inspect call logs, and track usage and billing across the full telephony-to-AI flow.",
  formTitle = "Admin access",
  buttonLabel = "Sign in",
  submitNote = "Use your email and password to continue.",
  error = "",
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  children,
}: LoginViewProps) {
  return (
    <main className="login-shell">
      <section className="login-hero">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="product-grid">
          <div className="panel">
            <span>SIP Bridge</span>
            <small>Carrier and PBX connectivity</small>
          </div>
          <div className="panel">
            <span>WebRTC Gateway</span>
            <small>Browser and app voice sessions</small>
          </div>
          <div className="panel">
            <span>AI Bot Service</span>
            <small>Real-time audio intelligence</small>
          </div>
          <div className="panel">
            <span>Service Builder</span>
            <small>Flow logic and routing</small>
          </div>
        </div>
      </section>

      <section className="login-card panel">
        <p className="eyebrow">Secure Login</p>
        <h2>{formTitle}</h2>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="admin@company.com"
            onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Enter your password"
            onKeyDown={(event) => { if (event.key === "Enter") onSubmit(); }}
          />
        </label>
        <button className="primary-button" onClick={onSubmit}>
          {buttonLabel}
        </button>
        {children}
        {error ? <p className="error-text">{error}</p> : null}
        <p className="muted">{submitNote}</p>
      </section>
    </main>
  );
}
