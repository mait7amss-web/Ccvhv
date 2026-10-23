// Live score, minute, events, lineups, stats and every player's rating from API-Football.
// Called every minute by pg_cron (supabase/livefeed.sql). It only calls the provider when a
// match with a known API-Football id is near or in play, and paces itself to the plan:
// on the free plan (100 calls/day) every 15 minutes during play, on paid plans every minute.
// Fixture ids are matched by scripts/sync-lineups.mjs in GitHub Actions.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const KEY = Deno.env.get("API_FOOTBALL_KEY") || "";
const MIN = 60000;

async function getPrivate(keys: string[]) {
  const { data } = await sb.from("app_private").select("key,value").in("key", keys);
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}
const setPrivate = (key: string, value: string) => sb.from("app_private").upsert({ key, value }, { onConflict: "key" });

const STATUS: Record<string, string> = {
  TBD: "TIMED", NS: "TIMED", "1H": "IN_PLAY", "2H": "IN_PLAY", ET: "IN_PLAY", BT: "IN_PLAY", P: "IN_PLAY", LIVE: "IN_PLAY", INT: "IN_PLAY",
  HT: "PAUSED", FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED", PST: "POSTPONED", SUSP: "SUSPENDED", CANC: "CANCELLED", ABD: "CANCELLED", AWD: "FINISHED", WO: "FINISHED",
};

// deno-lint-ignore no-explicit-any
type Fx = any;

Deno.serve(async (req) => {
  const priv = await getPrivate(["hook_secret", "live_last_call", "api_daily_limit"]);
  if (!priv.hook_secret || req.headers.get("x-hala-secret") !== priv.hook_secret) return new Response("forbidden", { status: 403 });
  if (!KEY) return new Response("no API_FOOTBALL_KEY yet", { status: 200 });

  const now = Date.now();
  const { data: rows } = await sb.from("matches")
    .select("id,channel,home,away,kickoff,status,api_fixture_id,live_home,live_away,lineups,live_at")
    .not("api_fixture_id", "is", null)
    .gt("kickoff", new Date(now - 170 * MIN).toISOString())
    .lt("kickoff", new Date(now + 70 * MIN).toISOString());
  const todo = (rows || []).filter((m) => !(m.status === "FINISHED" && m.live_at) && !(new Date(m.kickoff).getTime() > now && m.lineups));
  if (!todo.length) return new Response("nothing near", { status: 200 });

  // Pace to the plan
  const limit = Number(priv.api_daily_limit) || 100;
  const live = todo.some((m) => new Date(m.kickoff).getTime() <= now);
  const every = live ? (limit <= 100 ? 15 * MIN : limit <= 7500 ? MIN : 30000) : (limit <= 100 ? 30 * MIN : 5 * MIN);
  if (now - Number(priv.live_last_call || 0) < every - 5000) return new Response("waiting", { status: 200 });
  await setPrivate("live_last_call", String(now));

  const byFx = new Map(todo.map((m) => [Number(m.api_fixture_id), m]));
  const ids = [...byFx.keys()];
  let updated = 0, goals = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const r = await fetch(`https://v3.football.api-sports.io/fixtures?ids=${ids.slice(i, i + 20).join("-")}`, { headers: { "x-apisports-key": KEY } });
    const lim = r.headers.get("x-ratelimit-requests-limit");
    if (lim && lim !== String(limit)) await setPrivate("api_daily_limit", lim);
    const j = await r.json().catch(() => ({}));
    if (j.errors && Object.keys(j.errors).length) return new Response("provider error " + JSON.stringify(j.errors), { status: 200 });
    for (const fx of (j.response || []) as Fx[]) {
      const m = byFx.get(Number(fx.fixture?.id)); if (!m) continue;
      const homeId = fx.teams?.home?.id;
      const sideOf = (teamId: number) => (teamId === homeId ? "home" : "away");
      const short = fx.fixture?.status?.short || "";
      const patch: Record<string, unknown> = { live_at: new Date().toISOString() };
      if (STATUS[short]) patch.status = STATUS[short];
      const gh = fx.goals?.home, ga = fx.goals?.away;
      const started = !["TBD", "NS", "PST", "CANC"].includes(short);
      if (started && Number.isInteger(gh) && Number.isInteger(ga)) { patch.live_home = gh; patch.live_away = ga; }
      if (Number.isInteger(fx.fixture?.status?.elapsed)) patch.minute = fx.fixture.status.elapsed + (fx.fixture.status.extra || 0);
      if (short === "FT" && Number.isInteger(gh) && Number.isInteger(ga)) { patch.home_score = gh; patch.away_score = ga; }

      if (Array.isArray(fx.events)) {
        patch.events = fx.events.map((e: Fx) => ({
          min: e.time?.elapsed, extra: e.time?.extra || null, side: sideOf(e.team?.id),
          type: e.type, detail: e.detail, player: e.player?.name || null, assist: e.assist?.name || null,
        }));
      }
      if (Array.isArray(fx.lineups) && fx.lineups.length === 2) {
        const p = (x: Fx) => ({ name: x.player?.name, number: x.player?.number, pos: x.player?.pos, grid: x.player?.grid });
        const side = (t: Fx) => ({ team: t.team?.name, formation: t.formation, coach: t.coach?.name || null, xi: (t.startXI || []).map(p), subs: (t.substitutes || []).map(p) });
        const [h, a] = fx.lineups[0].team?.id === homeId ? [fx.lineups[0], fx.lineups[1]] : [fx.lineups[1], fx.lineups[0]];
        patch.lineups = { home: side(h), away: side(a), fetched_at: new Date().toISOString() };
      }
      if (Array.isArray(fx.statistics) && fx.statistics.length === 2) {
        const stats: Record<string, Record<string, unknown>> = { home: {}, away: {} };
        for (const t of fx.statistics) for (const s of t.statistics || []) stats[sideOf(t.team?.id)][s.type] = s.value;
        patch.stats = stats;
      }
      if (Array.isArray(fx.players) && fx.players.length) {
        const best: Record<string, unknown[]> = { home: [], away: [] };
        for (const t of fx.players) {
          best[sideOf(t.team?.id)] = (t.players || [])
            .map((x: Fx) => ({ name: x.player?.name, rating: Number(x.statistics?.[0]?.games?.rating) || 0, min: x.statistics?.[0]?.games?.minutes || 0 }))
            .filter((x: { rating: number }) => x.rating > 0)
            .sort((a: { rating: number }, b: { rating: number }) => b.rating - a.rating);
        }
        patch.players = best;
      }
      await sb.from("matches").update(patch).eq("id", m.id);
      updated++;

      // Official goals → push (same path as crowd goals). Only when we saw the score before,
      // so joining a match late doesn't send a burst.
      if (m.live_home != null && m.live_away != null && patch.live_home != null) {
        for (const [side, before, after] of [["home", m.live_home, gh], ["away", m.live_away, ga]] as const) {
          for (let k = before; k < after; k++) {
            const last = [...(fx.events || [])].reverse().find((e: Fx) => e.type === "Goal" && e.detail !== "Missed Penalty" && sideOf(e.team?.id) === side);
            const scorer = last?.player?.name ? last.player.name + (last.detail === "Own Goal" ? " (عكسي)" : last.detail === "Penalty" ? " (بلنتي)" : "") : null;
            await sb.from("crowd_events").insert({ match_id: m.id, kind: "official", side, minute: patch.minute ?? null, scorer });
            goals++;
          }
        }
      }
    }
  }
  return new Response(`updated ${updated}, goals ${goals}`, { status: 200 });
});
