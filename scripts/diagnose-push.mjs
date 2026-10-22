// One-off push diagnostics. Read-only except for a test notification sent to admins' devices.
// Env: SUPABASE_ACCESS_TOKEN (management API), PROJECT_REF
import webpush from "web-push";
const { SUPABASE_ACCESS_TOKEN: TOKEN, PROJECT_REF: REF } = process.env;

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) return { error: `${r.status} ${t.slice(0, 300)}` };
  try { return JSON.parse(t); } catch { return t; }
}
const show = (label, v) => console.log(`\n=== ${label} ===\n` + (typeof v === "string" ? v : JSON.stringify(v, null, 1)));

show("subscriptions", await sql(`select p.name, s.reminders, s.results, s.leagues, split_part(split_part(s.endpoint,'//',2),'/',1) as push_host, s.created_at
  from public.push_subscriptions s join public.profiles p on p.id = s.user_id order by s.created_at desc limit 30`));
show("keys present", await sql(`select 'private:'||key as k from public.app_private union all select 'public:'||key from public.app_public`));
show("trigger", await sql(`select tgname, tgenabled from pg_trigger where tgname = 'on_message_notify'`));
show("pg_net extension", await sql(`select extname, extversion from pg_extension where extname = 'pg_net'`));
show("recent function calls (pg_net responses)", await sql(`select id, status_code, left(content::text, 160) as content, error_msg, created from net._http_response order by id desc limit 12`));
show("recent messages", await sql(`select m.id, p.name, m.channel, m.created_at from public.messages m join public.profiles p on p.id = m.user_id order by m.id desc limit 6`));
show("admins", await sql(`select p.name from public.admins a join public.profiles p on p.id = a.user_id`));

// Direct test push to admins' devices
const keys = await sql(`select key, value from public.app_private where key = 'vapid_private' union all select key, value from public.app_public where key = 'vapid_public'`);
const pub = Array.isArray(keys) ? keys.find(k => k.key === "vapid_public")?.value : null;
const priv = Array.isArray(keys) ? keys.find(k => k.key === "vapid_private")?.value : null;
if (!pub || !priv) { show("test push", "skipped: VAPID keys missing"); process.exit(0); }
webpush.setVapidDetails("mailto:hala@example.com", pub, priv);
const subs = await sql(`select s.endpoint, s.p256dh, s.auth, p.name from public.push_subscriptions s join public.profiles p on p.id = s.user_id where s.user_id in (select user_id from public.admins)`);
if (!Array.isArray(subs) || !subs.length) { show("test push", "no subscriptions for admin accounts"); process.exit(0); }
for (const s of subs) {
  try {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ title: "🔔 تجربة إشعار", body: "إذا وصلك هذا، الإشعارات شغالة على جهازك ✅", url: "./", tag: "test" }), { TTL: 600 });
    show("test push → " + s.name, `status ${r.statusCode}`);
  } catch (e) {
    show("test push → " + s.name, `FAILED status ${e.statusCode} ${String(e.body || e.message).slice(0, 200)}`);
  }
}
