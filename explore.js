// مدرج هلا: صفحة الفريق + البحث الشامل + الحساب الرسمي الموثّق.
// Hooks into the community pages (community.js): cmStack kind "team", tab "search".

/* ---------- teams ---------- */
// The name a club has in the matches table, when it differs from the short name in TEAMS.
const TEAM_MATCH_NAME = { dortmund: "بوروسيا دورتموند", leverkusen: "باير ليفركوزن", frankfurt: "آينتراخت فرانكفورت" };
const teamMatchName = (id) => TEAM_MATCH_NAME[id] || TEAM_BY_ID[id]?.name || "";
const LEAGUE_OF_TEAM = {};
for (const lg in TEAMS) for (const [id] of TEAMS[lg]) LEAGUE_OF_TEAM[id] = lg;
const teamData = {};   // team id -> { matches, fans, fanCount }

function openTeam(id) {
  if (!TEAM_BY_ID[id]) return;
  closeSheet();
  if (typeof roomMatch !== "undefined" && roomMatch) leaveRoom();
  if (typeof dmClose === "function" && !$("dmPane")?.hidden) dmClose();
  setCommunity(true);
  const pg = cmPage();
  if (!(pg?.kind === "team" && pg.id === id)) cmStack.push({ kind: "team", id });
  renderLeagues(); refreshView(true);
}

async function cmLoadTeam(id) {
  const nm = teamMatchName(id);
  const cols = "id,channel,home,away,kickoff,status,home_score,away_score,live_home,live_away,minute,live_at,lineups,players,stats,events";
  const [h, a, fans, cnt] = await Promise.all([
    sb.from("matches").select(cols).eq("home", nm).order("kickoff", { ascending: false }).limit(20),
    sb.from("matches").select(cols).eq("away", nm).order("kickoff", { ascending: false }).limit(20),
    sb.from("profiles").select("id,name,team,avatar_path,username").eq("team", id).limit(300),
    sb.from("profiles").select("id", { count: "exact", head: true }).eq("team", id),
  ]);
  const matches = [...(h.data || []), ...(a.data || [])].sort((x, y) => new Date(x.kickoff) - new Date(y.kickoff));
  for (const m of matches) { matchCache[m.id] = { ...(matchCache[m.id] || {}), ...m }; cmMatches[m.id] = { ...(cmMatches[m.id] || {}), ...m }; }
  const list = fans.data || [];
  for (const p of list) people[p.id] = { ...(people[p.id] || {}), name: p.name, team: p.team, avatar_path: p.avatar_path || null, username: p.username || null };
  const { data: lv } = list.length ? await sb.rpc("user_levels", { ids: list.map((p) => p.id) }) : { data: [] };
  for (const x of lv || []) if (people[x.id]) people[x.id].xp = x.xp;
  const top = list.filter((p) => p.id !== official()).sort((x, y) => (people[y.id]?.xp || 0) - (people[x.id]?.xp || 0)).slice(0, 8).map((p) => p.id);
  teamData[id] = { matches, top, fanCount: cnt.count ?? list.length };
  await cmLoadFeed("team:" + id);
}

const scoreOf = (m) => m.status === "FINISHED" && m.home_score != null ? [m.home_score, m.away_score] : m.live_home != null ? [m.live_home, m.live_away] : null;
function teamMatchRow(m, id) {
  const nm = teamMatchName(id), home = m.home === nm;
  const opp = home ? m.away : m.home;
  const sc = scoreOf(m);
  const r = el("button", "tm-match"); r.type = "button";
  const live = ["IN_PLAY", "PAUSED"].includes(m.status);
  let res = null;
  if (m.status === "FINISHED" && sc) {
    const [f, g] = home ? sc : [sc[1], sc[0]];
    res = f > g ? ["ف", "win"] : f < g ? ["خ", "loss"] : ["ت", "draw"];
  }
  const tag = el("span", "tm-res " + (res ? res[1] : live ? "live" : "next"), res ? res[0] : live ? "🔴" : "⏭️");
  const mid = el("div", "tm-mid");
  mid.append(el("b", null, (home ? "🏠 " : "✈️ ") + opp));
  const fmt = new Intl.DateTimeFormat("ar", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  mid.append(el("span", null, live ? `مباشر · ${arNum(m.minute || 0)}′` : fmt.format(new Date(m.kickoff))));
  const right = el("span", "tm-score", sc ? `${arNum(sc[0])} - ${arNum(sc[1])}` : "");
  r.append(tag, mid, right);
  r.onclick = () => {
    if (inLiveWindow(m)) enterRoom(m);
    else if (m.lineups || m.stats) statsSheet(matchCache[m.id] || m);
    else toast("التفاصيل بتطلع قبل المباراة بشوي ⏳");
  };
  return r;
}

function cmDrawTeam(id) {
  const t = TEAM_BY_ID[id], d = teamData[id] || { matches: [], top: [], fanCount: 0 };
  const ch = CHANNELS.find((c) => c.id === LEAGUE_OF_TEAM[id]);
  const head = el("div", "tm-head");
  head.style.background = `linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 45%, #000))`;
  head.style.color = inkFor(t.color);
  head.append(el("div", "tm-crest", t.name.trim().charAt(0)), el("h2", null, t.name));
  head.append(el("span", "tm-sub", `${ch ? ch.flag + " " + ch.name : ""} · 👥 ${arNum(d.fanCount)} مشجع`));
  const mine = people[me.id]?.team === id;
  if (mine) head.append(el("span", "tm-mine", "💙 فريقك"));
  else {
    const b = el("button", "tm-fav", "⭐ خلّه فريقي"); b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      const { error } = await sb.from("profiles").update({ team: id }).eq("id", me.id);
      if (error) { toast("ما انحفظ."); b.disabled = false; return; }
      people[me.id].team = id; renderMe(); toast(`✅ صار ${t.name} فريقك`); drawCommunity(false);
    };
    head.append(b);
  }
  cmView.append(head);

  const now = Date.now();
  const live = d.matches.filter((m) => ["IN_PLAY", "PAUSED"].includes(m.status));
  const next = d.matches.filter((m) => new Date(m.kickoff) > now && !["FINISHED", "IN_PLAY", "PAUSED", "POSTPONED", "CANCELLED"].includes(m.status)).slice(0, 3);
  const past = d.matches.filter((m) => m.status === "FINISHED").slice(-5).reverse();
  const sec = (title) => { const s = el("section", "tm-sec"); s.append(el("h3", null, title)); cmView.append(s); return s; };
  if (live.length || next.length) { const s = sec(live.length ? "🔴 الحين" : "⏭️ الجاي"); for (const m of [...live, ...next]) s.append(teamMatchRow(m, id)); }
  if (past.length) {
    const s = sec("📊 آخر النتايج");
    const form = el("div", "tm-form");
    for (const m of [...past].reverse()) { const r = teamMatchRow(m, id).querySelector(".tm-res"); form.append(r.cloneNode(true)); }
    s.append(form);
    for (const m of past) s.append(teamMatchRow(m, id));
  }
  if (!live.length && !next.length && !past.length) cmView.append(el("p", "sheet-p", "ما فيه مباريات مسجّلة لهالفريق للحين."));
  if (d.top.length) {
    const s = sec("🏅 أقوى المشجعين");
    const row = el("div", "tm-fans");
    d.top.forEach((uid, i) => {
      const b = el("button", "tm-fan"); b.type = "button";
      const av = avatarEl(uid);
      b.append(el("span", "tm-rank", i < 3 ? ["🥇", "🥈", "🥉"][i] : arNum(i + 1)), av, el("b", null, nameOf(uid)));
      b.onclick = () => (uid === me.id ? cmOpen("user", uid) : profileSheet(uid));
      row.append(b);
    });
    s.append(row);
  }
  cmView.append(el("h3", "tm-h", `💬 الكلام عن ${t.name}`));
  cmDrawFeed("team:" + id);
}

/* ---------- search ---------- */
let cmQuery = "", cmSearchSeq = 0;
const norm = (s) => String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "").trim();
function cmDrawSearch() {
  const box = el("div", "sr-box");
  const inp = el("input", "sr-in"); inp.type = "search"; inp.placeholder = "🔍 ابحث عن شخص، فريق، منشور، أو #هاشتاق"; inp.value = cmQuery; inp.maxLength = 40;
  inp.enterKeyHint = "search";
  const res = el("div", "sr-res");
  box.append(inp);
  cmView.append(box, res);
  let tmr;
  inp.oninput = () => { cmQuery = inp.value; clearTimeout(tmr); tmr = setTimeout(() => cmRunSearch(res), 300); };
  cmRunSearch(res);
  if (!cmQuery) setTimeout(() => inp.focus(), 50);
}
function teamChip(id) {
  const t = TEAM_BY_ID[id];
  const b = el("button", "sr-team"); b.type = "button";
  b.style.setProperty("--tc", t.color); b.style.setProperty("--ti", inkFor(t.color));
  b.append(el("i", null, t.name.trim().charAt(0)), el("span", null, t.name));
  b.onclick = () => openTeam(id);
  return b;
}
async function cmRunSearch(res) {
  const my = ++cmSearchSeq;
  const raw = cmQuery.trim();
  const q = raw.replace(/^[@#]/, "").replace(/[%_,()*\\"']/g, "").slice(0, 40);
  const sec = (title) => { const s = el("section", "sr-sec"); s.append(el("h3", null, title)); return s; };
  if (!q) {
    res.textContent = "";
    const myTeam = people[me.id]?.team;
    const s = sec("⚽ الفرق");
    for (const lg of CHANNELS) {
      if (!TEAMS[lg.id]) continue;
      s.append(el("div", "sr-lg", lg.flag + " " + lg.name));
      const g = el("div", "sr-teams");
      for (const [id] of TEAMS[lg.id]) { const c = teamChip(id); if (id === myTeam) c.classList.add("mine"); g.append(c); }
      s.append(g);
    }
    const { data: tags } = await sb.rpc("trending_tags");
    if (my !== cmSearchSeq) return;
    if (tags?.length) {
      const t = sec("🔥 الهاشتاقات الرائجة"); const g = el("div", "sr-tags");
      for (const x of tags.slice(0, 10)) { const b = el("button", "sr-tag", "#" + x.tag); b.type = "button"; b.onclick = () => cmOpen("tag", x.tag); g.append(b); }
      t.append(g); res.append(t);
    }
    res.append(s);
    return;
  }
  res.textContent = ""; res.append(el("div", "cm-loading", "يدوّر…"));
  const nq = norm(q);
  const teams = Object.keys(TEAM_BY_ID).filter((id) => norm(TEAM_BY_ID[id].name).includes(nq) || norm(teamMatchName(id)).includes(nq) || id.includes(nq));
  const [pp, ps] = await Promise.all([
    sb.from("profiles").select("id,name,team,avatar_path,username").or(`username.ilike.${q.toLowerCase()}%,name.ilike.%${q}%`).limit(10),
    raw.startsWith("@") ? { data: [] } : sb.from("posts").select(CM_COLS).is("reply_to", null).ilike("body", `%${q}%`).order("created_at", { ascending: false }).limit(20),
  ]);
  if (my !== cmSearchSeq) return;
  const posts = (ps.data || []).filter(cmVisible);
  await cmHydrate(posts);
  const users = (pp.data || []).filter((p) => !blocked.has(p.id));
  for (const p of users) people[p.id] = { ...(people[p.id] || {}), name: p.name, team: p.team, avatar_path: p.avatar_path || null, username: p.username || null };
  await loadPeople(users.map((p) => p.id));
  if (my !== cmSearchSeq) return;
  res.textContent = "";
  if (/^[0-9A-Za-z_ء-ي٠-٩]{2,30}$/.test(q)) {
    const b = el("button", "sr-tag big", "#" + q + " ← شوف الهاشتاق"); b.type = "button";
    b.onclick = () => cmOpen("tag", q.toLowerCase());
    res.append(b);
  }
  if (teams.length) { const s = sec("⚽ الفرق"); const g = el("div", "sr-teams"); for (const id of teams.slice(0, 8)) g.append(teamChip(id)); s.append(g); res.append(s); }
  if (users.length) {
    const s = sec("👤 الناس");
    for (const p of users) {
      const r = el("button", "dm-item"); r.type = "button";
      const info = el("div", "dm-info");
      const top = el("div", "dm-top"); top.append(el("b", null, nameOf(p.id)));
      const lvb = levelBadge(p.id); if (lvb) { lvb.style.pointerEvents = "none"; top.append(lvb); }
      info.append(top);
      if (p.username) info.append(el("span", "cm-handle", "@" + p.username));
      r.append(avatarEl(p.id), info);
      const pill = teamPill(p.id); if (pill) r.append(pill);
      r.onclick = () => cmOpen("user", p.id);
      s.append(r);
    }
    res.append(s);
  }
  if (posts.length) { const s = sec("💬 المنشورات"); for (const p of posts) s.append(postCard(p)); res.append(s); }
  if (!teams.length && !users.length && !posts.length) res.append(cmEmpty("🔍", "ما لقينا شي", "جرّب كلمة ثانية أو اسم أقصر."));
}

/* ---------- the official account ---------- */
const OFFICIAL_ID = "a1a1a1a1-0000-4000-8000-000000000001";
const official = () => OFFICIAL_ID;
// Verified tick instead of a level, and the app icon as its photo
const _levelBadgeEx = levelBadge;
levelBadge = function (id) {
  if (id === OFFICIAL_ID || people[id]?.verified) { const b = el("span", "vbadge", "✓"); b.title = "حساب رسمي"; return b; }
  return _levelBadgeEx(id);
};
const _avatarElEx = avatarEl;
avatarEl = function (id) {
  const av = _avatarElEx(id);
  if (id === OFFICIAL_ID) { av.textContent = ""; av.classList.add("has-pic", "official"); av.style.backgroundImage = 'url("icon-192.png")'; }
  return av;
};

/* ---------- 👥 all members ---------- */
let cmMembers = null, cmMembersAt = 0, cmMemberQuery = "";
async function cmLoadMembers() {
  if (cmMembers && Date.now() - cmMembersAt < 2 * 60000) return;
  const { data } = await sb.from("profiles").select("id,name,team,avatar_path,username,verified,created_at").not("banned", "is", true).order("created_at", { ascending: true }).limit(1000);
  const list = (data || []).filter((p) => !blocked.has(p.id));
  for (const p of list) people[p.id] = { ...(people[p.id] || {}), name: p.name, team: p.team, avatar_path: p.avatar_path || null, username: p.username || null, verified: !!p.verified };
  // Levels, 100 at a time
  const ids = list.map((p) => p.id);
  const chunks = []; for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const lv = await Promise.all(chunks.map((c) => sb.rpc("user_levels", { ids: c }).then((r) => r.data || [], () => [])));
  for (const x of lv.flat()) if (people[x.id]) people[x.id].xp = x.xp;
  // The official account first, then the most active
  cmMembers = list.map((p) => ({ id: p.id, at: p.created_at })).sort((a, b) =>
    (b.id === OFFICIAL_ID) - (a.id === OFFICIAL_ID) || (people[b.id]?.xp || 0) - (people[a.id]?.xp || 0));
  cmMembersAt = Date.now();
}
function cmDrawMembers() {
  const list = cmMembers || [];
  const head = el("div", "mb-head");
  head.append(el("h2", "cm-title", `أعضاء مدرج هلا (${arNum(list.length)})`));
  const inp = el("input", "sr-in"); inp.type = "search"; inp.placeholder = "🔍 فلتر بالاسم أو اليوزر أو الفريق"; inp.value = cmMemberQuery; inp.maxLength = 30;
  head.append(inp);
  const box = el("div", "mb-list");
  cmView.append(head, box);
  const draw = () => {
    box.textContent = "";
    const q = norm(cmMemberQuery);
    const rows = list.filter(({ id }) => {
      if (!q) return true;
      const p = people[id] || {};
      return norm(p.name).includes(q) || norm(p.username).includes(q) || norm(TEAM_BY_ID[p.team]?.name).includes(q);
    });
    if (!rows.length) { box.append(cmEmpty("🔍", "ما لقينا أحد", "جرّب اسم ثاني.")); return; }
    for (const { id } of rows) {
      const r = el("div", "mb-row");
      const who = el("button", "mb-who"); who.type = "button";
      const info = el("div", "dm-info");
      const top = el("div", "dm-top"); top.append(el("b", null, nameOf(id) + (id === me.id ? " (أنت)" : "")));
      const lvb = levelBadge(id); if (lvb) top.append(lvb);
      info.append(top);
      const sub = el("div", "mb-sub");
      if (people[id]?.username) sub.append(el("span", "cm-handle", "@" + people[id].username));
      const pill = teamPill(id); if (pill) sub.append(pill);
      info.append(sub);
      who.append(avatarEl(id), info);
      who.onclick = () => cmOpen("user", id);
      r.append(who);
      if (id !== me.id) {
        const on = cmFollowing.has(id);
        const f = el("button", on ? "ghost mb-f" : "primary mb-f", on ? "تتابعه ✓" : "تابع"); f.type = "button";
        f.onclick = async () => {
          f.disabled = true;
          const follow = !cmFollowing.has(id);
          const { error } = follow ? await sb.from("follows").insert({ follower: me.id, followee: id })
            : await sb.from("follows").delete().eq("follower", me.id).eq("followee", id);
          f.disabled = false;
          if (error && error.code !== "23505") { toast("ما انحفظ."); return; }
          if (follow) cmFollowing.add(id); else cmFollowing.delete(id);
          delete cmFeeds.following;
          f.className = follow ? "ghost mb-f" : "primary mb-f"; f.textContent = follow ? "تتابعه ✓" : "تابع";
        };
        r.append(f);
      }
      box.append(r);
    }
  };
  let t; inp.oninput = () => { cmMemberQuery = inp.value; clearTimeout(t); t = setTimeout(draw, 150); };
  draw();
}
