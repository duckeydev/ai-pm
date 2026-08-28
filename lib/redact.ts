const PLACEHOLDER = "[REDACTED]";

/** Strip secrets from any string that might be written to Notion. */
export function redactSecrets(value: string | undefined | null): string {
  if (!value) return value ?? "";
  let out = value;
  const secrets = [
    process.env.OPENROUTER_API_KEY,
    process.env.NOTION_TOKEN,
    process.env.CRON_SECRET,
  ];
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      out = out.split(secret).join(PLACEHOLDER);
    }
  }
  return out;
}
