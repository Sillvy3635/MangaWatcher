import type { AppState } from "./types";

export const pagesMode = import.meta.env.VITE_API_MODE === "pages";
export const cloudMode = pagesMode || import.meta.env.VITE_API_MODE === "cloud";
const apiOrigin = pagesMode ? (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "") : "";
const sessionKey = "mw.pages.session";
const endpoint = (path: string) => `${apiOrigin}/api/${path}`;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function consumeLoginFragment(): void {
  if (!pagesMode || !window.location.hash.startsWith("#mw_session=")) return;
  try {
    const token = decodeURIComponent(window.location.hash.slice("#mw_session=".length));
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) window.sessionStorage.setItem(sessionKey, token);
  } catch { /* Reject malformed fragments and unavailable storage. */ }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export function loginUrl(): string { return endpoint("auth/start"); }
export function clearSession(): void {
  if (pagesMode) { try { window.sessionStorage.removeItem(sessionKey); } catch { /* Storage unavailable. */ } }
}

function bearer(): string {
  let token: string | null = null;
  try { token = window.sessionStorage.getItem(sessionKey); } catch { /* Storage unavailable. */ }
  if (!token) throw new ApiError("กรุณาเข้าสู่ระบบด้วย GitHub", 401);
  return token;
}

async function responseBody<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String(body.error) : `HTTP ${response.status}`;
    if (pagesMode && response.status === 401) clearSession();
    throw new ApiError(message, response.status);
  }
  return body as T;
}

async function csrfToken(): Promise<string> {
  const session = await responseBody<{ csrf: string }>(await fetch(endpoint("session"), { cache: "no-store" }));
  return session.csrf;
}

async function headersForPost(): Promise<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    ...(pagesMode ? { Authorization: `Bearer ${bearer()}` } : cloudMode ? { "X-CSRF-Token": await csrfToken() } : {}),
  };
}

export async function api<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(endpoint(path), payload === undefined
    ? { headers: pagesMode ? { Authorization: `Bearer ${bearer()}` } : undefined, cache: "no-store" }
    : { method: "POST", headers: await headersForPost(), body: JSON.stringify(payload), cache: "no-store" });
  return responseBody<T>(response);
}

export const getState = () => api<AppState>("state");

export async function importSnapshot(snapshot: unknown): Promise<{ backup: string }> {
  if (!cloudMode) return api("import", snapshot);
  const previous = await fetch(endpoint("export"), {
    headers: pagesMode ? { Authorization: `Bearer ${bearer()}` } : undefined,
    cache: "no-store",
  });
  if (previous.status !== 404) await responseBody(previous);
  const etag = previous.headers.get("ETag");
  if (previous.ok && !etag) throw new Error("ไม่พบรหัสรุ่นของไฟล์ข้อมูล");
  const response = await fetch(endpoint("import"), {
    method: "POST",
    headers: {
      ...await headersForPost(),
      ...(previous.status === 404 ? { "If-None-Match": "*" } : { "If-Match": etag! }),
    },
    body: JSON.stringify(snapshot),
    cache: "no-store",
  });
  return responseBody(response);
}
