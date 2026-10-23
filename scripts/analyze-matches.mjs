// محلل هلا: after each finished match, the official account posts a short analysis in Gulf Arabic,
// written by Claude from the real match data (score, events, stats, player ratings).
// Run after each sync in GitHub Actions. Quietly does nothing until ANTHROPIC_API_KEY is set.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
import Anthropic from "@anthropic-ai/sdk";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.log("No ANTHROPIC_API_KEY yet, skipping the analyst"); process.exit(0); }

const OFFICIAL = "a1a1a1a1-0000-4000-8000-000000000001";
const MAX_PER_RUN = 6;
const headers = { apikey: SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
if (!SUPABASE_SERVICE_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`;
async function api(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const LEAGUES = { epl: "الدوري الإنجليزي", laliga: "الدوري الإسباني", seriea: "الدوري الإيطالي", bundesliga: "الدوري الألماني", ligue1: "الدوري الفرنسي", ucl: "دوري أبطال أوروبا" };
const H = 3600000;

// Finished in the last 12 hours, with enough data to talk about
const since = new Date(Date.now() - 14 * H).toISOString();
const matches = await api(`matches?status=eq.FINISHED&kickoff=gt.${since}&select=id,channel,home,away,kickoff,home_score,away_score,live_home,live_away,events,stats,players,lineups&order=kickoff.asc`);
if (!matches.length) { console.log("No finished matches to analyse"); process.exit(0); }
const done = new Set((await api(`posts?auto=eq.analysis&match_id=in.(${matches.map((m) => m.id).join(",")})&select=match_id`)).map((p) => p.match_id));
const todo = matches.filter((m) => {
  if (done.has(m.id)) return false;
  const ended = new Date(m.kickoff).getTime() + 2 * H;
  const hasRatings = (m.players?.home || []).some((p) => p.rating);
  // Wait for ratings, but not forever: after 3 hours go with what we have
  return hasRatings || Date.now() > ended + 3 * H;
}).slice(0, MAX_PER_RUN);
if (!todo.length) { console.log("Nothing new to analyse"); process.exit(0); }

// Only the facts, in a compact form
function facts(m) {
  const hs = m.home_score ?? m.live_home, as = m.away_score ?? m.live_away;
  const side = (s) => (s === "home" ? m.home : m.away);
  const lines = [`${LEAGUES[m.channel] || ""}: ${m.home} ${hs} - ${as} ${m.away}`];
  const ev = (m.events || []).filter((e) => ["Goal", "Card", "Var"].includes(e.type) && !(e.type === "Card" && /yellow/i.test(e.detail) && !/second/i.test(e.detail)));
  if (ev.length) {
    lines.push("الأحداث:");
    for (const e of ev) lines.push(`- ${e.min}${e.extra ? "+" + e.extra : ""}' ${side(e.side)}: ${e.type} (${e.detail})${e.player ? " " + e.player : ""}${e.assist ? " صناعة " + e.assist : ""}`);
  }
  const st = m.stats;
  if (st?.home && st?.away) {
    lines.push("الإحصائيات (المستضيف / الضيف):");
    for (const k of ["Ball Possession", "expected_goals", "Total Shots", "Shots on Goal", "Corner Kicks", "Passes %", "Fouls", "Goalkeeper Saves"]) {
      if (st.home[k] != null || st.away[k] != null) lines.push(`- ${k}: ${st.home[k] ?? "-"} / ${st.away[k] ?? "-"}`);
    }
  }
  for (const s of ["home", "away"]) {
    const ps = (m.players?.[s] || []).filter((p) => p.rating).slice(0, 18);
    if (!ps.length) continue;
    lines.push(`تقييمات لاعبي ${side(s)} (من 10):`);
    for (const p of ps) {
      const x = p.s || {};
      const bits = [x.g && `${x.g} هدف`, x.a && `${x.a} صناعة`, x.kp && `${x.kp} تمريرة مفتاحية`, x.sv && `${x.sv} تصدي`, x.tk && `${x.tk} افتكاك`, x.drs && `${x.drs} مراوغة ناجحة`, x.rc && "طرد"].filter(Boolean);
      lines.push(`- ${p.name} ${p.rating}${p.min ? ` (${p.min} د)` : ""}${bits.length ? ": " + bits.join("، ") : ""}`);
    }
  }
  const coach = (s) => m.lineups?.[s]?.coach;
  if (coach("home") || coach("away")) lines.push(`المدربين: ${m.home} ${coach("home") || "?"}، ${m.away} ${coach("away") || "?"}`);
  return lines.join("\n");
}

const SYSTEM = `أنت "محلل هلا"، محلل كروي في تطبيق "مدرج هلا" لجمهور كرة قدم خليجي.
تكتب منشور قصير بعد نهاية المباراة، باللهجة الخليجية (سعودية/كويتية بسيطة)، بأسلوب حماسي وخفيف دم بدون تجريح.

القواعد:
- اعتمد فقط على البيانات اللي تنعطى لك. لا تخترع أحداث أو أرقام أو أسماء مو موجودة.
- اكتب أسماء اللاعبين بالحروف العربية.
- من ٣ إلى ٥ أسطر قصيرة، والمجموع أقل من ٤٠٠ حرف.
- السطر الأول: خلاصة المباراة في جملة وحدة قوية.
- بعدها: مين أبدع ومين خيّب (استند على التقييمات والأحداث)، ونقطة تكتيكية أو رقم لافت من الإحصائيات إذا موجود.
- السطر الأخير: سؤال يفتح النقاش للجمهور.
- إيموجي واحد أو اثنين بالكثير. بدون هاشتاقات، بدون عناوين، بدون تنسيق markdown.
- اكتب المنشور نفسه فقط، بدون أي مقدمة.`;

const client = new Anthropic();
let posted = 0;
for (const m of todo) {
  let text = "";
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: `بيانات المباراة:\n${facts(m)}\n\nاكتب المنشور.` }],
    });
    if (response.stop_reason === "refusal") { console.log(`Match ${m.id}: declined, skipping`); continue; }
    text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) { console.error("ANTHROPIC_API_KEY is not valid"); process.exit(0); }
    if (error instanceof Anthropic.RateLimitError) { console.error("Rate limited, will try next run"); break; }
    if (error instanceof Anthropic.APIError) { console.error(`Match ${m.id}: API error ${error.status}: ${error.message}`); continue; }
    throw error;
  }
  if (!text) continue;
  const tag = (t) => "#" + String(t).trim().replace(/\s+/g, "_");
  const body = `🤖 محلل هلا\n${text}`.slice(0, 470) + `\n${tag(m.home)} ${tag(m.away)}`;
  try {
    await api("posts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: OFFICIAL, body: body.slice(0, 500), match_id: m.id, auto: "analysis" }) });
    posted++;
    console.log(`Match ${m.id} (${m.home} × ${m.away}): analysis posted`);
  } catch (e) {
    console.error(`Match ${m.id}: could not post: ${e.message}`);
  }
}
console.log(`Analyst done: ${posted} of ${todo.length}`);
