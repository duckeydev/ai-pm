import { Client, isFullPage } from "@notionhq/client";
import {
  AI_RUNS_COLLECTION,
  NOTES_COLLECTION,
  PROJECTS_COLLECTION,
  TASKS_COLLECTION,
  type AiRunKind,
  type AiRunStatus,
} from "@/lib/hq";
import { getNotionToken } from "@/lib/env";
import { redactSecrets } from "@/lib/redact";

const FORBIDDEN_TASK_PROJECT_PROPS = new Set(["Status", "Health"]);

type NotionClient = Client;

let cached: NotionClient | null = null;

export function getNotionClient(): NotionClient {
  if (!cached) {
    cached = new Client({ auth: getNotionToken() });
  }
  return cached;
}

/** Test hook — swap the client without reading env. */
export function setNotionClientForTests(client: NotionClient | null): void {
  cached = client;
}

export type NotionPage = {
  id: string;
  url: string;
  properties: Record<string, unknown>;
  parent?: unknown;
  raw: unknown;
};

export type CreateAiRunInput = {
  name: string;
  kind: AiRunKind;
  triggeredBy: string;
  taskId?: string;
  projectId?: string;
};

export type PatchAiRunInput = {
  Status?: AiRunStatus;
  Prompt?: string;
  Output?: string;
  Error?: string;
  Model?: string;
  "Tokens in"?: number;
  "Tokens out"?: number;
  "Cost USD"?: number;
  "Ran at"?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function parseNotionId(urlOrId: string): string {
  const cleaned = urlOrId.trim();
  const uuid = cleaned.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  if (uuid) return uuid[0].toLowerCase();

  const hexMatch =
    cleaned.match(/([0-9a-f]{32})(?:[?#/]|$)/i) || cleaned.match(/([0-9a-f]{32})/i);
  if (hexMatch) {
    const h = hexMatch[1].toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  throw new Error(`Could not parse Notion page id from: ${urlOrId}`);
}

function richTextChunks(content: string): Array<{ type: "text"; text: { content: string } }> {
  const text = content ?? "";
  const chunks: Array<{ type: "text"; text: { content: string } }> = [];
  const limit = 2000;
  if (text.length === 0) {
    return [{ type: "text", text: { content: "" } }];
  }
  for (let i = 0; i < text.length && chunks.length < 100; i += limit) {
    chunks.push({ type: "text", text: { content: text.slice(i, i + limit) } });
  }
  return chunks;
}

function titleProp(content: string) {
  return { title: richTextChunks(content.slice(0, 2000)) };
}

function richTextProp(content: string) {
  return { rich_text: richTextChunks(redactSecrets(content)) };
}

function selectProp(name: string) {
  return { select: { name } };
}

function numberProp(n: number) {
  return { number: n };
}

function dateProp(iso: string) {
  return { date: { start: iso } };
}

function relationProp(ids: string[]) {
  return { relation: ids.map((id) => ({ id })) };
}

export function assertSafeTaskProjectPatch(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    if (FORBIDDEN_TASK_PROJECT_PROPS.has(key)) {
      throw new Error(`Refusing to patch Task/Project property "${key}"`);
    }
  }
}

type QueryArgs = {
  filter?: unknown;
  sorts?: unknown;
  page_size?: number;
};

async function queryCollection(
  dataSourceId: string,
  args: QueryArgs = {},
): Promise<NotionPage[]> {
  const client = getNotionClient() as unknown as {
    dataSources?: {
      query: (a: Record<string, unknown>) => Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    };
    databases: {
      query: (a: Record<string, unknown>) => Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    };
  };

  const pages: NotionPage[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  const maxPages = 8;

  for (let i = 0; i < maxPages && hasMore; i++) {
    const body: Record<string, unknown> = {
      page_size: args.page_size ?? 100,
      ...(args.filter ? { filter: args.filter } : {}),
      ...(args.sorts ? { sorts: args.sorts } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    };

    let response: { results: unknown[]; has_more: boolean; next_cursor: string | null };
    if (client.dataSources?.query) {
      response = await client.dataSources.query({ data_source_id: dataSourceId, ...body });
    } else {
      response = await client.databases.query({ database_id: dataSourceId, ...body });
    }

    for (const result of response.results) {
      const rec = asRecord(result);
      if (!rec || rec.object !== "page") continue;
      pages.push(normalizePage(result));
    }
    hasMore = Boolean(response.has_more);
    cursor = response.next_cursor;
  }

  return pages;
}

function normalizePage(result: unknown): NotionPage {
  const rec = asRecord(result) ?? {};
  return {
    id: String(rec.id ?? ""),
    url: String(rec.url ?? ""),
    properties: (asRecord(rec.properties) as Record<string, unknown>) ?? {},
    parent: rec.parent,
    raw: result,
  };
}

export function getTitle(page: NotionPage): string {
  for (const value of Object.values(page.properties)) {
    const rec = asRecord(value);
    if (rec?.type === "title" && Array.isArray(rec.title)) {
      return rec.title.map((t: { plain_text?: string }) => t.plain_text ?? "").join("");
    }
  }
  return "Untitled";
}

export function getSelect(page: NotionPage, name: string): string | null {
  const rec = asRecord(page.properties[name]);
  if (!rec) return null;
  if (rec.type === "select") {
    const sel = asRecord(rec.select);
    return sel?.name ? String(sel.name) : null;
  }
  if (rec.type === "status") {
    const st = asRecord(rec.status);
    return st?.name ? String(st.name) : null;
  }
  return null;
}

export function getRichText(page: NotionPage, name: string): string {
  const rec = asRecord(page.properties[name]);
  if (!rec) return "";
  if (Array.isArray(rec.rich_text)) {
    return rec.rich_text.map((t: { plain_text?: string }) => t.plain_text ?? "").join("");
  }
  if (Array.isArray(rec.title)) {
    return rec.title.map((t: { plain_text?: string }) => t.plain_text ?? "").join("");
  }
  return "";
}

export function getNumber(page: NotionPage, name: string): number | null {
  const rec = asRecord(page.properties[name]);
  if (!rec) return null;
  return typeof rec.number === "number" ? rec.number : null;
}

export function getDate(page: NotionPage, name: string): string | null {
  const rec = asRecord(page.properties[name]);
  if (!rec) return null;
  const date = asRecord(rec.date);
  return date?.start ? String(date.start) : null;
}

export function getPeopleNames(page: NotionPage, name: string): string[] {
  const rec = asRecord(page.properties[name]);
  if (!rec || !Array.isArray(rec.people)) return [];
  return rec.people
    .map((p: { name?: string; id?: string }) => p.name || p.id || "")
    .filter(Boolean);
}

export function getRelationIds(page: NotionPage, name: string): string[] {
  const rec = asRecord(page.properties[name]);
  if (!rec || !Array.isArray(rec.relation)) return [];
  return rec.relation.map((r: { id?: string }) => r.id).filter((id): id is string => Boolean(id));
}

export function propIsEmpty(page: NotionPage, name: string): boolean {
  const rec = asRecord(page.properties[name]);
  if (!rec) return true;
  const type = rec.type;
  if (type === "select") return !asRecord(rec.select)?.name;
  if (type === "status") return !asRecord(rec.status)?.name;
  if (type === "rich_text") return !Array.isArray(rec.rich_text) || rec.rich_text.length === 0 || getRichText(page, name).trim() === "";
  if (type === "title") return getTitle(page).trim() === "" || getTitle(page) === "Untitled";
  if (type === "people") return !Array.isArray(rec.people) || rec.people.length === 0;
  if (type === "relation") return !Array.isArray(rec.relation) || rec.relation.length === 0;
  if (type === "date") return !asRecord(rec.date)?.start;
  if (type === "number") return rec.number === null || rec.number === undefined;
  if (type === "multi_select") return !Array.isArray(rec.multi_select) || rec.multi_select.length === 0;
  if (type === "checkbox") return rec.checkbox === false;
  if (type === "formula") {
    const f = asRecord(rec.formula);
    if (!f) return true;
    if (f.type === "string") return !f.string;
    if (f.type === "number") return f.number === null || f.number === undefined;
    if (f.type === "boolean") return !f.boolean;
    if (f.type === "date") return !asRecord(f.date)?.start;
  }
  return true;
}

export async function getPagePlainText(pageId: string, limit = 40): Promise<string> {
  const client = getNotionClient();
  const lines: string[] = [];
  let cursor: string | undefined;
  let fetched = 0;

  do {
    const response = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: Math.min(50, limit - fetched),
    });
    for (const block of response.results) {
      const rec = asRecord(block);
      if (!rec) continue;
      const type = String(rec.type ?? "");
      const inner = asRecord(rec[type]);
      if (inner && Array.isArray(inner.rich_text)) {
        const text = inner.rich_text
          .map((t: { plain_text?: string }) => t.plain_text ?? "")
          .join("");
        if (text) lines.push(text);
      }
      fetched += 1;
      if (fetched >= limit) break;
    }
    cursor = response.has_more && fetched < limit ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return lines.join("\n");
}

function buildAiRunProperties(fields: {
  Name?: string;
  Kind?: AiRunKind;
  Status?: AiRunStatus;
  "Triggered by"?: string;
  Task?: string;
  Project?: string;
} & PatchAiRunInput): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (fields.Name !== undefined) properties.Name = titleProp(fields.Name);
  if (fields.Kind !== undefined) properties.Kind = selectProp(fields.Kind);
  if (fields.Status !== undefined) properties.Status = selectProp(fields.Status);
  if (fields["Triggered by"] !== undefined) {
    properties["Triggered by"] = richTextProp(fields["Triggered by"]);
  }
  if (fields.Task) properties.Task = relationProp([fields.Task]);
  if (fields.Project) properties.Project = relationProp([fields.Project]);
  if (fields.Prompt !== undefined) properties.Prompt = richTextProp(fields.Prompt);
  if (fields.Output !== undefined) properties.Output = richTextProp(fields.Output);
  if (fields.Error !== undefined) properties.Error = richTextProp(fields.Error);
  if (fields.Model !== undefined) properties.Model = richTextProp(fields.Model);
  if (fields["Tokens in"] !== undefined) properties["Tokens in"] = numberProp(fields["Tokens in"]);
  if (fields["Tokens out"] !== undefined) properties["Tokens out"] = numberProp(fields["Tokens out"]);
  if (fields["Cost USD"] !== undefined) properties["Cost USD"] = numberProp(fields["Cost USD"]);
  if (fields["Ran at"] !== undefined) properties["Ran at"] = dateProp(fields["Ran at"]);
  return properties;
}

export async function createAiRun(input: CreateAiRunInput): Promise<{ id: string }> {
  const client = getNotionClient();
  const properties = buildAiRunProperties({
    Name: input.name,
    Kind: input.kind,
    Status: "Queued",
    "Triggered by": input.triggeredBy,
    Task: input.taskId,
    Project: input.projectId,
  });

  const page = await client.pages.create({
    parent: { data_source_id: AI_RUNS_COLLECTION },
    properties: properties as never,
  });

  return { id: page.id };
}

export async function patchAiRun(id: string, fields: PatchAiRunInput): Promise<void> {
  const client = getNotionClient();
  const properties = buildAiRunProperties(fields);
  await client.pages.update({
    page_id: id,
    properties: properties as never,
  });
}

export async function patchAiSummary(pageId: string, summary: string): Promise<void> {
  const properties = { "AI summary": richTextProp(summary) };
  assertSafeTaskProjectPatch(properties);
  const client = getNotionClient();
  await client.pages.update({
    page_id: pageId,
    properties: properties as never,
  });
}

const COMMENT_CHAR_LIMIT = 4000;

export async function createPageComment(pageId: string, text: string): Promise<void> {
  const safe = redactSecrets(text).slice(0, COMMENT_CHAR_LIMIT);
  const client = getNotionClient();
  await client.comments.create({
    parent: { page_id: pageId },
    rich_text: richTextChunks(safe),
  });
}

export async function queryInboxNotes(): Promise<NotionPage[]> {
  return queryCollection(NOTES_COLLECTION, {
    filter: { property: "Status", select: { equals: "Inbox" } },
  });
}

export async function queryTasks(filter?: unknown): Promise<NotionPage[]> {
  return queryCollection(TASKS_COLLECTION, filter ? { filter } : {});
}

export async function queryProjects(filter?: unknown): Promise<NotionPage[]> {
  return queryCollection(PROJECTS_COLLECTION, filter ? { filter } : {});
}

export async function getTaskById(id: string): Promise<NotionPage> {
  const client = getNotionClient();
  const page = await client.pages.retrieve({ page_id: id });
  if (!isFullPage(page)) {
    return { id, url: "", properties: {}, raw: page };
  }
  return normalizePage(page);
}

export async function getTaskByUrl(url: string): Promise<NotionPage> {
  return getTaskById(parseNotionId(url));
}

export async function getPageByUrlOrId(urlOrId: string): Promise<NotionPage> {
  return getTaskById(parseNotionId(urlOrId));
}

export function parentCollectionId(page: NotionPage): string | null {
  const parent = asRecord(page.parent);
  if (!parent) return null;
  if (typeof parent.data_source_id === "string") return parent.data_source_id;
  if (typeof parent.database_id === "string") return parent.database_id;
  return null;
}

export function summarizeTask(page: NotionPage): Record<string, unknown> {
  return {
    id: page.id,
    url: page.url,
    name: getTitle(page),
    Status: getSelect(page, "Status"),
    Priority: getSelect(page, "Priority"),
    Health: getSelect(page, "Health"),
    "Owner (role)": getSelect(page, "Owner (role)") || getRichText(page, "Owner (role)") || getPeopleNames(page, "Owner (role)").join(", "),
    Assignee: getPeopleNames(page, "Assignee").join(", ") || getRichText(page, "Assignee"),
    Due: getDate(page, "Due"),
    Estimate: getNumber(page, "Estimate") ?? getSelect(page, "Estimate") ?? getRichText(page, "Estimate"),
    Acceptance: getRichText(page, "Acceptance"),
    Blockers: getRichText(page, "Blockers") || getRelationIds(page, "Blockers"),
    "Blocked by": getRelationIds(page, "Blocked by"),
    Blocking: getRelationIds(page, "Blocking"),
    Project: getRelationIds(page, "Project"),
    Type: getSelect(page, "Type"),
    Area: getSelect(page, "Area"),
    "AI summary": getRichText(page, "AI summary"),
  };
}

export function summarizeProject(page: NotionPage): Record<string, unknown> {
  return {
    id: page.id,
    url: page.url,
    name: getTitle(page),
    Status: getSelect(page, "Status"),
    Health: getSelect(page, "Health"),
    "Owner (role)": getSelect(page, "Owner (role)") || getRichText(page, "Owner (role)") || getPeopleNames(page, "Owner (role)").join(", "),
    Owner: getPeopleNames(page, "Owner").join(", ") || getRichText(page, "Owner"),
    Priority: getSelect(page, "Priority"),
    Risks: getRichText(page, "Risks"),
    Target: getDate(page, "Target") || getRichText(page, "Target"),
    Blockers: getRichText(page, "Blockers") || getRelationIds(page, "Blockers"),
    Tasks: getRelationIds(page, "Tasks"),
    "AI summary": getRichText(page, "AI summary"),
  };
}

export function summarizeNote(page: NotionPage, body?: string): Record<string, unknown> {
  return {
    id: page.id,
    url: page.url,
    name: getTitle(page),
    Status: getSelect(page, "Status"),
    Type: getSelect(page, "Type"),
    Tags: getRichText(page, "Tags"),
    Project: getRelationIds(page, "Project"),
    Date: getDate(page, "Date"),
    body: body ?? "",
  };
}
