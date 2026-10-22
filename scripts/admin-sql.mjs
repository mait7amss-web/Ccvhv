// Runs SQL against the project through the Supabase management API and prints the result.
// Used by the "Admin SQL" workflow for maintenance tasks.
// A query of the form "file:supabase/x.sql" runs that file from the repo.
import { readFileSync } from "node:fs";
const { SUPABASE_ACCESS_TOKEN: TOKEN, PROJECT_REF: REF } = process.env;
let QUERY = process.env.QUERY;
if (QUERY.startsWith("file:")) {
  const path = QUERY.slice(5).trim();
  if (!/^supabase\/[\w-]+\.sql$/.test(path)) { console.log("bad file path"); process.exit(1); }
  QUERY = readFileSync(path, "utf8");
  console.log("running", path);
}
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});
console.log("status", r.status);
console.log(await r.text());
if (!r.ok) process.exit(1);
