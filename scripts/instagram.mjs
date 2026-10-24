// Automatic Instagram posts for مدرج هلا (runs in GitHub Actions, see .github/workflows/instagram.yml):
//  - before a big club's match: a match card ("الليلة …، تابعها مباشر في مدرج هلا")
//  - after it: the result card with the star of the match
// Posts only to the app's own Instagram account through the official Instagram API, a few times a day at most.
//
//   node scripts/instagram.mjs plan   -> prints what it would post, writes todo=1/0 to $GITHUB_OUTPUT
//   node scripts/instagram.mjs run    -> renders the cards (needs Playwright), uploads them, publishes
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, IG_USER_ID, IG_TOKEN (first token; refreshed tokens live in the
//      database), DRY_RUN=1 to render and upload without publishing, APP_URL.
import { readFileSync, appendFileSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, IG_USER_ID, IG_TOKEN, DRY_RUN, GITHUB_OUTPUT } = process.env;
const APP_URL = process.env.APP_URL || "mait7amss-web.github.io/Ccvhv";
const IG = "https://graph.instagram.com" + (process.env.IG_API_VERSION ? "/" + process.env.IG_API_VERSION : "");
const MODE = process.argv[2] || "plan";
const dry = DRY_RUN === "1";
const out = (k, v) => { if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `${k}=${v}\n`); };

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!dry && (!IG_USER_ID || !IG_TOKEN)) { console.log("Instagram is not connected yet (IG_USER_ID / IG_TOKEN secrets). Nothing to do."); out("todo", 0); process.exit(0); }

const H = 3600000;
const headers = { apikey: SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
if (!SUPABASE_SERVICE_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
async function api(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 || res.status === 201 ? null : res.json().catch(() => null);
}

const BIG = new Set(["ريال مدريد", "برشلونة", "أتلتيكو مدريد", "مانشستر سيتي", "ليفربول", "أرسنال", "تشيلسي", "مانشستر يونايتد", "توتنهام",
  "بايرن ميونخ", "بوروسيا دورتموند", "باير ليفركوزن", "باريس سان جيرمان", "يوفنتوس", "إنتر", "ميلان", "نابولي"]);
const LEAGUES = { epl: "الدوري الإنجليزي", laliga: "الدوري الإسباني", seriea: "الدوري الإيطالي", bundesliga: "الدوري الألماني", ligue1: "الدوري الفرنسي", ucl: "دوري أبطال أوروبا" };
const TAGS = { epl: "#الدوري_الانجليزي #البريميرليج", laliga: "#الدوري_الاسباني #لاليغا", seriea: "#الدوري_الايطالي", bundesliga: "#الدوري_الالماني #البوندسليغا", ligue1: "#الدوري_الفرنسي", ucl: "#دوري_ابطال_اوروبا #دوري_الابطال" };
// Club colours from the app's list
const COLORS = {};
{
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const m = src.match(/const TEAMS = (\{[\s\S]*?\n\});/);
  if (m) { const T = Function(`return ${m[1]}`)(); for (const lg in T) for (const [, name, color] of T[lg]) COLORS[name] = color; }
  Object.assign(COLORS, { "بوروسيا دورتموند": "#fde100", "باير ليفركوزن": "#e32221", "آينتراخت فرانكفورت": "#e1000f" });
}
const big = (m) => BIG.has(m.home) || BIG.has(m.away);
const both = (m) => BIG.has(m.home) && BIG.has(m.away);
const tag = (t) => "#" + String(t).trim().replace(/\s+/g, "_");

/* ---------- what to post ---------- */
const now = Date.now();
const [upcoming, finished, recent] = await Promise.all([
  api(`matches?kickoff=gt.${new Date(now + 1.5 * H).toISOString()}&kickoff=lt.${new Date(now + 9 * H).toISOString()}&status=not.in.(FINISHED,POSTPONED,CANCELLED)&select=id,channel,home,away,kickoff&order=kickoff.asc`),
  api(`matches?status=eq.FINISHED&kickoff=gt.${new Date(now - 8 * H).toISOString()}&select=id,channel,home,away,kickoff,home_score,away_score,players&order=kickoff.desc`),
  api(`social_posts?created_at=gt.${new Date(now - 24 * H).toISOString()}&select=key,kind`).catch(() => null),
]);
if (recent === null) { console.log("social_posts table missing: run supabase/instagram.sql"); out("todo", 0); process.exit(0); }
const done = new Set(recent.map((r) => r.key));
const allKeys = new Set((await api(`social_posts?select=key&created_at=gt.${new Date(now - 7 * 24 * H).toISOString()}`)).map((r) => r.key));
const count = (k) => recent.filter((r) => r.kind === k).length;
const rank = (m) => (both(m) ? 0 : 1);
const jobs = [];
// At most 2 match previews and 3 results a day, the biggest games first
for (const m of upcoming.filter(big).filter((m) => !allKeys.has("preview:" + m.id)).sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(0, 2 - count("preview")))) jobs.push({ kind: "preview", m });
for (const m of finished.filter(big).filter((m) => m.home_score != null && !allKeys.has("result:" + m.id)).sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(0, 3 - count("result")))) jobs.push({ kind: "result", m });
// One post per run, so the feed never gets a burst
const job = jobs[0];
console.log(`Candidates: ${jobs.map((j) => `${j.kind} ${j.m.home} × ${j.m.away}`).join(" | ") || "none"}`);
out("todo", job ? 1 : 0);
if (MODE === "plan" || !job) process.exit(0);

/* ---------- the card ---------- */
const riyadh = new Intl.DateTimeFormat("ar-SA-u-nu-arab", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" });
const dayName = new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", weekday: "long" });
const m = job.m;
const top = (() => {
  const all = [...(m.players?.home || []), ...(m.players?.away || [])].filter((p) => p.rating);
  return all.sort((a, b) => b.rating - a.rating)[0] || null;
})();
const crest = (name) => { const c = COLORS[name] || "#2fbf5b"; const n = parseInt(c.slice(1), 16); const ink = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150 ? "#111" : "#fff"; return `<div class="crest" style="background:${c};color:${ink}">${name.trim().charAt(0)}</div>`; };
const riyadhHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "numeric", hour12: false }).format(new Date(m.kickoff)));
const sameDay = new Date(m.kickoff).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }) === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const kickDay = sameDay ? (riyadhHour >= 17 || riyadhHour < 4 ? "الليلة" : "اليوم") : dayName.format(new Date(m.kickoff));
const logo = "data:image/png;base64," + readFileSync(new URL("../icon-512.png", import.meta.url)).toString("base64");
const middle = job.kind === "preview"
  ? `<div class="vs">×</div>`
  : `<div class="score">${m.home_score} - ${m.away_score}</div>`;
const sub = job.kind === "preview"
  ? `<div class="when">⏰ ${kickDay} ${riyadh.format(new Date(m.kickoff))} <small>بتوقيت السعودية</small></div><div class="cta">🔴 تابعها مباشر مع الجمهور في مدرج هلا</div>`
  : `${top ? `<div class="star">⭐ نجم المباراة: <bdi><b>${top.name}</b></bdi> <span>${Number(top.rating).toFixed(1)}</span></div>` : ""}<div class="cta">⭐ قيّم اللاعبين وشارك رأيك في مدرج هلا</div>`;
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lalezar&family=Cairo:wght@600;700;800;900&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden;font-family:Cairo,sans-serif;color:#f2f5ff;background:#050b1e}
.stage{position:fixed;left:0;top:0;width:1080px;height:1350px;overflow:hidden}
.bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#17327a 0%,#0a1640 45%,#040a1f 100%)}
.beam{position:absolute;top:-200px;width:380px;height:1800px;background:linear-gradient(180deg,rgba(255,255,240,.22),rgba(255,255,240,0) 70%);filter:blur(24px)}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:70px 60px;text-align:center}
.top{display:flex;align-items:center;gap:20px;font:400 56px Lalezar,sans-serif;color:#2fbf5b}
.top img{width:110px;height:110px;border-radius:50%;box-shadow:0 0 0 5px #2fbf5b}
.league{margin-top:34px;font:800 40px Cairo;color:#c9d4f5;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 34px}
.kind{margin-top:30px;font:400 86px/1.1 Lalezar,sans-serif;text-shadow:0 6px 30px rgba(0,0,0,.6)}
.teams{margin-top:50px;display:flex;align-items:center;justify-content:center;gap:40px;width:100%}
.team{display:flex;flex-direction:column;align-items:center;gap:20px;width:290px;flex:none}
.crest{width:200px;height:200px;border-radius:50%;display:grid;place-items:center;font:400 110px/1 Lalezar,sans-serif;border:7px solid rgba(255,255,255,.92);box-shadow:0 18px 50px rgba(0,0,0,.5)}
.team b{font:900 50px/1.2 Cairo}
.vs{font:400 110px Lalezar,sans-serif;color:#f2b134}
.score{flex:none;white-space:nowrap;font:400 130px/1 Lalezar,sans-serif;direction:rtl;background:rgba(0,0,0,.25);border-radius:30px;padding:16px 30px 6px}
.when{margin-top:50px;font:900 54px Cairo}.when small{font-size:34px;color:#aab8e6;font-weight:700}
.star{margin-top:46px;font:800 46px Cairo}.star span{background:#1d8cf8;border-radius:14px;padding:2px 16px;margin-inline-start:8px}
.cta{margin-top:auto;font:900 44px Cairo;background:#2fbf5b;color:#04150a;border-radius:26px;padding:22px 40px;box-shadow:0 14px 40px rgba(47,191,91,.35)}
.url{margin-top:24px;font:800 32px Cairo;color:#c9d4f5;direction:ltr}
</style></head><body><div class="stage"><div class="bg"></div><div class="beam" style="left:-60px;transform:rotate(-16deg)"></div><div class="beam" style="right:-60px;transform:rotate(16deg)"></div>
<div class="wrap"><div class="top"><img src="${logo}">مدرج هلا</div>
<div class="league">${LEAGUES[m.channel] || "كرة القدم"}</div>
<div class="kind">${job.kind === "preview" ? "مباراة نار 🔥" : "صافرة النهاية 🏁"}</div>
<div class="teams"><div class="team">${crest(m.home)}<b>${m.home}</b></div>${middle}<div class="team">${crest(m.away)}<b>${m.away}</b></div></div>
${sub}<div class="url">${APP_URL}</div></div></div></body></html>`;

const caption = (job.kind === "preview"
  ? `🔥 ${m.home} × ${m.away}\n⏰ ${kickDay} ${riyadh.format(new Date(m.kickoff))} بتوقيت السعودية\n\nتابعها مباشر مع الجمهور في غرف مدرج هلا 🔴 توقّع الفايز ونجم المباراة، وتنافس في دوري المدرج 🏆\n\nالرابط في البايو 👆 مجاني وبالعربي، للشباب والبنات 💚`
  : `🏁 ${m.home} ${m.home_score} - ${m.away_score} ${m.away}${top ? `\n⭐ نجم المباراة: ${top.name} (${Number(top.rating).toFixed(1)})` : ""}\n\nوش تقييمك للاعبين؟ قيّمهم وشارك رأيك في مدرج هلا 🎙️\nالرابط في البايو 👆`)
  + `\n\n${tag(m.home)} ${tag(m.away)} ${TAGS[m.channel] || ""} #كورة #مدرج_هلا`;

/* ---------- render, upload ---------- */
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
await browser.close();
const path = `${job.kind}-${m.id}-${Date.now()}.jpg`;
const up = await fetch(`${SUPABASE_URL}/storage/v1/object/social/${path}`, { method: "POST", headers: { ...headers, "Content-Type": "image/jpeg", "x-upsert": "true" }, body: jpg });
if (!up.ok) { console.error("Upload failed", up.status, await up.text()); process.exit(1); }
const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/social/${path}`;
console.log("Card:", imageUrl);
console.log("Caption:\n" + caption);
if (dry) { console.log("DRY_RUN: not publishing"); process.exit(0); }

/* ---------- Instagram ---------- */
// The token lasts 60 days; refresh it every ~3 weeks and keep the fresh one in the database.
const priv = Object.fromEntries((await api("app_private?key=in.(ig_token,ig_token_at)&select=key,value")).map((r) => [r.key, r.value]));
let token = priv.ig_token || IG_TOKEN;
if (!priv.ig_token_at || now - Number(priv.ig_token_at) > 21 * 24 * H) {
  const r = await fetch(`${IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (j.access_token) {
    token = j.access_token;
    await api("app_private?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ key: "ig_token", value: token }, { key: "ig_token_at", value: String(now) }]) });
    console.log("Instagram token refreshed");
  } else if (priv.ig_token && IG_TOKEN && IG_TOKEN !== priv.ig_token) {
    token = IG_TOKEN;   // the stored one stopped working; fall back to the secret
  }
}
async function ig(path, params) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${IG}/${path}`, { method: "POST", body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${path}: ${r.status} ${JSON.stringify(j.error || j)}`);
  return j;
}
const container = await ig(`${IG_USER_ID}/media`, { image_url: imageUrl, caption });
for (let i = 0; i < 20; i++) {
  const r = await fetch(`${IG}/${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  if (j.status_code === "FINISHED") break;
  if (j.status_code === "ERROR") throw new Error("Instagram could not process the image");
  await new Promise((r) => setTimeout(r, 3000));
}
const pub = await ig(`${IG_USER_ID}/media_publish`, { creation_id: container.id });
await api("social_posts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ key: `${job.kind}:${m.id}`, kind: job.kind, match_id: m.id, media_id: pub.id, image_url: imageUrl }) });
console.log(`Published ${job.kind} for ${m.home} × ${m.away}: ${pub.id}`);
