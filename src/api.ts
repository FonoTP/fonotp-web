const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";
const AUTH_TOKEN_KEY = "fonotp_auth_token";
const AUTH_PORTAL_KEY = "fonotp_auth_portal";

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredSession(token: string, portal: "admin" | "user") {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.localStorage.setItem(AUTH_PORTAL_KEY, portal);
}

export function clearStoredSession() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_PORTAL_KEY);
}

export function getStoredPortal() {
  return window.localStorage.getItem(AUTH_PORTAL_KEY);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload as T;
}
