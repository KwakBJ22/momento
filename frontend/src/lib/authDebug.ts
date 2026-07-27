type AuthDebugMetadata = Record<string, unknown>;
type DebugWriter = (message: string, metadata?: Record<string, unknown>) => void;

const SENSITIVE_KEY = /^(accessToken|refreshToken|authorization|email|phone|code|cookie|storage|session|password)$/i;
const ID_KEY = /^(userId|albumId)$/;
const ALLOWED_KEYS = new Set([
  "reason", "source", "routeRole", "hasSession", "hasUser", "authReady",
  "endpoint", "userId", "albumId", "errorName", "event",
]);

function safeEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return new URL(value, window.location.origin).pathname; } catch { return value.startsWith("/") ? value.split("?")[0] : undefined; }
}

export function sanitizeAuthDebugMetadata(metadata?: AuthDebugMetadata): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!ALLOWED_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    if (ID_KEY.test(key) && typeof value === "string") safe[key] = value.slice(0, 6);
    else if (key === "endpoint") {
      const endpoint = safeEndpoint(value);
      if (endpoint) safe[key] = endpoint;
    } else if (typeof value === "string") safe[key] = value.slice(0, 80);
    else if (typeof value === "boolean" || typeof value === "number") safe[key] = value;
  }
  return safe;
}

export function isAuthDebugEnabled(env?: { DEV?: boolean; VITE_AUTH_DEBUG?: string }): boolean {
  const runtimeEnv = env ?? (import.meta.env ?? {});
  return Boolean(runtimeEnv.DEV || runtimeEnv.VITE_AUTH_DEBUG === "true");
}

export function createAuthDebugLogger(
  env: { DEV?: boolean; VITE_AUTH_DEBUG?: string },
  write: DebugWriter = (message, metadata) => console.debug(message, metadata),
): (event: string, metadata?: AuthDebugMetadata) => void {
  return (event, metadata) => {
    if (!isAuthDebugEnabled(env)) return;
    const safe = sanitizeAuthDebugMetadata(metadata);
    write(`[AUTH] ${event}`, Object.keys(safe).length ? safe : undefined);
  };
}

export const authDebug = createAuthDebugLogger(import.meta.env ?? {});
