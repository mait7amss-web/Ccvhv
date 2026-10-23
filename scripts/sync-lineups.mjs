// API-Football link-up, run every 30 minutes from GitHub Actions:
//  - matches each of our fixtures (from football-data.org) in the next 36 hours to an API-Football
//    fixture id, once (a handful of calls a day)
//  - pushes "the lineup is out" to fans of either club and to people who predicted the match
// The live data itself (score, minute, events, lineups, stats) is fetched every minute by the
// live-sync edge function (supabase/functions/live-sync), paced to the plan's daily limit.
// Env: API_FOOTBALL_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY. Skips quietly when the key is missing.
import webpush from "web-push";
import { AR, FAV_TO_FD } from "./teams.mjs";

const { API_FOOTBALL_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!API_FOOTBALL_KEY) { console.log("No API_FOOTBALL_KEY, skipping lineups"); process.exit(0); }

const LEAGUE_ID = { epl: 39, laliga: 140, seriea: 135, bundesliga: 78, ligue1: 61, ucl: 2 };
const H = 3600000, now = Date.now();

const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
if (!SUPABASE_SERVICE_KEY.startsWith("sb_")) sbHeaders.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, ...opts.headers } });
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
let apiCalls = 0;
async function api(path) {
  apiCalls++;
  const r = await fetch(`https://v3.football.api-sports.io/${path}`, { headers: { "x-apisports-key": API_FOOTBALL_KEY } });
  const j = await r.json();
  if (j.errors?.plan) { console.log("API-Football plan doesn't cover this (free plans skip the current season):", j.errors.plan); process.exit(0); }
  if (j.errors && Object.keys(j.errors).length) throw new Error(`API-Football ${path}: ${JSON.stringify(j.errors)}`);
  return j.response || [];
}
const iso = (ms) => new Date(ms).toISOString();
const enc = encodeURIComponent;

// Plan check (the status endpoint doesn't count against the quota)
try {
  const st = await (await fetch("https://v3.football.api-sports.io/status", { headers: { "x-apisports-key": API_FOOTBALL_KEY } })).json();
  const r = st.response || {};
  console.log(`API-Football plan: ${r.subscription?.plan ?? "?"} · active: ${r.subscription?.active ?? "?"} · used today: ${r.requests?.current ?? "?"}/${r.requests?.limit_day ?? "?"}` + (st.errors && Object.keys(st.errors).length ? ` · errors: ${JSON.stringify(st.errors)}` : ""));
} catch (e) { console.log("status check failed", e.message); }

// Matches from 3h ago to 36h ahead
let matches;
try {
  matches = await db(`matches?select=id,channel,home,away,home_en,away_en,kickoff,status,api_fixture_id,lineups,events&kickoff=gt.${enc(iso(now - 3 * H))}&kickoff=lt.${enc(iso(now + 36 * H))}`);
} catch (e) {
  console.log("Lineup columns missing (run supabase/tactics.sql):", e.message.slice(0, 200)); process.exit(0);
}

// Same mapping as supabase/functions/live-sync: one API-Football fixture -> our match columns.
function fixturePatch(fx) {
  const homeId = fx.teams?.home?.id;
  const sideOf = (id) => (id === homeId ? "home" : "away");
  const patch = { live_at: iso(Date.now()) };
  const gh = fx.goals?.home, ga = fx.goals?.away;
  if (Number.isInteger(gh) && Number.isInteger(ga)) { patch.live_home = gh; patch.live_away = ga; }
  if (Number.isInteger(fx.fixture?.status?.elapsed)) patch.minute = fx.fixture.status.elapsed;
  if (Array.isArray(fx.events)) patch.events = fx.events.map((e) => ({ min: e.time?.elapsed, extra: e.time?.extra || null, side: sideOf(e.team?.id), type: e.type, detail: e.detail, player: e.player?.name || null, assist: e.assist?.name || null }));
  if (Array.isArray(fx.lineups) && fx.lineups.length === 2) {
    const pl = (x) => ({ name: x.player?.name, number: x.player?.number, pos: x.player?.pos, grid: x.player?.grid });
    const side = (t) => ({ team: t.team?.name, formation: t.formation, coach: t.coach?.name || null, xi: (t.startXI || []).map(pl), subs: (t.substitutes || []).map(pl) });
    const [h, a] = fx.lineups[0].team?.id === homeId ? [fx.lineups[0], fx.lineups[1]] : [fx.lineups[1], fx.lineups[0]];
    patch.lineups = { home: side(h), away: side(a), fetched_at: iso(Date.now()) };
  }
  if (Array.isArray(fx.statistics) && fx.statistics.length === 2) {
    const st = { home: {}, away: {} };
    for (const t of fx.statistics) for (const x of t.statistics || []) st[sideOf(t.team?.id)][x.type] = x.value;
    patch.stats = st;
  }
  if (Array.isArray(fx.players) && fx.players.length) {
    const all = { home: [], away: [] };
    for (const t of fx.players) all[sideOf(t.team?.id)] = (t.players || [])
      .map((x) => ({ name: x.player?.name, rating: Number(x.statistics?.[0]?.games?.rating) || 0, min: x.statistics?.[0]?.games?.minutes || 0 }))
      .filter((x) => x.rating > 0).sort((a, b) => b.rating - a.rating);
    patch.players = all;
  }
  return patch;
}

// ---- 1. find API-Football fixture ids ----
const STOP = new Set(["fc", "cf", "afc", "ac", "as", "sc", "ssc", "club", "de", "calcio", "ss", "rc", "ogc", "sv", "vfb", "vfl", "tsg", "bv", "hsc", "us", "cd", "ud", "rcd", "sd", "ca", "real", "1", "fsv", "and"]);
const tokens = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
function sim(a, b) {
  const A = tokens(a), B = tokens(b);
  let s = 0;
  for (const x of A) for (const y of B) if (x === y || (x.length >= 5 && y.startsWith(x.slice(0, 5)))) s++;
  return s;
}
const season = (d) => (d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
const fixturesCache = new Map();
async function fixturesFor(channel, day) {
  const key = channel + day;
  if (!fixturesCache.has(key)) fixturesCache.set(key, await api(`fixtures?league=${LEAGUE_ID[channel]}&season=${season(new Date(day))}&date=${day}`));
  return fixturesCache.get(key);
}
// Unmatched games far from kickoff are retried every 6 hours only, to save the daily quota.
const retryNow = process.env.FORCE_MATCH === "1" || (new Date().getUTCHours() % 6 === 0 && new Date().getUTCMinutes() < 30);
async function linkFixture(m) {
  const day = m.kickoff.slice(0, 10);
  const list = (await fixturesFor(m.channel, day)).filter((f) => Math.abs(new Date(f.fixture.date) - new Date(m.kickoff)) <= 20 * 60000);
  let best = null, bestScore = -1;
  for (const f of list) {
    const s = sim(m.home_en, f.teams.home.name) + sim(m.away_en, f.teams.away.name);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  if (best && (bestScore > 0 || list.length === 1)) {
    m.api_fixture_id = best.fixture.id; m._fx = best;
    console.log(`matched ${m.home_en} v ${m.away_en} -> ${best.teams.home.name} v ${best.teams.away.name} (${best.fixture.id})`);
  } else console.log(`no fixture match for ${m.home_en} v ${m.away_en}`);
}
for (const m of matches) {
  if (m.api_fixture_id) continue;
  if (new Date(m.kickoff).getTime() - now > 2 * H && !retryNow) continue;
  await linkFixture(m);
}

// ---- 2. save the new fixture ids ----
for (const m of matches) {
  if (!m._fx) continue;
  await db(`matches?id=eq.${m.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_fixture_id: m.api_fixture_id }) });
}

// ---- 2b. finished matches of the last 7 days that never got live data: fetch it once ----
// (lineups, events, stats, every player's rating). live_at marks a match as done, found or not.
let past = [];
try {
  past = await db(`matches?select=id,channel,home_en,away_en,kickoff,api_fixture_id&home_score=not.is.null&live_at=is.null&kickoff=gt.${enc(iso(now - 7 * 24 * H))}&kickoff=lt.${enc(iso(now - 2 * H))}&order=kickoff.desc&limit=80`);
} catch (e) { console.log("backfill skipped:", e.message.slice(0, 120)); }
for (const m of past) if (!m.api_fixture_id) await linkFixture(m);
const pastIds = past.filter((m) => m.api_fixture_id).map((m) => m.api_fixture_id);
const pastByFx = new Map(past.map((m) => [Number(m.api_fixture_id), m]));
for (let i = 0; i < pastIds.length; i += 20) {
  for (const fx of await api(`fixtures?ids=${pastIds.slice(i, i + 20).join("-")}`)) {
    const m = pastByFx.get(Number(fx.fixture?.id)); if (!m) continue;
    await db(`matches?id=eq.${m.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ api_fixture_id: m.api_fixture_id, ...fixturePatch(fx) }) });
    m._done = true;
  }
}
for (const m of past) if (!m._done) await db(`matches?id=eq.${m.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ live_at: iso(now) }) });
if (past.length) console.log(`Backfilled ${past.filter((m) => m._done).length} of ${past.length} finished matches`);
console.log(`API-Football calls this run: ${apiCalls}`);

// ---- 3. "lineup is out" notifications ----
// Lineups that are out for matches not started yet (filled in by live-sync); push_log stops repeats.
const newLineups = matches.filter((m) => m.lineups && new Date(m.kickoff).getTime() > now - 15 * 60000);
if (!newLineups.length) process.exit(0);
const pub = (await db("app_public?key=eq.vapid_public&select=value"))[0]?.value;
const priv = (await db("app_private?key=eq.vapid_private&select=value"))[0]?.value;
if (!pub || !priv) process.exit(0);
webpush.setVapidDetails("mailto:hala@example.com", pub, priv);
const subs = await db("push_subscriptions?select=endpoint,p256dh,auth,user_id,results");
if (!subs.length) process.exit(0);
const userIds = [...new Set(subs.map((s) => s.user_id))];
const profiles = await db(`profiles?select=id,team&id=in.${enc(`(${userIds.join(",")})`)}`);
const favName = Object.fromEntries(profiles.map((p) => [p.id, p.team ? AR[FAV_TO_FD[p.team]] : null]));
const ids = newLineups.map((m) => m.id);
const preds = await db(`predictions?select=match_id,user_id&match_id=in.${enc(`(${ids.join(",")})`)}`);
const sent = new Set((await db(`push_log?select=match_id,user_id&kind=eq.lineup&match_id=in.${enc(`(${ids.join(",")})`)}`)).map((l) => `${l.match_id}|${l.user_id}`));
const logRows = [];
for (const m of newLineups) {
  const lu = m.lineups || {};
  for (const u of userIds) {
    const fan = favName[u] && (favName[u] === m.home || favName[u] === m.away);
    const predicted = preds.some((p) => p.match_id === m.id && p.user_id === u);
    if (!(fan || predicted) || sent.has(`${m.id}|${u}`)) continue;
    const payload = JSON.stringify({
      title: `📋 التشكيلة الرسمية: ${m.home} × ${m.away}`,
      body: "نزلت التشكيلة! شوفها وحلّلها مع الشلة قبل صافرة البداية.",
      url: `./?league=${m.channel}&view=pred`, tag: `lineup-${m.id}`,
    });
    for (const s of subs.filter((x) => x.user_id === u)) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); }
      catch (e) { console.error("push failed", e.statusCode); }
    }
    logRows.push({ match_id: m.id, user_id: u, kind: "lineup" });
  }
}
if (logRows.length) await db("push_log?on_conflict=match_id,user_id,kind", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(logRows) });
console.log(`Lineup notifications: ${logRows.length}`);
