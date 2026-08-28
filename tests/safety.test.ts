import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeTaskProjectPatch,
  patchAiSummary,
  setNotionClientForTests,
} from "@/lib/notion";

describe("never write Status/Health on tasks/projects", () => {
  afterEach(() => {
    setNotionClientForTests(null);
  });

  it("assertSafeTaskProjectPatch rejects Status and Health", () => {
    expect(() => assertSafeTaskProjectPatch({ Status: { select: { name: "Done" } } })).toThrow(
      /Status/,
    );
    expect(() => assertSafeTaskProjectPatch({ Health: { select: { name: "Green" } } })).toThrow(
      /Health/,
    );
    expect(() => assertSafeTaskProjectPatch({ "AI summary": { rich_text: [] } })).not.toThrow();
  });

  it("patchAiSummary only sends AI summary", async () => {
    const update = vi.fn().mockResolvedValue({});
    setNotionClientForTests({
      pages: { update, create: vi.fn(), retrieve: vi.fn() },
    } as never);

    await patchAiSummary("task-1", "hello");

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0] as {
      page_id: string;
      properties: Record<string, unknown>;
    };
    expect(arg.page_id).toBe("task-1");
    expect(Object.keys(arg.properties)).toEqual(["AI summary"]);
    expect(arg.properties).not.toHaveProperty("Status");
    expect(arg.properties).not.toHaveProperty("Health");
  });

  it("patchAiSummary refuses if Status sneaks in", async () => {
    const update = vi.fn();
    setNotionClientForTests({
      pages: { update },
    } as never);

    await expect(
      (async () => {
        assertSafeTaskProjectPatch({ Status: {}, "AI summary": {} });
      })(),
    ).rejects.toThrow(/Status/);
    expect(update).not.toHaveBeenCalled();
  });
});
