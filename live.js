/* مدرج هلا — live match mode and fan engagement:
   match room (presence, live reactions, crowd pulse, who's on top, quick polls, crowd-confirmed goals),
   live banner in the league chat, post-match "crowd report" share card, daily streak and fan levels.
   Loaded after app.js and tactics.js. */

const LIVE_EMOJIS = ["⚽", "🔥", "😱", "😡", "🟥", "👏"];
const QUICK_POLLS = (m) => [
  ["الحكم ظالم؟", ["إيه ظالم", "لا عادل", "نص نص"]],
  ["مين بيفوز؟", [m.home, "تعادل", m.away]],
  ["التبديل صح؟", ["صح ١٠٠٪", "غلط", "ننتظر نشوف"]],
  ["الشوط الجاي؟", ["فيه أهداف", "بيقفلونها", "فيه طرد"]],
  ["مين أحسن لاعب الحين؟", [m.home, m.away]],
];
const LIVE_BEFORE = 60 * 60000, LIVE_AFTER = 150 * 60000;
function inLiveWindow(m) {
  const k = new Date(m.kickoff).getTime(), now = Date.now();
  if (m.status === "FINISHED" && now - k > 125 * 60000) return false;
  return now >= k - LIVE_BEFORE && now <= k + LIVE_AFTER;
}
function liveMinute(m) {
  const d = Math.floor((Date.now() - new Date(m.kickoff)) / 60000);
  if (d < 0) return { label: `تبدأ بعد ${-d} د`, n: 0 };
  // Official minute from the live feed, moved on by the time since the last update
  const fresh = m.live_at && Date.now() - new Date(m.live_at) < 20 * 60000;
  if (fresh && m.minute != null && m.status !== "FINISHED") {
    if (m.status === "PAUSED") return { label: "استراحة", n: 45 };
    const n = Math.min(m.minute + Math.floor((Date.now() - new Date(m.live_at)) / 60000), m.minute + 15);
    return { label: `د ${n}'`, n };
  }
  if (m.status === "FINISHED" || d > 125) return { label: "انتهت", n: Math.min(d, 120) };
  if (m.status === "PAUSED") return { label: "استراحة", n: 45 };
  // rough: 15 min half-time after 45'
  const n = d <= 47 ? d : d < 62 ? 45 : Math.min(d - 15, 120);
  return { label: d > 47 && d < 62 ? "استراحة تقريبًا" : `د ${n}'`, n };
}

/* ---------- Room tag on league messages ---------- */
function roomTag(m) {
  const mt = matchCache[m.match_id];
  const t = el("button", "roomtag", "🔴 من غرفة " + (mt ? `${mt.home} × ${mt.away}` : "المباراة"));
  t.type = "button";
  t.onclick = (e) => { e.stopPropagation(); if (mt) enterRoom(mt); };
  return t;
}

/* ---------- Live banner above the league chat ---------- */
const banner = el("div", "livebanner"); banner.id = "liveBanner"; banner.hidden = true;
$("strip").after(banner);
let liveList = [];
async function refreshLiveBanner() {
  if (!me) return;
  const now = Date.now();
  let { data } = await sb.from("matches").select("id,channel,home,away,kickoff,status,home_score,away_score")
    .eq("channel", channel).gte("kickoff", new Date(now - LIVE_AFTER).toISOString()).lte("kickoff", new Date(now + LIVE_BEFORE).toISOString())
    .order("kickoff").limit(10);
  liveList = (data || []).filter(inLiveWindow);
  for (const m of liveList) matchCache[m.id] = { ...(matchCache[m.id] || {}), ...m };
  drawLiveBanner();
}
function drawLiveBanner() {
  banner.textContent = "";
  banner.hidden = !liveList.length || view !== "chat" || $("scroller").hidden;
  for (const m of liveList) {
    const b = el("button", "livechip"); b.type = "button";
    const mn = liveMinute(m);
    b.append(el("span", "dot"), el("b", null, `${m.home} × ${m.away}`), el("span", "lm", mn.label), el("span", "go", "ادخل الغرفة ←"));
    b.onclick = () => enterRoom(m);
    banner.append(b);
  }
}
// keep the banner in sync with the league and view the user is on
const _refreshView = refreshView;
refreshView = async function (jump) { const r = await _refreshView(jump); refreshLiveBanner(); return r; };
setInterval(() => { if (!document.hidden) refreshLiveBanner(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshLiveBanner(); });

/* ---------- The room ---------- */
const room = el("div", "room"); room.id = "room"; room.hidden = true;
room.innerHTML = `
  <div class="rhead">
    <button type="button" class="ghost" id="roomBack" aria-label="رجوع">→ رجوع</button>
    <div class="rteams"><b id="rHome"></b><span class="rscore" id="rScore"></span><b id="rAway"></b></div>
    <div class="rmeta"><span id="rMin"></span><button type="button" class="ghost rstats" id="rStats" hidden>📊 الإحصائيات</button><span id="rPeople">👥 1</span></div>
  </div>
  <div class="rcrowd" id="rCrowd"></div>
  <div class="rbody" id="rBody">
    <section class="rsec">
      <div class="rlabel"><b>⚖️ مين مسيطر الحين؟</b><span id="rMomN"></span></div>
      <div class="mombar"><span id="rMomHome"></span><span id="rMomAway"></span></div>
      <div class="momnames"><span id="rMomHN"></span><span id="rMomAN"></span></div>
      <input type="range" id="rMom" min="-100" max="100" step="10" value="0" dir="rtl" aria-label="حرّك ناحية الفريق المسيطر">
    </section>
    <section class="rsec">
      <div class="rlabel"><b>💓 نبض المدرج</b><span class="muted" id="rPulseN"></span></div>
      <div id="rPulse" class="pulse"></div>
    </section>
    <section class="rsec">
      <div class="rlabel"><b>⚡ تصويت سريع</b></div>
      <div class="qpolls" id="rPolls"></div>
    </section>
    <div class="rfeed" id="rFeed"></div>
  </div>
  <div class="rreact" id="rReact"></div>
  <form class="rcompose" id="rCompose">
    <button type="button" class="goalbtn" id="rGoal">⚽ جوول!</button>
    <input type="text" id="rMsg" maxlength="500" placeholder="علّق على المباراة…" autocomplete="off">
    <button type="submit" class="round send" aria-label="إرسال"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="transform:scaleX(-1)"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg></button>
  </form>
  <div class="floats" id="rFloats"></div>
  <div class="celebrate" id="rCeleb" hidden></div>`;
document.body.append(room);

let roomMatch = null, roomCh = null, roomTimers = [], pendingReacts = {}, crowdGoals = { home: 0, away: 0 }, myMomentum = null, lastGoalReport = 0;

for (const e of LIVE_EMOJIS) {
  const b = el("button", "rbtn", e); b.type = "button"; b.setAttribute("aria-label", "تفاعل " + e);
  b.onclick = () => tapReaction(e);
  $("rReact").append(b);
}
$("rStats").onclick = () => roomMatch && statsSheet(roomMatch);
$("roomBack").onclick = () => leaveRoom();

async function enterRoom(m) {
  closeSheet();
  if (roomMatch) leaveRoom(true);
  roomMatch = m; matchCache[m.id] = { ...(matchCache[m.id] || {}), ...m };
  document.body.dataset.league = m.channel || channel;
  room.hidden = false;
  $("rHome").textContent = m.home; $("rAway").textContent = m.away;
  $("rMomHN").textContent = m.home; $("rMomAN").textContent = m.away;
  $("rCrowd").hidden = true; crowdGoals = { home: 0, away: 0 };
  drawRoomHeader();
  // quick polls
  const qp = $("rPolls"); qp.textContent = "";
  for (const [q, opts] of QUICK_POLLS(m)) {
    const b = el("button", "chipq", q); b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      try { await insertMessage({ channel: m.channel, poll: { question: q, options: opts }, match_id: m.id }); renderRoomFeed(true); }
      catch { toast("ما انرسل التصويت."); }
      b.disabled = false;
    };
    qp.append(b);
  }
  // live channel: who's here, flying reactions, new room messages and crowd events
  roomCh = sb.channel("room-" + m.id, { config: { presence: { key: me.id }, broadcast: { self: false } } })
    .on("presence", { event: "sync" }, () => { $("rPeople").textContent = "👥 " + Math.max(1, Object.keys(roomCh.presenceState()).length); })
    .on("broadcast", { event: "react" }, ({ payload }) => { if (LIVE_EMOJIS.includes(payload?.e)) floatEmoji(payload.e); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${m.id}` }, (p) => {
      const list = byChannel[p.new.channel] || (byChannel[p.new.channel] = []);
      if (!list.some(x => x.id === p.new.id)) { list.push(p.new); reacts[p.new.id] = []; if (p.new.poll) votes[p.new.id] = {}; }
      renderRoomFeed();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crowd_events", filter: `match_id=eq.${m.id}` }, (p) => onCrowdEvent(p.new, true))
    .subscribe(async (status) => { if (status === "SUBSCRIBED") await roomCh.track({ at: Date.now() }); });
  // initial data
  const [{ data: msgs }, { data: evs }, { data: mom }] = await Promise.all([
    sb.from("messages").select("*").eq("match_id", m.id).order("created_at", { ascending: true }).limit(200),
    sb.from("crowd_events").select("*").eq("match_id", m.id).order("created_at"),
    sb.from("momentum").select("value").eq("match_id", m.id).eq("user_id", me.id).maybeSingle(),
  ]);
  const list = byChannel[m.channel] || (byChannel[m.channel] = []);
  for (const x of msgs || []) if (!list.some(y => y.id === x.id)) list.push(x);
  list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ids = (msgs || []).map(x => x.id);
  if (ids.length) {
    const [r, v] = await Promise.all([
      sb.from("reactions").select("message_id,user_id,emoji").in("message_id", ids),
      sb.from("poll_votes").select("message_id,user_id,option").in("message_id", ids),
    ]);
    for (const id of ids) { reacts[id] = []; votes[id] = votes[id] || {}; }
    for (const x of r.data || []) reacts[x.message_id].push({ user_id: x.user_id, emoji: x.emoji });
    for (const x of v.data || []) votes[x.message_id][x.user_id] = x.option;
  }
  for (const e of evs || []) onCrowdEvent(e, false);
  if (mom) { myMomentum = mom.value; $("rMom").value = mom.value; }
  renderRoomFeed(true);
  refreshMomentum(); refreshPulse();
  roomTimers.push(setInterval(refreshMomentum, 15000), setInterval(refreshPulse, 20000), setInterval(drawRoomHeader, 30000), setInterval(flushReactions, 3000));
}
function leaveRoom(silent) {
  flushReactions();
  roomTimers.forEach(clearInterval); roomTimers = [];
  roomCh?.unsubscribe(); roomCh = null; roomMatch = null;
  room.hidden = true;
  document.body.dataset.league = channel;
  if (!silent) render(false);
}

function drawRoomHeader() {
  const m = roomMatch; if (!m) return;
  const official = m.home_score != null && m.away_score != null;
  const live = !official && m.live_home != null && m.live_away != null;
  const off = official || live;
  $("rScore").textContent = official ? `${m.home_score} - ${m.away_score}` : live ? `${m.live_home} - ${m.live_away}` : `${crowdGoals.home} - ${crowdGoals.away}`;
  $("rScore").classList.toggle("crowd", !off);
  $("rStats").hidden = !m.stats;
  $("rMin").textContent = liveMinute(m).label;
  const c = $("rCrowd");
  if (!off && (crowdGoals.home || crowdGoals.away)) { c.hidden = false; c.textContent = "النتيجة حسب المدرج (الجمهور أكّدها)"; }
  else if (!off) { c.hidden = false; c.textContent = "سجّل فريق؟ اضغط ⚽ جوول! وإذا أكد ٣ من المدرج تنحسب للكل"; }
  else c.hidden = true;
  if (liveMinute(m).label === "انتهت" && !$("rBody").querySelector(".reportbtn")) {
    const b = el("button", "primary reportbtn", "📊 تقرير المدرج: شاركه"); b.type = "button"; b.onclick = () => matchReport(m);
    $("rBody").prepend(b);
  }
}

function renderRoomFeed(jump) {
  if (!roomMatch) return;
  const feed = $("rFeed");
  const near = feed.parentElement.scrollHeight - feed.parentElement.scrollTop - feed.parentElement.clientHeight < 160;
  const msgs = (byChannel[roomMatch.channel] || []).filter(x => x.match_id === roomMatch.id && !blocked.has(x.user_id) && !hiddenLocal.has(x.id));
  feed.textContent = "";
  if (!msgs.length) feed.append(el("p", "sheet-p", "الغرفة هادية… اكتب أول تعليق، أو اضغط إيموجي تحت 👇"));
  let last = null;
  for (const x of msgs) { feed.append(messageRow(x, x.user_id === last)); last = x.user_id; }
  if (jump || near) { const b = $("rBody"); b.scrollTop = b.scrollHeight; }
}
// re-render the room whenever the app re-renders the chat (reactions, votes, replies…)
const _render = render;
render = async function (jump) { const r = await _render(jump); if (roomMatch) renderRoomFeed(false); return r; };

$("rCompose").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("rMsg"); const body = inp.value.trim(); if (!body || !roomMatch) return;
  inp.value = "";
  try { await insertMessage({ channel: roomMatch.channel, body, match_id: roomMatch.id, ...(replyTo ? { reply_to: replyTo.id } : {}) }); clearReply(); renderRoomFeed(true); }
  catch (err) { inp.value = body; toast(err?.code === "42501" ? "حسابك موقوف عن الكتابة." : "ما انرسل التعليق."); }
});

/* reactions */
let tapTimes = [];
function tapReaction(e) {
  const now = Date.now(); tapTimes = tapTimes.filter(t => now - t < 1000);
  if (tapTimes.length >= 8) return; tapTimes.push(now);
  floatEmoji(e, true);
  pendingReacts[e] = (pendingReacts[e] || 0) + 1;
  roomCh?.send({ type: "broadcast", event: "react", payload: { e } });
}
async function flushReactions() {
  const m = roomMatch; if (!m) return;
  const rows = Object.entries(pendingReacts).filter(([, n]) => n > 0).map(([emoji, n]) => ({ match_id: m.id, emoji, n: Math.min(30, n), minute: liveMinute(m).n }));
  pendingReacts = {};
  if (rows.length) await sb.from("live_reactions").insert(rows);
}
function floatEmoji(e, mine) {
  const f = el("span", "fl" + (mine ? " mine" : ""), e);
  f.style.left = (10 + Math.random() * 80) + "%";
  f.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
  f.style.fontSize = (26 + Math.random() * 16) + "px";
  $("rFloats").append(f);
  setTimeout(() => f.remove(), 2600);
}

/* momentum */
let momTimer = null;
$("rMom").addEventListener("input", () => {
  clearTimeout(momTimer);
  const v = Number($("rMom").value);
  momTimer = setTimeout(async () => {
    if (!roomMatch) return;
    myMomentum = v;
    await sb.from("momentum").upsert({ match_id: roomMatch.id, user_id: me.id, value: v, updated_at: new Date().toISOString() }, { onConflict: "match_id,user_id" });
    refreshMomentum();
  }, 700);
});
async function refreshMomentum() {
  if (!roomMatch) return;
  const { data } = await sb.rpc("momentum_now", { m: roomMatch.id });
  const row = Array.isArray(data) ? data[0] : data;
  const avg = Number(row?.avg_value || 0), n = Number(row?.voters || 0);
  const home = Math.round((100 - avg) / 2);
  $("rMomHome").style.width = home + "%"; $("rMomAway").style.width = (100 - home) + "%";
  $("rMomHome").textContent = n ? home + "٪" : ""; $("rMomAway").textContent = n ? (100 - home) + "٪" : "";
  $("rMomN").textContent = n ? `${n} رأي آخر ٦ دقايق` : "حرّك الشريط ناحية الفريق المسيطر";
}

/* pulse */
async function refreshPulse() {
  if (!roomMatch) return;
  const { data } = await sb.rpc("pulse", { m: roomMatch.id });
  drawPulse($("rPulse"), data || [], liveMinute(roomMatch).n);
  const tot = (data || []).reduce((t, r) => t + Number(r.total), 0);
  $("rPulseN").textContent = tot ? `${tot} تفاعل` : "";
}
function pulseSeries(rows) {
  const per = {};
  for (const r of rows) { const k = Number(r.minute); (per[k] ||= { total: 0, top: null, topN: 0 }); per[k].total += Number(r.total); if (Number(r.total) > per[k].topN) { per[k].topN = Number(r.total); per[k].top = r.emoji; } }
  return per;
}
function drawPulse(box, rows, nowMin) {
  const per = pulseSeries(rows);
  const maxMin = Math.max(95, nowMin, ...Object.keys(per).map(Number));
  const peak = Math.max(1, ...Object.values(per).map(p => p.total));
  const W = 300, H = 64;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H + 14}`, class: "pulsesvg", preserveAspectRatio: "none" });
  const bw = W / (maxMin + 1);
  // half-time line
  svg.append(svgEl("line", { x1: W - 45.5 * bw, y1: 0, x2: W - 45.5 * bw, y2: H, stroke: "rgba(255,255,255,.18)", "stroke-dasharray": "2 2" }));
  for (let mi = 0; mi <= maxMin; mi++) {
    const p = per[mi]; if (!p) continue;
    const h = Math.max(2, (p.total / peak) * (H - 4));
    // RTL: minute 0 on the right
    svg.append(svgEl("rect", { x: W - (mi + 1) * bw, y: H - h, width: Math.max(1, bw - 0.6), height: h, rx: 1, fill: "var(--league)" }));
  }
  const peaks = Object.entries(per).sort((a, b) => b[1].total - a[1].total).slice(0, 3).filter(([, p]) => p.total >= peak * 0.4);
  for (const [mi, p] of peaks) svg.append(svgEl("text", { x: W - (Number(mi) + 0.5) * bw, y: H - (p.total / peak) * (H - 4) - 2, "text-anchor": "middle", "font-size": 11 }, p.top));
  for (const mm of [0, 45, 90]) svg.append(svgEl("text", { x: W - (mm + 0.5) * bw, y: H + 12, "text-anchor": "middle", "font-size": 8, fill: "var(--muted)" }, mm + "'"));
  box.textContent = ""; box.append(svg);
  if (!rows.length) box.append(el("p", "sheet-p small", "اضغط الإيموجي تحت وقت اللحظات الكبيرة، ويطلع هنا نبض الجمهور دقيقة بدقيقة."));
}

/* goal reports and crowd events */
$("rGoal").onclick = () => {
  const m = roomMatch; if (!m) return;
  if (Date.now() - lastGoalReport < 60000) { toast("وصل بلاغك، انتظر دقيقة قبل بلاغ ثاني."); return; }
  openSheet("⚽ جوول لمين؟", (s) => {
    s.append(el("p", "sheet-p", "إذا ٣ من المدرج أكدوا نفس الهدف خلال دقيقة ونص، تتحدث النتيجة عند الكل ويوصل إشعار."));
    const r = el("div", "goalpick");
    for (const side of ["home", "away"]) {
      const b = el("button", "primary", side === "home" ? m.home : m.away); b.type = "button";
      b.onclick = async () => {
        b.disabled = true;
        const { error } = await sb.from("live_reports").insert({ match_id: m.id, side });
        closeSheet();
        if (error) { toast("ما وصل البلاغ."); return; }
        lastGoalReport = Date.now(); floatEmoji("⚽", true);
        toast("وصل! ننتظر تأكيد المدرج ⏳");
      };
      r.append(b);
    }
    s.append(r);
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
};
function onCrowdEvent(ev, fresh) {
  if (!roomMatch || ev.match_id !== roomMatch.id) return;
  if (ev.kind === "goal") { crowdGoals[ev.side] = (crowdGoals[ev.side] || 0) + 1; drawRoomHeader(); }
  if (!fresh) return;
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const team = esc(ev.side === "home" ? roomMatch.home : roomMatch.away);
  const goal = ev.kind === "goal" || ev.kind === "official";
  celebrate(ev.kind === "official" ? `⚽ جوووول!<small>${team}${ev.scorer ? " · " + esc(ev.scorer) : ""}${ev.minute ? ` · د ${esc(ev.minute)}'` : ""}</small>`
    : ev.kind === "goal" ? `⚽ جوووول!<small>${team} · حسب المدرج</small>` : `💥 المدرج انفجر! ${esc(ev.emoji || "🔥")}<small>د ${esc(ev.minute ?? "")}'</small>`);
  for (let i = 0; i < 14; i++) setTimeout(() => floatEmoji(goal ? "⚽" : (ev.emoji || "🔥")), i * 90);
}
function celebrate(html) {
  const c = $("rCeleb"); c.innerHTML = html; c.hidden = false;
  c.classList.remove("show"); void c.offsetWidth; c.classList.add("show");
  setTimeout(() => { c.hidden = true; }, 2600);
}
// crowd events in other matches: nudge people who are elsewhere in the app
let crowdWatch = null;
function startCrowdWatch() {
  crowdWatch?.unsubscribe();
  crowdWatch = sb.channel("hala-crowd").on("postgres_changes", { event: "INSERT", schema: "public", table: "crowd_events" }, async (p) => {
  const ev = p.new;
  if (roomMatch?.id === ev.match_id || !me) return;
  let m = matchCache[ev.match_id];
  if (!m) { const { data } = await sb.from("matches").select("id,channel,home,away,kickoff,status,home_score,away_score").eq("id", ev.match_id).maybeSingle(); m = data; if (m) matchCache[m.id] = m; }
  if (!m) return;
  const t = el("button", "toast live", ev.kind === "official" ? `⚽ جوول لـ${ev.side === "home" ? m.home : m.away}!${ev.scorer ? " " + ev.scorer : ""} · ادخل الغرفة` : ev.kind === "goal" ? `⚽ جوول لـ${ev.side === "home" ? m.home : m.away}! (حسب المدرج) · ادخل الغرفة` : `💥 المدرج انفجر في ${m.home} × ${m.away} · ادخل`);
  t.type = "button"; t.onclick = () => { t.remove(); enterRoom(m); };
  document.body.append(t); setTimeout(() => t.remove(), 6000);
  }).subscribe();
}

/* ---------- Post-match crowd report (shareable image) ---------- */
async function matchReport(m) {
  const [pulseR, momR, ratR, predR, evR] = await Promise.all([
    sb.rpc("pulse", { m: m.id }),
    sb.from("momentum").select("value").eq("match_id", m.id),
    sb.from("player_ratings").select("player,rating").eq("match_id", m.id),
    sb.from("predictions").select("home,away").eq("match_id", m.id),
    sb.from("crowd_events").select("kind,side,emoji,minute").eq("match_id", m.id),
  ]);
  const pulse = pulseR.data || [], per = pulseSeries(pulse);
  const peakMin = Object.entries(per).sort((a, b) => b[1].total - a[1].total)[0];
  const moms = (momR.data || []).map(x => x.value);
  const momAvg = moms.length ? moms.reduce((a, b) => a + b, 0) / moms.length : 0;
  const homeShare = Math.round((100 - momAvg) / 2);
  const byP = {};
  for (const r of ratR.data || []) (byP[r.player] ||= []).push(r.rating);
  const star = Object.entries(byP).map(([p, rs]) => [p, rs.reduce((a, b) => a + b, 0) / rs.length, rs.length]).sort((a, b) => b[1] - a[1])[0];
  const preds = predR.data || [];
  const exact = m.home_score != null ? preds.filter(p => p.home === m.home_score && p.away === m.away_score).length : null;
  const totalReacts = pulse.reduce((t, r) => t + Number(r.total), 0);

  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  const accent = getComputedStyle(document.body).getPropertyValue("--league").trim() || "#2fbf5b";
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0f2418"); g.addColorStop(1, "#06100a"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 120) { x.fillStyle = "rgba(255,255,255,.025)"; x.fillRect(i, 0, 60, H); }
  x.direction = "rtl"; x.textAlign = "center"; x.fillStyle = "#eef5ef";
  const font = (w, s, f = "Cairo") => `${w} ${s}px ${f}, Tahoma, sans-serif`;
  x.font = font(400, 64, "Lalezar"); x.fillText("📊 تقرير المدرج", W / 2, 120);
  x.font = font(800, 54); x.fillText(`${m.home}  ×  ${m.away}`, W / 2, 230);
  if (m.home_score != null) { x.font = font(400, 120, "Lalezar"); x.fillText(`${m.home_score} - ${m.away_score}`, W / 2, 370); }
  // pulse chart
  const cx = 90, cy = 430, cw = W - 180, ch = 260;
  x.fillStyle = "rgba(255,255,255,.06)"; x.fillRect(cx, cy, cw, ch);
  x.font = font(700, 30); x.fillStyle = "#b9ccbf"; x.fillText(`💓 نبض الجمهور · ${totalReacts} تفاعل`, W / 2, cy - 14);
  const maxMin = Math.max(95, ...Object.keys(per).map(Number)), peak = Math.max(1, ...Object.values(per).map(p => p.total)), bw = cw / (maxMin + 1);
  x.fillStyle = accent;
  for (const [mi, p] of Object.entries(per)) { const h = (p.total / peak) * (ch - 50); x.fillRect(cx + cw - (Number(mi) + 1) * bw, cy + ch - h, Math.max(2, bw - 2), h); }
  x.font = font(400, 40); for (const [mi, p] of Object.entries(per).sort((a, b) => b[1].total - a[1].total).slice(0, 3)) x.fillText(p.top, cx + cw - (Number(mi) + 0.5) * bw, cy + ch - (p.total / peak) * (ch - 50) - 8);
  // facts
  let y = cy + ch + 90;
  const fact = (t) => { x.font = font(800, 40); x.fillStyle = "#eef5ef"; x.fillText(t, W / 2, y); y += 78; };
  if (peakMin) fact(`💥 أكبر لحظة: الدقيقة ${peakMin[0]} ${peakMin[1].top}`);
  if (moms.length) fact(`⚖️ حسب الجمهور: ${m.home} مسيطر ${homeShare}٪`);
  if (star) fact(`🌟 نجم المدرج: ${star[0]} (${star[1].toFixed(1)})`);
  if (exact != null && preds.length) fact(`🎯 ${exact} من ${preds.length} جابوا النتيجة بالضبط`);
  x.font = font(700, 34); x.fillStyle = accent; x.fillText("مدرج هلا · mait7amss-web.github.io/Ccvhv", W / 2, H - 60);

  const url = cv.toDataURL("image/jpeg", 0.9);
  openSheet("📊 تقرير المدرج", (s) => {
    const img = el("img", "reportimg"); img.src = url; img.alt = "تقرير المدرج"; s.append(img);
    s.append(el("p", "sheet-p small", "شاركه في الستوري أو الواتساب. وإذا ما اشتغل زر المشاركة، اضغط على الصورة ضغطة طويلة واحفظها."));
    const acts = el("div", "acts");
    const share = el("button", "primary", "شارك"); share.type = "button";
    share.onclick = async () => {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], "madraj-hala.jpg", { type: "image/jpeg" });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `تقرير المدرج: ${m.home} × ${m.away} ⚽ تعال تابع معنا: https://mait7amss-web.github.io/Ccvhv/` });
        else toast("اضغط على الصورة ضغطة طويلة واحفظها.");
      } catch {}
    };
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet;
    acts.append(share, c); s.append(acts);
  });
}

/* ---------- Daily streak and fan level ---------- */
const LEVELS = [[0, "مشجع جديد"], [100, "مشجع"], [300, "مشجع وفي"], [700, "محلل"], [1500, "خبير"], [3000, "أسطورة المدرج"]];
let myStats = null;
function levelOf(xp) {
  let i = 0; for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k][0]) i = k;
  const next = LEVELS[i + 1];
  return { name: LEVELS[i][1], idx: i, next: next ? next[0] : null, base: LEVELS[i][0] };
}
async function loadStreak() {
  if (!me) return;
  await sb.from("activity_days").upsert({ user_id: me.id }, { onConflict: "user_id,day", ignoreDuplicates: true });
  const { data, error } = await sb.rpc("my_stats");
  if (error || !data) return;
  myStats = data;
  const nameEl = $("meName");
  nameEl.textContent = nameOf(me.id) + (data.streak > 1 ? ` 🔥${data.streak}` : "");
  const today = new Date().toISOString().slice(0, 10);
  let shown = null; try { shown = localStorage.getItem("hala.streakToast"); } catch {}
  if (data.streak > 1 && shown !== today) {
    try { localStorage.setItem("hala.streakToast", today); } catch {}
    toast(`🔥 ستريك ${data.streak} أيام ورا بعض! كمّل بكرة`);
  }
}
async function renderStats(box) {
  box.textContent = "";
  box.append(el("h4", null, "🏅 مستواك"));
  if (!myStats) { const { data } = await sb.rpc("my_stats"); if (data) myStats = data; }
  if (!myStats) { box.append(el("p", null, "يطلع مستواك هنا بعد تحديث قاعدة البيانات.")); return; }
  const lv = levelOf(myStats.xp);
  const head = el("div", "lvl"); head.append(el("b", null, lv.name), el("span", null, `${myStats.xp} نقطة`));
  box.append(head);
  const bar = el("div", "xpbar"); const f = el("span"); f.style.width = (lv.next ? Math.round((myStats.xp - lv.base) / (lv.next - lv.base) * 100) : 100) + "%"; bar.append(f); box.append(bar);
  box.append(el("p", null, lv.next ? `باقي ${lv.next - myStats.xp} نقطة لـ"${LEVELS[lv.idx + 1][1]}"` : "وصلت أعلى مستوى 👑"));
  const grid = el("div", "stgrid2");
  for (const [k, label] of [["streak", "🔥 ستريك"], ["best", "🏆 أطول ستريك"], ["exact", "🎯 توقعات بالضبط"], ["msgs", "💬 رسايلك"], ["tactics", "🧠 تحليلاتك"], ["reacts", "💥 تفاعلات لايف"]]) {
    const c = el("div"); c.append(el("b", null, String(myStats[k] ?? 0)), el("small", null, label)); grid.append(c);
  }
  box.append(grid);
  box.append(el("p", null, "النقاط من: الرسايل، التوقعات (والصح منها أكثر)، التحليلات، الحجج، التفاعل وقت المباريات، وكل يوم تفتح فيه التطبيق."));
}
// run once the chat starts
const _startChat = startChat;
startChat = async function () { const r = await _startChat(); loadStreak(); refreshLiveBanner(); startCrowdWatch(); return r; };
