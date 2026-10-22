// Match push notifications, run after each sync:
//  - reminder ~1 hour before kickoff to people who haven't predicted yet
//  - final score + points to people who predicted, once the result is in
// Also creates the VAPID key pair the first time it runs.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
import webpush from "web-push";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const headers = { apikey: SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
if (!SUPABASE_SERVICE_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;

async function api(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 || opts.method === "DELETE" ? null : res.json().catch(() => null);
}
const inList = (xs) => encodeURIComponent(`(${xs.map((x) => `"${x}"`).join(",")})`);

const LEAGUES = { epl: "الإنجليزي", laliga: "الإسباني", seriea: "الإيطالي", bundesliga: "الألماني", ligue1: "الفرنسي", ucl: "دوري الأبطال" };

// ---------- VAPID keys (created once, stored in the database) ----------
let pub = (await api("app_public?key=eq.vapid_public&select=value"))[0]?.value;
let priv = (await api("app_private?key=eq.vapid_private&select=value"))[0]?.value;
if (!pub || !priv) {
  const keys = webpush.generateVAPIDKeys();
  pub = keys.publicKey; priv = keys.privateKey;
  const upsert = { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" } };
  await api("app_private?on_conflict=key", { ...upsert, body: JSON.stringify([{ key: "vapid_private", value: priv }]) });
  await api("app_public?on_conflict=key", { ...upsert, body: JSON.stringify([{ key: "vapid_public", value: pub }]) });
  console.log("Created push keys");
}
webpush.setVapidDetails("mailto:hala@example.com", pub, priv);

const subs = await api("push_subscriptions?select=endpoint,p256dh,auth,user_id,reminders,results");
if (!subs.length) { console.log("No subscribers"); process.exit(0); }

const now = Date.now();
const isoAt = (ms) => new Date(ms).toISOString();

// Matches starting within the next 75 minutes, and results from the last 36 hours.
const soon = await api(`matches?select=id,channel,home,away,kickoff&kickoff=gt.${isoAt(now)}&kickoff=lt.${isoAt(now + 75 * 60000)}`);
const done = await api(`matches?select=id,channel,home,away,kickoff,home_score,away_score&home_score=not.is.null&away_score=not.is.null&kickoff=gt.${isoAt(now - 36 * 3600000)}`);
const ids = [...soon, ...done].map((m) => m.id);
if (!ids.length) { console.log("Nothing to send"); process.exit(0); }

const preds = await api(`predictions?select=match_id,user_id,home,away&match_id=in.${inList(ids)}`);
const log = await api(`push_log?select=match_id,user_id,kind&match_id=in.${inList(ids)}`);
const logged = new Set(log.map((l) => `${l.match_id}|${l.user_id}|${l.kind}`));
const predOf = (m, u) => preds.find((p) => p.match_id === m && p.user_id === u);

const sign = Math.sign;
const points = (p, m) => (p.home === m.home_score && p.away === m.away_score ? 3 : sign(p.home - p.away) === sign(m.home_score - m.away_score) ? 1 : 0);

// Build one notification per (match, user, kind); every device of that user gets it.
const jobs = [];
const users = [...new Set(subs.map((s) => s.user_id))];
for (const u of users) {
  const mine = subs.filter((s) => s.user_id === u);
  for (const m of soon) {
    if (predOf(m.id, u) || logged.has(`${m.id}|${u}|remind`)) continue;
    const to = mine.filter((s) => s.reminders);
    if (to.length) jobs.push({ m, u, kind: "remind", to, payload: {
      title: `⏰ ${m.home} × ${m.away}`,
      body: `تبدأ خلال ساعة في ${m.channel === "ucl" ? "" : "الدوري "}${LEAGUES[m.channel]}، وللحين ما توقعت!`,
      url: `./?league=${m.channel}&view=pred`, tag: `remind-${m.id}`,
    } });
  }
  for (const m of done) {
    const p = predOf(m.id, u);
    if (!p || logged.has(`${m.id}|${u}|result`)) continue;
    const pts = points(p, m);
    const to = mine.filter((s) => s.results);
    if (to.length) jobs.push({ m, u, kind: "result", to, payload: {
      title: `⚽ انتهت: ${m.home} ${m.home_score} - ${m.away_score} ${m.away}`,
      body: `توقعك ${p.home} - ${p.away}، ` + (pts === 3 ? "جبتها بالضبط! +٣ نقاط 🎯" : pts === 1 ? "جبت النتيجة، +١ نقطة 👍" : "ما ضبطت هالمرة، ٠ نقاط"),
      url: `./?league=${m.channel}&view=pred`, tag: `result-${m.id}`,
    } });
  }
}

const dead = new Set();
let sent = 0;
for (const j of jobs) {
  for (const s of j.to) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(j.payload), { TTL: 3 * 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.add(s.endpoint);
      else console.error("push failed", e.statusCode || e.message);
    }
  }
}
if (jobs.length) {
  await api("push_log?on_conflict=match_id,user_id,kind", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(jobs.map((j) => ({ match_id: j.m.id, user_id: j.u, kind: j.kind }))),
  });
}
if (dead.size) await api(`push_subscriptions?endpoint=in.${inList([...dead])}`, { method: "DELETE" });
console.log(`Notifications: ${jobs.length} to send, ${sent} delivered, ${dead.size} expired devices removed`);
