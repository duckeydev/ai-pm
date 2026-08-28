export const dynamic = "force-dynamic";

const JOBS = [
  { method: "POST", path: "/api/jobs/triage", body: "—" },
  { method: "POST", path: "/api/jobs/breakdown", body: '{ "taskUrl": "<notion task url>" }' },
  { method: "POST", path: "/api/jobs/standup", body: "—" },
  { method: "POST", path: "/api/jobs/risk", body: "—" },
  { method: "POST", path: "/api/jobs/rewrite", body: '{ "text"?: string, "pageUrl"?: string }' },
] as const;

export default function Home() {
  const env = {
    OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini (default)",
    NOTION_TOKEN: Boolean(process.env.NOTION_TOKEN),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
  };

  return (
    <main>
      <h1>ai-pm</h1>
      <p>status: ok</p>
      <p className="muted">HQ job runner. Auth: Authorization Bearer CRON_SECRET.</p>

      <h2>Jobs</h2>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Path</th>
            <th>JSON body</th>
          </tr>
        </thead>
        <tbody>
          {JOBS.map((job) => (
            <tr key={job.path}>
              <td>{job.method}</td>
              <td>
                <code>{job.path}</code>
              </td>
              <td>
                <code>{job.body}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Cron (UTC)</h2>
      <ul>
        <li>
          <code>standup</code> weekdays 02:00 UTC (08:30 Asia/Rangoon)
        </li>
        <li>
          <code>risk</code> weekdays 10:30 UTC (17:00 Asia/Rangoon)
        </li>
      </ul>

      <h2>Env (presence only)</h2>
      <ul>
        <li>OPENROUTER_API_KEY: {env.OPENROUTER_API_KEY ? "set" : "missing"}</li>
        <li>OPENROUTER_MODEL: {env.OPENROUTER_MODEL}</li>
        <li>NOTION_TOKEN: {env.NOTION_TOKEN ? "set" : "missing"}</li>
        <li>CRON_SECRET: {env.CRON_SECRET ? "set" : "missing"}</li>
      </ul>
    </main>
  );
}
