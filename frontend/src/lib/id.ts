/** Prefer crypto.randomUUID; fall back when not in a secure context (e.g. http://LAN-IP). */
export function createId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Non-secure contexts (HTTP over LAN) throw or omit randomUUID on mobile Safari/Chrome.
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
