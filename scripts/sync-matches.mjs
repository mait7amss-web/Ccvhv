// Pulls fixtures and results for the five big leagues from football-data.org
// and upserts them into the Supabase `matches` table. Runs on a schedule in
// GitHub Actions (see .github/workflows/sync-matches.yml).
//
// Env:
//   FOOTBALL_DATA_TOKEN   football-data.org API token
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY  Supabase secret (service_role) key — bypasses RLS

const { FOOTBALL_DATA_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
for (const [k, v] of Object.entries({ FOOTBALL_DATA_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}

// football-data.org competition code -> app channel id
const COMPETITIONS = { PL: "epl", PD: "laliga", SA: "seriea", BL1: "bundesliga", FL1: "ligue1" };
const DAYS_BACK = 3;   // catch late results
const DAYS_AHEAD = 7;  // free tier allows a 10-day window per request

// Arabic names for well-known clubs (keyed by football-data team id); others keep the API short name.
const AR = {
  57: "أرسنال", 58: "أستون فيلا", 61: "تشيلسي", 64: "ليفربول", 65: "مانشستر سيتي", 66: "مانشستر يونايتد",
  67: "نيوكاسل", 73: "توتنهام", 62: "إيفرتون", 563: "وست هام", 354: "كريستال بالاس", 397: "برايتون",
  402: "برينتفورد", 351: "نوتنغهام فورست", 76: "وولفرهامبتون", 63: "فولهام", 1044: "بورنموث",
  86: "ريال مدريد", 81: "برشلونة", 78: "أتلتيكو مدريد", 559: "إشبيلية", 92: "ريال سوسيداد", 90: "ريال بيتيس",
  77: "أتلتيك بلباو", 94: "فياريال", 95: "فالنسيا", 558: "سيلتا فيغو", 79: "أوساسونا", 82: "خيتافي", 89: "مايوركا",
  109: "يوفنتوس", 108: "إنتر", 98: "ميلان", 113: "نابولي", 100: "روما", 110: "لاتسيو", 102: "أتالانتا",
  99: "فيورنتينا", 103: "بولونيا", 586: "تورينو", 115: "أودينيزي", 107: "جنوى",
  5: "بايرن ميونخ", 4: "بوروسيا دورتموند", 3: "باير ليفركوزن", 721: "لايبزيغ", 19: "آينتراخت فرانكفورت",
  10: "شتوتغارت", 18: "مونشنغلادباخ", 11: "فولفسبورغ", 17: "فرايبورغ", 2: "هوفنهايم", 12: "فيردر بريمن", 1: "كولن",
  524: "باريس سان جيرمان", 516: "مارسيليا", 523: "ليون", 548: "موناكو", 521: "ليل", 522: "نيس", 546: "لانس",
  529: "رين", 576: "ستراسبورغ", 543: "نانت", 512: "بريست", 533: "لوهافر",
};
const teamName = (t) => (AR[t.id] || t.shortName || t.name || "؟").slice(0, 40);

const iso = (d) => d.toISOString().slice(0, 10);
const now = new Date();
const from = new Date(now.getTime() - DAYS_BACK * 86400000);
const to = new Date(now.getTime() + DAYS_AHEAD * 86400000);

// New-style Supabase secret keys (sb_secret_...) go in the apikey header only;
// legacy service_role JWTs also go in Authorization.
const sbHeaders = { apikey: SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
if (!SUPABASE_SERVICE_KEY.startsWith("sb_")) sbHeaders.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchCompetition(code) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?dateFrom=${iso(from)}&dateTo=${iso(to)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "X-Auth-Token": FOOTBALL_DATA_TOKEN } });
    if (res.status === 429) { await sleep(65000); continue; } // free tier: 10 requests/minute
    if (!res.ok) throw new Error(`${code}: football-data ${res.status} ${await res.text()}`);
    return (await res.json()).matches || [];
  }
  throw new Error(`${code}: rate limited`);
}

function toRow(m, channel) {
  const finished = m.status === "FINISHED";
  const ft = m.score?.fullTime || {};
  return {
    external_id: m.id,
    channel,
    created_by: null,
    home: teamName(m.homeTeam),
    away: teamName(m.awayTeam),
    kickoff: m.utcDate,
    status: m.status,
    // Only store a score once the match is over, so points aren't handed out mid-game.
    home_score: finished && Number.isInteger(ft.home) ? ft.home : null,
    away_score: finished && Number.isInteger(ft.away) ? ft.away : null,
  };
}

async function upsert(rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/matches?on_conflict=external_id`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${await res.text()}`);
}

let failed = false;
for (const [code, channel] of Object.entries(COMPETITIONS)) {
  try {
    const matches = await fetchCompetition(code);
    // Skip fixtures whose teams aren't decided yet.
    const rows = matches.filter((m) => m.homeTeam?.id && m.awayTeam?.id).map((m) => toRow(m, channel));
    await upsert(rows);
    console.log(`${code}: ${rows.length} matches synced`);
    const teams = new Map();
    for (const m of matches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id) teams.set(t.id, `${t.id} ${t.shortName} -> ${teamName(t)}`);
    console.log("  teams: " + [...teams.values()].join(" | "));
  } catch (e) {
    failed = true;
    console.error(e.message);
  }
}
if (failed) process.exit(1);
