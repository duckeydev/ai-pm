import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAiRun, patchAiRun, patchAiSummary, chatCompletion } = vi.hoisted(() => ({
  createAiRun: vi.fn(),
  patchAiRun: vi.fn(),
  patchAiSummary: vi.fn(),
  chatCompletion: vi.fn(),
}));

vi.mock("@/lib/notion", () => ({
  createAiRun,
  patchAiRun,
  patchAiSummary,
}));

vi.mock("@/lib/openrouter", () => ({
  chatCompletion,
}));

import { executeRun } from "@/lib/run";

describe("executeRun write path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createAiRun.mockResolvedValue({ id: "run-1" });
    patchAiRun.mockResolvedValue(undefined);
    patchAiSummary.mockResolvedValue(undefined);
    process.env.OPENROUTER_API_KEY = "sk-test-secret-key";
  });

  it("Queued → Running → Done and stores model/tokens/cost", async () => {
    chatCompletion.mockResolvedValue({
      text: "digest",
      model: "openai/gpt-4.1-mini",
      promptTokens: 11,
      completionTokens: 7,
      costUsd: 0.002,
    });

    const result = await executeRun({
      name: "Standup test",
      kind: "Standup",
      triggeredBy: "test",
      prompt: "hello",
      taskId: "task-1",
      projectId: "proj-1",
      summaryTargets: [{ id: "proj-1" }],
    });

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-1");
    expect(createAiRun).toHaveBeenCalledTimes(1);
    expect(createAiRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Standup test",
        kind: "Standup",
        triggeredBy: "test",
        taskId: "task-1",
        projectId: "proj-1",
      }),
    );

    const statuses = patchAiRun.mock.calls.map((c: unknown[]) => (c[1] as { Status?: string }).Status);
    expect(statuses[0]).toBe("Running");
    expect(statuses[1]).toBe("Done");
    expect(statuses).not.toContain("Error");

    const done = patchAiRun.mock.calls[1][1] as Record<string, unknown>;
    expect(done.Prompt).toBe("hello");
    expect(done.Output).toBe("digest");
    expect(done.Model).toBe("openai/gpt-4.1-mini");
    expect(done["Tokens in"]).toBe(11);
    expect(done["Tokens out"]).toBe(7);
    expect(done["Cost USD"]).toBe(0.002);
    expect(done["Ran at"]).toEqual(expect.any(String));

    expect(patchAiSummary).toHaveBeenCalledWith("proj-1", "digest");
  });

  it("failure sets Error and is not left Running", async () => {
    chatCompletion.mockRejectedValue(new Error("upstream failed"));

    const result = await executeRun({
      name: "Triage test",
      kind: "Triage",
      triggeredBy: "test",
      prompt: "notes",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("upstream failed");

    const statuses = patchAiRun.mock.calls.map((c: unknown[]) => (c[1] as { Status?: string }).Status);
    expect(statuses[0]).toBe("Running");
    expect(statuses.at(-1)).toBe("Error");
    expect(statuses.filter((s: string | undefined) => s === "Running")).toHaveLength(1);

    const last = patchAiRun.mock.calls.at(-1)?.[1] as { Error?: string; Status?: string };
    expect(last.Status).toBe("Error");
    expect(last.Error).toContain("upstream failed");
    expect(patchAiSummary).not.toHaveBeenCalled();
  });

  it("buildPrompt failure after Running marks Error", async () => {
    const result = await executeRun({
      name: "Risk test",
      kind: "Risk scan",
      triggeredBy: "test",
      buildPrompt: async () => {
        throw new Error("notion query failed");
      },
    });

    expect(result.ok).toBe(false);
    const last = patchAiRun.mock.calls.at(-1)?.[1] as { Status?: string; Error?: string };
    expect(last.Status).toBe("Error");
    expect(last.Error).toContain("notion query failed");
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("redacts OPENROUTER_API_KEY from Prompt, Output, and Error", async () => {
    const key = "sk-test-secret-key";
    chatCompletion.mockResolvedValue({
      text: `used ${key} in output`,
      model: "openai/gpt-4.1-mini",
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0,
    });

    await executeRun({
      name: "Rewrite test",
      kind: "Rewrite",
      triggeredBy: "test",
      prompt: `prompt contains ${key}`,
      summaryTargets: [{ id: "task-9" }],
    });

    const done = patchAiRun.mock.calls[1][1] as { Prompt: string; Output: string };
    expect(done.Prompt).not.toContain(key);
    expect(done.Output).not.toContain(key);
    expect(done.Prompt).toContain("[REDACTED]");
    expect(done.Output).toContain("[REDACTED]");
    expect(patchAiSummary.mock.calls[0][1]).not.toContain(key);
  });

  it("redacts API key from Error on failure", async () => {
    const key = "sk-test-secret-key";
    chatCompletion.mockRejectedValue(new Error(`bad key ${key}`));

    await executeRun({
      name: "Triage test",
      kind: "Triage",
      triggeredBy: "test",
      prompt: "x",
    });

    const last = patchAiRun.mock.calls.at(-1)?.[1] as { Error: string };
    expect(last.Error).not.toContain(key);
    expect(last.Error).toContain("[REDACTED]");
  });
  it("never writes Status or Health on tasks/projects", async () => {
    chatCompletion.mockResolvedValue({
      text: "subtasks",
      model: "openai/gpt-4.1-mini",
      promptTokens: 2,
      completionTokens: 2,
      costUsd: 0,
    });

    await executeRun({
      name: "Breakdown test",
      kind: "Breakdown",
      triggeredBy: "test",
      prompt: "task",
      summaryTargets: [{ id: "task-1" }, { id: "proj-1" }],
    });

    expect(patchAiSummary).toHaveBeenCalledTimes(2);
    for (const call of patchAiSummary.mock.calls) {
      expect(call).toHaveLength(2);
      expect(typeof call[0]).toBe("string");
      expect(typeof call[1]).toBe("string");
    }
    expect(createAiRun.mock.calls[0][0]).not.toHaveProperty("Status");
    expect(createAiRun.mock.calls[0][0]).not.toHaveProperty("Health");
  });
});
