import { getCronSecret } from "@/lib/env";

/** Require Authorization: Bearer CRON_SECRET. Returns a 401 Response, or null if ok. */
export function requireCronAuth(request: Request): Response | null {
  const secret = getCronSecret();
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export function triggeredByFrom(request: Request): string {
  return (
    request.headers.get("x-triggered-by")?.trim() ||
    (request.headers.get("user-agent")?.includes("vercel-cron") ? "vercel-cron" : "cron")
  );
}
