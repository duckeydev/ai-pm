import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeTaskProjectPatch,
  createPageComment,
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

describe("createPageComment", () => {
  afterEach(() => {
    setNotionClientForTests(null);
    delete process.env.OPENROUTER_API_KEY;
  });

  it("redacts secrets and never patches Status or Health", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-secret-key";
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn();
    setNotionClientForTests({
      comments: { create },
      pages: { update, create: vi.fn(), retrieve: vi.fn() },
    } as never);

    await createPageComment("note-1", "file as Task using sk-test-secret-key");

    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0] as {
      parent: { page_id: string };
      rich_text: Array<{ text: { content: string } }>;
    };
    expect(arg.parent.page_id).toBe("note-1");
    const content = arg.rich_text.map((t) => t.text.content).join("");
    expect(content).not.toContain("sk-test-secret-key");
    expect(content).toContain("[REDACTED]");
    expect(content).not.toMatch(/"Status"/);
    expect(content).not.toMatch(/"Health"/);
  });
});
