import { PROJECTS_COLLECTION, TASKS_COLLECTION } from "@/lib/hq";
import {
  createPageComment,
  getDate,
  getPageByUrlOrId,
  getPagePlainText,
  getRelationIds,
  getSelect,
  getTitle,
  parentCollectionId,
  propIsEmpty,
  queryInboxNotes,
  queryProjects,
  queryTasks,
  summarizeNote,
  summarizeProject,
  summarizeTask,
  type NotionPage,
} from "@/lib/notion";
import { executeRun, type ExecuteRunResult } from "@/lib/run";

const RANGOON = "Asia/Rangoon";

export function todayYmdRangoon(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RANGOON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function ymdInRangoon(isoDate: string): string {
  const d = new Date(isoDate.length <= 10 ? `${isoDate}T12:00:00Z` : isoDate);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RANGOON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function startOfWeekMondayYmd(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = utc.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return utc.toISOString().slice(0, 10);
}

function endOfWeekSundayYmd(today: string): string {
  const start = startOfWeekMondayYmd(today);
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function hasBlockers(page: NotionPage): boolean {
  return !propIsEmpty(page, "Blockers") || !propIsEmpty(page, "Blocked by");
}

function hasOwner(page: NotionPage): boolean {
  return !propIsEmpty(page, "Owner (role)") || !propIsEmpty(page, "Assignee");
}

export type FileAs = "Task" | "Note" | "Decision" | "dump";

export type TriageSuggestion = {
  id: string;
  fileAs: FileAs;
  reason: string;
};

const FILE_AS_MAP: Record<string, FileAs> = {
  task: "Task",
  note: "Note",
  decision: "Decision",
  dump: "dump",
};

function extractJsonArray(output: string): unknown[] | null {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const blobs = fenced ? [fenced[1], output] : [output];
  for (const blob of blobs) {
    const start = blob.indexOf("[");
    if (start < 0) continue;
    for (let end = blob.lastIndexOf("]"); end > start; end = blob.lastIndexOf("]", end - 1)) {
      try {
        const parsed = JSON.parse(blob.slice(start, end + 1)) as unknown;
        if (Array.isArray(parsed)) return parsed;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function normalizePageId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/** Parsed suggestions only. Missing/unparseable notes are handled by triageFallbackComment. */
export function parseTriageSuggestions(
  output: string,
  notes: Array<{ id: string }>,
): TriageSuggestion[] {
  const known = new Map(notes.map((n) => [normalizePageId(n.id), n.id]));
  const parsed = extractJsonArray(output);
  if (!parsed) return [];
  const out: TriageSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawId = String(rec.id ?? rec.pageId ?? rec.page_id ?? "").trim();
    const canonical = known.get(normalizePageId(rawId));
    if (!canonical || seen.has(canonical)) continue;
    const fileAs = FILE_AS_MAP[String(rec.fileAs ?? rec.file_as ?? "").trim().toLowerCase()];
    if (!fileAs) continue;
    const reason = String(rec.reason ?? "").trim() || "No reason given";
    seen.add(canonical);
    out.push({ id: canonical, fileAs, reason: reason.slice(0, 500) });
  }
  return out;
}

export function triageCommentText(suggestion: TriageSuggestion): string {
  return [
    "AI triage suggestion (not filed — waiting on PM).",
    `Suggested file-as: ${suggestion.fileAs}.`,
    `Reason: ${suggestion.reason}`,
    "Note Status was not changed.",
  ].join("\n");
}

export function triageFallbackComment(output: string): string {
  const snippet = output.replace(/\s+/g, " ").trim().slice(0, 400);
  return [
    "Triage: waiting on PM to file; Status not changed.",
    snippet ? `Model output snippet: ${snippet}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type HealthFlag = "overdue" | "blocked" | "no owner" | "P0 not in progress";

export function healthSuggestionForFlags(flags: HealthFlag[]): {
  health: "Red" | "Amber";
  reasons: HealthFlag[];
} {
  const reasons = [...new Set(flags)];
  const health = reasons.some((f) => f === "overdue" || f === "P0 not in progress")
    ? "Red"
    : "Amber";
  return { health, reasons };
}

export function healthSuggestionComment(flags: HealthFlag[]): string {
  const { health, reasons } = healthSuggestionForFlags(flags);
  return [
    "AI Health suggestion (not applied).",
    `Suggested Health: ${health}.`,
    `Reasons: ${reasons.join("; ")}.`,
    "PM must confirm; Health not set. Status was not changed. No Blockers row was created.",
  ].join("\n");
}

export async function runTriageJob(triggeredBy: string): Promise<ExecuteRunResult> {
  const date = todayYmdRangoon();
  const notes = await queryInboxNotes();
  const items = [];
  for (const note of notes) {
    const body = await getPagePlainText(note.id);
    items.push(summarizeNote(note, body));
  }

  const result = await executeRun({
    name: `Triage ${date}`,
    kind: "Triage",
    triggeredBy,
    prompt: [
      `Inbox notes (${items.length}) as of ${date} (Asia/Rangoon).`,
      "For each note, suggest file-as: Task vs Note vs Decision vs dump.",
      "Do not change Note Status.",
      "Output markdown, then a JSON array of {id, fileAs, reason} for each note.",
      "",
      JSON.stringify(items, null, 2),
    ].join("\n"),
  });

  if (result.ok) {
    const output = result.output ?? "";
    const suggestions = parseTriageSuggestions(output, notes);
    const byId = new Map(suggestions.map((s) => [s.id, s]));
    for (const note of notes) {
      const suggestion = byId.get(note.id);
      const text = suggestion ? triageCommentText(suggestion) : triageFallbackComment(output);
      await createPageComment(note.id, text);
    }
  }
  return result;
}

export async function runBreakdownJob(
  triggeredBy: string,
  taskUrl: string,
): Promise<ExecuteRunResult> {
  const task = await getPageByUrlOrId(taskUrl);
  const body = await getPagePlainText(task.id);
  const summary = summarizeTask(task);
  const projectIds = getRelationIds(task, "Project");
  return executeRun({
    name: `Breakdown: ${getTitle(task)}`.slice(0, 2000),
    kind: "Breakdown",
    triggeredBy,
    taskId: task.id,
    projectId: projectIds[0],
    summaryTargets: [{ id: task.id }],
    prompt: [
      "Break this task into subtasks. Do NOT create pages — propose only.",
      "For each subtask include: title, Estimate, Priority (P0-P3), Acceptance.",
      "",
      JSON.stringify({ ...summary, body }, null, 2),
    ].join("\n"),
  });
}

export async function runStandupJob(triggeredBy: string): Promise<ExecuteRunResult> {
  const today = todayYmdRangoon();
  const weekStart = startOfWeekMondayYmd(today);
  const weekEnd = endOfWeekSundayYmd(today);
  const summaryTargets: Array<{ id: string }> = [];

  return executeRun({
    name: `Standup ${today}`,
    kind: "Standup",
    triggeredBy,
    summaryTargets,
    buildPrompt: async () => {
      const tasks = await queryTasks();
      const inProgress: NotionPage[] = [];
      const notStarted: NotionPage[] = [];
      const blockers: NotionPage[] = [];
      const health: NotionPage[] = [];
      const dueThisWeek: NotionPage[] = [];

      for (const task of tasks) {
        const status = getSelect(task, "Status");
        const h = getSelect(task, "Health");
        const due = getDate(task, "Due");
        const dueYmd = due ? ymdInRangoon(due).slice(0, 10) : null;

        if (status === "In progress") inProgress.push(task);
        if (status === "Not started") notStarted.push(task);
        if (hasBlockers(task) && status !== "Done" && status !== "Archived") {
          blockers.push(task);
        }
        if ((h === "Red" || h === "Amber") && status !== "Done" && status !== "Archived") {
          health.push(task);
        }
        if (
          dueYmd &&
          dueYmd >= weekStart &&
          dueYmd <= weekEnd &&
          status !== "Done" &&
          status !== "Archived"
        ) {
          dueThisWeek.push(task);
        }
      }

      const related = uniqueIds(
        [...inProgress, ...notStarted, ...blockers, ...health, ...dueThisWeek].flatMap((t) =>
          getRelationIds(t, "Project"),
        ),
      );
      summaryTargets.splice(0, summaryTargets.length, ...related.map((id) => ({ id })));

      return [
        `Standup for ${today} (Asia/Rangoon). Week ${weekStart} → ${weekEnd}.`,
        "Write a markdown digest. Do not change Status or Health.",
        "",
        JSON.stringify(
          {
            inProgress: inProgress.map(summarizeTask),
            notStarted: notStarted.map(summarizeTask),
            blockers: blockers.map(summarizeTask),
            healthRedAmber: health.map(summarizeTask),
            dueThisWeek: dueThisWeek.map(summarizeTask),
            relatedProjectIds: related,
          },
          null,
          2,
        ),
      ].join("\n");
    },
  });
}

export async function runRiskJob(triggeredBy: string): Promise<ExecuteRunResult> {
  const today = todayYmdRangoon();
  const summaryTargets: Array<{ id: string }> = [];
  const tasks = await queryTasks();
  const overdue: NotionPage[] = [];
  const blocked: NotionPage[] = [];
  const noOwner: NotionPage[] = [];
  const p0NotInProgress: NotionPage[] = [];
  const flagsById = new Map<string, HealthFlag[]>();

  function addFlag(task: NotionPage, flag: HealthFlag) {
    const existing = flagsById.get(task.id) ?? [];
    existing.push(flag);
    flagsById.set(task.id, existing);
  }

  for (const task of tasks) {
    const status = getSelect(task, "Status");
    if (status === "Done" || status === "Archived") continue;
    const due = getDate(task, "Due");
    const dueYmd = due ? ymdInRangoon(due).slice(0, 10) : null;
    const priority = getSelect(task, "Priority");

    if (dueYmd && dueYmd < today) {
      overdue.push(task);
      addFlag(task, "overdue");
    }
    if (hasBlockers(task)) {
      blocked.push(task);
      addFlag(task, "blocked");
    }
    if (!hasOwner(task)) {
      noOwner.push(task);
      addFlag(task, "no owner");
    }
    if (priority === "P0" && status !== "In progress") {
      p0NotInProgress.push(task);
      addFlag(task, "P0 not in progress");
    }
  }

  const flagged = [...overdue, ...blocked, ...noOwner, ...p0NotInProgress];
  const related = uniqueIds(flagged.flatMap((t) => getRelationIds(t, "Project")));
  summaryTargets.push(...related.map((id) => ({ id })));

  const projects = await queryProjects();
  const result = await executeRun({
    name: `Risk scan ${today}`,
    kind: "Risk scan",
    triggeredBy,
    summaryTargets,
    prompt: [
      `Risk scan for ${today} (Asia/Rangoon).`,
      "Do not change Status or Health. Markdown sections: Overdue, Blocked, No owner, P0 not in progress.",
      "",
      JSON.stringify(
        {
          overdue: overdue.map(summarizeTask),
          blocked: blocked.map(summarizeTask),
          noOwner: noOwner.map(summarizeTask),
          p0NotInProgress: p0NotInProgress.map(summarizeTask),
          projects: projects.map(summarizeProject),
        },
        null,
        2,
      ),
    ].join("\n"),
  });

  if (result.ok) {
    for (const [id, flags] of flagsById) {
      await createPageComment(id, healthSuggestionComment(flags));
    }
  }
  return result;
}

export async function runRewriteJob(
  triggeredBy: string,
  input: { text?: string; pageUrl?: string },
): Promise<ExecuteRunResult> {
  const today = todayYmdRangoon();
  let page: NotionPage | null = null;
  let source = input.text?.trim() || "";
  let taskId: string | undefined;
  let projectId: string | undefined;
  const summaryTargets: Array<{ id: string }> = [];

  if (input.pageUrl) {
    page = await getPageByUrlOrId(input.pageUrl);
    const body = await getPagePlainText(page.id);
    source = [source, `Page: ${getTitle(page)}`, body].filter(Boolean).join("\n\n");
    const parent = parentCollectionId(page);
    if (parent === TASKS_COLLECTION) {
      taskId = page.id;
      projectId = getRelationIds(page, "Project")[0];
      summaryTargets.push({ id: page.id });
    } else if (parent === PROJECTS_COLLECTION) {
      projectId = page.id;
      summaryTargets.push({ id: page.id });
    }
  }

  if (!source) {
    throw new Error("rewrite requires text or pageUrl");
  }

  return executeRun({
    name: `Rewrite ${page ? getTitle(page) : today}`.slice(0, 2000),
    kind: "Rewrite",
    triggeredBy,
    taskId,
    projectId,
    summaryTargets,
    prompt: [
      "Rewrite the following messy notes into a clean status update.",
      "Include: what happened, what's next, blockers (if any).",
      "",
      source,
    ].join("\n"),
  });
}
