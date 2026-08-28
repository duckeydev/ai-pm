import { DEFAULT_OPENROUTER_MODEL } from "@/lib/hq";

/** Lazy env reads — never throw at module import / build time. */

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  return key;
}

export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
}

export function getNotionToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN is not set");
  }
  return token;
}

export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}

export function getAppReferer(): string {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "https://github.com/duckeydev/ai-pm";
}

export function getAppTitle(): string {
  return "ai-pm";
}
