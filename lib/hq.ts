/** HQ Notion collection IDs (data source IDs). Code constants — not env. */
export const TASKS_COLLECTION = "771fe81c-9775-4ba1-a77a-1785baaaee5e";
export const PROJECTS_COLLECTION = "46606c59-7916-4bc9-a1d4-29145d87244f";
export const NOTES_COLLECTION = "52f5a3c1-42f7-49e7-8436-5edda2dd607d";
export const AI_RUNS_COLLECTION = "c1861411-5fb8-4319-b9d9-78cb5be7c64c";

/** Database page IDs (docs only — do not use for queries). */
export const HQ_PAGES = {
  tasks: "1f8ac0f744d54476aef030cb54d4a24e",
  projects: "86691cc938614d4089c64548c30815ea",
  aiRuns: "0981a84afa154122b3ae46c60877a732",
  dashboard: "34f24a9c3b1b80aa8222e1a4df7d374f",
} as const;

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";

export type AiRunKind =
  | "Triage"
  | "Breakdown"
  | "Standup"
  | "Risk scan"
  | "Rewrite"
  | "Decision brief";

export type AiRunStatus = "Queued" | "Running" | "Done" | "Error";
