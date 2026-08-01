export type AdminRoute = {
  section: string;
  resourceId: string | null;
};

/** Kept out of AdminConsole so App can route without loading the console. */
export function parseAdminRoute(pathname: string): AdminRoute | null {
  if (!pathname.startsWith("/admin")) return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "admin") return null;
  const section = parts[1] || "dashboard";
  const resourceId = parts[2] || null;
  return { section, resourceId };
}
