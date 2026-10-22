// Runs one SQL statement against the project through the Supabase management API and prints the result.
// Used by the "Admin SQL" workflow for maintenance tasks.
const { SUPABASE_ACCESS_TOKEN: TOKEN, PROJECT_REF: REF, QUERY } = process.env;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});
console.log("status", r.status);
console.log(await r.text());
if (!r.ok) process.exit(1);
