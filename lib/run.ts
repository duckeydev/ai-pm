import type { AiRunKind } from "@/lib/hq";
import { createAiRun, patchAiRun, patchAiSummary } from "@/lib/notion";
import { chatCompletion } from "@/lib/openrouter";
import { redactSecrets } from "@/lib/redact";

export type ExecuteRunInput = {
  name: string;
  kind: AiRunKind;
  triggeredBy: string;
  prompt?: string;
  buildPrompt?: () => Promise<string>;
  system?: string;
  taskId?: string;
  projectId?: string;
  summaryTargets?: Array<{ id: string }>;
};

export type ExecuteRunResult = {
  runId: string;
  ok: boolean;
  model?: string;
  output?: string;
  error?: string;
};

function defaultSystem(kind: AiRunKind): string {
  const base =
    "You are a project-management assistant for The Place HQ. Be concise, structured, and specific. Do not invent Notion page IDs. Never suggest changing Status or Health automatically.";
  switch (kind) {
    case "Triage":
      return `${base} For each inbox note, recommend filing as Task, Note, Decision, or dump. Give a one-line reason. Do not change Note Status.`;
    case "Breakdown":
      return `${base} Propose subtasks only (do not create pages). For each subtask include Estimate, Priority (P0-P3), and Acceptance criteria.`;
    case "Standup":
      return `${base} Write a markdown standup digest grouped by In progress, Not started, Blockers, Health (Red/Amber), and Due this week.`;
    case "Risk scan":
      return `${base} Write a markdown risk scan covering overdue Due, blocked work, missing owner, and P0 items not In progress. Do not recommend auto-changing Status or Health.`;
    case "Rewrite":
      return `${base} Rewrite messy notes into a clean status update (what happened, what's next, blockers).`;
    case "Decision brief":
      return `${base} Write a short decision brief: context, options, recommendation, risks.`;
    default:
      return base;
  }
}

/**
 * Shared write path every job uses:
 * 1. create AI Runs row Status=Queued
 * 2. patch Status=Running
 * 3. call OpenRouter
 * 4. success: Status=Done + Prompt, Output, Model, tokens, cost, Ran at
 * 5. failure: Status=Error + Error; never leave Running
 * 6. then PATCH related Task/Project AI summary only
 */
export async function executeRun(input: ExecuteRunInput): Promise<ExecuteRunResult> {
  const created = await createAiRun({
    name: input.name,
    kind: input.kind,
    triggeredBy: input.triggeredBy,
    taskId: input.taskId,
    projectId: input.projectId,
  });
  const runId = created.id;

  try {
    await patchAiRun(runId, { Status: "Running" });

    const prompt = input.prompt ?? (input.buildPrompt ? await input.buildPrompt() : "");
    const system = input.system ?? defaultSystem(input.kind);

    const result = await chatCompletion([
      { role: "system", content: system },
      { role: "user", content: prompt },
    ]);

    const safePrompt = redactSecrets(prompt);
    const safeOutput = redactSecrets(result.text);
    const ranAt = new Date().toISOString();

    await patchAiRun(runId, {
      Status: "Done",
      Prompt: safePrompt,
      Output: safeOutput,
      Model: result.model,
      "Tokens in": result.promptTokens,
      "Tokens out": result.completionTokens,
      "Cost USD": result.costUsd,
      "Ran at": ranAt,
    });

    const summary = safeOutput;
    for (const target of input.summaryTargets ?? []) {
      if (target.id) {
        await patchAiSummary(target.id, summary);
      }
    }

    return { runId, ok: true, model: result.model, output: safeOutput };
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    try {
      await patchAiRun(runId, { Status: "Error", Error: message });
    } catch (patchErr) {
      const extra = redactSecrets(patchErr instanceof Error ? patchErr.message : String(patchErr));
      return { runId, ok: false, error: `${message}; also failed to mark Error: ${extra}` };
    }
    return { runId, ok: false, error: message };
  }
}
