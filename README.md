# ai-pm

Small Next.js App Router service that runs HQ AI jobs against Notion via OpenRouter.

Jobs never change Task/Project **Status** or **Health**. They never write the OpenRouter API key into Notion. HQ collection IDs live in `lib/hq.ts` (not env). Existing Notion databases are not recreated.

## Env

Copy `.env.example` and set values in Vercel (or locally). Never commit `.env`.

| Name | Required | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes (runtime) | Never logged; redacted from Prompt / Output / Error |
| `OPENROUTER_MODEL` | no | Default `openai/gpt-4.1-mini` |
| `NOTION_TOKEN` | yes (runtime) | Existing The Place integration |
| `CRON_SECRET` | yes (jobs) | Bearer token for `/api/jobs/*`. Vercel Cron sends this automatically when set |

## HQ collections

Constants in `lib/hq.ts`:

- Tasks `771fe81c-9775-4ba1-a77a-1785baaaee5e`
- Projects `46606c59-7916-4bc9-a1d4-29145d87244f`
- Notes `52f5a3c1-42f7-49e7-8436-5edda2dd607d`
- AI Runs `c1861411-5fb8-4319-b9d9-78cb5be7c64c`

Database page IDs (docs only): Tasks `1f8ac0f744d54476aef030cb54d4a24e`, Projects `86691cc938614d4089c64548c30815ea`, AI Runs `0981a84afa154122b3ae46c60877a732`, Dashboard `34f24a9c3b1b80aa8222e1a4df7d374f`.

## Jobs

All jobs POST and require `Authorization: Bearer $CRON_SECRET`.

Every run writes an **AI Runs** row: Queued to Running to Done (or Error). Related Task/Project **AI summary** is patched after success only.

| Job | Kind | What it does |
| --- | --- | --- |
| `/api/jobs/triage` | Triage | Inbox notes: file-as Task / Note / Decision / dump. Does not change Note Status |
| `/api/jobs/breakdown` | Breakdown | Task URL to proposed subtasks with Estimate / Priority / Acceptance. Does not create pages |
| `/api/jobs/standup` | Standup | Markdown digest of Not started / In progress, blockers, Health Red/Amber, Due this week |
| `/api/jobs/risk` | Risk scan | Overdue, blocked, no owner, P0 not In progress |
| `/api/jobs/rewrite` | Rewrite | Messy notes to status update |

Cron (UTC, Asia/Rangoon = UTC+6:30):

- Standup weekdays 08:30 Rangoon = `0 2 * * 1-5`
- Risk weekdays 17:00 Rangoon = `30 10 * * 1-5`

## curl

Replace `$HOST` with the deployment URL.

```bash
export CRON_SECRET=your-cron-secret
export HOST=https://example.vercel.app

curl -sS -X POST "$HOST/api/jobs/triage" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -sS -X POST "$HOST/api/jobs/breakdown" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"taskUrl":"https://www.notion.so/...."}'

curl -sS -X POST "$HOST/api/jobs/standup" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -sS -X POST "$HOST/api/jobs/risk" \
  -H "Authorization: Bearer $CRON_SECRET"

curl -sS -X POST "$HOST/api/jobs/rewrite" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text":"wip: blocked on api, will retry tomorrow"}'

curl -sS -X POST "$HOST/api/jobs/rewrite" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"pageUrl":"https://www.notion.so/...."}'
```

## Scripts

- `dev` — Next.js dev server
- `build` — production build (does not require secrets; env is read lazily)
- `start` — start production server
- `test` — Vitest
