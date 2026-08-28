import { afterEach, describe, expect, it } from "vitest";
import { POST as triage } from "@/app/api/jobs/triage/route";
import { requireCronAuth } from "@/lib/auth";

const SECRET = "cron-test-secret";

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("Bearer CRON_SECRET auth", () => {
  it("401 without secret header", () => {
    process.env.CRON_SECRET = SECRET;
    const req = new Request("http://localhost/api/jobs/triage", { method: "POST" });
    const res = requireCronAuth(req);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("401 with wrong bearer", () => {
    process.env.CRON_SECRET = SECRET;
    const req = new Request("http://localhost/api/jobs/triage", {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
    });
    expect(requireCronAuth(req)?.status).toBe(401);
  });

  it("401 when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    const req = new Request("http://localhost/api/jobs/triage", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    expect(requireCronAuth(req)?.status).toBe(401);
  });

  it("allows matching Bearer token", () => {
    process.env.CRON_SECRET = SECRET;
    const req = new Request("http://localhost/api/jobs/triage", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(requireCronAuth(req)).toBeNull();
  });

  it("route returns 401 without secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await triage(new Request("http://localhost/api/jobs/triage", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});
