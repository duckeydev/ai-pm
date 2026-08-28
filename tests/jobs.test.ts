import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createPageComment,
  queryInboxNotes,
  queryTasks,
  queryProjects,
  getPagePlainText,
} = vi.hoisted(() => ({
  createPageComment: vi.fn(),
  queryInboxNotes: vi.fn(),
  queryTasks: vi.fn(),
  queryProjects: vi.fn(),
  getPagePlainText: vi.fn(),
}));

const { executeRun } = vi.hoisted(() => ({
  executeRun: vi.fn(),
}));

vi.mock("@/lib/notion", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notion")>("@/lib/notion");
  return {
    ...actual,
    createPageComment,
    queryInboxNotes,
    queryTasks,
    queryProjects,
    getPagePlainText,
  };
});

vi.mock("@/lib/run", () => ({
  executeRun,
}));

import {
  healthSuggestionComment,
  healthSuggestionForFlags,
  parseTriageSuggestions,
  runRiskJob,
  runTriageJob,
  triageCommentText,
  triageFallbackComment,
} from "@/lib/jobs";

function page(id: string, properties: Record<string, unknown> = {}): {
  id: string;
  url: string;
  properties: Record<string, unknown>;
  raw: unknown;
} {
  return { id, url: `https://notion.so/${id}`, properties, raw: {} };
}

function select(name: string) {
  return { type: "select", select: { name } };
}

function status(name: string) {
  return { type: "status", status: { name } };
}

describe("parseTriageSuggestions", () => {
  it("reads JSON array of id/fileAs/reason and skips unparsed notes", () => {
    const output = `markdown\n[{"id":"n1","fileAs":"Task","reason":"actionable"}]`;
    expect(parseTriageSuggestions(output, [{ id: "n1" }, { id: "n2" }])).toEqual([
      { id: "n1", fileAs: "Task", reason: "actionable" },
    ]);
  });

  it("returns [] when output is not parseable JSON", () => {
    expect(parseTriageSuggestions("just markdown", [{ id: "n1" }])).toEqual([]);
  });
});

describe("healthSuggestionForFlags", () => {
  it("uses Red for overdue or P0, Amber otherwise; worst wins", () => {
    expect(healthSuggestionForFlags(["blocked"]).health).toBe("Amber");
    expect(healthSuggestionForFlags(["no owner", "blocked"]).health).toBe("Amber");
    expect(healthSuggestionForFlags(["overdue"]).health).toBe("Red");
    expect(healthSuggestionForFlags(["P0 not in progress", "blocked"]).health).toBe("Red");
  });
});

describe("runTriageJob comments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    queryInboxNotes.mockResolvedValue([page("note-1"), page("note-2")]);
    getPagePlainText.mockResolvedValue("body");
    createPageComment.mockResolvedValue(undefined);
    executeRun.mockResolvedValue({
      runId: "run-1",
      ok: true,
      output: JSON.stringify([
        { id: "note-1", fileAs: "Task", reason: "needs a ticket" },
        { id: "note-2", fileAs: "dump", reason: "noise" },
      ]),
    });
  });

  it("comments each inbox note and does not patch Status", async () => {
    const result = await runTriageJob("test");
    expect(result.ok).toBe(true);
    expect(createPageComment).toHaveBeenCalledTimes(2);
    expect(createPageComment).toHaveBeenCalledWith(
      "note-1",
      triageCommentText({ id: "note-1", fileAs: "Task", reason: "needs a ticket" }),
    );
    expect(createPageComment).toHaveBeenCalledWith(
      "note-2",
      triageCommentText({ id: "note-2", fileAs: "dump", reason: "noise" }),
    );
    for (const call of createPageComment.mock.calls) {
      expect(call[1]).toContain("Status was not changed");
      expect(call[1]).not.toMatch(/\bPATCH\b/);
    }
  });

  it("still comments every note when JSON cannot be parsed", async () => {
    executeRun.mockResolvedValue({
      runId: "run-1",
      ok: true,
      output: "just markdown, no json",
    });
    await runTriageJob("test");
    expect(createPageComment).toHaveBeenCalledTimes(2);
    const expected = triageFallbackComment("just markdown, no json");
    expect(createPageComment).toHaveBeenCalledWith("note-1", expected);
    expect(createPageComment).toHaveBeenCalledWith("note-2", expected);
    for (const call of createPageComment.mock.calls) {
      expect(call[1]).toContain("waiting on PM to file; Status not changed");
      expect(call[1]).toContain("just markdown, no json");
    }
  });

  it("does not comment when the run fails", async () => {
    executeRun.mockResolvedValue({ runId: "run-1", ok: false, error: "boom" });
    await runTriageJob("test");
    expect(createPageComment).not.toHaveBeenCalled();
  });
});

describe("runRiskJob comments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createPageComment.mockResolvedValue(undefined);
    queryProjects.mockResolvedValue([]);
    executeRun.mockResolvedValue({ runId: "run-2", ok: true, output: "digest" });
  });

  it("comments flagged tasks once with worst Health and does not patch Health or Status", async () => {
    queryTasks.mockResolvedValue([
      page("overdue-1", {
        Status: status("Not started"),
        Due: { type: "date", date: { start: "2020-01-01" } },
        "Owner (role)": { type: "rich_text", rich_text: [{ plain_text: "SWE" }] },
      }),
      page("blocked-1", {
        Status: status("In progress"),
        Blockers: { type: "relation", relation: [{ id: "b1" }] },
        "Owner (role)": { type: "rich_text", rich_text: [{ plain_text: "SWE" }] },
      }),
      page("owner-1", {
        Status: status("Not started"),
      }),
      page("multi-1", {
        Status: status("Not started"),
        Priority: select("P0"),
        Due: { type: "date", date: { start: "2020-01-01" } },
        Blockers: { type: "relation", relation: [{ id: "b2" }] },
      }),
      page("done-1", {
        Status: status("Done"),
        Priority: select("P0"),
      }),
    ]);

    const result = await runRiskJob("test");
    expect(result.ok).toBe(true);

    const ids = createPageComment.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(ids.sort()).toEqual(["blocked-1", "multi-1", "overdue-1", "owner-1"]);
    expect(ids).not.toContain("done-1");
    expect(ids.filter((id) => id === "multi-1")).toHaveLength(1);

    const overdue = createPageComment.mock.calls.find((c: unknown[]) => c[0] === "overdue-1");
    expect(overdue?.[1]).toBe(healthSuggestionComment(["overdue"]));
    expect(String(overdue?.[1])).toContain("Suggested Health: Red");
    expect(String(overdue?.[1])).toContain("PM must confirm; Health not set");
    expect(String(overdue?.[1])).toContain("Status was not changed");

    const blocked = createPageComment.mock.calls.find((c: unknown[]) => c[0] === "blocked-1");
    expect(String(blocked?.[1])).toContain("Suggested Health: Amber");

    const owner = createPageComment.mock.calls.find((c: unknown[]) => c[0] === "owner-1");
    expect(String(owner?.[1])).toContain("no owner");
    expect(String(owner?.[1])).toContain("Suggested Health: Amber");

    const multi = createPageComment.mock.calls.find((c: unknown[]) => c[0] === "multi-1");
    expect(String(multi?.[1])).toBe(
      healthSuggestionComment(["overdue", "blocked", "no owner", "P0 not in progress"]),
    );
    expect(String(multi?.[1])).toContain("Suggested Health: Red");
    expect(String(multi?.[1])).toContain("overdue");
    expect(String(multi?.[1])).toContain("blocked");
    expect(String(multi?.[1])).toContain("no owner");
    expect(String(multi?.[1])).toContain("P0 not in progress");
  });

  it("does not comment when the run fails", async () => {
    queryTasks.mockResolvedValue([
      page("overdue-1", {
        Status: status("Not started"),
        Due: { type: "date", date: { start: "2020-01-01" } },
      }),
    ]);
    executeRun.mockResolvedValue({ runId: "run-2", ok: false, error: "boom" });
    await runRiskJob("test");
    expect(createPageComment).not.toHaveBeenCalled();
  });
});
