/* ---------- 🏆 دوري المدرج: الدرجات، الغريم، تشكيلة الجولة، حرب الجماهير، الألقاب ----------
   Replaces the old predictions-only table in the "الترتيب" tab. Rules and points: supabase/league.sql */

const TIERS = [null,
  { name: "الدرجة الثالثة", ico: "🥉", c: "#b07a4a" },
  { name: "الدرجة الثانية", ico: "🥈", c: "#a9b4c2" },
  { name: "الدرجة الأولى", ico: "🥇", c: "#e3c84a" },
  { name: "النخبة", ico: "💎", c: "#3ec7e0" },
  { name: "دوري الأساطير", ico: "👑", c: "#c86bff" },
];
const FX_SLOTS = ["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"];
const FX_POS = { G: "حارس", D: "مدافع", M: "وسط", F: "مهاجم" };
const lgNum = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
let leagueJoined = false, leagueTick = null;

function leagueLeft(iso) {
  const ms = new Date(iso) - Date.now(); if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return d ? `${lgNum(d)} يوم ${lgNum(h)} س` : h ? `${lgNum(h)} س ${lgNum(m)} د` : `${lgNum(m)} د`;
}
async function leagueJoin() {
  if (leagueJoined) return;
  const { error } = await sb.rpc("league_join");
  if (!error) leagueJoined = true;
}

async function renderLeague() {
  const box = $("tableView"); box.textContent = "";
  box.append(el("div", "cm-loading", "يحمّل الدوري…"));
  await leagueJoin();
  const [{ data: t, error }, { data: war }, { data: titles }] = await Promise.all([
    sb.rpc("league_table"), sb.rpc("fan_war"), sb.rpc("league_titles"),
  ]);
  if (view !== "table") return;
  box.textContent = "";
  if (error || !t) { box.append(el("div", "rules", "دوري المدرج يتجهز… ارجع بعد شوي.")); return; }
  const members = t.members || [];
  await loadPeople([...members.map((m) => m.user_id), ...Object.values(titles || {}).filter(Boolean).map((x) => x.user_id)]);
  const tier = TIERS[t.tier || 1];

  // Header: tier, group, countdown
  const hd = el("div", "lg-head"); hd.style.setProperty("--tc", tier.c);
  hd.append(el("div", "lg-ico", tier.ico));
  const ht = el("div", "lg-ht");
  ht.append(el("h2", null, "دوري المدرج"), el("b", null, `${tier.name} · مجموعة ${lgNum(t.grp || 1)}`));
  const cd = el("span", "lg-cd", `⏳ الجولة تخلص بعد ${leagueLeft(t.ends_at)}`); cd.id = "lgCountdown";
  ht.append(cd); hd.append(ht); box.append(hd);
  clearInterval(leagueTick); leagueTick = setInterval(() => { const c = $("lgCountdown"); if (!c) return clearInterval(leagueTick); c.textContent = `⏳ الجولة تخلص بعد ${leagueLeft(t.ends_at)}`; }, 30000);
  if (t.moved === 1) box.append(el("div", "lg-moved up", `⬆️ مبروك! صعدت إلى ${tier.name}`));
  if (t.moved === -1) box.append(el("div", "lg-moved down", `⬇️ هبطت إلى ${tier.name}. ارجع أقوى هالجولة!`));

  // Rival: nearest in points, preferably a fan of another club
  const meRow = members.find((m) => m.user_id === me.id);
  const others = members.filter((m) => m.user_id !== me.id);
  if (meRow && others.length) {
    const myTeam = people[me.id]?.team;
    const rival = others.slice().sort((a, b) => {
      const da = Math.abs(a.total - meRow.total) - (people[a.user_id]?.team && people[a.user_id].team !== myTeam ? 5 : 0);
      const db = Math.abs(b.total - meRow.total) - (people[b.user_id]?.team && people[b.user_id].team !== myTeam ? 5 : 0);
      return da - db;
    })[0];
    const diff = meRow.total - rival.total;
    const rv = el("button", "lg-rival"); rv.type = "button";
    const sideL = el("div", "rv-side"); sideL.append(avatarEl(me.id), el("b", null, lgNum(meRow.total)), el("small", null, "أنت"));
    const sideR = el("div", "rv-side"); sideR.append(avatarEl(rival.user_id), el("b", null, lgNum(rival.total)), el("small", null, nameOf(rival.user_id)));
    const mid = el("div", "rv-mid");
    mid.append(el("span", "rv-t", "⚔️ غريمك هالجولة"), el("span", "rv-s " + (diff > 0 ? "win" : diff < 0 ? "lose" : ""), diff > 0 ? `متقدم بـ${lgNum(diff)}` : diff < 0 ? `متأخر بـ${lgNum(-diff)}` : "متعادلين"));
    rv.append(sideL, mid, sideR);
    rv.onclick = () => profileSheet(rival.user_id);
    box.append(rv);
  }

  // Standings
  box.append(el("div", "sec", "ترتيب مجموعتك"));
  const n = members.length;
  const table = el("div", "lg-table");
  members.forEach((m, i) => {
    const up = i < 5 && (t.tier || 1) < 5 && n >= 6, down = n >= 10 && i >= n - 5 && (t.tier || 1) > 1;
    const row = el("button", "lg-row" + (m.user_id === me.id ? " me" : "") + (up ? " up" : down ? " down" : "")); row.type = "button";
    row.append(el("span", "lg-rk", lgNum(i + 1)), avatarEl(m.user_id));
    const nm = el("span", "lg-nm", nameOf(m.user_id) + (m.user_id === me.id ? " (أنت)" : ""));
    if (m.moved === 1) nm.append(el("i", "mv up", "⬆"));
    if (m.moved === -1) nm.append(el("i", "mv down", "⬇"));
    row.append(nm, el("b", "lg-pts", lgNum(m.total)));
    const det = el("div", "lg-det"); det.hidden = true;
    const parts = [["🔮 الفايز", m.pred], ["⭐ نجم المباراة", m.motm], ["⚽ التشكيلة", m.fantasy], ["🔥 آراء جريئة", m.takes], ["🎙️ النقاش المنظم", m.debates], ["❤️ تفاعل", m.likes], ["📅 حضور", m.bonus]];
    for (const [k, v] of parts) if (v) det.append(el("span", null, `${k} +${lgNum(v)}`));
    if (!det.childNodes.length) det.append(el("span", null, "ما جمع نقاط للحين"));
    row.onclick = () => { det.hidden = !det.hidden; };
    table.append(row, det);
  });
  if (n >= 6) table.append(el("p", "sheet-p note2", "🟢 أول ٥ يصعدون للدرجة اللي فوق" + (n >= 10 ? " · 🔴 آخر ٥ يهبطون" : "") + ". اضغط على أي اسم تشوف نقاطه من وين."));
  else table.append(el("p", "sheet-p note2", "المجموعة تكبر كل ما دخل ناس. ادعُ أصحابك عشان تنافسهم!"));
  box.append(table);

  // Fantasy XI
  box.append(await fantasyCard(t));

  // Fan war
  if (war?.length) {
    box.append(el("div", "sec", "🔥 حرب الجماهير"));
    const w = el("div", "lg-war");
    const max = Math.max(...war.map((x) => Number(x.total)));
    war.forEach((x, i) => {
      const tm = TEAM_BY_ID[x.team]; if (!tm) return;
      const r = el("div", "war-row" + (x.team === people[me.id]?.team ? " mine" : ""));
      const bar = el("i"); bar.style.width = (Number(x.total) / max * 100) + "%"; bar.style.background = tm.color;
      r.append(el("span", "war-rk", lgNum(i + 1)), el("span", "war-nm", tm.name), el("span", "war-bar"), el("b", null, lgNum(x.total)));
      r.children[2].append(bar);
      r.append(el("small", null, `${lgNum(x.fans)} مشجع`));
      w.append(r);
    });
    w.append(el("p", "sheet-p note2", people[me.id]?.team ? "نقاطك تنضاف لجمهور فريقك. ارفع راسه!" : "اختر فريقك المفضل من صفحتك ⚙️ عشان نقاطك تنضاف لجمهوره."));
    box.append(w);
  }

  // Last round's titles
  const T = titles || {};
  const tl = [["scorer", "👑 هداف الجولة", "نقطة"], ["oracle", "🔮 عرّاف المدرج", "نقطة توقعات"], ["manager", "🧠 مدرب الجولة", "نقطة تشكيلة"], ["bold", "🔥 ملك الجرأة", "نقطة آراء"]].filter(([k]) => T[k]);
  if (tl.length) {
    box.append(el("div", "sec", "🏅 ألقاب الجولة الماضية"));
    const g = el("div", "lg-titles");
    for (const [k, label, unit] of tl) {
      const c = el("button", "lg-title"); c.type = "button";
      c.append(el("span", "tt", label), avatarEl(T[k].user_id), el("b", null, nameOf(T[k].user_id)), el("small", null, `${lgNum(T[k].n)} ${unit}`));
      c.onclick = () => T[k].user_id !== me.id && profileSheet(T[k].user_id);
      g.append(c);
    }
    box.append(g);
  }

  // How to score
  const how = el("details", "lg-how");
  how.append(el("summary", null, "📖 كيف تجمع نقاط؟"));
  for (const line of ["🔮 توقع الفايز صح: +١٠", "⭐ نجم المباراة صح: +٢٠ (تختاره بعد ما تنزل التشكيلة)", "⚽ تشكيلة الجولة: كل لاعب (تقييمه − ٦) × ٥، والكابتن ×٢", "🔥 رأي جريء يصدق: +٢٥", "🎙️ فريقك يفوز في النقاش المنظم: +٢٠", "❤️ كل إعجاب على منشوراتك: +١ (لين ٣٠)", "📅 تدخل ٥ أيام في الجولة: +١٥", "الجولة من الثلاثاء إلى الإثنين. أول ٥ يصعدون وآخر ٥ يهبطون."]) how.append(el("p", null, line));
  box.append(how);
}
renderTable = renderLeague;

/* ---------- ⚽ تشكيلة الجولة ---------- */
async function fantasyTeam(t) {
  const locked = new Date(t.deadline) <= Date.now();
  const ws = new Date(t.week + "T00:00:00Z"); if (locked) ws.setUTCDate(ws.getUTCDate() + 7);
  const week = ws.toISOString().slice(0, 10);
  const [{ data: cur }, { data: nxt }] = await Promise.all([
    sb.from("fantasy_teams").select("players,captain,week_start").eq("user_id", me.id).eq("week_start", t.week).maybeSingle(),
    locked ? sb.from("fantasy_teams").select("players,captain,week_start").eq("user_id", me.id).eq("week_start", week).maybeSingle() : { data: null },
  ]);
  return { locked, week, current: cur, editing: locked ? nxt : cur };
}
async function fantasyCard(t) {
  const card = el("div", "fx-card");
  const f = await fantasyTeam(t);
  const hd = el("div", "fx-hd");
  hd.append(el("b", null, "⚽ تشكيلة الجولة"));
  const meRow = (t.members || []).find((m) => m.user_id === me.id);
  hd.append(el("span", null, f.locked ? (f.current ? `نقاطها: ${lgNum(meRow?.fantasy || 0)}` : "انقفلت هالجولة") : `تنقفل بعد ${leagueLeft(t.deadline)}`));
  card.append(hd);
  const shown = f.locked ? f.current : f.editing;
  if (shown?.players?.length) {
    const svg = pitchSvg(); svg.classList.add("fx-mini");
    drawFantasy(svg, shown.players, shown.captain);
    card.append(svg);
  } else card.append(el("p", "sheet-p", "اختر ١١ لاعب من أي دوري: حارس و٤ دفاع و٣ وسط و٣ هجوم، وبحد أقصى ٣ من نفس النادي. بعد الجولة تاخذ نقاط حسب تقييمهم الرسمي، والكابتن نقاطه ×٢."));
  const b = el("button", "primary", f.locked ? (f.editing ? "✏️ عدّل تشكيلة الجولة الجاية" : "⚽ اختر تشكيلة الجولة الجاية") : (f.editing ? "✏️ عدّل تشكيلتك" : "⚽ اختر تشكيلتك")); b.type = "button";
  b.onclick = () => fantasySheet(f.week, f.editing, f.locked);
  card.append(b);
  return card;
}
function fxPositions(players) {
  const rows = { G: 92, D: 72, M: 48, F: 22 };
  const out = [];
  for (const pos of ["G", "D", "M", "F"]) {
    const list = players.map((p, i) => ({ p, i })).filter((x) => FX_SLOTS[x.i] === pos);
    list.forEach((x, k) => out.push({ ...x, x: ((k + 0.5) / list.length) * 100, y: rows[pos] }));
  }
  return out;
}
function drawFantasy(svg, players, captain, onTap) {
  svg.querySelectorAll(".pl").forEach((n) => n.remove());
  const slots = FX_SLOTS.map((_, i) => players[i] || null);
  for (const s of fxPositions(slots)) {
    const p = s.p;
    const g = drawPlayer(svg, { x: s.x, y: s.y, n: p ? (p.name === captain ? "C" : "") : "+", label: p ? p.name : FX_POS[FX_SLOTS[s.i]], r: 3.4, fs: 2.4, rt: p?.avg_rating || null }, p ? (p.name === captain ? "#e3a008" : "#1b5fd6") : "rgba(255,255,255,.25)", "#fff");
    if (onTap) { g.style.cursor = "pointer"; g.onclick = () => onTap(s.i); }
  }
}
function fantasySheet(week, existing, nextWeek) {
  const players = FX_SLOTS.map((_, i) => existing?.players?.[i] || null);
  let captain = existing?.captain || null;
  openSheet(nextWeek ? "⚽ تشكيلة الجولة الجاية" : "⚽ تشكيلة الجولة", (s) => {
    s.classList.add("wide");
    s.append(el("p", "sheet-p note2", "اضغط على أي مركز وختار لاعب. اضغط على لاعب اخترته تخليه كابتن (©) أو تشيله."));
    const svg = pitchSvg(); const wrap = el("div", "boardwrap"); wrap.append(svg); s.append(wrap);
    const panel = el("div", "fx-panel"); s.append(panel);
    const redraw = () => drawFantasy(svg, players, captain, openSlot);
    const openSlot = (i) => {
      panel.textContent = "";
      const p = players[i];
      if (p) {
        const hd = el("div", "rp-hd"); hd.append(el("b", null, p.name), el("span", null, `${p.team_ar || p.team} · ${FX_POS[p.pos]}`));
        const acts = el("div", "fx-acts");
        const cap = el("button", "small pri", p.name === captain ? "✅ هو الكابتن" : "© خلّه كابتن"); cap.type = "button";
        cap.onclick = () => { captain = p.name; redraw(); openSlot(i); };
        const ch = el("button", "small", "🔁 غيّره"); ch.type = "button"; ch.onclick = () => search(i);
        const rm = el("button", "small", "🗑️ شيله"); rm.type = "button";
        rm.onclick = () => { if (captain === p.name) captain = null; players[i] = null; redraw(); panel.textContent = ""; };
        acts.append(cap, ch, rm); panel.append(hd, acts);
      } else search(i);
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const search = (i) => {
      panel.textContent = "";
      const pos = FX_SLOTS[i];
      panel.append(el("b", null, `اختر ${FX_POS[pos]}`));
      const inp = el("input"); inp.type = "search"; inp.placeholder = "دوّر باسم اللاعب أو النادي…"; inp.className = "fx-q";
      const list = el("div", "fx-list");
      panel.append(inp, list);
      let seq = 0, timer = null;
      const load = async () => {
        const my = ++seq;
        list.textContent = ""; list.append(el("p", "sheet-p", "يحمّل…"));
        const { data, error } = await sb.rpc("player_search", { q: inp.value.trim(), p: pos });
        if (my !== seq) return;
        list.textContent = "";
        if (error) { list.append(el("p", "sheet-p", "ما قدرنا نجيب اللاعبين.")); return; }
        if (!data?.length) { list.append(el("p", "sheet-p", "ما لقينا أحد. جرّب اسم ثاني.")); return; }
        for (const x of data) {
          const taken = players.some((q) => q && q.name === x.name && q.team === x.team);
          const row = el("button", "fx-row"); row.type = "button"; row.disabled = taken;
          const nm = el("span", "fx-nm"); nm.append(el("b", null, x.name), el("small", null, x.team_ar || x.team));
          row.append(nm);
          if (x.avg_rating) { const r = el("i", null, Number(x.avg_rating).toFixed(1)); r.style.background = ratingColor(Number(x.avg_rating)); row.append(r); }
          row.onclick = () => {
            const sameClub = players.filter((q, k) => q && k !== i && q.team === x.team).length;
            if (sameClub >= 3) { toast("بحد أقصى ٣ لاعبين من نفس النادي."); return; }
            if (players[i] && captain === players[i].name) captain = null;
            players[i] = { name: x.name, team: x.team, team_ar: x.team_ar, pos: x.pos, avg_rating: x.avg_rating ? Number(x.avg_rating) : null };
            redraw(); panel.textContent = "";
            const next = players.findIndex((q) => !q); if (next >= 0) openSlot(next);
          };
          list.append(row);
        }
      };
      inp.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
      load();
    };
    redraw();
    sheetActions(s, "احفظ تشكيلتي", async () => {
      if (players.some((p) => !p)) return "كمّل الـ١١ لاعب أول.";
      if (!captain) return "اختر كابتن (اضغط على أي لاعب).";
      const { error } = await sb.from("fantasy_teams").upsert({ user_id: me.id, week_start: week, players: players.map(({ name, team, team_ar, pos }) => ({ name, team, team_ar, pos })), captain }, { onConflict: "user_id,week_start" });
      if (error) {
        const m = error.message || "";
        return /locked/.test(m) ? "انقفلت التشكيلة، بدأت أول مباراة في الجولة." : /max 3/.test(m) ? "بحد أقصى ٣ من نفس النادي." : /bad shape|need 11/.test(m) ? "لازم حارس و٤ دفاع و٣ وسط و٣ هجوم." : "ما انحفظت. جرّب مرة ثانية.";
      }
      toast("✅ انحفظت تشكيلتك");
      if (view === "table") renderLeague();
    });
  });
}

/* ---------- ⭐ نجم المباراة ---------- */
function motmSheet(m) {
  const lu = m.lineups; if (!lu) return;
  openSheet(`⭐ نجم ${m.home} × ${m.away}`, (s) => {
    s.append(el("p", "sheet-p", "مين بيكون أعلى لاعب تقييمًا في المباراة؟ لو جبته تاخذ +٢٠. تقدر تغيّر لين صافرة البداية."));
    for (const side of ["home", "away"]) {
      const t = lu[side]; if (!t) continue;
      s.append(el("h4", null, side === "home" ? m.home : m.away));
      const g = el("div", "motm-grid");
      for (const p of t.xi || []) {
        const b = el("button", "motm-b" + (motmMine[m.id] === p.name ? " on" : "")); b.type = "button";
        b.append(el("i", null, String(p.number ?? "")), el("span", null, p.name));
        b.onclick = async () => {
          g.parentElement.querySelectorAll(".motm-b").forEach((x) => (x.disabled = true));
          const { error } = await sb.from("motm_picks").upsert({ match_id: m.id, user_id: me.id, side, player: p.name }, { onConflict: "match_id,user_id" });
          if (error) { toast("بدأت المباراة، ما يمديك تختار."); closeSheet(); return; }
          motmMine[m.id] = p.name; closeSheet(); toast(`⭐ اخترت ${p.name}`);
          if (view === "pred") renderPredictions();
        };
        g.append(b);
      }
      s.append(g);
    }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

// Join this round's league quietly when the app opens
const _startChatLg = startChat;
startChat = async function () { const r = await _startChatLg(); leagueJoin(); return r; };
