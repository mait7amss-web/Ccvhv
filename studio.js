// 🎬 استوديو التحليل: analyse a match on the tactics board with your voice and record it as a video
// (canvas + microphone → MediaRecorder). The video posts to the community and can be saved or shared
// to TikTok / Instagram. Tables and storage in supabase/studio.sql.

const SV_W = 720, SV_H = 1280;                    // portrait 9:16, ready for TikTok / Reels
const SV_PITCH = { x: 24, y: 160, w: 672, h: 1038 }; // 68 × 105 m
const SV_MAX_SECS = 90;
const videoUrl = (path) => `${cfg.supabaseUrl}/storage/v1/object/public/videos/${path}`;
const posterOf = (path) => path.replace(/\.\w+$/, ".jpg");

// Club colours from the favourite-team list, by the names used in the matches table
const SV_TEAM_COLOR = {};
for (const lg in TEAMS) for (const [id, name, color] of TEAMS[lg]) { SV_TEAM_COLOR[name] = color; if (typeof TEAM_MATCH_NAME !== "undefined" && TEAM_MATCH_NAME[id]) SV_TEAM_COLOR[TEAM_MATCH_NAME[id]] = color; }
const svHex = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const svNear = (a, b) => { const x = svHex(a), y = svHex(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 110; };

let sv = null;   // the open studio
// The app logo, drawn into every video (same origin, so the canvas stays recordable)
const SV_LOGO = new Image(); SV_LOGO.src = "icon-512.png";
function svLogo(c, x, y, size) {
  c.save();
  c.beginPath(); c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); c.closePath();
  if (SV_LOGO.complete && SV_LOGO.naturalWidth) { c.clip(); c.drawImage(SV_LOGO, x, y, size, size); }
  else { c.fillStyle = "#2fbf5b"; c.fill(); }
  c.restore();
  c.strokeStyle = "#2fbf5b"; c.lineWidth = 3; c.beginPath(); c.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); c.stroke();
}

function svDefaultTeam(f, top) {
  return formationPlayers(f).map((p) => top
    ? { x: 100 - p.x, y: 5 + (92 - p.y) / 70 * 39, n: p.n, label: "" }
    : { x: p.x, y: 100 - (7.5 + ((5 + (92 - p.y) / 70 * 39) - 5) * 36.5 / 39), n: p.n, label: "" });
}

/* ---------- open: pick a match, give it a title ---------- */
// Big clubs (names as in the matches table): only their upcoming matches are offered for analysis
const SV_BIG = new Set(["ريال مدريد", "برشلونة", "أتلتيكو مدريد", "مانشستر سيتي", "ليفربول", "أرسنال", "تشيلسي", "مانشستر يونايتد", "توتنهام",
  "بايرن ميونخ", "باريس سان جيرمان", "يوفنتوس", "إنتر", "ميلان", "نابولي"]);
const svBig = (m) => SV_BIG.has(m.home) || SV_BIG.has(m.away);

// For a match without an official lineup yet: each team's latest official XI (its likely lineup)
async function svLastXI(team) {
  const cols = "home,away,kickoff,lineups";
  const [h, a] = await Promise.all([
    sb.from("matches").select(cols).eq("home", team).not("lineups", "is", null).lt("kickoff", new Date().toISOString()).order("kickoff", { ascending: false }).limit(1),
    sb.from("matches").select(cols).eq("away", team).not("lineups", "is", null).lt("kickoff", new Date().toISOString()).order("kickoff", { ascending: false }).limit(1),
  ]);
  const hm = h.data?.[0], am = a.data?.[0];
  const m = hm && am ? (new Date(hm.kickoff) > new Date(am.kickoff) ? hm : am) : hm || am;
  if (!m) return null;
  return m.home === team ? m.lineups.home : m.lineups.away;
}
async function svWithLineups(m) {
  if (m.lineups) return m;
  const [h, a] = await Promise.all([svLastXI(m.home), svLastXI(m.away)]);
  if (!h && !a) return m;
  const blank = () => ({ formation: "4-3-3", xi: [] });
  return { ...m, lineups: { home: h || blank(), away: a || blank() }, guessed: true };
}

async function studioOpen({ match = null, reply = null } = {}) {
  closeSheet();
  if (typeof roomMatch !== "undefined" && roomMatch) leaveRoom();
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    toast("جهازك ما يدعم تسجيل الفيديو من التطبيق. حدّث المتصفح وجرّب.");
    return;
  }
  if (match && !match.lineups) {
    const { data } = await sb.from("matches").select("*").eq("id", match.id).maybeSingle();
    if (data) match = data;
  }
  if (match) return svStage({ match: await svWithLineups(match), reply, title: `${match.home} × ${match.away}` });
  openSheet("🎬 استوديو التحليل", async (s) => {
    s.append(el("p", "sheet-p", "حلّل مباراة بصوتك على الملعب: حرّك اللاعبين، ارسم، واشرح. يطلع لك فيديو تنشره هنا أو في تيك توك وانستقرام."));
    const list = el("div", "sv-picks"); s.append(list);
    list.append(el("div", "cm-loading", "يحمّل المباريات…"));
    const now = Date.now(), D = 24 * 3600000;
    const cols = "id,channel,home,away,kickoff,status,lineups,home_score,away_score,live_home,live_away,players";
    const [up, past] = await Promise.all([
      sb.from("matches").select(cols).gt("kickoff", new Date(now - 3 * 3600000).toISOString()).lt("kickoff", new Date(now + 8 * D).toISOString())
        .not("status", "in", "(FINISHED,POSTPONED,CANCELLED)").order("kickoff", { ascending: true }).limit(150),
      sb.from("matches").select(cols).not("lineups", "is", null).gt("kickoff", new Date(now - 8 * D).toISOString()).lt("kickoff", new Date(now).toISOString())
        .eq("status", "FINISHED").order("kickoff", { ascending: false }).limit(30),
    ]);
    up.data = (up.data || []).filter(svBig).slice(0, 30);
    list.textContent = "";
    const blank = el("button", "sv-pick"); blank.type = "button";
    blank.append(el("b", null, "⬜ لوحة فاضية"), el("span", null, "فريقين بدون أسماء، ترتّبهم مثل ما تبي"));
    blank.onclick = () => { closeSheet(); svStage({ match: null, reply, title: "" }); };
    list.append(blank);
    const fmt = new Intl.DateTimeFormat("ar", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const fmtDay = new Intl.DateTimeFormat("ar", { weekday: "short", day: "numeric", month: "short" });
    const add = (m, upcoming) => {
      const ch = CHANNELS.find((c) => c.id === m.channel);
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      const sc = m.home_score != null ? `${m.home_score}-${m.away_score}` : m.live_home != null ? `${m.live_home}-${m.live_away}` : "";
      const b = el("button", "sv-pick"); b.type = "button";
      const info = upcoming
        ? `${ch?.flag || ""} ${live ? "🔴 مباشر" : fmt.format(new Date(m.kickoff))} · ${m.lineups ? "📋 التشكيلة الرسمية" : "🔮 التشكيلة المتوقعة"}`
        : `${ch?.flag || ""} ${fmtDay.format(new Date(m.kickoff))}${sc ? " · ⁦" + sc + "⁩" : ""}`;
      b.append(el("b", null, `${m.home} × ${m.away}`), el("span", null, info));
      b.onclick = async () => {
        b.disabled = true;
        const full = await svWithLineups(m);
        closeSheet(); matchCache[m.id] = { ...(matchCache[m.id] || {}), ...m };
        svStage({ match: full, reply, title: `${m.home} × ${m.away}` });
      };
      list.append(b);
    };
    if ((up.data || []).length) { list.append(el("div", "sv-sec", "⏭️ مباريات الكبار الجاية: حلّل قبلها وتوقّع")); for (const m of up.data) add(m, true); }
    if ((past.data || []).length) { list.append(el("div", "sv-sec", "📋 اللي صارت: حلّل وش صار")); for (const m of past.data) add(m, false); }
    if (!(up.data || []).length && !(past.data || []).length) list.append(el("p", "sheet-p", "ما فيه مباريات هالأيام. جرّب اللوحة الفاضية."));
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

/* ---------- the stage ---------- */
function svStage({ match, reply, title }) {
  if (sv) svClose(true);
  const both = match?.lineups ? lineupBoth(match) : { home: svDefaultTeam("4-3-3", false), away: svDefaultTeam("4-3-3", true) };
  let hc = SV_TEAM_COLOR[match?.home] || "#1b5fd6", ac = SV_TEAM_COLOR[match?.away] || "#e4202b";
  if (svNear(hc, ac)) ac = svNear(hc, "#f2f2f2") ? "#111111" : "#f2f2f2";
  const st = {
    home: both.home.map((p) => ({ x: p.x, y: p.y, n: p.n, label: p.label })),
    away: both.away.map((p) => ({ x: p.x, y: p.y, n: p.n, label: p.label })),
    ball: { x: 50, y: 50 }, strokes: [], arrows: [], rings: [], names: true, opp: true,
  };
  sv = { match, reply, title, st, hc, ac, tool: "move", undo: [], rec: null, raf: 0, t0: 0 };

  const pane = el("div", "studio"); pane.id = "studio";
  const head = el("div", "sv-head");
  const close = el("button", "ghost", "✕"); close.type = "button"; close.setAttribute("aria-label", "سكّر");
  close.onclick = () => svClose(false);
  const tIn = el("input", "sv-title"); tIn.type = "text"; tIn.maxLength = 60; tIn.value = title; tIn.placeholder = "عنوان التحليل… مثلًا: ليش خسر الريال؟";
  tIn.oninput = () => { sv.title = tIn.value; };
  head.append(close, tIn);
  const stage = el("div", "sv-stage");
  const canvas = document.createElement("canvas"); canvas.width = SV_W; canvas.height = SV_H; canvas.className = "sv-canvas";
  const recDot = el("div", "sv-rec"); recDot.hidden = true;
  const count = el("div", "sv-count"); count.hidden = true;
  stage.append(canvas, recDot, count);
  const tools = el("div", "sv-tools");
  const TOOLS = [["move", "✋", "حرّك"], ["pen", "✏️", "قلم"], ["run", "➡️", "تحرّك"], ["pass", "⤏", "تمريرة"], ["ring", "🎯", "ركّز"]];
  const tb = {};
  for (const [k, ico, label] of TOOLS) {
    const b = el("button", "sv-tool"); b.type = "button"; b.append(el("i", null, ico), el("span", null, label));
    b.onclick = () => { sv.tool = k; for (const x in tb) tb[x].classList.toggle("on", x === k); };
    tb[k] = b; tools.append(b);
  }
  tb.move.classList.add("on");
  const act = (ico, label, fn) => { const b = el("button", "sv-tool"); b.type = "button"; b.append(el("i", null, ico), el("span", null, label)); b.onclick = fn; tools.append(b); return b; };
  act("↶", "تراجع", () => { const h = sv.undo.pop(); if (h) Object.assign(sv.st, JSON.parse(h)); });
  act("🧽", "امسح", () => { svSnap(); st.strokes = []; st.arrows = []; st.rings = []; });
  act("🏷️", "الأسماء", () => { st.names = !st.names; });
  act("👥", "الخصم", () => { st.opp = !st.opp; });
  const bottom = el("div", "sv-bottom");
  const hint = el("span", "sv-hint", `اضغط سجّل، واشرح بصوتك وأنت تحرّك وترسم. أقصى شي ${arNum(SV_MAX_SECS)} ثانية.`);
  const recBtn = el("button", "sv-recbtn"); recBtn.type = "button"; recBtn.append(el("i"), el("span", null, "سجّل"));
  recBtn.onclick = () => (sv.rec ? svStop() : svStart());
  bottom.append(hint, recBtn);
  pane.append(head, stage, tools, bottom);
  document.body.append(pane);
  document.body.classList.add("sv-on");
  Object.assign(sv, { pane, canvas, ctx: canvas.getContext("2d"), recDot, count, recBtn, hint, tIn });
  // Fit the 9:16 board into whatever space is left between the bars
  const fit = () => {
    const w = stage.clientWidth - 12, h = stage.clientHeight - 12;
    const k = Math.min(w / SV_W, h / SV_H);
    canvas.style.width = Math.floor(SV_W * k) + "px"; canvas.style.height = Math.floor(SV_H * k) + "px";
  };
  fit();
  sv.ro = new ResizeObserver(fit); sv.ro.observe(stage);

  // Pointer: drag players and the ball, draw lines, place spotlights
  const toBoard = (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) * SV_W / r.width, cy = (e.clientY - r.top) * SV_H / r.height;
    return [Math.max(0, Math.min(100, (cx - SV_PITCH.x) / SV_PITCH.w * 100)), Math.max(0, Math.min(100, (cy - SV_PITCH.y) / SV_PITCH.h * 100))];
  };
  const hit = ([x, y], withBall) => {
    const d = (p) => Math.hypot((p.x - x) * SV_PITCH.w / 100, (p.y - y) * SV_PITCH.h / 100);
    if (withBall && d(st.ball) < 34) return st.ball;
    let best = null, bd = 44;
    for (const team of st.opp ? ["home", "away"] : ["home"]) st[team].forEach((p, i) => { const k = d(p); if (k < bd) { bd = k; best = { team, i, p }; } });
    return best;
  };
  let drag = null, stroke = null, arrow = null;
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    const pt = toBoard(e);
    if (sv.tool === "move") {
      const h = hit(pt, true); if (!h) return;
      svSnap(); drag = h === st.ball ? st.ball : h.p;
    } else if (sv.tool === "pen") {
      svSnap(); stroke = { pts: [pt] }; st.strokes.push(stroke);
    } else if (sv.tool === "run" || sv.tool === "pass") {
      svSnap(); arrow = { a: pt, b: pt, k: sv.tool }; st.arrows.push(arrow);
    } else if (sv.tool === "ring") {
      const h = hit(pt, false); if (!h) return;
      svSnap();
      const at = st.rings.findIndex((r) => r.team === h.team && r.i === h.i);
      if (at >= 0) st.rings.splice(at, 1); else st.rings.push({ team: h.team, i: h.i });
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag && !stroke && !arrow) return;
    const [x, y] = toBoard(e);
    if (drag) { drag.x = x; drag.y = y; }
    else if (stroke) { const l = stroke.pts[stroke.pts.length - 1]; if (Math.hypot(l[0] - x, l[1] - y) > 0.4) stroke.pts.push([x, y]); }
    else arrow.b = [x, y];
  });
  const end = () => {
    if (arrow && Math.hypot(arrow.a[0] - arrow.b[0], arrow.a[1] - arrow.b[1]) < 2.5) st.arrows.pop();
    if (stroke && stroke.pts.length < 2) st.strokes.pop();
    drag = stroke = arrow = null;
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);

  const loop = () => { if (!sv) return; svDraw(); sv.raf = requestAnimationFrame(loop); };
  (document.fonts?.ready || Promise.resolve()).then(() => { if (sv) loop(); });
}
function svSnap() {
  const { home, away, ball, strokes, arrows, rings } = sv.st;
  sv.undo.push(JSON.stringify({ home, away, ball, strokes, arrows, rings }));
  if (sv.undo.length > 50) sv.undo.shift();
}
function svClose(force) {
  if (!sv) return;
  if (!force && sv.rec) { toast("وقّف التسجيل أول."); return; }
  if (sv.rec) { sv.rec.cancel = true; try { sv.rec.mr.stop(); } catch {} sv.rec.mic?.getTracks().forEach((t) => t.stop()); }
  cancelAnimationFrame(sv.raf);
  sv.ro?.disconnect();
  sv.pane.remove(); document.body.classList.remove("sv-on");
  sv = null;
}

/* ---------- drawing (also what gets recorded) ---------- */
const svFont = (w, px) => `${w} ${px}px Cairo, "Segoe UI", Tahoma, sans-serif`;
const BX = (x) => SV_PITCH.x + x / 100 * SV_PITCH.w, BY = (y) => SV_PITCH.y + y / 100 * SV_PITCH.h;
function svDraw() {
  const { ctx: c, st } = sv;
  const m = SV_PITCH.w / 68;                       // pixels per metre
  // background + header
  const bg = c.createLinearGradient(0, 0, 0, SV_H); bg.addColorStop(0, "#0b1a10"); bg.addColorStop(1, "#08130c");
  c.fillStyle = bg; c.fillRect(0, 0, SV_W, SV_H);
  c.direction = "rtl"; c.textAlign = "right"; c.textBaseline = "alphabetic";
  c.fillStyle = "#fff"; c.font = svFont(800, 38);
  c.fillText(svFit(c, sv.title || "تحليل", SV_W - 150), SV_W - 28, 64);
  c.fillStyle = "#9fb3a6"; c.font = svFont(700, 26);
  const mt = sv.match;
  let sub = "🎙️ استوديو التحليل";
  if (mt) {
    const sc = mt.home_score != null ? `${mt.home_score} - ${mt.away_score}` : mt.live_home != null ? `${mt.live_home} - ${mt.live_away}` : "×";
    sub = `${mt.home} ${sc} ${mt.away}`;
    if (new Date(mt.kickoff).getTime() > Date.now()) sub += mt.guessed ? " · التشكيلة المتوقعة" : " · قبل المباراة";
  }
  c.fillText(svFit(c, sub, SV_W - 150), SV_W - 28, 108);
  // brand badge (left)
  svLogo(c, 26, 24, 96);
  c.fillStyle = "#2fbf5b"; c.font = `400 24px Lalezar, Cairo, sans-serif`; c.textAlign = "center"; c.direction = "rtl"; c.fillText("مدرج هلا", 74, 146);
  // pitch
  const P = SV_PITCH;
  for (let i = 0; i < 7; i++) { c.fillStyle = i % 2 ? "#2a7d3c" : "#2f8a43"; c.fillRect(P.x, P.y + i * P.h / 7, P.w, P.h / 7 + 1); }
  c.strokeStyle = "rgba(255,255,255,.78)"; c.lineWidth = 3.2;
  const L = (x, y) => [P.x + x * m, P.y + y * m];
  c.strokeRect(...L(1, 1), 66 * m, 103 * m);
  c.beginPath(); c.moveTo(...L(1, 52.5)); c.lineTo(...L(67, 52.5)); c.stroke();
  c.beginPath(); c.arc(...L(34, 52.5), 9.15 * m, 0, Math.PI * 2); c.stroke();
  for (const top of [true, false]) {
    const y0 = top ? 1 : 104, d = top ? 1 : -1;
    c.strokeRect(...L(13.85, top ? y0 : y0 - 16.5), 40.3 * m, 16.5 * m);
    c.strokeRect(...L(24.85, top ? y0 : y0 - 5.5), 18.3 * m, 5.5 * m);
    c.beginPath(); c.arc(...L(34, y0 + d * 11), 9.15 * m, top ? 0.2 * Math.PI : 1.2 * Math.PI, top ? 0.8 * Math.PI : 1.8 * Math.PI); c.stroke();
    c.fillStyle = "rgba(255,255,255,.85)"; c.fillRect(...L(30.3, top ? y0 - 1.2 : y0), 7.4 * m, 1.2 * m);
  }
  // pen strokes
  c.lineCap = "round"; c.lineJoin = "round";
  for (const s of st.strokes) {
    c.strokeStyle = "#ffd84a"; c.lineWidth = 8; c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 6;
    c.beginPath(); s.pts.forEach(([x, y], i) => (i ? c.lineTo(BX(x), BY(y)) : c.moveTo(BX(x), BY(y)))); c.stroke();
  }
  c.shadowBlur = 0;
  // arrows
  for (const a of st.arrows) {
    const pass = a.k === "pass";
    const [x1, y1, x2, y2] = [BX(a.a[0]), BY(a.a[1]), BX(a.b[0]), BY(a.b[1])];
    c.strokeStyle = c.fillStyle = pass ? "#ffffff" : "#ffd84a"; c.lineWidth = 7;
    c.setLineDash(pass ? [18, 12] : []);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - Math.cos(ang) * 14, y2 - Math.sin(ang) * 14); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.moveTo(x2, y2);
    c.lineTo(x2 - 30 * Math.cos(ang - 0.45), y2 - 30 * Math.sin(ang - 0.45));
    c.lineTo(x2 - 30 * Math.cos(ang + 0.45), y2 - 30 * Math.sin(ang + 0.45)); c.closePath(); c.fill();
  }
  // spotlights (pulsing)
  const pulse = (Math.sin(performance.now() / 260) + 1) / 2;
  for (const r of st.rings) {
    const p = st[r.team][r.i]; if (!p || (r.team === "away" && !st.opp)) continue;
    c.strokeStyle = `rgba(255,216,74,${0.55 + pulse * 0.45})`; c.lineWidth = 6;
    c.beginPath(); c.arc(BX(p.x), BY(p.y), 40 + pulse * 10, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "rgba(255,216,74,.16)"; c.beginPath(); c.arc(BX(p.x), BY(p.y), 40 + pulse * 10, 0, Math.PI * 2); c.fill();
  }
  // players
  const drawP = (p, color) => {
    const x = BX(p.x), y = BY(p.y), R = 25;
    c.fillStyle = color; c.strokeStyle = "#fff"; c.lineWidth = 4;
    c.shadowColor = "rgba(0,0,0,.4)"; c.shadowBlur = 8;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0; c.stroke();
    c.fillStyle = inkFor(color); c.font = svFont(800, 22); c.textAlign = "center"; c.direction = "ltr";
    c.fillText(String(p.n ?? ""), x, y + 8);
    if (st.names && p.label) {
      c.font = svFont(800, 20); c.lineWidth = 5; c.strokeStyle = "rgba(0,0,0,.65)";
      const t = shortName(p.label);
      c.strokeText(t, x, y + R + 24); c.fillStyle = "#fff"; c.fillText(t, x, y + R + 24);
    }
  };
  if (st.opp) st.away.forEach((p) => drawP(p, sv.ac));
  st.home.forEach((p) => drawP(p, sv.hc));
  // ball
  const bx = BX(st.ball.x), by = BY(st.ball.y);
  c.font = "34px sans-serif"; c.textAlign = "center"; c.direction = "ltr"; c.fillText("⚽", bx, by + 12);
  // footer
  c.direction = "rtl"; c.textAlign = "right"; c.fillStyle = "#cfe0d4"; c.font = svFont(700, 26);
  const who = people[me.id]?.username ? "@" + people[me.id].username : nameOf(me.id);
  c.fillText(`🎙️ ${who}`, SV_W - 28, 1246);
  svLogo(c, 26, 1210, 52);
  c.textAlign = "left"; c.direction = "ltr"; c.fillStyle = "#2fbf5b"; c.font = `400 32px Lalezar, Cairo, sans-serif`;
  c.fillText("مدرج هلا", 90, 1248);
  // small watermark on the pitch corner, so even a cropped clip carries the logo
  c.globalAlpha = 0.55; svLogo(c, SV_PITCH.x + SV_PITCH.w - 58, SV_PITCH.y + 12, 46); c.globalAlpha = 1;
}
function svFit(c, t, w) { if (c.measureText(t).width <= w) return t; while (t.length > 1 && c.measureText(t + "…").width > w) t = t.slice(0, -1); return t + "…"; }

/* ---------- recording ---------- */
function svPickVideoMime() {
  for (const t of ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc3,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}
async function svStart() {
  if (!sv || sv.rec) return;
  if (!sv.title.trim()) { toast("اكتب عنوان للتحليل فوق."); sv.tIn.focus(); return; }
  let mic = null;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { toast("لازم تسمح بالمايك عشان يطلع صوتك في التحليل."); return; }
  // 3, 2, 1
  sv.recBtn.disabled = true;
  for (const n of ["٣", "٢", "١"]) { if (!sv) { mic.getTracks().forEach((t) => t.stop()); return; } sv.count.hidden = false; sv.count.textContent = n; await new Promise((r) => setTimeout(r, 800)); }
  if (!sv) { mic.getTracks().forEach((t) => t.stop()); return; }
  sv.count.hidden = true; sv.recBtn.disabled = false;
  const poster = await new Promise((r) => sv.canvas.toBlob(r, "image/jpeg", 0.82));
  const stream = new MediaStream([...sv.canvas.captureStream(30).getVideoTracks(), ...mic.getAudioTracks()]);
  const mime = svPickVideoMime();
  let mr;
  try { mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2000000, audioBitsPerSecond: 96000 }); }
  catch { mic.getTracks().forEach((t) => t.stop()); toast("ما قدرنا نبدأ التسجيل على جهازك."); return; }
  const chunks = [];
  sv.rec = { mr, mic, chunks, poster, t0: Date.now(), cancel: false };
  mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  mr.onstop = () => {
    const r = sv?.rec || { cancel: true };
    mic.getTracks().forEach((t) => t.stop());
    stream.getTracks().forEach((t) => t.stop());
    if (!sv || r.cancel) return;
    sv.rec = null; svRecUi(false);
    const secs = Math.min(SV_MAX_SECS, (Date.now() - r.t0) / 1000);
    if (secs < 2) { toast("التسجيل قصير مرة."); return; }
    const type = (chunks[0]?.type || mime || "video/webm").split(";")[0];
    svPreview(new Blob(chunks, { type }), type, poster, secs);
  };
  mr.start(500);
  svRecUi(true);
  const tick = () => {
    if (!sv?.rec || sv.rec.mr !== mr) return;
    const s = (Date.now() - sv.rec.t0) / 1000;
    sv.recDot.textContent = `● ${fmtSecs(s)} / ${fmtSecs(SV_MAX_SECS)}`;
    if (s >= SV_MAX_SECS) { svStop(); return; }
    setTimeout(tick, 250);
  };
  tick();
}
function svStop() { if (sv?.rec && sv.rec.mr.state !== "inactive") sv.rec.mr.stop(); }
function svRecUi(on) {
  sv.recDot.hidden = !on;
  sv.recBtn.classList.toggle("on", on);
  sv.recBtn.querySelector("span").textContent = on ? "وقّف" : "سجّل";
  sv.hint.textContent = on ? "🔴 يسجّل… اشرح بصوتك وحرّك اللاعبين" : `اضغط سجّل، واشرح بصوتك وأنت تحرّك وترسم. أقصى شي ${arNum(SV_MAX_SECS)} ثانية.`;
  sv.tIn.disabled = on;
}

/* ---------- preview, publish, share ---------- */
function svPreview(blob, type, poster, secs) {
  const url = URL.createObjectURL(blob);
  const ext = type.includes("mp4") ? "mp4" : type.includes("quicktime") ? "mov" : "webm";
  const match = sv.match, reply = sv.reply, title = sv.title.trim();
  openSheet("🎬 تحليلك جاهز", (s) => {
    $("sheetBg").dataset.lock = "1";
    const v = el("video", "sv-preview"); v.src = url; v.controls = true; v.playsInline = true; v.setAttribute("playsinline", "");
    s.append(v);
    const ta = el("textarea", "cm-ta"); ta.rows = 2; ta.maxLength = 500; ta.value = title; ta.placeholder = "اكتب وصف للتحليل…";
    s.append(ta);
    const upcoming = match && new Date(match.kickoff).getTime() > Date.now() && !reply;
    let take = false;
    if (upcoming) {
      const tk = el("button", "ghost cm-wide", "🔥 خلّه رأي جريء: الناس يحكمون بعد المباراة إذا صدق"); tk.type = "button";
      tk.onclick = () => { take = !take; tk.classList.toggle("on", take); tk.textContent = (take ? "✅ " : "🔥 ") + "خلّه رأي جريء: الناس يحكمون بعد المباراة إذا صدق"; };
      s.append(tk);
    }
    const err = el("div", "err"); err.hidden = true; s.append(err);
    const acts = el("div", "acts");
    const pub = el("button", "primary", reply ? "رد بالتحليل" : "📤 انشر في المجتمع"); pub.type = "button";
    pub.onclick = async () => {
      err.hidden = true; pub.disabled = true; pub.textContent = "يرفع…";
      const body = ta.value.trim() || title || null;
      const id = crypto.randomUUID();
      const path = `${me.id}/${id}.${ext}`;
      const up = await sb.storage.from("videos").upload(path, blob, { contentType: type });
      if (up.error) { err.textContent = "ما انرفع الفيديو. تأكد من الاتصال وجرّب."; err.hidden = false; pub.disabled = false; pub.textContent = "📤 انشر في المجتمع"; return; }
      if (poster) await sb.storage.from("videos").upload(posterOf(path), poster, { contentType: "image/jpeg" }).catch(() => {});
      const row = { user_id: me.id, body, video_path: path, video_secs: Math.round(secs * 10) / 10 };
      if (reply) row.reply_to = reply.id;
      if (match) row.match_id = match.id;
      if (take) row.take_match_id = match.id;
      const { data, error } = await sb.from("posts").insert(row).select(CM_COLS).single();
      if (error) {
        sb.storage.from("videos").remove([path, posterOf(path)]).catch(() => {});
        err.textContent = cmErr(error); err.hidden = false; pub.disabled = false; pub.textContent = "📤 انشر في المجتمع"; return;
      }
      URL.revokeObjectURL(url);
      closeSheet(); svClose(true);
      toast("✅ انتشر تحليلك");
      for (const k of ["all", "user:" + me.id]) delete cmFeeds[k];
      setCommunity(true);
      cmStack = [{ kind: "thread", id: data?.root_id || data?.id }];
      renderLeagues(); refreshView(true);
    };
    const save = el("button", "ghost", "⬇️ احفظ / شارك"); save.type = "button";
    save.onclick = () => svShareFile(blob, `madraj-hala.${ext}`, type, title);
    const again = el("button", "cancel", "🔁 سجّل من جديد"); again.type = "button";
    again.onclick = () => { URL.revokeObjectURL(url); closeSheet(); };
    acts.append(pub, save);
    s.append(acts, again);
  });
}
async function svShareFile(blob, name, type, title) {
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("⬇️ انحفظ الفيديو");
}
// Share a posted video as a video file (Instagram, TikTok, WhatsApp…). Phones only allow sharing right
// after a tap, so we download it first, then the share button is a fresh tap.
const svBlobs = {};
function svSharePosted(p) {
  openSheet("📤 شارك التحليل كفيديو", async (s) => {
    const note = el("p", "sheet-p", "⏳ يجهّز الفيديو…"); s.append(note);
    const acts = el("div", "sv-share"); s.append(acts);
    const link = el("button", "link", "🔗 أو شارك رابط المنشور بس"); link.type = "button";
    link.onclick = () => { closeSheet(); cmShareLink(p); };
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet;
    s.append(link, c);
    let blob = svBlobs[p.video_path];
    try {
      if (!blob) {
        const r = await fetch(videoUrl(p.video_path));
        if (!r.ok) throw new Error(String(r.status));
        blob = svBlobs[p.video_path] = await r.blob();
      }
    } catch { note.textContent = "ما قدرنا نحمّل الفيديو. تأكد من الاتصال وجرّب."; return; }
    const ext = p.video_path.split(".").pop();
    const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : ext === "webm" ? "video/webm" : "video/mp4";
    const file = new File([blob], `madraj-hala.${ext}`, { type });
    const canShare = !!navigator.canShare?.({ files: [file] });
    note.textContent = canShare ? "✅ جاهز! اضغط شارك واختر انستقرام (ستوري أو ريلز) أو تيك توك أو واتساب." : "✅ جاهز! احفظه في جوالك وبعدين ارفعه في انستقرام.";
    if (ext === "webm") note.textContent += " (ملاحظة: هالفيديو تسجّل بصيغة WebM، وانستقرام ممكن ما يقبلها.)";
    if (canShare) {
      const sh = el("button", "primary cm-wide", "📤 شارك الفيديو"); sh.type = "button";
      sh.onclick = async () => { try { await navigator.share({ files: [file] }); closeSheet(); } catch (e) { if (e?.name !== "AbortError") toast("ما قدرنا نشارك. جرّب احفظ."); } };
      acts.append(sh);
    }
    const save = el("button", canShare ? "ghost cm-wide" : "primary cm-wide", "⬇️ احفظ في الجوال"); save.type = "button";
    save.onclick = () => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    };
    acts.append(save);
  });
}

/* ---------- in a post ---------- */
function postVideo(p) {
  const box = el("div", "post-vid");
  const tag = el("span", "post-vtag", `🎬 تحليل${p.video_secs ? " · " + fmtSecs(p.video_secs) : ""}`);
  const v = el("video"); v.src = videoUrl(p.video_path); v.poster = videoUrl(posterOf(p.video_path));
  v.controls = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "none";
  box.append(tag, v);
  return box;
}

/* ---------- 🏆 analyst of the week + studio invite, on top of the community feed ---------- */
let svWeek = null, svWeekAt = 0;
function studioStrip() {
  const wrap = el("div", "sv-strip");
  const cta = el("button", "sv-cta"); cta.type = "button";
  cta.append(el("i", null, "🎬"), el("div", null), el("b", null, "سجّل"));
  cta.children[1].append(el("strong", null, "استوديو التحليل"), el("span", null, "حلّل مباراة بصوتك على الملعب وانشرها فيديو"));
  cta.onclick = () => studioOpen({});
  wrap.append(cta);
  (async () => {
    if (Date.now() - svWeekAt > 5 * 60000) {
      const { data } = await sb.rpc("analyst_of_week");
      svWeek = data?.[0] || null; svWeekAt = Date.now();
    }
    if (!svWeek) return;
    let p = cmPosts[svWeek.post_id];
    if (!p) { const { data } = await sb.from("posts").select(CM_COLS).eq("id", svWeek.post_id).maybeSingle(); if (!data) return; await cmHydrate([data]); p = cmPosts[data.id]; }
    if (!p || !cmVisible(p)) return;
    const box = el("div", "sv-week");
    box.append(el("div", "sv-weekh", `🏆 محلل الأسبوع: ${nameOf(p.user_id)} · ❤️ ${arNum(p.like_count || 0)}`), postCard(p));
    wrap.append(box);
  })().catch(() => {});
  return wrap;
}
