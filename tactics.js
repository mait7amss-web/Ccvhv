/* مدرج هلا — analysis features: tactics board, frame analysis (telestrator),
   "what would you do" coach scenarios, debates, player ratings, official lineups.
   Loaded after app.js and uses its helpers (el, $, sb, me, openSheet, insertMessage, …). */

const matchCache = {};          // match id -> match row
const scenarioAnswers = {};     // message id -> [answer rows]
const debateArgs = {};          // message id -> [arg rows]
const debateVotes = {};         // arg id -> Set(user ids)

/* ---------- Shared: pitch drawing ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, text) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
// Board coordinates: x 0–100 across, y 0–100 along (0 = the attacking end at the top)
const PX = (x) => x * 0.68, PY = (y) => y * 1.05;

function pitchSvg() {
  const svg = svgEl("svg", { viewBox: "0 0 68 105", class: "pitch" });
  for (let i = 0; i < 7; i++) svg.append(svgEl("rect", { x: 0, y: i * 15, width: 68, height: 15, fill: i % 2 ? "#2a7d3c" : "#2f8a43" }));
  const L = { fill: "none", stroke: "rgba(255,255,255,.75)", "stroke-width": 0.45 };
  svg.append(svgEl("rect", { x: 1, y: 1, width: 66, height: 103, ...L }));
  svg.append(svgEl("line", { x1: 1, y1: 52.5, x2: 67, y2: 52.5, ...L }));
  svg.append(svgEl("circle", { cx: 34, cy: 52.5, r: 9.15, ...L }));
  svg.append(svgEl("circle", { cx: 34, cy: 52.5, r: 0.6, fill: "rgba(255,255,255,.8)" }));
  for (const top of [true, false]) {
    const y0 = top ? 1 : 104, d = top ? 1 : -1;
    svg.append(svgEl("rect", { x: 13.85, y: top ? y0 : y0 - 16.5, width: 40.3, height: 16.5, ...L }));
    svg.append(svgEl("rect", { x: 24.85, y: top ? y0 : y0 - 5.5, width: 18.3, height: 5.5, ...L }));
    svg.append(svgEl("circle", { cx: 34, cy: y0 + d * 11, r: 0.5, fill: "rgba(255,255,255,.8)" }));
    svg.append(svgEl("path", { d: `M 26.7 ${y0 + d * 16.5} A 9.15 9.15 0 0 ${top ? 0 : 1} 41.3 ${y0 + d * 16.5}`, ...L }));
    svg.append(svgEl("rect", { x: 30.3, y: top ? y0 - 1.6 : y0, width: 7.4, height: 1.6, fill: "rgba(255,255,255,.85)" }));
  }
  const defs = svgEl("defs");
  for (const [id, color] of [["ar-run", "#ffd84a"], ["ar-pass", "#ffffff"], ["ar-press", "#ff6a5c"]]) {
    const mk = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto-start-reverse" });
    mk.append(svgEl("path", { d: "M0 0 L10 5 L0 10z", fill: color })); defs.append(mk);
  }
  svg.prepend(defs);
  return svg;
}

// Keep "4-3-3" in left-to-right order inside Arabic text.
const ltr = (t) => t ? "\u2066" + t + "\u2069" : "";
const shortName = (n) => { if (!n) return ""; const p = n.trim().split(/\s+/); return (p.length > 1 ? p[p.length - 1] : p[0]).slice(0, 12); };
// Rating colours like the big score apps: red < 6, orange < 6.5, yellow < 7, green < 8, blue 8+
const ratingColor = (r) => r >= 8 ? "#1d8cf8" : r >= 7 ? "#21b45a" : r >= 6.5 ? "#c9b21b" : r >= 6 ? "#f08a24" : "#e5484d";
function drawPlayer(svg, p, color, ink) {
  const g = svgEl("g", { class: "pl", "data-i": p.i ?? "" });
  const r = p.r || 3.2, fs = p.fs || 2.6;
  g.append(svgEl("circle", { cx: PX(p.x), cy: PY(p.y), r, fill: color, stroke: "#fff", "stroke-width": 0.5 }));
  g.append(svgEl("text", { x: PX(p.x), y: PY(p.y) + r * 0.36, "text-anchor": "middle", "font-size": r * 0.97, "font-weight": 800, fill: ink }, String(p.n ?? "")));
  if (p.label) g.append(svgEl("text", { x: PX(p.x), y: PY(p.y) + r + fs + 0.4, "text-anchor": "middle", "font-size": fs, "font-weight": 700, fill: "#fff", stroke: "rgba(0,0,0,.55)", "stroke-width": 0.5, "paint-order": "stroke" }, shortName(p.label)));
  if (p.rt) {
    const bx = PX(p.x) + r * 0.55, by = PY(p.y) - r - 1.2;
    g.append(svgEl("rect", { x: bx, y: by, width: 5.4, height: 2.9, rx: 0.9, fill: ratingColor(p.rt), stroke: "#fff", "stroke-width": 0.25 }));
    g.append(svgEl("text", { x: bx + 2.7, y: by + 2.15, "text-anchor": "middle", "font-size": 2.1, "font-weight": 800, fill: "#fff" }, Number(p.rt).toFixed(1)));
  }
  svg.append(g); return g;
}
function drawBoard(svg, st) {
  svg.querySelectorAll(".dyn").forEach(n => n.remove());
  const layer = svgEl("g", { class: "dyn" }); svg.append(layer);
  for (const z of st.zones || []) layer.append(svgEl("circle", { cx: PX(z.x), cy: PY(z.y), r: z.r * 0.68, fill: "rgba(255,216,74,.28)", stroke: "#ffd84a", "stroke-width": 0.4, "stroke-dasharray": "1.2 1" }));
  for (const a of st.arrows || []) {
    const color = a.k === "pass" ? "#ffffff" : a.k === "press" ? "#ff6a5c" : "#ffd84a";
    layer.append(svgEl("line", { x1: PX(a.a[0]), y1: PY(a.a[1]), x2: PX(a.b[0]), y2: PY(a.b[1]), stroke: color, "stroke-width": 0.9, "stroke-linecap": "round", "stroke-dasharray": a.k === "pass" ? "2 1.4" : "", "marker-end": `url(#ar-${a.k || "run"})` }));
  }
  const pl = svgEl("g", { class: "dyn" }); svg.append(pl);
  (st.opp || []).forEach((p, i) => drawPlayer(pl, { ...p, i: "o" + i }, "#e4202b", "#fff"));
  (st.players || []).forEach((p, i) => drawPlayer(pl, { ...p, i }, "#1b5fd6", "#fff"));
}

/* ---------- 1. Tactics board ---------- */
const FORMATIONS = {
  "4-3-3": [[50, 92], [15, 72], [38, 76], [62, 76], [85, 72], [30, 54], [50, 58], [70, 54], [18, 28], [50, 22], [82, 28]],
  "4-2-3-1": [[50, 92], [15, 72], [38, 76], [62, 76], [85, 72], [38, 60], [62, 60], [18, 38], [50, 40], [82, 38], [50, 20]],
  "4-4-2": [[50, 92], [15, 72], [38, 76], [62, 76], [85, 72], [15, 48], [38, 52], [62, 52], [85, 48], [38, 24], [62, 24]],
  "4-1-4-1": [[50, 92], [15, 72], [38, 76], [62, 76], [85, 72], [50, 62], [15, 44], [38, 46], [62, 46], [85, 44], [50, 22]],
  "3-5-2": [[50, 92], [28, 76], [50, 78], [72, 76], [10, 50], [32, 55], [50, 60], [68, 55], [90, 50], [38, 24], [62, 24]],
  "3-4-3": [[50, 92], [28, 76], [50, 78], [72, 76], [15, 52], [38, 56], [62, 56], [85, 52], [20, 28], [50, 22], [80, 28]],
  "5-3-2": [[50, 92], [8, 66], [28, 76], [50, 78], [72, 76], [92, 66], [30, 52], [50, 56], [70, 52], [38, 26], [62, 26]],
};
const clamp01 = (v) => Math.max(2, Math.min(98, Math.round(v * 10) / 10));
function formationPlayers(f, labels = []) { return FORMATIONS[f].map(([x, y], i) => ({ x, y, n: i + 1, label: labels[i] || "" })); }

async function tacticEditor(base, replyToMsg) {
  if (!matchData[channel]) await loadMatches(channel).catch(() => {});
  const st = base ? JSON.parse(JSON.stringify(base)) : { formation: "4-3-3", players: formationPlayers("4-3-3"), opp: [], arrows: [], zones: [], title: "" };
  const history = [];
  const snap = () => { history.push(JSON.stringify(st)); if (history.length > 40) history.shift(); };
  let tool = "move";
  openSheet(base ? "✏️ عدّل على اللوحة" : "🧠 لوحة تكتيك", (s) => {
    s.classList.add("wide");
    const title = textInput("tTitle", 80, st.title); title.placeholder = "عنوان التحليل… مثلًا: ليش لازم نضغط عالي قدام سيتي";
    s.append(title);
    const bar = el("div", "tbar");
    const fsel = el("select"); fsel.id = "tForm";
    for (const f of Object.keys(FORMATIONS)) fsel.append(new Option(f, f));
    fsel.value = st.formation || "4-3-3";
    fsel.onchange = () => { snap(); st.formation = fsel.value; const labels = st.players.map(p => p.label); st.players = formationPlayers(fsel.value, labels); redraw(); };
    bar.append(fsel);
    const tools = [["move", "✋ حرّك"], ["run", "➡️ تحرك"], ["pass", "⤏ تمريرة"], ["press", "🔴 ضغط"], ["zone", "◯ منطقة"]];
    const tbtns = {};
    for (const [k, label] of tools) {
      const b = el("button", "tool", label); b.type = "button"; tbtns[k] = b;
      b.onclick = () => { tool = k; for (const x in tbtns) tbtns[x].classList.toggle("on", x === tool); };
      bar.append(b);
    }
    tbtns.move.classList.add("on");
    s.append(bar);
    const bar2 = el("div", "tbar");
    const oppBtn = el("button", "tool", st.opp?.length ? "إخفاء الخصم" : "➕ الخصم"); oppBtn.type = "button";
    oppBtn.onclick = () => { snap(); st.opp = st.opp?.length ? [] : FORMATIONS["4-4-2"].map(([x, y], i) => ({ x: 100 - x, y: 100 - y, n: i + 1 })); oppBtn.textContent = st.opp.length ? "إخفاء الخصم" : "➕ الخصم"; redraw(); };
    const namesBtn = el("button", "tool", "🏷️ الأسماء"); namesBtn.type = "button"; namesBtn.onclick = () => namesPanel.hidden = !namesPanel.hidden;
    const undo = el("button", "tool", "↶ تراجع"); undo.type = "button"; undo.onclick = () => { const h = history.pop(); if (h) { Object.assign(st, JSON.parse(h)); fsel.value = st.formation; redraw(); } };
    const clear = el("button", "tool", "🧹 امسح الرسم"); clear.type = "button"; clear.onclick = () => { snap(); st.arrows = []; st.zones = []; redraw(); };
    bar2.append(oppBtn, namesBtn, undo, clear);
    s.append(bar2);

    // Names: type them, or copy an official lineup
    const namesPanel = el("div", "names"); namesPanel.hidden = true;
    const withLineups = (matchData[channel]?.matches || []).filter(m => m.lineups);
    if (withLineups.length) {
      const pick = el("select"); pick.id = "tLineup";
      pick.append(new Option("📋 انسخ تشكيلة رسمية…", ""));
      for (const m of withLineups.slice(0, 12)) for (const side of ["home", "away"]) pick.append(new Option(`${side === "home" ? m.home : m.away} (${ltr(m.lineups[side].formation)})`, `${m.id}:${side}`));
      pick.onchange = () => {
        if (!pick.value) return;
        const [id, side] = pick.value.split(":"); const lu = matchCache[id]?.lineups?.[side]; if (!lu) return;
        snap();
        const f = Object.keys(FORMATIONS).includes(lu.formation) ? lu.formation : st.formation;
        st.formation = f; fsel.value = f;
        st.players = lineupToBoard(lu, f);
        fillNames(); redraw();
      };
      namesPanel.append(pick);
    }
    const nameGrid = el("div", "ngrid"); namesPanel.append(nameGrid);
    const fillNames = () => {
      nameGrid.textContent = "";
      st.players.forEach((p, i) => {
        const inp = textInput("tN" + i, 24, p.label); inp.placeholder = String(i + 1);
        inp.oninput = () => { p.label = inp.value; redraw(); };
        nameGrid.append(inp);
      });
    };
    fillNames();
    s.append(namesPanel);

    const wrap = el("div", "boardwrap");
    const svg = pitchSvg(); svg.classList.add("edit"); wrap.append(svg); s.append(wrap);
    s.append(el("p", "sheet-p note2", "حرّك اللاعبين بإصبعك، أو اختر أداة وارسم على الملعب. اضغط على المنطقة مرة ثانية تنشال."));
    const redraw = () => drawBoard(svg, st);
    redraw();

    const pt = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [clamp01(q.x / 0.68), clamp01(q.y / 1.05)]; };
    let drag = null, line = null;
    svg.addEventListener("pointerdown", (e) => {
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      const [x, y] = pt(e);
      if (tool === "move") {
        const g = e.target.closest(".pl"); if (!g) return;
        const key = g.getAttribute("data-i"); snap();
        drag = String(key).startsWith("o") ? st.opp[+key.slice(1)] : st.players[+key];
      } else if (tool === "zone") {
        snap();
        const hit = (st.zones || []).findIndex(z => Math.hypot(z.x - x, (z.y - y) * 1.54) < z.r);
        if (hit >= 0) st.zones.splice(hit, 1); else (st.zones ||= []).push({ x, y, r: 10 });
        redraw();
      } else {
        snap(); line = { a: [x, y], b: [x, y], k: tool }; (st.arrows ||= []).push(line); redraw();
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag && !line) return;
      const [x, y] = pt(e);
      if (drag) { drag.x = x; drag.y = y; } else { line.b = [x, y]; }
      redraw();
    });
    const end = () => {
      if (line && Math.hypot(line.a[0] - line.b[0], line.a[1] - line.b[1]) < 3) { st.arrows.pop(); redraw(); }
      drag = null; line = null;
    };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);

    sheetActions(s, "انشر التحليل", async () => {
      st.title = title.value.trim();
      if (!st.title) return "اكتب عنوان للتحليل.";
      if ((st.arrows || []).length > 60 || (st.zones || []).length > 20) return "الرسم كثير مرة. امسح شوي وجرّب.";
      const reply = replyToMsg?.id || replyTo?.id || null;
      await insertMessage({ channel, tactic: st, body: st.title, ...(reply ? { reply_to: reply } : {}) });
      clearReply(); render(true);
    });
  });
}

// Place an official XI on the board using the API grid ("row:col"), falling back to the formation template.
function lineupToBoard(lu, f) {
  const xi = lu.xi || [];
  const rows = {};
  for (const p of xi) { const [r, c] = String(p.grid || "").split(":").map(Number); if (r) (rows[r] ||= []).push({ ...p, c }); }
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
  if (rowKeys.length < 2) return formationPlayers(f, xi.map(p => p.name));
  const maxR = rowKeys[rowKeys.length - 1];
  const out = [];
  for (const r of rowKeys) {
    const list = rows[r].sort((a, b) => a.c - b.c);
    list.forEach((p, i) => out.push({ x: Math.round(((i + 0.5) / list.length) * 100), y: Math.round(92 - ((r - 1) / Math.max(1, maxR - 1)) * 70), n: p.number, label: p.name }));
  }
  return out.slice(0, 11);
}

// Both official lineups on one pitch: home in the bottom half attacking up, away in the top half.
// Rows come from API-Football's grid ("row:col"), spread from the goal to near the halfway line.
function lineupBoth(match) {
  const out = { home: [], away: [] };
  for (const side of ["home", "away"]) {
    const t = match.lineups?.[side]; if (!t) continue;
    const rows = {};
    for (const p of t.xi || []) { const [r, c] = String(p.grid || "").split(":").map(Number); if (r) (rows[r] ||= []).push({ ...p, c }); }
    let keys = Object.keys(rows).map(Number).sort((a, b) => a - b);
    let pts;
    if (keys.length >= 2) {
      pts = [];
      keys.forEach((r, ri) => {
        const list = rows[r].sort((a, b) => a.c - b.c);
        const depth = 5 + (ri / (keys.length - 1)) * 39;   // 5 (keeper) → 44 (front line)
        list.forEach((p, i) => pts.push({ x: ((i + 0.5) / list.length) * 100, depth, n: p.number, label: p.name }));
      });
    } else {
      const f = Object.keys(FORMATIONS).includes(t.formation) ? t.formation : "4-3-3";
      pts = formationPlayers(f, (t.xi || []).map((p) => p.name)).map((p, i) => ({ x: p.x, depth: 5 + (92 - p.y) / 70 * 39, n: t.xi?.[i]?.number ?? p.n, label: p.label }));
    }
    out[side] = pts.slice(0, 11).map((p) => side === "home"
      ? { x: p.x, y: 100 - (7.5 + (p.depth - 5) * 36.5 / 39), n: p.n, label: p.label, r: 2.7, fs: 2.25 }
      : { x: 100 - p.x, y: p.depth, n: p.n, label: p.label, r: 2.7, fs: 2.25 });
  }
  return out;
}

function tacticCard(m) {
  const box = el("div", "tcard");
  box.append(el("div", "ttitle", "🧠 " + (m.tactic.title || "لوحة تكتيك")));
  const svg = pitchSvg(); svg.classList.add("thumb");
  drawBoard(svg, m.tactic); box.append(svg);
  const meta = el("div", "tmeta", ltr(m.tactic.formation) + " · اضغط عشان تكبّرها أو تعدّل عليها"); box.append(meta);
  box.onclick = (e) => { e.stopPropagation(); tacticViewer(m); };
  return box;
}
function tacticViewer(m) {
  openSheet("🧠 " + (m.tactic.title || "لوحة تكتيك"), (s) => {
    s.classList.add("wide");
    s.append(el("p", "sheet-p", `${nameOf(m.user_id)} · ${ltr(m.tactic.formation)}`));
    const wrap = el("div", "boardwrap"); const svg = pitchSvg(); drawBoard(svg, m.tactic); wrap.append(svg); s.append(wrap);
    s.append(legend());
    const acts = el("div", "acts");
    const remix = el("button", "primary", "✏️ عدّل عليها ورد"); remix.type = "button";
    remix.onclick = () => { const base = { ...m.tactic, title: "رد على: " + (m.tactic.title || "") }; closeSheet(); tacticEditor(base, m); };
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet;
    acts.append(remix, c); s.append(acts);
  });
}
function legend() {
  const l = el("div", "legend");
  l.innerHTML = '<span><i style="background:#1b5fd6"></i>الفريق</span><span><i style="background:#e4202b"></i>الخصم</span><span><b style="color:#ffd84a">➜</b> تحرك</span><span><b style="color:#fff">⇢</b> تمريرة</span><span><b style="color:#ff6a5c">➜</b> ضغط</span>';
  return l;
}

/* ---------- 2. Frame analysis (telestrator) ---------- */
const tele = document.createElement("input"); tele.type = "file"; tele.accept = "image/*"; tele.id = "telePicker"; tele.hidden = true;
document.body.append(tele);
tele.addEventListener("change", async () => {
  const file = tele.files[0]; tele.value = "";
  if (!file || !file.type.startsWith("image/")) return;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { toast("ما قدرنا نفتح الصورة."); return; }
  teleEditor(bmp);
});
function teleEditor(bmp) {
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
  const shapes = []; let tool = "arrow", color = "#ffd84a", cur = null;
  openSheet("🎥 حلّل اللقطة", (s) => {
    s.classList.add("wide");
    const bar = el("div", "tbar");
    const tb = {};
    for (const [k2, label] of [["arrow", "➡️ سهم"], ["circle", "◯ دائرة"], ["line", "／ خط"], ["pen", "✏️ قلم"]]) {
      const b = el("button", "tool", label); b.type = "button"; tb[k2] = b;
      b.onclick = () => { tool = k2; for (const x in tb) tb[x].classList.toggle("on", x === tool); }; bar.append(b);
    }
    tb.arrow.classList.add("on");
    s.append(bar);
    const bar2 = el("div", "tbar");
    const cb = {};
    for (const c of ["#ffd84a", "#ff4b3e", "#ffffff", "#38d6ff"]) {
      const b = el("button", "swatch"); b.type = "button"; b.style.background = c; b.setAttribute("aria-label", "لون"); cb[c] = b;
      b.onclick = () => { color = c; for (const x in cb) cb[x].classList.toggle("on", x === color); }; bar2.append(b);
    }
    cb[color].classList.add("on");
    const undo = el("button", "tool", "↶ تراجع"); undo.type = "button"; undo.onclick = () => { shapes.pop(); paint(); };
    bar2.append(undo); s.append(bar2);
    const canvas = el("canvas", "telecv"); canvas.width = W; canvas.height = H; s.append(canvas);
    const cap = textInput("teleCap", 300, ""); cap.placeholder = "تعليقك على اللقطة… مثلًا: شوف المساحة ورا الظهير"; s.append(cap);
    const ctx = canvas.getContext("2d");
    const lw = Math.max(3, Math.round(W / 220));
    function drawShape(sh) {
      ctx.strokeStyle = sh.c; ctx.fillStyle = sh.c; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = lw;
      if (sh.t === "pen") { ctx.beginPath(); sh.p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
      else if (sh.t === "circle") { ctx.beginPath(); ctx.ellipse((sh.a[0] + sh.b[0]) / 2, (sh.a[1] + sh.b[1]) / 2, Math.abs(sh.b[0] - sh.a[0]) / 2 || 1, Math.abs(sh.b[1] - sh.a[1]) / 2 || 1, 0, 0, Math.PI * 2); ctx.stroke(); }
      else {
        ctx.beginPath(); ctx.moveTo(...sh.a); ctx.lineTo(...sh.b);
        if (sh.t === "line") ctx.setLineDash([lw * 3, lw * 2]);
        ctx.stroke(); ctx.setLineDash([]);
        if (sh.t === "arrow") {
          const ang = Math.atan2(sh.b[1] - sh.a[1], sh.b[0] - sh.a[0]), h = lw * 5;
          ctx.beginPath(); ctx.moveTo(...sh.b);
          ctx.lineTo(sh.b[0] - h * Math.cos(ang - 0.45), sh.b[1] - h * Math.sin(ang - 0.45));
          ctx.lineTo(sh.b[0] - h * Math.cos(ang + 0.45), sh.b[1] - h * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    }
    function paint() { ctx.drawImage(bmp, 0, 0, W, H); shapes.forEach(drawShape); if (cur) drawShape(cur); }
    paint();
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); const p = pos(e); cur = tool === "pen" ? { t: "pen", c: color, p: [p] } : { t: tool, c: color, a: p, b: p }; });
    canvas.addEventListener("pointermove", (e) => { if (!cur) return; const p = pos(e); if (cur.t === "pen") cur.p.push(p); else cur.b = p; paint(); });
    const end = () => { if (cur && (cur.t === "pen" ? cur.p.length > 2 : Math.hypot(cur.a[0] - cur.b[0], cur.a[1] - cur.b[1]) > 8)) shapes.push(cur); cur = null; paint(); };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    sheetActions(s, "انشر اللقطة", async () => {
      paint();
      const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88));
      if (!blob) return "ما قدرنا نجهز الصورة.";
      const text = cap.value.trim();
      closeSheet();
      sendImageBlob(new File([blob], "frame.jpg", { type: "image/jpeg" }), text ? "🎥 " + text : "🎥 تحليل لقطة");
    });
  });
}

/* ---------- 3. What would you do? (coach scenarios) ---------- */
const STYLES = ["ضغط عالي", "تكتّل دفاعي", "هجمات مرتدة", "استحواذ وصبر", "كرات طويلة", "هجوم من الأطراف"];
async function scenarioComposer() {
  if (!matchData[channel]) await loadMatches(channel);
  openSheet("🎯 لو أنت المدرب", (s) => {
    s.append(el("p", "sheet-p", "اطرح موقف من مباراة، والكل يقول وش كان بيسوي لو هو المدرب."));
    const near = (matchData[channel]?.matches || []).filter(m => Math.abs(new Date(m.kickoff) - Date.now()) < 6 * 3600000);
    const msel = el("select"); msel.id = "scMatch";
    msel.append(new Option("بدون مباراة محددة", ""));
    for (const m of near) { msel.append(new Option(`${m.home} — تدريب ${m.home}`, `${m.id}:home`)); msel.append(new Option(`${m.away} — تدريب ${m.away}`, `${m.id}:away`)); }
    s.append(field("أنت مدرب أي فريق؟", msel));
    const min = el("input"); min.type = "number"; min.inputMode = "numeric"; min.min = 1; min.max = 120; min.id = "scMin"; min.placeholder = "مثلًا 60";
    s.append(field("الدقيقة", min));
    const txt = el("textarea"); txt.id = "scText"; txt.maxLength = 300; txt.rows = 3; txt.placeholder = "مثلًا: متأخرين ٠-١، والوسط ضايع، والخصم يضغط علينا. وش تسوي؟";
    s.append(field("الموقف", txt));
    sheetActions(s, "انشر الموقف", async () => {
      const text = txt.value.trim(); if (!text) return "اكتب الموقف.";
      const [mid, side] = msel.value ? msel.value.split(":") : [null, null];
      const m = mid ? matchCache[mid] : null;
      const scenario = { text, minute: Number(min.value) || null, match_id: m ? m.id : null, side: side || null, team: m ? (side === "home" ? m.home : m.away) : null };
      await insertMessage({ channel, scenario, ...(replyTo ? { reply_to: replyTo.id } : {}) });
      clearReply(); render(true);
    });
  });
}
function answerKey(a) {
  if (a.choice === "sub") return `🔁 ${a.in_player || "؟"} بدال ${a.out_player || "؟"}`;
  if (a.choice === "formation") return `📐 ${ltr(a.formation)}`;
  return `🧭 ${a.style}`;
}
function scenarioCard(m) {
  const sc = m.scenario, box = el("div", "scard");
  box.append(el("div", "ttitle", "🎯 لو أنت المدرب" + (sc.team ? ` · ${sc.team}` : "") + (sc.minute ? ` · د ${sc.minute}'` : "")));
  box.append(el("div", "stext", sc.text));
  const ans = scenarioAnswers[m.id] || [];
  const counts = {};
  for (const a of ans) counts[answerKey(a)] = (counts[answerKey(a)] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) {
    const list = el("div", "sres");
    for (const [k, n] of top) {
      const r = el("div", "sbar"); const pct = Math.round(n / ans.length * 100);
      const f = el("span", "fill"); f.style.width = pct + "%";
      r.append(f, el("span", "lbl", k), el("span", "n", pct + "٪"));
      list.append(r);
    }
    box.append(list);
  }
  const actual = coachDecision(sc);
  if (actual) { const a = el("div", "actual"); a.append(el("b", null, "قرار المدرب الحقيقي: "), actual); box.append(a); }
  const mine = ans.find(a => a.user_id === me.id);
  const foot = el("div", "sfoot");
  foot.append(el("span", null, `${ans.length} قرار` + (mine ? " · قرارك: " + answerKey(mine) : "")));
  const b = el("button", "small pri", mine ? "غيّر قرارك" : "وش قرارك؟"); b.type = "button";
  b.onclick = (e) => { e.stopPropagation(); answerSheet(m); };
  foot.append(b); box.append(foot);
  box.onclick = (e) => e.stopPropagation();
  return box;
}
function coachDecision(sc) {
  const match = sc.match_id ? matchCache[sc.match_id] : null;
  if (!match?.events || !sc.side) return null;
  const subs = match.events.filter(e => e.type === "subst" && e.side === sc.side && (!sc.minute || e.min >= sc.minute)).slice(0, 3);
  if (!subs.length) return new Date(match.kickoff) < Date.now() - 2 * 3600000 ? "ما سوّى تبديل بعد هالدقيقة" : null;
  return subs.map(e => `🔁 ${e.player || "?"} ↔ ${e.assist || "?"} (د ${e.min}')`).join("، ");
}
function answerSheet(m) {
  const sc = m.scenario, mine = (scenarioAnswers[m.id] || []).find(a => a.user_id === me.id);
  const lu = sc.match_id && sc.side ? matchCache[sc.match_id]?.lineups?.[sc.side] : null;
  openSheet("🎯 وش قرارك؟", (s) => {
    s.append(el("p", "sheet-p", sc.text));
    const choice = el("div", "tabs");
    const opts = [["sub", "🔁 تبديل"], ["formation", "📐 تغيير الخطة"], ["style", "🧭 أسلوب اللعب"]];
    const panels = {};
    let cur = mine?.choice || "sub";
    const btns = {};
    for (const [k, label] of opts) { const b = el("button", null, label); b.type = "button"; btns[k] = b; b.onclick = () => { cur = k; sync(); }; choice.append(b); }
    s.append(choice);
    // sub
    const p1 = el("div", "spanel");
    let outI, inI;
    if (lu) {
      outI = el("select"); outI.id = "aOut"; outI.append(new Option("مين يطلع؟", ""));
      for (const p of lu.xi || []) outI.append(new Option(`${p.number ?? ""} ${p.name}`, p.name));
      inI = el("select"); inI.id = "aIn"; inI.append(new Option("مين يدخل؟", ""));
      for (const p of lu.subs || []) inI.append(new Option(`${p.number ?? ""} ${p.name}`, p.name));
    } else {
      outI = textInput("aOut", 60, ""); outI.placeholder = "اسم اللاعب اللي يطلع";
      inI = textInput("aIn", 60, ""); inI.placeholder = "اسم اللاعب اللي يدخل";
    }
    if (mine?.out_player) outI.value = mine.out_player; if (mine?.in_player) inI.value = mine.in_player;
    p1.append(field("يطلع", outI), field("يدخل", inI)); panels.sub = p1;
    // formation
    const p2 = el("div", "spanel"); const fs = el("select"); fs.id = "aForm";
    for (const f of Object.keys(FORMATIONS)) fs.append(new Option(f, f));
    if (mine?.formation) fs.value = mine.formation;
    p2.append(field("الخطة الجديدة", fs)); panels.formation = p2;
    // style
    const p3 = el("div", "spanel"); const ss = el("select"); ss.id = "aStyle";
    for (const x of STYLES) ss.append(new Option(x, x));
    if (mine?.style) ss.value = mine.style;
    p3.append(field("الأسلوب", ss)); panels.style = p3;
    for (const k in panels) s.append(panels[k]);
    const note = el("textarea"); note.id = "aNote"; note.rows = 2; note.maxLength = 200; note.placeholder = "ليش؟ (اختياري)"; note.value = mine?.note || "";
    s.append(note);
    const sync = () => { for (const k in panels) panels[k].hidden = k !== cur; for (const k in btns) btns[k].setAttribute("aria-selected", String(k === cur)); };
    sync();
    sheetActions(s, "احفظ قراري", async () => {
      const row = { message_id: m.id, user_id: me.id, choice: cur, out_player: null, in_player: null, formation: null, style: null, note: note.value.trim() || null };
      if (cur === "sub") { row.out_player = outI.value.trim(); row.in_player = inI.value.trim(); if (!row.out_player || !row.in_player) return "اختر مين يطلع ومين يدخل."; }
      if (cur === "formation") row.formation = fs.value;
      if (cur === "style") row.style = ss.value;
      const { error } = await sb.from("scenario_answers").upsert(row, { onConflict: "message_id,user_id" });
      if (error) return "ما انحفظ قرارك. جرّب مرة ثانية.";
      const list = scenarioAnswers[m.id] ||= [];
      const i = list.findIndex(a => a.user_id === me.id); if (i >= 0) list[i] = row; else list.push(row);
      render(false);
    });
  });
}

/* ---------- 4. Debates ---------- */
function debateComposer() {
  openSheet("⚔️ مناظرة جديدة", (s) => {
    const q = textInput("dQ", 200, ""); q.placeholder = "مثلًا: رودري أهم من بيلينغهام؟";
    s.append(field("السؤال", q));
    const r = el("div", "row2");
    const a = textInput("dA", 40, ""); a.placeholder = "مثلًا: رودري";
    const b = textInput("dB", 40, ""); b.placeholder = "مثلًا: بيلينغهام";
    r.append(field("الطرف الأول", a), field("الطرف الثاني", b)); s.append(r);
    sheetActions(s, "افتح المناظرة", async () => {
      const question = q.value.trim(), sides = [a.value.trim(), b.value.trim()];
      if (!question || !sides[0] || !sides[1]) return "اكتب السؤال والطرفين.";
      await insertMessage({ channel, debate: { question, sides }, ...(replyTo ? { reply_to: replyTo.id } : {}) });
      clearReply(); render(true);
    });
  });
}
const argScore = (a) => debateVotes[a.id]?.size || 0;
function debateCard(m) {
  const d = m.debate, box = el("div", "dcard");
  box.append(el("div", "ttitle", "⚔️ مناظرة"), el("div", "stext", d.question));
  const args = debateArgs[m.id] || [];
  const cols = el("div", "dcols");
  const totals = [0, 1].map(side => args.filter(a => a.side === side).reduce((t, a) => t + 1 + argScore(a), 0));
  const sum = totals[0] + totals[1] || 1;
  d.sides.forEach((label, side) => {
    const c = el("div", "dside s" + side);
    const top = args.filter(a => a.side === side).sort((x, y) => argScore(y) - argScore(x))[0];
    c.append(el("b", null, label), el("span", "dpct", Math.round(totals[side] / sum * 100) + "٪"));
    if (top) c.append(el("q", null, top.body.length > 70 ? top.body.slice(0, 69) + "…" : top.body));
    cols.append(c);
  });
  box.append(cols);
  const bar = el("div", "dbar"); const f = el("span"); f.style.width = Math.round(totals[0] / sum * 100) + "%"; bar.append(f); box.append(bar);
  const btn = el("button", "small pri", `ادخل المناظرة (${args.length} حجة)`); btn.type = "button";
  btn.onclick = (e) => { e.stopPropagation(); debateSheet(m); };
  box.append(btn);
  box.onclick = (e) => e.stopPropagation();
  return box;
}
function debateSheet(m) {
  const d = m.debate;
  openSheet("⚔️ " + d.question, async (s) => {
    const listBox = el("div", "dlist"); s.append(listBox);
    const drawList = async () => {
      const args = (debateArgs[m.id] || []).slice();
      await loadPeople(args.map(a => a.user_id));
      listBox.textContent = "";
      d.sides.forEach((label, side) => {
        const sec = el("div", "dsec s" + side); sec.append(el("h4", null, label));
        const mineArgs = args.filter(a => a.side === side).sort((x, y) => argScore(y) - argScore(x));
        if (!mineArgs.length) sec.append(el("p", "sheet-p", "ما فيه حجج للحين. كن أول واحد."));
        for (const a of mineArgs) {
          const r = el("div", "arg");
          const on = debateVotes[a.id]?.has(me.id);
          const v = el("button", "rc" + (on ? " on" : ""), "👍 " + argScore(a)); v.type = "button";
          v.onclick = async () => {
            const set = debateVotes[a.id] ||= new Set();
            if (set.has(me.id)) { set.delete(me.id); await sb.from("debate_votes").delete().match({ arg_id: a.id, user_id: me.id }); }
            else { set.add(me.id); await sb.from("debate_votes").insert({ arg_id: a.id }); }
            drawList(); render(false);
          };
          const t = el("div"); t.append(el("b", null, nameOf(a.user_id)), el("p", null, a.body));
          r.append(t, v);
          if (a.user_id === me.id || isAdmin) {
            const del = el("button", "del", "حذف"); del.type = "button";
            del.onclick = async () => { await sb.from("debate_args").delete().eq("id", a.id); debateArgs[m.id] = (debateArgs[m.id] || []).filter(x => x.id !== a.id); drawList(); render(false); };
            t.append(del);
          }
          sec.append(r);
        }
        listBox.append(sec);
      });
    };
    await drawList();
    const add = el("div", "dadd");
    const sideSel = el("select"); sideSel.id = "argSide"; d.sides.forEach((l, i) => sideSel.append(new Option("مع: " + l, String(i))));
    const body = el("textarea"); body.id = "argBody"; body.rows = 2; body.maxLength = 500; body.placeholder = "اكتب حجتك…";
    const post = el("button", "primary", "أضف حجتي"); post.type = "button";
    post.onclick = async () => {
      const text = body.value.trim(); if (!text) return;
      post.disabled = true;
      const { data, error } = await sb.from("debate_args").insert({ message_id: m.id, side: Number(sideSel.value), body: text }).select().single();
      post.disabled = false;
      if (error) { toast("ما انحفظت حجتك."); return; }
      (debateArgs[m.id] ||= []).push(data); body.value = ""; drawList(); render(false);
    };
    add.append(sideSel, body, post); s.append(add);
  });
}

/* ---------- 5. Player ratings ---------- */
async function ratingsSheet(match) {
  const { data } = await sb.from("player_ratings").select("user_id,side,player,rating").eq("match_id", match.id);
  const rows = data || [];
  openSheet(`⭐ ${match.home} × ${match.away}`, (s) => {
    s.classList.add("wide");
    const tabs = el("div", "tabs"); const tH = el("button", null, match.home), tA = el("button", null, match.away);
    tH.type = tA.type = "button"; tabs.append(tH, tA); s.append(tabs);
    const body = el("div"); s.append(body);
    let side = "home";
    const players = (sd) => {
      const lu = match.lineups?.[sd];
      const names = new Set();
      if (lu) {
        for (const p of lu.xi || []) names.add(p.name);
        // substitutes who came on (either name of a substitution event, if they were on the bench)
        const bench = new Set((lu.subs || []).map(p => p.name));
        for (const e of match.events || []) if (e.type === "subst" && e.side === sd) for (const n of [e.player, e.assist]) if (n && bench.has(n)) names.add(n);
      }
      for (const r of rows) if (r.side === sd) names.add(r.player);
      return [...names];
    };
    const draw = () => {
      tH.setAttribute("aria-selected", String(side === "home")); tA.setAttribute("aria-selected", String(side === "away"));
      body.textContent = "";
      const list = players(side);
      // crowd table
      const agg = list.map(p => { const rs = rows.filter(r => r.side === side && r.player === p && r.rating); return { p, avg: rs.length ? rs.reduce((t, r) => t + r.rating, 0) / rs.length : null, n: rs.length }; });
      const rated = agg.filter(a => a.avg != null).sort((a, b) => b.avg - a.avg);
      if (rated.length) {
        const best = el("div", "rbest");
        best.append(el("span", null, `🌟 نجم المدرج: ${rated[0].p} (${rated[0].avg.toFixed(1)})`));
        if (rated.length > 2) best.append(el("span", null, `👎 الأضعف: ${rated[rated.length - 1].p} (${rated[rated.length - 1].avg.toFixed(1)})`));
        body.append(best);
      }
      if (!list.length) body.append(el("p", "sheet-p", "التشكيلة الرسمية للحين ما نزلت. أضف اللاعبين بنفسك وقيّمهم."));
      for (const a of agg.sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1))) {
        const mineR = rows.find(r => r.user_id === me.id && r.side === side && r.player === a.p)?.rating;
        const r = el("div", "rrow");
        const off = (match.players?.[side] || []).find(x => x.name === a.p)?.rating;
        const name = el("div", "rname"); name.append(el("b", null, a.p), el("small", null, (off ? `رسمي ${Number(off).toFixed(1)} · ` : "") + (a.avg != null ? `المدرج ${a.avg.toFixed(1)} · ${a.n} تقييم` : "ما أحد قيّمه من المدرج")));
        const sel = el("select", "rsel"); sel.setAttribute("aria-label", "تقييمك لـ " + a.p);
        sel.append(new Option("قيّم", ""));
        for (let i = 10; i >= 1; i--) sel.append(new Option(String(i), String(i)));
        if (mineR) sel.value = String(mineR);
        sel.onchange = async () => {
          if (!sel.value) return;
          const row = { match_id: match.id, user_id: me.id, side, player: a.p, rating: Number(sel.value) };
          const { error } = await sb.from("player_ratings").upsert(row, { onConflict: "match_id,user_id,side,player" });
          if (error) { toast("ما انحفظ التقييم."); return; }
          const i = rows.findIndex(x => x.user_id === me.id && x.side === side && x.player === a.p);
          if (i >= 0) rows[i] = row; else rows.push(row);
          draw();
        };
        r.append(name, sel); body.append(r);
      }
      const addRow = el("div", "row2");
      const inp = textInput("ratAdd", 60, ""); inp.placeholder = "أضف لاعب…";
      const b = el("button", "small", "أضف"); b.type = "button";
      b.onclick = () => { const n = inp.value.trim(); if (!n) return; rows.push({ user_id: "_", side, player: n, rating: null }); draw(); };
      addRow.append(inp, b); body.append(addRow);
    };
    tH.onclick = () => { side = "home"; draw(); }; tA.onclick = () => { side = "away"; draw(); };
    draw();
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

/* ---------- 6. Official lineup view: both teams, ratings on the pitch, tap a player to rate ---------- */
async function lineupSheet(match) {
  match = matchCache[match.id] || match;
  const lu = match.lineups;
  const started = new Date(match.kickoff) <= Date.now();
  const { data } = started ? await sb.from("player_ratings").select("user_id,side,player,rating").eq("match_id", match.id) : { data: [] };
  const rows = data || [];
  const official = (side, name) => (match.players?.[side] || []).find((x) => x.name === name)?.rating || null;
  const crowd = (side, name) => { const rs = rows.filter((r) => r.side === side && r.player === name && r.rating); return rs.length ? { avg: rs.reduce((t, r) => t + r.rating, 0) / rs.length, n: rs.length } : null; };
  openSheet(`📋 ${match.home} × ${match.away}`, (s) => {
    s.classList.add("wide");
    const svg = pitchSvg();
    const wrap = el("div", "boardwrap"); wrap.append(svg); s.append(wrap);
    const panel = el("div", "ratepanel"); panel.hidden = true; s.append(panel);
    const both = lineupBoth(match);
    const draw = () => {
      svg.querySelectorAll(".pl").forEach((n) => n.remove());
      for (const side of ["home", "away"]) for (const p of both[side]) {
        const c = crowd(side, p.label);
        const g = drawPlayer(svg, { ...p, rt: official(side, p.label) || (c ? c.avg : null) }, side === "home" ? "#1b5fd6" : "#e4202b", "#fff");
        if (started) { g.style.cursor = "pointer"; g.onclick = () => openRate(side, p.label); }
      }
    };
    const openRate = (side, name) => {
      panel.hidden = false; panel.textContent = "";
      const off = official(side, name), c = crowd(side, name);
      const mine = rows.find((r) => r.user_id === me.id && r.side === side && r.player === name)?.rating;
      const hd = el("div", "rp-hd");
      hd.append(el("b", null, name), el("span", null, side === "home" ? match.home : match.away));
      const pl = (match.players?.[side] || []).find((x) => x.name === name);
      const info = el("div", "rp-info");
      if (off) { const b = el("span", "rp-badge", Number(off).toFixed(1)); b.style.background = ratingColor(off); info.append(el("span", null, "رسمي"), b); }
      info.append(el("span", null, c ? `المدرج ${c.avg.toFixed(1)} (${c.n})` : "ما أحد قيّمه من المدرج"));
      const btns = el("div", "rp-btns");
      for (let v = 1; v <= 10; v++) {
        const b = el("button", "rp-b" + (mine === v ? " on" : ""), String(v)); b.type = "button";
        b.style.setProperty("--c", ratingColor(v));
        b.onclick = async () => {
          const row = { match_id: match.id, user_id: me.id, side, player: name, rating: v };
          const { error } = await sb.from("player_ratings").upsert(row, { onConflict: "match_id,user_id,side,player" });
          if (error) { toast("ما انحفظ التقييم."); return; }
          const k = rows.findIndex((x) => x.user_id === me.id && x.side === side && x.player === name);
          if (k >= 0) rows[k] = row; else rows.push(row);
          toast(`⭐ قيّمت ${name}: ${v}`);
          draw(); openRate(side, name);
        };
        btns.append(b);
      }
      panel.append(hd, info);
      if (pl) panel.append(playerStatsEl(pl));
      else if (started) panel.append(el("p", "sheet-p note2", "ما فيه إحصائيات تفصيلية لهاللاعب (ما شارك أو للحين ما وصلت)."));
      panel.append(el("p", "sheet-p note2", "تقييمك من ١ إلى ١٠:"), btns);
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    draw();
    if (started) s.append(el("p", "sheet-p note2", "⭐ اضغط على أي لاعب وقيّمه. الرقم فوقه تقييمه الرسمي، أو تقييم المدرج لو ما فيه رسمي."));

    for (const side of ["away", "home"]) {
      const t = lu?.[side]; if (!t) continue;
      const box = el("div", "lubox " + side);
      box.append(el("h4", null, `${side === "home" ? match.home : match.away} · ${ltr(t.formation)}`));
      if (t.coach) box.append(el("p", "sheet-p", "المدرب: " + t.coach));
      // Subs who came on, with ratings, tappable
      const cameOn = new Set((match.events || []).filter((e) => e.type === "subst" && e.side === side).flatMap((e) => [e.player, e.assist]));
      const used = (t.subs || []).filter((p) => cameOn.has(p.name));
      if (used.length) {
        const list = el("div", "subs");
        for (const p of used) {
          const rt = official(side, p.name) || crowd(side, p.name)?.avg;
          const b = el("button", "subp"); b.type = "button";
          b.append(el("span", null, `${p.number ?? ""} ${p.name}`));
          if (rt) { const r = el("i", null, Number(rt).toFixed(1)); r.style.background = ratingColor(rt); b.append(r); }
          b.onclick = () => openRate(side, p.name);
          list.append(el("small", null, "🔁 دخل بديل:"), b);
        }
        box.append(list);
      }
      const bench = (t.subs || []).filter((p) => !cameOn.has(p.name));
      if (bench.length) box.append(el("p", "sheet-p", "الاحتياط: " + bench.map((p) => `${p.number ?? ""} ${p.name}`).join("، ")));
      s.append(box);
    }
    if (match.events?.length) {
      const ev = el("div", "evlist"); ev.append(el("h4", null, "أحداث المباراة"));
      const icon = (e) => e.type === "Goal" ? "⚽" : e.type === "Card" ? (/red/i.test(e.detail) ? "🟥" : "🟨") : e.type === "subst" ? "🔁" : e.type === "Var" ? "📺" : "•";
      for (const e of match.events) {
        const team = e.side === "home" ? match.home : match.away;
        const txt = e.type === "subst" ? `${e.player || ""} ↔ ${e.assist || ""}` : `${e.player || ""}${e.assist && e.type === "Goal" ? ` (صناعة ${e.assist})` : ""}${e.type === "Var" ? ` — ${e.detail}` : ""}`;
        ev.append(el("div", "ev", `${icon(e)} ${e.min}'${e.extra ? "+" + e.extra : ""} · ${team} · ${txt}`));
      }
      s.append(ev);
    }
    s.append(el("p", "sheet-p note2", "التشكيلات والأحداث والتقييم الرسمي من API-Football، وتتحدث أول بأول."));
    const acts = el("div", "acts");
    const tb = el("button", "primary", "🧠 حلّلها في لوحة تكتيك"); tb.type = "button";
    tb.onclick = () => {
      const f = Object.keys(FORMATIONS).includes(lu.home?.formation) ? lu.home.formation : "4-3-3";
      const b2 = lineupBoth(match);
      closeSheet();
      tacticEditor({ formation: f, players: b2.home, opp: b2.away, arrows: [], zones: [], title: `${match.home} × ${match.away}` });
    };
    const vb = el("button", "primary cm-wide sv-open", "🎬 سجّل تحليل فيديو بصوتك"); vb.type = "button";
    vb.onclick = () => { closeSheet(); if (typeof studioOpen === "function") studioOpen({ match }); };
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet;
    acts.append(tb, c); s.append(vb, acts);
  });
}

/* ---------- 🧍 A player's full match stats ---------- */
function playerStatsEl(p) {
  const s = p.s || {}, box = el("div", "pst");
  const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  const POS = { G: "حارس", D: "مدافع", M: "وسط", F: "مهاجم" };
  const top = el("div", "pst-top");
  const chip = (t) => top.append(el("span", null, t));
  if (p.min) chip(`⏱️ ${ar(p.min)} دقيقة`);
  if (s.pos) chip(POS[s.pos] || s.pos);
  if (s.cap) chip("© الكابتن");
  if (s.g) chip(`⚽ ${ar(s.g)}`);
  if (s.a) chip(`🅰️ ${ar(s.a)}`);
  if (s.yc) chip("🟨"); if (s.rc) chip("🟥");
  box.append(top);
  const groups = [];
  const row = (label, val, hi) => val == null ? null : [label, val, hi];
  const pct = (a, b) => (b ? ` (${ar(Math.round(a / b * 100))}٪)` : "");
  const acc = s.acc != null && s.pas ? Number(String(s.acc).replace("%", "")) : null;
  groups.push(["⚽ الهجوم", [
    row("أهداف", s.g ?? 0, s.g), row("صناعة", s.a ?? 0, s.a),
    row("تسديدات", s.sh != null ? `${ar(s.sot ?? 0)} على المرمى من ${ar(s.sh)}` : null),
    row("مراوغات ناجحة", s.dr != null ? `${ar(s.drs ?? 0)} من ${ar(s.dr)}${pct(s.drs ?? 0, s.dr)}` : null),
    row("تسلل", s.off), row("ضربات جزاء", s.ps || s.pm ? `${ar(s.ps ?? 0)} سجّل · ${ar(s.pm ?? 0)} ضيّع` : null),
    row("كسب ضربة جزاء", s.pw),
  ]]);
  groups.push(["🎯 التمرير", [
    row("تمريرات", s.pas != null ? (acc != null && acc <= s.pas ? `${ar(acc)} صحيحة من ${ar(s.pas)}${pct(acc, s.pas)}` : `${ar(s.pas)}` + (acc != null ? ` · دقة ${ar(acc)}٪` : "")) : null),
    row("تمريرات مفتاحية", s.kp, s.kp >= 3),
  ]]);
  groups.push(["🛡️ الدفاع", [
    row("افتكاك", s.tk), row("قطع", s.int), row("صد تسديدات", s.blk),
    row("التحامات", s.du != null ? `${ar(s.duw ?? 0)} فاز من ${ar(s.du)}${pct(s.duw ?? 0, s.du)}` : null),
  ]]);
  if (s.pos === "G" || s.sv != null || s.gc != null) groups.push(["🧤 الحراسة", [row("تصديات", s.sv, s.sv >= 4), row("أهداف دخلت", s.gc), row("صد ضربة جزاء", s.psv, s.psv)]]);
  groups.push(["⚠️ الأخطاء", [row("أخطاء عليه", s.fd), row("ارتكب أخطاء", s.fc), row("إنذار", s.yc), row("طرد", s.rc)]]);
  for (const [title, rows] of groups) {
    const list = rows.filter(Boolean); if (!list.length) continue;
    const g = el("div", "pst-g"); g.append(el("b", null, title));
    for (const [label, val, hi] of list) {
      const r = el("div", "pst-r" + (hi ? " hi" : ""));
      r.append(el("span", null, label), el("em", null, typeof val === "number" ? ar(val) : val));
      g.append(r);
    }
    box.append(g);
  }
  return box;
}

/* ---------- 📊 Match statistics (live, from API-Football) ---------- */
const STAT_ROWS = [
  ["Ball Possession", "الاستحواذ"], ["expected_goals", "الأهداف المتوقعة xG"], ["Total Shots", "التسديدات"],
  ["Shots on Goal", "على المرمى"], ["Shots insidebox", "من داخل المنطقة"], ["Corner Kicks", "الركنيات"],
  ["Total passes", "التمريرات"], ["Passes %", "دقة التمرير"], ["Goalkeeper Saves", "تصديات الحارس"],
  ["Fouls", "الأخطاء"], ["Offsides", "التسلل"], ["Yellow Cards", "🟨 إنذارات"], ["Red Cards", "🟥 طرد"],
];
function statsSheet(match) {
  openSheet(`📊 ${match.home} × ${match.away}`, (s) => {
    const draw = () => {
      const m = matchCache[match.id] || match;
      s.querySelector(".stbody")?.remove();
      const body = el("div", "stbody");
      const score = m.home_score ?? m.live_home, score2 = m.away_score ?? m.live_away;
      const head = el("div", "sthead");
      head.append(el("b", null, m.home), el("span", "stsc", score != null ? `${score} - ${score2}` : "-"), el("b", null, m.away));
      body.append(head);
      if (typeof liveMinute === "function") body.append(el("div", "stmin", m.status === "FINISHED" || m.home_score != null ? "انتهت" : liveMinute(m).label));
      const goals = (m.events || []).filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty");
      if (goals.length) {
        const g = el("div", "stgoals");
        for (const side of ["home", "away"]) {
          const col = el("div", side);
          for (const e of goals.filter((x) => x.side === side)) col.append(el("div", null, `⚽ ${e.player || ""} ${e.min ?? ""}'${e.detail === "Own Goal" ? " (عكسي)" : e.detail === "Penalty" ? " (ب)" : ""}`));
          g.append(col);
        }
        body.append(g);
      }
      const st = m.stats || {};
      for (const [key, label] of STAT_ROWS) {
        const hv = st.home?.[key], av = st.away?.[key];
        if (hv == null && av == null) continue;
        const num = (v) => parseFloat(String(v ?? 0)) || 0;
        const h = num(hv), a = num(av), tot = h + a || 1;
        const row = el("div", "strow");
        const top = el("div", "sttop");
        top.append(el("b", h > a ? "win" : null, String(hv ?? 0)), el("span", null, label), el("b", a > h ? "win" : null, String(av ?? 0)));
        const bars = el("div", "stbars");
        const hb = el("i", "h"), ab = el("i", "a");
        hb.style.width = (h / tot * 100) + "%"; ab.style.width = (a / tot * 100) + "%";
        bars.append(hb, ab);
        row.append(top, bars); body.append(row);
      }
      if (!m.stats) body.append(el("p", "sheet-p", "الإحصائيات تطلع أول ما تبدأ المباراة."));
      const best = m.players;
      if (best && (best.home?.length || best.away?.length)) {
        body.append(el("h4", null, "⭐ الأفضل حسب التقييم"));
        const g = el("div", "stgoals");
        for (const side of ["home", "away"]) {
          const col = el("div", side);
          for (const p of (best[side] || []).filter((p) => p.rating).slice(0, 3)) col.append(el("div", null, `${p.name} · ${Number(p.rating).toFixed(1)}`));
          g.append(col);
        }
        body.append(g);
      }
      body.append(el("p", "sheet-p note2", "من API-Football، وتتحدث أول بأول."));
      const actsEl = s.querySelector(".acts"); if (actsEl) actsEl.before(body); else s.append(body);
    };
    draw();
    const acts = el("div", "acts");
    if (match.lineups) { const lb = el("button", "primary", "📋 التشكيلة"); lb.type = "button"; lb.onclick = () => lineupSheet(matchCache[match.id] || match); acts.append(lb); }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; acts.append(c);
    s.append(acts);
    // Refresh while open
    const t = setInterval(() => { if ($("sheetBg").hidden || !s.contains(acts)) clearInterval(t); else draw(); }, 15000);
  });
}

/* ---------- Loading + live updates for scenario answers and debates ---------- */
async function loadExtras(msgs) {
  const sIds = msgs.filter(m => m.scenario).map(m => m.id);
  const dIds = msgs.filter(m => m.debate).map(m => m.id);
  const matchIds = [...new Set(msgs.filter(m => m.scenario?.match_id && !matchCache[m.scenario.match_id]).map(m => m.scenario.match_id))];
  const [sa, da, mm] = await Promise.all([
    sIds.length ? sb.from("scenario_answers").select("*").in("message_id", sIds) : { data: [] },
    dIds.length ? sb.from("debate_args").select("id,message_id,user_id,side,body,created_at").in("message_id", dIds) : { data: [] },
    matchIds.length ? sb.from("matches").select("id,home,away,kickoff,lineups,events").in("id", matchIds) : { data: [] },
  ]);
  for (const id of sIds) scenarioAnswers[id] = [];
  for (const a of sa.data || []) scenarioAnswers[a.message_id].push(a);
  for (const id of dIds) debateArgs[id] = [];
  for (const a of da.data || []) debateArgs[a.message_id].push(a);
  for (const m of mm.data || []) matchCache[m.id] = { ...(matchCache[m.id] || {}), ...m };
  const argIds = (da.data || []).map(a => a.id);
  if (argIds.length) {
    const { data: dv } = await sb.from("debate_votes").select("arg_id,user_id").in("arg_id", argIds);
    for (const id of argIds) debateVotes[id] = new Set();
    for (const v of dv || []) debateVotes[v.arg_id].add(v.user_id);
  }
}
let extrasChannel = null;
function startExtrasRealtime() {
  extrasChannel?.unsubscribe();
  extrasChannel = sb.channel("hala-extras")
    .on("postgres_changes", { event: "*", schema: "public", table: "scenario_answers" }, (p) => onExtraChange("scenario_answers", p))
    .on("postgres_changes", { event: "*", schema: "public", table: "debate_args" }, (p) => onExtraChange("debate_args", p))
    .on("postgres_changes", { event: "*", schema: "public", table: "debate_votes" }, (p) => onExtraChange("debate_votes", p))
    .subscribe();
}
function onExtraChange(table, p) {
  const row = p.eventType === "DELETE" ? p.old : p.new;
  if (table === "scenario_answers") {
    const list = scenarioAnswers[row.message_id]; if (!list) return;
    const i = list.findIndex(a => a.user_id === row.user_id);
    if (p.eventType === "DELETE") { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = row; else list.push(row);
  } else if (table === "debate_args") {
    if (p.eventType === "DELETE") { for (const k in debateArgs) debateArgs[k] = debateArgs[k].filter(a => a.id !== row.id); }
    else { const list = debateArgs[row.message_id]; if (!list) return; if (!list.some(a => a.id === row.id)) list.push(row); debateVotes[row.id] ||= new Set(); }
  } else if (table === "debate_votes") {
    const set = debateVotes[row.arg_id] ||= new Set();
    if (p.eventType === "DELETE") set.delete(row.user_id); else set.add(row.user_id);
  }
  if (view === "chat") render(false);
}
