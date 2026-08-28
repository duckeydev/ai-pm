import { requireCronAuth, triggeredByFrom } from "@/lib/auth";
import { runBreakdownJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const triggeredBy = triggeredByFrom(request);
    const body = (await request.json().catch(() => ({}))) as { taskUrl?: string };
    if (!body.taskUrl || typeof body.taskUrl !== "string") {
      return Response.json({ error: "taskUrl is required" }, { status: 400 });
    }
    const result = await runBreakdownJob(triggeredBy, body.taskUrl);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
