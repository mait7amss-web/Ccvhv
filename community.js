/* ---------- 🌍 المجتمع العام: منشورات للجميع مثل تويتر، ومعها "رأي جريء" ----------
   Lives above the leagues as its own chip. Data and rules are in supabase/community.sql. */

const CM_COLS = "id,user_id,body,image_path,gif_url,audio_path,audio_secs,poll,take_match_id,reply_to,root_id,quote_of,mentions,tags,like_count,reply_count,repost_count,view_count,hidden,created_at,match_id";
const CM_PAGE = 25;
const cmPosts = {};                 // id -> post
const cmFeeds = {};                 // key -> { ids: [], done: bool }
const cmLiked = new Set();          // post ids I liked
const cmSaved = new Set();          // post ids I bookmarked
const cmPoll = {};                  // post id -> { user_id: option }
const cmTakeVotes = {};             // post id -> [{ user_id, agree }]
const cmVerdicts = {};              // post id -> [{ user_id, came_true }]
const cmMatches = {};               // match id -> match
let cmFollowing = new Set();        // user ids I follow
let community = (() => { try { return localStorage.getItem("hala.community") !== "0"; } catch { return true; } })();
let cmTab = "all";                  // all | following | trend | notifs
let cmStack = [];                   // pages opened on top of the tab: { kind: "thread"|"user"|"tag", id }
let cmUnread = 0, cmNewCount = 0, cmMissing = false, cmLoaded = false;

const cmPage = () => cmStack[cmStack.length - 1] || null;
const cmBare = (p) => p.quote_of && !p.body && !p.image_path && !p.gif_url && !p.audio_path && !p.poll;
const arNum = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
function cmAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "الحين";
  if (s < 3600) return `${arNum(Math.floor(s / 60))} د`;
  if (s < 86400) return `${arNum(Math.floor(s / 3600))} س`;
  if (s < 7 * 86400) return `${arNum(Math.floor(s / 86400))} يوم`;
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short" }).format(new Date(iso));
}

/* ---------- the shell: chip, strip tabs, view, write button ---------- */
const cmView = el("div", "wrap pane cm"); cmView.id = "communityView"; cmView.hidden = true;
$("scroller").append(cmView);
const cmTabs = el("div", "wrap views cm-tabs"); cmTabs.id = "cViews"; cmTabs.hidden = true;
$("strip").append(cmTabs);
for (const [id, label] of [["all", "الكل"], ["following", "أتابعهم"], ["trend", "🔥 الترند"], ["notifs", "🔔"]]) {
  const b = el("button", null, label); b.type = "button"; b.dataset.tab = id;
  if (id === "notifs") { b.setAttribute("aria-label", "الإشعارات"); b.append(el("span", "cm-badge")); }
  b.onclick = () => { cmTab = id; cmStack = []; drawCommunity(true); };
  cmTabs.append(b);
}
const cmFab = el("button", "cm-fab", "✍️"); cmFab.type = "button"; cmFab.hidden = true;
cmFab.setAttribute("aria-label", "منشور جديد");
cmFab.onclick = () => composeSheet({});
document.body.append(cmFab);
const cmNewPill = el("button", "cm-new"); cmNewPill.type = "button"; cmNewPill.hidden = true;
cmNewPill.onclick = () => { cmNewCount = 0; cmNewPill.hidden = true; delete cmFeeds[cmTab]; drawCommunity(true); };
cmView.before(cmNewPill);

function setCommunity(on) {
  community = on;
  try { localStorage.setItem("hala.community", on ? "1" : "0"); } catch {}
}

const _renderLeaguesCm = renderLeagues;
renderLeagues = function () {
  _renderLeaguesCm();
  const box = $("chips");
  // League chips leave the community when tapped.
  [...box.children].forEach((b, i) => { const id = CHANNELS[i].id; b.onclick = () => { setCommunity(false); openChannel(id); }; if (community) b.setAttribute("aria-pressed", "false"); });
  const c = el("button", "lg cm-chip"); c.type = "button"; c.title = "المجتمع العام";
  c.style.setProperty("--c", "#f2b134"); c.style.setProperty("--ci", "#1c1300");
  c.setAttribute("aria-pressed", String(community));
  const f = el("span", "flag", "🌍"); f.setAttribute("aria-hidden", "true");
  c.append(f, el("span", "nm", "المجتمع"));
  c.onclick = () => { setCommunity(true); cmStack = []; renderLeagues(); refreshView(true); };
  box.prepend(c);
  if (community) { document.body.dataset.league = "community"; $("leagueName").textContent = "🌍 المجتمع العام · كل الدوريات"; }
};

const _refreshViewCm = refreshView;
refreshView = async function (jump) {
  const leagueTabs = $("vChat").parentElement;
  leagueTabs.hidden = community; cmTabs.hidden = !community;
  cmView.hidden = !community; cmFab.hidden = !community || cmPage()?.kind === "thread";
  if (!community) { cmNewPill.hidden = true; return _refreshViewCm(jump); }
  for (const id of ["thread", "roomsView", "predView", "tableView", "arenaView", "chatFooter", "liveBanner"]) if ($(id)) $(id).hidden = true;
  return drawCommunity(jump);
};

/* ---------- loading ---------- */
async function cmHydrate(list) {
  const fresh = list.filter(Boolean);
  for (const p of fresh) cmPosts[p.id] = p;
  // Quoted posts
  const qids = [...new Set(fresh.map((p) => p.quote_of).filter((id) => id && !cmPosts[id]))];
  if (qids.length) { const { data } = await sb.from("posts").select(CM_COLS).in("id", qids); for (const p of data || []) { cmPosts[p.id] = p; fresh.push(p); } }
  const ids = fresh.map((p) => p.id);
  const polls = fresh.filter((p) => p.poll).map((p) => p.id);
  const takes = fresh.filter((p) => p.take_match_id).map((p) => p.id);
  const mids = [...new Set(fresh.flatMap((p) => [p.take_match_id, p.match_id]).filter((m) => m && !cmMatches[m]))];
  const [lk, pv, tv, vd, ms] = await Promise.all([
    ids.length ? sb.from("post_likes").select("post_id").eq("user_id", me.id).in("post_id", ids) : { data: [] },
    polls.length ? sb.from("post_poll_votes").select("post_id,user_id,option").in("post_id", polls) : { data: [] },
    takes.length ? sb.from("take_votes").select("post_id,user_id,agree").in("post_id", takes) : { data: [] },
    takes.length ? sb.from("take_verdicts").select("post_id,user_id,came_true").in("post_id", takes) : { data: [] },
    mids.length ? sb.from("matches").select("id,channel,home,away,kickoff,home_score,away_score").in("id", mids) : { data: [] },
  ]);
  for (const x of lk.data || []) cmLiked.add(x.post_id);
  for (const id of polls) cmPoll[id] = {};
  for (const x of pv.data || []) cmPoll[x.post_id][x.user_id] = x.option;
  for (const id of takes) { cmTakeVotes[id] = []; cmVerdicts[id] = []; }
  for (const x of tv.data || []) cmTakeVotes[x.post_id].push(x);
  for (const x of vd.data || []) cmVerdicts[x.post_id].push(x);
  for (const m of ms.data || []) cmMatches[m.id] = m;
  await Promise.all([
    loadPeople(fresh.flatMap((p) => [p.user_id, ...(p.mentions || [])])),
    signUrls(fresh.filter((p) => p.image_path).map((p) => p.image_path)),
  ]).catch(() => {});
}

async function cmLoadFeed(key, more) {
  if (key === "saved") {
    const { data: bm, error } = await sb.from("bookmarks").select("post_id,created_at").eq("user_id", me.id).order("created_at", { ascending: false }).limit(100);
    if (error) { cmMissing = true; return; }
    const ids = (bm || []).map((b) => b.post_id);
    const { data } = ids.length ? await sb.from("posts").select(CM_COLS).in("id", ids) : { data: [] };
    await cmHydrate(data || []);
    cmFeeds.saved = { ids: ids.filter((id) => cmPosts[id]), done: true };
    return;
  }
  const feed = (cmFeeds[key] ||= { ids: [], done: false });
  if (more && feed.done) return;
  let q = sb.from("posts").select(CM_COLS).order("created_at", { ascending: false }).limit(CM_PAGE);
  if (key === "all") q = q.is("reply_to", null);
  else if (key === "following") q = q.is("reply_to", null).in("user_id", [...cmFollowing, me.id]);
  else if (key === "takes") q = q.not("take_match_id", "is", null);
  else if (key.startsWith("tag:")) q = q.contains("tags", [key.slice(4)]);
  else if (key.startsWith("user:")) q = q.eq("user_id", key.slice(5)).is("reply_to", null);
  if (more && feed.ids.length) q = q.lt("created_at", cmPosts[feed.ids[feed.ids.length - 1]].created_at);
  const { data, error } = await q;
  if (error) { cmMissing = true; return; }
  cmMissing = false;
  await cmHydrate(data || []);
  const ids = (data || []).map((p) => p.id);
  feed.ids = more ? feed.ids.concat(ids.filter((id) => !feed.ids.includes(id))) : ids;
  feed.done = (data || []).length < CM_PAGE;
}

async function cmLoadThread(id) {
  let p = cmPosts[id];
  if (!p) { const { data } = await sb.from("posts").select(CM_COLS).eq("id", id).maybeSingle(); if (!data) return null; p = data; }
  const rootId = p.root_id || p.id;
  const [{ data: root }, { data: replies }] = await Promise.all([
    sb.from("posts").select(CM_COLS).eq("id", rootId).maybeSingle(),
    sb.from("posts").select(CM_COLS).eq("root_id", rootId).order("created_at", { ascending: true }).limit(300),
  ]);
  await cmHydrate([root, ...(replies || [])]);
  if (!root) return null;
  cmFeeds["thread:" + rootId] = { ids: (replies || []).map((r) => r.id), done: true };
  return rootId;
}

async function cmLoadBasics() {
  if (cmLoaded) return;
  cmLoaded = true;
  const [{ data: fol }, { count }, { data: saved }] = await Promise.all([
    sb.from("follows").select("followee").eq("follower", me.id),
    sb.from("community_notifs").select("id", { count: "exact", head: true }).eq("read", false),
    sb.from("bookmarks").select("post_id").eq("user_id", me.id).limit(2000),
  ]);
  for (const b of saved || []) cmSaved.add(b.post_id);
  cmFollowing = new Set((fol || []).map((f) => f.followee));
  cmSetUnread(count || 0);
}
function cmSetUnread(n) {
  cmUnread = n;
  const b = cmTabs.querySelector(".cm-badge"); if (b) { b.textContent = n > 9 ? "+٩" : n ? arNum(n) : ""; b.hidden = !n; }
}

/* ---------- drawing ---------- */
let cmDrawSeq = 0;
async function drawCommunity(jump) {
  const seq = ++cmDrawSeq;
  if (communityLink) {
    const l = communityLink; communityLink = null;
    if (l.notifs) { cmTab = "notifs"; cmStack = []; }
    else if (l.post) cmStack = [{ kind: "thread", id: l.post }];
    else if (l.user) cmStack = [{ kind: "user", id: l.user }];
    else if (l.uname) {
      const { data: u } = await sb.from("profiles").select("id").eq("username", l.uname).maybeSingle();
      if (u) cmStack = [{ kind: "user", id: u.id }];
      else toast("ما لقينا هاليوزر.");
    }
  }
  for (const b of cmTabs.children) b.setAttribute("aria-pressed", String(!cmPage() && b.dataset.tab === cmTab));
  cmFab.hidden = !community || cmPage()?.kind === "thread";
  await cmLoadBasics();
  const page = cmPage();
  if (jump) { cmView.textContent = ""; cmView.append(el("div", "cm-loading", "يحمّل…")); }
  let draw;
  if (page?.kind === "thread") { const rootId = await cmLoadThread(page.id); draw = () => cmDrawThread(rootId, page.id); }
  else if (page?.kind === "user") { await Promise.all([cmLoadFeed("user:" + page.id), loadPeople([page.id])]); const { data } = await sb.rpc("profile_counts", { u: page.id }); draw = () => cmDrawProfile(page.id, data || {}); }
  else if (page?.kind === "saved") { await cmLoadFeed("saved"); draw = () => cmDrawFeed("saved", "🔖 محفوظاتي"); }
  else if (page?.kind === "tag") { await cmLoadFeed("tag:" + page.id); draw = () => cmDrawFeed("tag:" + page.id, "#" + page.id); }
  else if (cmTab === "trend") { const [{ data: tags }] = await Promise.all([sb.rpc("trending_tags"), cmLoadFeed("takes")]); draw = () => cmDrawTrend(tags || []); }
  else if (cmTab === "notifs") { const list = await cmLoadNotifs(); draw = () => cmDrawNotifs(list); }
  else { if (!cmFeeds[cmTab]) await cmLoadFeed(cmTab); draw = () => cmDrawFeed(cmTab); }
  if (seq !== cmDrawSeq || !community) return;
  cmView.textContent = "";
  if (cmMissing) { cmView.append(cmEmpty("🛠️", "المجتمع يتجهز", "قريب بيشتغل إن شاء الله.")); return; }
  if (page) {
    const back = el("button", "ar-back", "→ رجوع"); back.type = "button";
    back.onclick = () => { cmStack.pop(); drawCommunity(true); };
    cmView.append(back);
  }
  draw();
  if (jump) $("scroller").scrollTop = 0;
}
function cmEmpty(ico, title, text) {
  const e = el("div", "empty"); const i = el("span", "ico", ico); i.setAttribute("aria-hidden", "true");
  e.append(i, el("strong", null, title), el("div", null, text));
  return e;
}
const cmVisible = (p) => p && !blocked.has(p.user_id) && !hiddenLocal.has("p" + p.id);

function cmDrawFeed(key, title) {
  if (title) cmView.append(el("h2", "cm-title", title));
  if (key === "all" || key === "following") cmView.append(cmPrompt());
  if (key === "all") cmView.append(cmArenaStrip());
  const feed = cmFeeds[key] || { ids: [] };
  const list = feed.ids.map((id) => cmPosts[id]).filter(cmVisible);
  if (!list.length) {
    cmView.append(key === "following"
      ? cmEmpty("👥", "ما تتابع أحد للحين", "تابع الناس اللي يعجبك كلامهم من صفحاتهم، ومنشوراتهم بتطلع هنا.")
      : key === "saved" ? cmEmpty("🔖", "ما حفظت شي للحين", "اضغط علامة الحفظ تحت أي منشور، ويطلع لك هنا.")
      : cmEmpty("🌍", "كن أول واحد ينشر", "اكتب رأيك، نزّل صورة، أو تحدّى الكل برأي جريء 🔥"));
    return;
  }
  for (const p of list) cmView.append(postCard(p));
  if (!feed.done) {
    const more = el("button", "ghost cm-more", "اعرض أكثر"); more.type = "button";
    more.onclick = async () => { more.disabled = true; await cmLoadFeed(key, true); drawCommunity(false); };
    cmView.append(more);
  }
}
function cmPrompt() {
  const b = el("button", "cm-prompt"); b.type = "button";
  b.append(avatarEl(me.id), el("span", null, "وش رايك في كورة اليوم؟"), el("i", null, "🔥 رأي جريء"));
  b.onclick = () => composeSheet({});
  b.lastChild.onclick = (e) => { e.stopPropagation(); composeSheet({ take: true }); };
  return b;
}

function cmDrawThread(rootId, focusId) {
  const root = cmPosts[rootId];
  if (!root || !cmVisible(root)) { cmView.append(cmEmpty("🗑️", "المنشور مو موجود", "يمكن انحذف أو انخفى.")); return; }
  cmView.append(postCard(root, { big: true }));
  const replies = (cmFeeds["thread:" + rootId]?.ids || []).map((id) => cmPosts[id]).filter(cmVisible);
  const box = el("div", "cm-replies");
  for (const r of replies) box.append(postCard(r, { reply: true }));
  if (!replies.length) box.append(el("p", "sheet-p cm-noreply", "ما أحد رد للحين. كن الأول 👇"));
  cmView.append(box);
  const reply = el("button", "primary cm-replybtn", "💬 اكتب ردك"); reply.type = "button";
  reply.onclick = () => composeSheet({ reply: root });
  cmView.append(reply);
  if (focusId && focusId !== rootId) setTimeout(() => document.querySelector(`.post[data-id="${focusId}"]`)?.scrollIntoView({ block: "center" }), 50);
}

function cmDrawProfile(uid, c) {
  const head = el("div", "cm-prof");
  let av = avatarEl(uid); av.classList.add("big");
  if (uid === me.id) {
    // Tap your photo to change it
    const wrap = el("button", "cm-avbtn"); wrap.type = "button"; wrap.setAttribute("aria-label", "غيّر صورتك");
    wrap.append(av, el("span", "cm-cam", "📷"));
    wrap.onclick = avatarSheet;
    av = wrap;
  }
  const info = el("div", "cm-pinfo");
  const nmRow = el("div", "cm-nmrow"); nmRow.append(el("b", null, nameOf(uid)));
  const lvb = levelBadge(uid); if (lvb) nmRow.append(lvb);
  info.append(nmRow);
  if (people[uid]?.username) info.append(el("span", "cm-handle", "@" + people[uid].username));
  const pill = teamPill(uid); if (pill) info.append(pill);
  head.append(av, info);
  if (uid !== me.id) {
    const following = cmFollowing.has(uid);
    const f = el("button", following ? "ghost" : "primary cm-follow", following ? "تتابعه ✓" : "تابع"); f.type = "button";
    f.onclick = () => cmToggleFollow(uid, f);
    head.append(f);
  }
  cmView.append(head);
  if (uid === me.id) {
    const acts = el("div", "cm-meacts");
    const add = (label, fn) => { const b = el("button", "ghost", label); b.type = "button"; b.onclick = fn; acts.append(b); };
    add("📷 صورتي", avatarSheet);
    add("🔖 محفوظاتي", () => cmOpen("saved", null));
    add("⚙️ الإعدادات", () => openSettings());
    cmView.append(acts);
    const ig = el("button", "cm-ig", "📸 شارك بروفايلك في انستقرام"); ig.type = "button";
    ig.onclick = () => shareProfileCard(uid, c);
    cmView.append(ig);
    const tourBtn = el("button", "link", "🎓 شوف الجولة التعريفية مرة ثانية"); tourBtn.type = "button";
    tourBtn.onclick = () => startTour();
    cmView.append(tourBtn);
  }
  const stats = el("div", "cm-stats");
  for (const [n, label] of [[c.posts, "منشور"], [c.followers, "متابع"], [c.following, "يتابع"], [c.takes_right, "رأي صدق ✅"]]) {
    const s = el("div"); s.append(el("b", null, arNum(n || 0)), el("span", null, label)); stats.append(s);
  }
  cmView.append(stats);
  cmDrawFeed("user:" + uid);
}

function cmDrawTrend(tags) {
  cmView.append(el("h2", "cm-title", "🔥 الترند اليوم"));
  if (!tags.length) cmView.append(el("p", "sheet-p", "ما فيه هاشتاقات اليوم. اكتب # قبل أي كلمة في منشورك عشان تصير ترند."));
  const list = el("div", "cm-trends");
  tags.forEach((t, i) => {
    const b = el("button", "cm-trend"); b.type = "button";
    b.append(el("span", "r", arNum(i + 1)), el("b", null, "#" + t.tag), el("span", "n", `${arNum(t.n)} منشور`));
    b.onclick = () => cmOpen("tag", t.tag);
    list.append(b);
  });
  cmView.append(list);
  cmView.append(el("h2", "cm-title", "🎯 آراء جريئة تنتظر الحكم"));
  const now = Date.now();
  const takes = (cmFeeds.takes?.ids || []).map((id) => cmPosts[id]).filter(cmVisible)
    .filter((p) => { const m = cmMatches[p.take_match_id]; return m && new Date(m.kickoff).getTime() > now - 3 * 86400000; });
  if (!takes.length) cmView.append(el("p", "sheet-p", "ما فيه آراء جريئة للمباريات الجاية. اكتب أول واحد!"));
  for (const p of takes) cmView.append(postCard(p));
}

function cmOpen(kind, id) { cmStack.push({ kind, id }); drawCommunity(true); }

/* ---------- a post ---------- */
function postCard(p, opts = {}) {
  if (cmBare(p)) {
    const q = cmPosts[p.quote_of];
    const wrap = el("div", "cm-repost");
    const by = el("button", "cm-rpby", `🔁 ${nameOf(p.user_id)} أعاد النشر`); by.type = "button";
    by.onclick = () => cmOpen("user", p.user_id);
    wrap.append(by, q && cmVisible(q) ? postCard(q) : el("div", "post gone", "المنشور الأصلي انحذف"));
    return wrap;
  }
  const card = el("article", "post" + (opts.big ? " big" : "") + (opts.reply ? " reply" : "") + (p.hidden ? " hiddenp" : ""));
  card.dataset.id = p.id;
  const hd = el("div", "post-hd");
  const av = avatarEl(p.user_id); av.onclick = (e) => { e.stopPropagation(); cmOpen("user", p.user_id); };
  const who = el("button", "post-who"); who.type = "button";
  who.append(el("b", null, nameOf(p.user_id)));
  const lvb = levelBadge(p.user_id); if (lvb) who.append(lvb);
  const pill = teamPill(p.user_id); if (pill) who.append(pill);
  who.onclick = (e) => { e.stopPropagation(); cmOpen("user", p.user_id); };
  const more = el("button", "post-more", "⋯"); more.type = "button"; more.setAttribute("aria-label", "خيارات");
  more.onclick = (e) => { e.stopPropagation(); postMenu(p); };
  hd.append(av, who, el("span", "post-time", cmAgo(p.created_at)), more);
  card.append(hd);
  if (p.hidden) card.append(el("div", "post-flag", "🚩 مخفي بسبب البلاغات"));
  if (opts.reply && p.reply_to && p.reply_to !== p.root_id && cmPosts[p.reply_to]) {
    card.append(el("div", "post-re", "رد على " + nameOf(cmPosts[p.reply_to].user_id)));
  }
  if (p.take_match_id) card.append(takeHead(p));
  if (p.body) card.append(postBody(p));
  if (p.match_id && cmMatches[p.match_id]) {
    const m = cmMatches[p.match_id], open = inLiveWindow(m);
    const rb = el("button", "post-room" + (open ? "" : " closed")); rb.type = "button";
    rb.append(el("b", null, `🏟️ ${m.home} × ${m.away}`), el("span", null, open ? "🔴 ادخل الغرفة" : "🔒 انقفلت"));
    rb.onclick = (e) => { e.stopPropagation(); open ? enterRoom(m) : (m.stats || m.lineups ? statsSheet(m) : toast("🔒 الغرفة انقفلت")); };
    card.append(rb);
  }
  if (p.poll) card.append(postPoll(p));
  if (p.image_path) {
    const im = el("img", "post-img"); im.alt = "صورة"; im.loading = "lazy";
    im.src = signed[p.image_path]?.url || "";
    im.onclick = (e) => { e.stopPropagation(); if (im.src) { $("viewerImg").src = im.src; $("viewer").hidden = false; } };
    card.append(im);
  }
  if (p.gif_url) { const g = el("img", "post-img"); g.src = p.gif_url; g.alt = "GIF"; g.loading = "lazy"; card.append(g); }
  if (p.audio_path) card.append(voiceEl({ id: "p" + p.id, audio_path: p.audio_path, audio_secs: p.audio_secs }));
  if (p.take_match_id) card.append(takeVotesEl(p));
  if (p.quote_of) {
    const q = cmPosts[p.quote_of];
    const qb = el("div", "post-quote");
    if (q && cmVisible(q)) {
      qb.append(el("b", null, nameOf(q.user_id)), el("div", null, q.body || (q.image_path ? "📷 صورة" : q.audio_path ? "🎤 صوت" : q.gif_url ? "GIF" : q.poll ? "📊 تصويت" : "")));
      qb.onclick = (e) => { e.stopPropagation(); cmOpen("thread", q.id); };
    } else qb.textContent = "المنشور الأصلي انحذف";
    card.append(qb);
  }
  card.append(postActions(p));
  if (!opts.big) card.onclick = (e) => { if (e.target.closest("button, a, .voice, .poll, img")) return; cmOpen("thread", p.id); };
  return card;
}

function postBody(p) {
  const box = el("div", "post-body");
  const names = (p.mentions || []).flatMap((id) => [people[id]?.name, people[id]?.username]).filter(Boolean).sort((a, b) => b.length - a.length);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp((names.length ? "@(" + names.map(esc).join("|") + ")|" : "") + "#([0-9A-Za-z_\\u0621-\\u064A\\u0660-\\u0669]{2,30})", "g");
  let last = 0, mt;
  while ((mt = re.exec(p.body))) {
    box.append(p.body.slice(last, mt.index));
    if (mt[0][0] === "@") {
      const id = (p.mentions || []).find((i) => people[i]?.name === mt[1] || people[i]?.username === mt[1]);
      const s = el("span", "mention" + (id === me.id ? " me" : ""), mt[0]);
      if (id) s.onclick = (e) => { e.stopPropagation(); cmOpen("user", id); };
      box.append(s);
    } else {
      const tag = mt[0].slice(1).toLowerCase();
      const a = el("span", "cm-tag", mt[0]); a.onclick = (e) => { e.stopPropagation(); cmOpen("tag", tag); };
      box.append(a);
    }
    last = mt.index + mt[0].length;
  }
  box.append(p.body.slice(last));
  return box;
}

function postPoll(p) {
  const box = el("div", "poll cm-poll");
  const v = cmPoll[p.id] || {};
  const counts = p.poll.options.map((_, i) => Object.values(v).filter((o) => o === i).length);
  const total = counts.reduce((a, b) => a + b, 0), mine = v[me.id];
  p.poll.options.forEach((label, i) => {
    const o = el("button", "opt" + (mine === i ? " on" : "")); o.type = "button";
    const pct = total ? Math.round(counts[i] / total * 100) : 0;
    const bar = el("span", "bar"); bar.style.width = pct + "%";
    o.append(bar, el("span", "lbl", label), el("span", "n", total ? arNum(pct) + "٪" : ""));
    o.onclick = async (e) => {
      e.stopPropagation();
      (cmPoll[p.id] ||= {})[me.id] = i; box.replaceWith(postPoll(p));
      const { error } = await sb.from("post_poll_votes").upsert({ post_id: p.id, user_id: me.id, option: i });
      if (error) toast("ما انحسب صوتك.");
    };
    box.append(o);
  });
  box.append(el("div", "tot", total ? `${arNum(total)} صوت` : "ما أحد صوّت للحين"));
  return box;
}

/* ---------- 🔥 رأي جريء ---------- */
function takeState(p) {
  const m = cmMatches[p.take_match_id];
  if (!m) return { phase: "unknown" };
  const kick = new Date(m.kickoff).getTime(), now = Date.now();
  if (now < kick) return { phase: "open", m };
  const v = cmVerdicts[p.id] || [], yes = v.filter((x) => x.came_true).length;
  const decided = v.length >= 3 ? (yes / v.length >= 0.6 ? "right" : (v.length - yes) / v.length >= 0.6 ? "wrong" : null) : null;
  const finished = m.home_score != null || now > kick + 2 * 3600000;
  if (!finished) return { phase: "live", m };
  return { phase: "judge", m, decided, yes, total: v.length, open: now < kick + 3 * 86400000 };
}
function takeHead(p) {
  const st = takeState(p), m = st.m;
  const h = el("div", "take-hd");
  h.append(el("span", "take-tag", "🔥 رأي جريء"));
  if (m) h.append(el("span", "take-m", `${m.home} × ${m.away}` + (m.home_score != null ? ` (${m.home_score}-${m.away_score})` : "")));
  if (st.decided === "right") h.append(el("span", "take-stamp ok", "✅ قالها قبل الكل"));
  if (st.decided === "wrong") h.append(el("span", "take-stamp no", "❌ طلع هبد"));
  return h;
}
function takeVotesEl(p) {
  const st = takeState(p), mine = p.user_id === me.id;
  const box = el("div", "take-votes");
  const btn = (label, n, on, fn, disabled) => {
    const b = el("button", "take-b" + (on ? " on" : ""), `${label} ${n ? arNum(n) : ""}`.trim()); b.type = "button";
    b.disabled = disabled; b.onclick = async (e) => { e.stopPropagation(); await fn(); };
    return b;
  };
  if (st.phase === "open") {
    const v = cmTakeVotes[p.id] || [], my = v.find((x) => x.user_id === me.id);
    const yes = v.filter((x) => x.agree).length, no = v.length - yes;
    const vote = (agree) => async () => {
      const list = (cmTakeVotes[p.id] ||= []).filter((x) => x.user_id !== me.id); list.push({ user_id: me.id, agree }); cmTakeVotes[p.id] = list;
      box.replaceWith(takeVotesEl(p));
      const { error } = await sb.from("take_votes").upsert({ post_id: p.id, user_id: me.id, agree });
      if (error) toast("ما انحسب صوتك.");
    };
    box.append(btn("👍 صح", yes, my?.agree === true, vote(true), mine), btn("🙄 هبد", no, my?.agree === false, vote(false), mine));
    box.append(el("span", "take-note", mine ? "الناس يصوتون على رأيك قبل المباراة" : "صوّت قبل صافرة البداية"));
  } else if (st.phase === "live") {
    box.append(el("span", "take-note", "⏳ المباراة شغالة… بعدها الجمهور يحكم إذا صدق"));
  } else if (st.phase === "judge") {
    const v = cmVerdicts[p.id] || [], my = v.find((x) => x.user_id === me.id);
    const judge = (came_true) => async () => {
      const list = (cmVerdicts[p.id] ||= []).filter((x) => x.user_id !== me.id); list.push({ user_id: me.id, came_true }); cmVerdicts[p.id] = list;
      const card = box.closest(".post"); if (card) card.replaceWith(postCard(p, { big: card.classList.contains("big"), reply: card.classList.contains("reply") }));
      const { error } = await sb.from("take_verdicts").upsert({ post_id: p.id, user_id: me.id, came_true });
      if (error) toast("ما انحسب حكمك.");
    };
    if (st.open && !mine) box.append(btn("✅ صدق", st.yes, my?.came_true === true, judge(true)), btn("❌ ما صدق", st.total - st.yes, my?.came_true === false, judge(false)));
    else box.append(el("span", "take-note", `${arNum(st.yes)} قالوا صدق · ${arNum(st.total - st.yes)} قالوا لا`));
    if (!st.decided && st.open) box.append(el("span", "take-note", "انتهت المباراة. صدق ولا لا؟"));
  }
  return box;
}

/* ---------- actions ---------- */
// Line icons, X-style. Order in RTL (right to left): repost, reply, like, views, save, share.
const CM_ICONS = {
  repost: '<path d="M17 2.5l3 3-3 3"/><path d="M20 5.5H9a4 4 0 0 0-4 4V11"/><path d="M7 21.5l-3-3 3-3"/><path d="M4 18.5h11a4 4 0 0 0 4-4V13"/>',
  reply: '<path d="M12 3.5c4.7 0 8.5 3.3 8.5 7.6s-3.8 7.6-8.5 7.6c-1 0-2-.1-2.9-.4L4.5 20.5l1.3-3.7C4.4 15.4 3.5 13.4 3.5 11.1 3.5 6.8 7.3 3.5 12 3.5z"/><path d="M8.5 11h7"/>',
  like: '<path d="M12 20.3s-7.8-4.6-7.8-10.3A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.8 2.4c0 5.7-7.8 10.3-7.8 10.3z"/>',
  views: '<path d="M5.5 20V12.5"/><path d="M12 20V5"/><path d="M18.5 20v-9"/>',
  save: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
  share: '<path d="M12 15V3.5"/><path d="M7.5 8L12 3.5 16.5 8"/><path d="M4.5 13.5v5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/>',
};
function cmIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.classList.add("i");
  svg.innerHTML = CM_ICONS[name];
  return svg;
}
function postActions(p) {
  const row = el("div", "post-acts");
  const act = (ico, n, cls, fn, label) => {
    const b = el("button", "pa " + ico + " " + (cls || "")); b.type = "button"; b.setAttribute("aria-label", label);
    b.append(cmIcon(ico), el("span", "n", n ? cmShort(n) : ""));
    b.onclick = (e) => { e.stopPropagation(); fn(b); };
    row.append(b);
  };
  act("repost", p.repost_count, "", () => repostSheet(p), "إعادة نشر");
  act("reply", p.reply_count, "", () => composeSheet({ reply: p }), "رد");
  act("like", p.like_count, cmLiked.has(p.id) ? "on" : "", (b) => cmToggleLike(p, b), "إعجاب");
  act("views", p.view_count, "", () => toast(`👀 شافه ${arNum(p.view_count || 0)} شخص`), "المشاهدات");
  act("save", 0, cmSaved.has(p.id) ? "on" : "", (b) => cmToggleSave(p, b), "حفظ");
  act("share", 0, "", () => cmShare(p), "مشاركة");
  cmWatch(row, p);
  return row;
}
// 1200 → 1.2K style, in Arabic digits
function cmShort(n) {
  if (n < 1000) return arNum(n);
  if (n < 1e6) return arNum(+(n / 1000).toFixed(n < 1e4 ? 1 : 0)) + "K";
  return arNum(+(n / 1e6).toFixed(1)) + "M";
}
async function cmToggleSave(p, b) {
  const on = !cmSaved.has(p.id);
  if (on) cmSaved.add(p.id); else cmSaved.delete(p.id);
  b.classList.toggle("on", on);
  toast(on ? "🔖 انحفظ في محفوظاتك" : "انشال من المحفوظات");
  const { error } = on
    ? await sb.from("bookmarks").insert({ post_id: p.id, user_id: me.id })
    : await sb.from("bookmarks").delete().eq("post_id", p.id).eq("user_id", me.id);
  if (error && error.code !== "23505") toast("ما انحفظ. جرّب مرة ثانية.");
  delete cmFeeds.saved;
}

/* ---------- views: a post counts once per person, when it shows on screen ---------- */
const cmSeen = new Set(), cmSeenQueue = new Set();
const cmObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const id = Number(e.target.dataset.pid); cmObserver.unobserve(e.target);
    const p = cmPosts[id];
    if (!p || cmSeen.has(id) || p.user_id === me.id) continue;
    cmSeen.add(id); cmSeenQueue.add(id);
  }
}, { threshold: 0.6 }) : null;
function cmWatch(row, p) { if (cmObserver && !cmSeen.has(p.id)) { row.dataset.pid = p.id; cmObserver.observe(row); } }
setInterval(() => {
  if (!cmSeenQueue.size) return;
  const ids = [...cmSeenQueue]; cmSeenQueue.clear();
  sb.rpc("post_seen", { ids }).then(() => {}, () => {});
}, 4000);
async function cmToggleLike(p, b) {
  const on = !cmLiked.has(p.id);
  if (on) { cmLiked.add(p.id); p.like_count++; } else { cmLiked.delete(p.id); p.like_count = Math.max(0, p.like_count - 1); }
  b.classList.toggle("on", on);
  b.querySelector(".n").textContent = p.like_count ? cmShort(p.like_count) : "";
  if (on) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  const { error } = on
    ? await sb.from("post_likes").insert({ post_id: p.id, user_id: me.id })
    : await sb.from("post_likes").delete().eq("post_id", p.id).eq("user_id", me.id);
  if (error && error.code !== "23505") toast("ما انحفظ الإعجاب.");
}
function repostSheet(p) {
  openSheet("🔁 إعادة نشر", (s) => {
    const a = el("button", "primary", "🔁 أعد نشره لمتابعينك"); a.type = "button";
    a.onclick = async () => {
      closeSheet();
      const { error } = await sb.from("posts").insert({ user_id: me.id, quote_of: p.id });
      if (error) { toast(error.code === "23505" ? "سبق وأعدت نشره." : cmErr(error)); return; }
      p.repost_count++; toast("انعاد نشره ✅"); delete cmFeeds.all; delete cmFeeds.following; drawCommunity(false);
    };
    const b = el("button", "ghost cm-wide", "✍️ اقتبسه وأضف رأيك"); b.type = "button";
    b.onclick = () => { closeSheet(); composeSheet({ quote: p }); };
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet;
    s.append(a, b, c);
  });
}
function cmShare(p) {
  const url = location.origin + location.pathname + `?view=community&post=${p.id}`;
  const text = `${nameOf(p.user_id)} في مدرج هلا: ${(p.body || "").slice(0, 120)}`;
  if (navigator.share) navigator.share({ title: "مدرج هلا", text, url }).catch(() => {});
  else navigator.clipboard?.writeText(text + "\n" + url).then(() => toast("انسخ الرابط ✅"), () => {});
}
async function cmToggleFollow(uid, btn) {
  btn.disabled = true;
  const on = !cmFollowing.has(uid);
  const { error } = on
    ? await sb.from("follows").insert({ follower: me.id, followee: uid })
    : await sb.from("follows").delete().eq("follower", me.id).eq("followee", uid);
  if (error && error.code !== "23505") { toast("ما انحفظ. جرّب مرة ثانية."); btn.disabled = false; return; }
  if (on) cmFollowing.add(uid); else cmFollowing.delete(uid);
  delete cmFeeds.following;
  drawCommunity(false);
}
function postMenu(p) {
  openSheet("خيارات المنشور", (s) => {
    const add = (label, fn, cls) => { const b = el("button", "ghost cm-wide " + (cls || ""), label); b.type = "button"; b.onclick = fn; s.append(b); };
    add("📤 شارك المنشور", () => { closeSheet(); cmShare(p); });
    if (p.user_id === me.id || isAdmin) add("🗑️ احذف المنشور", () => cmDelete(p), "danger");
    if (p.user_id !== me.id) {
      add("🚩 بلّغ عن المنشور", () => cmReport(p));
      add("🚫 احظر " + nameOf(p.user_id), () => { closeSheet(); blockSheet(p.user_id); });
    }
    if (isAdmin && p.hidden) add("✅ رجّع المنشور (مشرف)", async () => { await sb.rpc("set_post_hidden", { p: p.id, hide: false }); p.hidden = false; closeSheet(); drawCommunity(false); });
    if (isAdmin && !p.hidden) add("🙈 اخفِ المنشور (مشرف)", async () => { await sb.rpc("set_post_hidden", { p: p.id, hide: true }); p.hidden = true; closeSheet(); drawCommunity(false); });
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}
function cmDelete(p) {
  openSheet("حذف المنشور", (s) => {
    s.append(el("p", "sheet-p", "متأكد؟ بينحذف المنشور وردوده."));
    sheetActions(s, "احذف", async () => {
      const { error } = await sb.from("posts").delete().eq("id", p.id);
      if (error) return "ما قدرنا نحذفه.";
      delete cmPosts[p.id];
      for (const k in cmFeeds) cmFeeds[k].ids = cmFeeds[k].ids.filter((id) => id !== p.id);
      if (cmPage()?.kind === "thread" && (cmPage().id === p.id)) cmStack.pop();
      drawCommunity(false);
    });
  });
}
function cmReport(p) {
  openSheet("تبليغ عن منشور", (s) => {
    s.append(el("p", "sheet-p", "بينخفي عندك على طول، ولو بلّغ عليه ٣ أشخاص ينخفي عن الكل لين يراجعه المشرف."));
    for (const reason of ["شتم أو إساءة", "عنصرية أو كراهية", "محتوى غير لائق", "إزعاج أو سبام", "معلومات كاذبة"]) {
      const b = el("button", "ghost cm-wide", reason); b.type = "button";
      b.onclick = async () => {
        await sb.from("post_reports").insert({ post_id: p.id, reporter: me.id, reason });
        hideLocally("p" + p.id); closeSheet(); toast("وصل بلاغك، شكرًا 🙏"); drawCommunity(false);
      };
      s.append(b);
    }
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

/* ---------- 🔔 notifications ---------- */
const CM_NOTIF = { like: "❤️ أعجبه منشورك", reply: "💬 رد عليك", follow: "👤 صار يتابعك", repost: "🔁 أعاد نشر منشورك", quote: "✍️ اقتبس منشورك", mention: "📣 منشنك", arena: "🎙️ يدعوك لنقاش منظم" };
const cmArenas = {};   // arena id -> { topic, channel }
async function cmLoadNotifs() {
  let { data, error } = await sb.from("community_notifs").select("id,actor,kind,post_id,read,created_at,arena_id").order("created_at", { ascending: false }).limit(60);
  if (error) ({ data } = await sb.from("community_notifs").select("id,actor,kind,post_id,read,created_at").order("created_at", { ascending: false }).limit(60));
  const list = data || [];
  const aids = [...new Set(list.map((n) => n.arena_id).filter(Boolean))];
  if (aids.length) { const { data: ar } = await sb.from("arenas").select("id,topic,channel").in("id", aids); for (const x of ar || []) cmArenas[x.id] = x; }
  const pids = [...new Set(list.map((n) => n.post_id).filter((id) => id && !cmPosts[id]))];
  if (pids.length) { const { data: ps } = await sb.from("posts").select(CM_COLS).in("id", pids); for (const p of ps || []) cmPosts[p.id] = p; }
  await loadPeople(list.map((n) => n.actor));
  if (list.some((n) => !n.read)) sb.from("community_notifs").update({ read: true }).eq("read", false).then(() => {});
  cmSetUnread(0);
  return list;
}
function cmDrawNotifs(list) {
  const head = el("div", "pane-head"); head.append(el("h2", null, "🔔 الإشعارات"));
  if (isAdmin) { const a = el("button", "ghost", "🚩 المخفية"); a.type = "button"; a.onclick = cmAdminSheet; head.append(a); }
  cmView.append(head);
  if (!list.length) { cmView.append(cmEmpty("🔔", "ما فيه إشعارات", "لما أحد يعجبه منشورك أو يرد عليك أو يتابعك بيطلع هنا.")); return; }
  for (const n of list) {
    if (blocked.has(n.actor)) continue;
    const row = el("button", "cm-notif" + (n.read ? "" : " unread")); row.type = "button";
    const txt = el("div", "t");
    txt.append(el("b", null, nameOf(n.actor) + " "), CM_NOTIF[n.kind] || "");
    const p = n.post_id && cmPosts[n.post_id];
    if (p?.body) txt.append(el("div", "s", p.body.length > 90 ? p.body.slice(0, 89) + "…" : p.body));
    const ar = n.arena_id && cmArenas[n.arena_id];
    if (ar) txt.append(el("div", "s", ar.topic));
    row.append(avatarEl(n.actor), txt, el("span", "post-time", cmAgo(n.created_at)));
    row.onclick = () => n.kind === "arena" ? (ar ? openArenaAnywhere(n.arena_id, ar.channel) : toast("النقاش انحذف."))
      : (n.kind === "follow" || !n.post_id ? cmOpen("user", n.actor) : cmOpen("thread", n.post_id));
    cmView.append(row);
  }
}
function cmAdminSheet() {
  openSheet("🚩 منشورات مخفية بالبلاغات", async (s) => {
    const body = el("div", "preds"); s.append(body);
    const { data } = await sb.from("posts").select(CM_COLS).eq("hidden", true).order("created_at", { ascending: false }).limit(100);
    await loadPeople((data || []).map((p) => p.user_id));
    if (!data?.length) body.append(el("p", "sheet-p", "ما فيه شي مخفي 👌"));
    for (const p of data || []) {
      const card = el("div", "match");
      card.append(el("div", "when", nameOf(p.user_id)), el("div", null, p.body || "📷 / 🎤 / GIF"));
      const row = el("div", "mrow");
      const btn = (label, fn, cls) => { const b = el("button", "small " + (cls || ""), label); b.type = "button"; b.onclick = async () => { b.disabled = true; await fn(); card.remove(); }; row.append(b); };
      btn("احذفه", () => sb.from("posts").delete().eq("id", p.id), "pri");
      btn("أوقف الحساب", () => sb.rpc("set_banned", { target: p.user_id, ban: true }));
      btn("ما فيه شي", () => sb.rpc("set_post_hidden", { p: p.id, hide: false }));
      card.append(row); body.append(card);
    }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = () => { closeSheet(); drawCommunity(false); }; s.append(c);
  });
}

/* ---------- ✍️ writing a post ---------- */
function cmErr(error) {
  const m = error?.message || "";
  return /slow down/.test(m) ? "نشرت كثير. ارتاح شوي وارجع 😄"
    : /bad words/.test(m) ? "منشورك فيه كلام غير لائق. عدّله وجرّب."
    : /take closed/.test(m) ? "المباراة بدأت، فات وقت الرأي الجريء عليها."
    : error?.code === "42501" ? "حسابك موقوف عن النشر."
    : "ما انتشر. تأكد من الاتصال وجرّب مرة ثانية.";
}
async function cmUpcoming() {
  const { data } = await sb.from("matches").select("id,channel,home,away,kickoff,home_score,away_score")
    .gt("kickoff", new Date().toISOString()).order("kickoff", { ascending: true }).limit(40);
  for (const m of data || []) cmMatches[m.id] = m;
  return data || [];
}
function composeSheet({ reply = null, quote = null, take = false, match = null }) {
  const title = match ? "📣 ادعُ المجتمع للغرفة" : reply ? "💬 رد على " + nameOf(reply.user_id) : quote ? "✍️ اقتباس" : take ? "🔥 رأي جريء" : "✍️ منشور جديد";
  openSheet(title, async (s) => {
    let att = null;               // { kind: "image"|"gif"|"audio"|"poll", ... }
    let takeOn = take;
    const ta = el("textarea", "cm-ta"); ta.rows = 4; ta.maxLength = 500;
    ta.placeholder = reply ? "اكتب ردك…" : take ? "مثال: صلاح بيسجل هاتريك اليوم 🔥" : "وش في بالك؟ استخدم # للهاشتاق و @ للمنشن";
    const count = el("span", "cm-count", "٥٠٠");
    ta.oninput = () => { count.textContent = arNum(500 - ta.value.length); };
    if (quote) { const q = el("div", "post-quote"); q.append(el("b", null, nameOf(quote.user_id)), el("div", null, quote.body || "منشور")); s.append(q); }
    if (match) {
      cmMatches[match.id] = { ...(cmMatches[match.id] || {}), ...match };
      ta.value = `🔴 غرفة ${match.home} × ${match.away} مفتوحة! تعالوا نتابعها سوا 🔥`;
      count.textContent = arNum(500 - ta.value.length);
      const q = el("div", "post-room"); q.append(el("b", null, `🏟️ ${match.home} × ${match.away}`), el("span", null, "🔴 زر الدخول للغرفة"));
      s.append(q);
    }
    s.append(ta);
    const preview = el("div", "cm-att"); s.append(preview);

    // Hot take: pick a match
    const takeBox = el("div", "cm-takebox"); takeBox.hidden = !takeOn;
    const sel = el("select"); sel.id = "cmTakeMatch";
    takeBox.append(el("p", "sheet-p", "اربط رأيك بمباراة جاية. الناس يصوتون صح أو هبد قبل البداية، وبعد النهاية الجمهور يحكم إذا صدق. لو صدق تاخذ ختم ✅ قالها قبل الكل و٢٥ نقطة."), sel);
    s.append(takeBox);
    if (!reply) {
      const ups = await cmUpcoming();
      if (!ups.length) sel.append(el("option", null, "ما فيه مباريات جاية الحين"));
      const fmt = new Intl.DateTimeFormat("ar", { weekday: "short", hour: "numeric", minute: "2-digit" });
      for (const m of ups) { const o = el("option", null, `${CHANNELS.find((c) => c.id === m.channel)?.flag || ""} ${m.home} × ${m.away} · ${fmt.format(new Date(m.kickoff))}`); o.value = m.id; sel.append(o); }
    }

    const tools = el("div", "cm-tools");
    const tool = (label, fn) => { const b = el("button", "ghost", label); b.type = "button"; b.onclick = fn; tools.append(b); return b; };
    const showAtt = () => {
      preview.textContent = "";
      if (!att) return;
      const x = el("button", "cm-x", "✕"); x.type = "button"; x.onclick = () => { stopRec(true); att = null; showAtt(); };
      if (att.kind === "image") { const i = el("img"); i.src = att.url; preview.append(i); }
      if (att.kind === "gif") { const i = el("img"); i.src = att.url; preview.append(i); }
      if (att.kind === "audio") preview.append(el("span", "cm-rec", att.rec ? "🔴 يسجّل… اضغط ⏹️ إذا خلصت" : `🎤 تسجيل ${fmtSecs(att.secs)}`));
      if (att.kind === "poll") {
        const pb = el("div", "cm-pollin");
        att.inputs.forEach((i) => pb.append(i));
        if (att.inputs.length < 4) { const add = el("button", "link", "+ خيار"); add.type = "button"; add.onclick = () => { att.inputs.push(cmOpt(att.inputs.length)); showAtt(); }; pb.append(add); }
        preview.append(pb);
      }
      preview.append(x);
    };
    const file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true;
    file.onchange = () => { const f = file.files[0]; file.value = ""; if (!f || !f.type.startsWith("image/")) return; att = { kind: "image", file: f, url: URL.createObjectURL(f) }; showAtt(); };
    s.append(file);
    tool("📷", () => file.click());
    tool("GIF", () => cmGifPicker((url) => { att = { kind: "gif", url }; showAtt(); }, s));
    let rec = null, chunks = [], t0 = 0, stream = null;
    const stopRec = (cancel) => { if (!rec) return; const r = rec; rec = null; r.onstop = cancel ? null : r.onstop; if (r.state !== "inactive") r.stop(); stream?.getTracks().forEach((t) => t.stop()); };
    const mic = tool("🎤", async () => {
      if (rec) { stopRec(false); mic.textContent = "🎤"; return; }
      const mime = pickMime();
      if (mime === null || !navigator.mediaDevices?.getUserMedia) { toast("جهازك ما يدعم تسجيل الصوت."); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast("لازم تسمح باستخدام المايك."); return; }
      chunks = []; rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = () => {
        const secs = (Date.now() - t0) / 1000;
        if (secs < 0.8) { att = null; showAtt(); return; }
        const type = (chunks[0]?.type || "audio/mp4").split(";")[0];
        att = { kind: "audio", blob: new Blob(chunks, { type }), type, secs: Math.min(120, secs) }; showAtt();
      };
      rec.start(250); t0 = Date.now(); att = { kind: "audio", rec: true }; showAtt(); mic.textContent = "⏹️";
      setTimeout(() => { if (rec && Date.now() - t0 >= 119000) { stopRec(false); mic.textContent = "🎤"; } }, 120000);
    });
    tool("📊", () => { att = { kind: "poll", inputs: [cmOpt(0), cmOpt(1)] }; showAtt(); });
    if (!reply && !quote && !match) {
      const tb = tool("🔥 رأي جريء", () => { takeOn = !takeOn; takeBox.hidden = !takeOn; tb.classList.toggle("on", takeOn); });
      tb.classList.toggle("on", takeOn);
    }
    tools.append(count);
    s.append(tools);

    sheetActions(s, reply ? "رد" : "انشر", async () => {
      if (rec) return "وقّف التسجيل أول (⏹️).";
      const body = ta.value.trim() || null;
      const row = { user_id: me.id, body };
      if (reply) row.reply_to = reply.id;
      if (match) row.match_id = match.id;
      if (quote) row.quote_of = quote.id;
      if (takeOn && !reply) {
        if (!body) return "اكتب رأيك الجريء.";
        if (!Number(sel.value)) return "اختر مباراة.";
        row.take_match_id = Number(sel.value);
      }
      if (att?.kind === "poll") {
        const options = att.inputs.map((i) => i.value.trim()).filter(Boolean);
        if (!body) return "اكتب سؤال التصويت.";
        if (options.length < 2) return "اكتب خيارين على الأقل.";
        row.poll = { options };
      }
      if (att?.kind === "gif") row.gif_url = att.url;
      if (!body && !att && !quote) return "اكتب شي أول 😄";
      if (att?.kind === "image") {
        const blob = await shrink(att.file);
        const ext = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] || "jpg";
        const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
        if (up.error) return "ما انرفعت الصورة. الحد ٥ ميجا.";
        signed[path] = { url: att.url, exp: Date.now() + 3000000 };
        row.image_path = path;
      }
      if (att?.kind === "audio") {
        const ext = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/aac": "aac", "audio/mpeg": "mp3" }[att.type] || "m4a";
        const path = `${me.id}/post-${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from(AUDIO_BUCKET).upload(path, att.blob, { contentType: att.type });
        if (up.error) return "ما انرفع التسجيل.";
        signed["a:" + path] = { url: URL.createObjectURL(att.blob), exp: Date.now() + 3000000 };
        row.audio_path = path; row.audio_secs = Math.round(att.secs * 10) / 10;
      }
      // @mentions: names are unique, so look them up
      const names = [...new Set([...(body || "").matchAll(/@([^\s@#،,.!?؟]+)/g)].map((x) => x[1]))].slice(0, 10);
      if (names.length) {
        const lower = names.map((n) => n.toLowerCase());
        const [{ data: byName }, { data: byUser }] = await Promise.all([
          sb.from("profiles").select("id,name").in("name", names),
          sb.from("profiles").select("id,name,username").in("username", lower),
        ]);
        const found = [...(byName || []), ...(byUser || [])];
        row.mentions = [...new Set(found.map((x) => x.id))].filter((id) => id !== me.id);
        for (const x of found) people[x.id] = { ...(people[x.id] || { team: null }), name: x.name, ...(x.username ? { username: x.username } : {}) };
      }
      const { data, error } = await sb.from("posts").insert(row).select(CM_COLS).single();
      if (error) return cmErr(error);
      await cmHydrate([data]);
      if (reply) { reply.reply_count++; if (cmPage()?.kind !== "thread") cmStack.push({ kind: "thread", id: reply.id }); }
      else {
        for (const k of ["all", "following", "user:" + me.id]) if (cmFeeds[k]) cmFeeds[k].ids.unshift(data.id);
        if (row.take_match_id) delete cmFeeds.takes;
        cmStack = []; if (cmTab !== "following") cmTab = "all";
      }
      if (quote) quote.repost_count++;
      toast(match ? "📣 انتشر في المجتمع، الحين الكل يقدر يدخل الغرفة" : row.take_match_id ? "🔥 رأيك الجريء نزل! نشوف بعد المباراة" : reply ? "انرسل ردك ✅" : "انتشر ✅");
      if (!match) drawCommunity(!reply);
    });
  });
}
function cmOpt(i) { const x = el("input"); x.type = "text"; x.maxLength = 40; x.placeholder = `الخيار ${arNum(i + 1)}`; return x; }
function cmGifPicker(onPick, sheet) {
  const key = (window.HALA_CONFIG || {}).giphyKey;
  if (!key) { toast("بحث GIF مو مفعّل."); return; }
  let panel = sheet.querySelector(".cm-gif");
  if (panel) { panel.remove(); return; }
  panel = el("div", "cm-gif");
  const inp = el("input"); inp.type = "search"; inp.placeholder = "دوّر GIF… مثلًا goal";
  const grid = el("div", "gifgrid");
  panel.append(inp, grid, el("div", "giphy", "Powered by GIPHY"));
  sheet.querySelector(".cm-tools").after(panel);
  let timer = null;
  const load = async (q) => {
    grid.textContent = "";
    try {
      const r = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q || "football goal")}&limit=18&rating=pg-13`);
      const j = await r.json();
      for (const g of j.data || []) {
        const im = g.images?.fixed_width; if (!im?.url) continue;
        const b = el("button"); b.type = "button"; const i = el("img"); i.src = im.webp || im.url; i.loading = "lazy"; b.append(i);
        b.onclick = () => { onPick(im.url.split("?")[0]); panel.remove(); };
        grid.append(b);
      }
    } catch { grid.append(el("p", "sheet-p", "ما قدرنا نجيب الـGIF.")); }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(inp.value.trim()), 350); };
  load("");
}

/* ---------- live updates ---------- */
let cmRealtime = null;
function startCommunityRealtime() {
  if (cmRealtime) return;
  cmRealtime = sb.channel("hala-community")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, ({ new: p }) => {
      if (!p || p.user_id === me.id || blocked.has(p.user_id)) return;
      if (p.reply_to) {
        // A reply in the thread I'm reading: show it.
        const pg = cmPage();
        if (community && pg?.kind === "thread" && (cmPosts[pg.id]?.root_id || pg.id) === p.root_id) drawCommunity(false);
        return;
      }
      if (cmTab === "following" && !cmFollowing.has(p.user_id)) return;
      cmNewCount++;
      cmNewPill.textContent = `↑ ${arNum(cmNewCount)} منشور جديد`;
      cmNewPill.hidden = !community || !!cmPage() || !["all", "following"].includes(cmTab);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_notifs", filter: `user_id=eq.${me.id}` }, () => {
      if (community && cmTab === "notifs" && !cmPage()) drawCommunity(false); else cmSetUnread(cmUnread + 1);
    })
    .subscribe();
}
const _startChatCm = startChat;
startChat = async function () {
  if (communityLink) setCommunity(true);
  const r = await _startChatCm();
  startCommunityRealtime();
  return r;
};
const _drawLiveBannerCm = drawLiveBanner;
drawLiveBanner = function () { _drawLiveBannerCm(); $("liveBanner").hidden = true; };

/* ---------- my page: the top-left button opens it, settings move inside ---------- */
const openSettings = $("meBtn").onclick;
$("meBtn").onclick = () => {
  setCommunity(true);
  const pg = cmPage();
  if (!(pg?.kind === "user" && pg.id === me.id)) cmStack.push({ kind: "user", id: me.id });
  renderLeagues(); refreshView(true);
};

function avatarSheet() {
  openSheet("📷 صورة البروفايل", (s) => {
    s.append(el("p", "sheet-p", "اختر صورة من الاستديو. بتطلع للكل جنب اسمك."));
    const file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true;
    const pick = el("button", "primary", "🖼️ اختر من الاستديو"); pick.type = "button";
    pick.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; file.value = "";
      if (!f || !f.type.startsWith("image/")) return;
      pick.disabled = true; pick.textContent = "يرفع…";
      const msg = await setAvatar(f);
      if (msg) { toast(msg); pick.disabled = false; pick.textContent = "🖼️ اختر من الاستديو"; return; }
      closeSheet(); toast("✅ تغيّرت صورتك");
    };
    s.append(file, pick);
    if (people[me.id]?.avatar_path) {
      const del = el("button", "ghost cm-wide danger", "احذف الصورة"); del.type = "button";
      del.onclick = async () => { del.disabled = true; await setAvatar(null); closeSheet(); toast("انحذفت الصورة"); };
      s.append(del);
    }
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}
// Square-crops to 512px JPEG, uploads to avatars/<my id>/, then points my profile at it.
async function setAvatar(file) {
  const old = people[me.id]?.avatar_path;
  let path = null;
  if (file) {
    let blob;
    try {
      const bmp = await createImageBitmap(file);
      const side = Math.min(bmp.width, bmp.height), size = Math.min(512, side);
      const c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    } catch { return "ما قدرنا نقرأ الصورة. جرّب صورة ثانية."; }
    if (!blob) return "ما قدرنا نقرأ الصورة.";
    path = `${me.id}/${Date.now()}.jpg`;
    const up = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) return "ما انرفعت الصورة. تأكد من الاتصال.";
  }
  const { error } = await sb.from("profiles").update({ avatar_path: path }).eq("id", me.id);
  if (error) return "ما انحفظت الصورة. جرّب مرة ثانية.";
  if (old) sb.storage.from("avatars").remove([old]).catch(() => {});
  people[me.id] = { ...(people[me.id] || {}), avatar_path: path };
  const av = avatarEl(me.id); $("meAvatar").replaceWith(av); av.id = "meAvatar";
  if (community) drawCommunity(false);
  return null;
}

/* ---------- a person's card from anywhere (league chat, match room) ---------- */
async function profileSheet(uid) {
  if (!uid || uid === me.id) return;
  await Promise.all([cmLoadBasics(), loadPeople([uid])]);
  const { data: c } = await sb.rpc("profile_counts", { u: uid });
  openSheet("", (s) => {
    s.querySelector("h3")?.remove();
    const head = el("div", "cm-prof");
    const av = avatarEl(uid); av.classList.add("big");
    const info = el("div", "cm-pinfo");
    const nmRow = el("div", "cm-nmrow"); nmRow.append(el("b", null, nameOf(uid)));
    const lvb = levelBadge(uid); if (lvb) nmRow.append(lvb);
    info.append(nmRow);
    if (people[uid]?.username) info.append(el("span", "cm-handle", "@" + people[uid].username));
    const pill = teamPill(uid); if (pill) info.append(pill);
    head.append(av, info);
    s.append(head);
    const stats = el("div", "cm-stats");
    for (const [n, label] of [[c?.posts, "منشور"], [c?.followers, "متابع"], [c?.following, "يتابع"], [c?.takes_right, "رأي صدق ✅"]]) {
      const x = el("div"); x.append(el("b", null, arNum(n || 0)), el("span", null, label)); stats.append(x);
    }
    s.append(stats);
    const acts = el("div", "acts");
    const on = cmFollowing.has(uid);
    const f = el("button", on ? "cancel" : "primary", on ? "تتابعه ✓ (إلغاء المتابعة)" : "➕ تابعه"); f.type = "button";
    f.onclick = async () => {
      f.disabled = true;
      const follow = !cmFollowing.has(uid);
      const { error } = follow
        ? await sb.from("follows").insert({ follower: me.id, followee: uid })
        : await sb.from("follows").delete().eq("follower", me.id).eq("followee", uid);
      if (error && error.code !== "23505") { toast("ما انحفظ. جرّب مرة ثانية."); f.disabled = false; return; }
      if (follow) cmFollowing.add(uid); else cmFollowing.delete(uid);
      delete cmFeeds.following;
      toast(follow ? `✅ صرت تتابع ${nameOf(uid)}` : `ألغيت متابعة ${nameOf(uid)}`);
      closeSheet(); profileSheet(uid);
    };
    acts.append(f);
    s.append(acts);
    const page = el("button", "ghost cm-wide", "🌍 شوف منشوراته في المجتمع"); page.type = "button";
    page.onclick = () => {
      closeSheet();
      if (typeof roomMatch !== "undefined" && roomMatch) leaveRoom();
      setCommunity(true); cmStack = [{ kind: "user", id: uid }]; renderLeagues(); refreshView(true);
    };
    const bl = el("button", "link danger", "🚫 حظر " + nameOf(uid)); bl.type = "button";
    bl.onclick = () => { closeSheet(); blockSheet(uid); };
    const close = el("button", "cancel", "سكّر"); close.type = "button"; close.onclick = closeSheet;
    s.append(page, bl, close);
  });
}

/* ---------- 🎙️ open debates from every league, at the top of the community feed ---------- */
function cmArenaStrip() {
  const wrap = el("div", "cm-arenas"); wrap.hidden = true;
  (async () => {
    const now = Date.now();
    const { data, error } = await sb.from("arenas").select("id,channel,topic,side_a,side_b,starts_at,created_at,private")
      .or(`starts_at.is.null,starts_at.gt.${new Date(now - 30 * 60000).toISOString()}`)
      .gt("created_at", new Date(now - 24 * 3600000).toISOString())
      .order("created_at", { ascending: false }).limit(15);
    if (error || !data?.length) return;
    const list = data.filter((a) => !a.private && (!a.starts_at || new Date(a.starts_at).getTime() + 30 * 60000 > now));
    if (!list.length) return;
    const { data: seats } = await sb.from("arena_seats").select("arena_id").in("arena_id", list.map((a) => a.id));
    const count = {}; for (const x of seats || []) count[x.arena_id] = (count[x.arena_id] || 0) + 1;
    // live first, then the fullest waiting ones (closest to starting)
    const state = (a) => (!a.starts_at ? "wait" : new Date(a.starts_at) > now ? "soon" : "live");
    list.sort((x, y) => ({ live: 0, soon: 1, wait: 2 }[state(x)] - { live: 0, soon: 1, wait: 2 }[state(y)]) || (count[y.id] || 0) - (count[x.id] || 0));
    const head = el("div", "cm-ar-head"); head.append(el("b", null, "🎙️ نقاشات منظمة مفتوحة"), el("span", null, "٣ ضد ٣"));
    const row = el("div", "cm-ar-row");
    for (const a of list) {
      const st = state(a), n = count[a.id] || 0;
      const c = el("button", "cm-ar " + st); c.type = "button";
      const lg = CHANNELS.find((x) => x.id === a.channel);
      c.append(el("small", null, `${lg?.flag || ""} ${lg?.short || ""}`), el("b", null, a.topic), el("span", "vs", `${a.side_a} × ${a.side_b}`));
      const seatsEl = el("div", "seats");
      for (let i = 0; i < 6; i++) seatsEl.append(el("i", i < n ? "on" : null));
      c.append(seatsEl, el("span", "cta", st === "live" ? "🔴 شغّال · تابع" : st === "soon" ? "⏳ يبدأ بعد شوي" : `ناقصهم ${arNum(6 - n)} · انضم`));
      c.onclick = () => openArenaAnywhere(a.id, a.channel);
      row.append(c);
    }
    wrap.append(head, row); wrap.hidden = false;
  })();
  return wrap;
}

/* ---------- @username: choose one (required once), with the usual rules ---------- */
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;
const RESERVED = new Set(["admin", "administrator", "support", "help", "hala", "madraj", "mudarraj", "official", "moderator", "mod", "root", "system", "null", "undefined", "api", "www", "staff"]);
function usernameProblem(u) {
  if (u.length < 3) return "لازم ٣ حروف على الأقل.";
  if (u.length > 20) return "بحد أقصى ٢٠ حرف.";
  if (!USERNAME_RE.test(u)) return "بس حروف إنجليزية صغيرة وأرقام و _ و .";
  if (u.startsWith(".") || u.endsWith(".")) return "ما يبدأ أو ينتهي بنقطة.";
  if (u.includes("..")) return "ما ينفع نقطتين ورا بعض.";
  if (RESERVED.has(u)) return "هاليوزر محجوز.";
  return null;
}
function usernameSheet(force) {
  return new Promise((done) => {
    openSheet(force ? "👋 اختر يوزر لحسابك" : "✏️ غيّر اليوزر", (s) => {
      if (force) $("sheetBg").dataset.lock = "1";
      s.append(el("p", "sheet-p", force
        ? "صار لكل شخص في مدرج هلا يوزر خاص فيه مثل انستقرام، يعرفونك فيه ويمنشنونك ويلقونك بالبحث. اختره مرة وحدة وخلصنا."
        : "اليوزر يطلع في صفحتك وتقدر تنمنشن فيه."));
      const wrap = el("div", "u-wrap");
      const inp = el("input"); inp.type = "text"; inp.id = "uName"; inp.maxLength = 20; inp.dir = "ltr";
      inp.autocapitalize = "none"; inp.autocomplete = "off"; inp.spellcheck = false; inp.placeholder = "yourname";
      inp.value = people[me.id]?.username || "";
      wrap.append(el("span", "u-at", "@"), inp); wrap.dir = "ltr";
      const msg = el("div", "u-msg");
      s.append(wrap, msg, el("p", "sheet-p note2", "٣ إلى ٢٠ حرف: إنجليزي صغير a-z، أرقام، _ و . (ما يبدأ أو ينتهي بنقطة)"));
      const base = ((me.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".").slice(0, 14)) || "fan";
      const sug = el("div", "u-sug");
      for (const x of [base.length >= 3 ? base : base + "_fan", base.slice(0, 12) + "_" + Math.floor(10 + Math.random() * 89), "hala_" + base.slice(0, 10)]) {
        const b = el("button", "small", "@" + x); b.type = "button"; b.dir = "ltr"; b.onclick = () => { inp.value = x; check(); }; sug.append(b);
      }
      s.append(sug);
      let seq = 0, timer = null;
      const check = () => {
        const u = inp.value.trim().toLowerCase(); if (inp.value !== u) inp.value = u;
        const my = ++seq; const pr = u ? usernameProblem(u) : null;
        msg.className = "u-msg"; msg.textContent = pr || "";
        if (pr || !u) { if (pr) msg.classList.add("bad"); return; }
        if (u === people[me.id]?.username) { msg.textContent = "✅ هذا يوزرك"; msg.classList.add("good"); return; }
        msg.textContent = "يتحقق…";
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const { data } = await sb.rpc("username_available", { u });
          if (my !== seq) return;
          msg.textContent = data ? "✅ متاح" : "❌ مأخوذ، جرّب غيره"; msg.classList.add(data ? "good" : "bad");
        }, 350);
      };
      inp.oninput = check;
      if (inp.value) check();
      const err = el("div", "err"); err.hidden = true;
      const acts = el("div", "acts");
      const save = el("button", "primary", "احفظ اليوزر"); save.type = "button";
      save.onclick = async () => {
        const u = inp.value.trim().toLowerCase();
        const pr = usernameProblem(u); if (pr) { err.textContent = pr; err.hidden = false; return; }
        save.disabled = true; err.hidden = true;
        const { error } = await sb.from("profiles").update({ username: u }).eq("id", me.id);
        save.disabled = false;
        if (error) { err.textContent = error.code === "23505" ? "❌ هاليوزر مأخوذ، جرّب غيره." : error.code === "23514" ? "اليوزر ما يطابق الشروط." : "ما انحفظ. جرّب مرة ثانية."; err.hidden = false; return; }
        people[me.id] = { ...(people[me.id] || {}), username: u };
        closeSheet(); toast(`✅ يوزرك صار \u2066@${u}\u2069`);
        if (community) drawCommunity(false);
        done(u);
      };
      acts.append(save);
      if (!force) { const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = () => { closeSheet(); done(null); }; acts.append(c); }
      s.append(err, acts);
    });
  });
}

/* ---------- 📸 profile card for Instagram stories (1080×1920) ---------- */
async function shareProfileCard(uid, counts) {
  toast("يجهّز البطاقة…");
  const c = counts || (await sb.rpc("profile_counts", { u: uid })).data || {};
  const W = 1080, H = 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  const t = TEAM_BY_ID[people[uid]?.team];
  const accent = t?.color || "#2fbf5b";
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0d1d14"); g.addColorStop(1, "#06100a"); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 12; i += 2) { x.fillStyle = "rgba(255,255,255,.025)"; x.fillRect(0, i * 160, W, 160); }
  const rg = x.createRadialGradient(W / 2, 640, 50, W / 2, 640, 700); rg.addColorStop(0, accent + "88"); rg.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = rg; x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 6; x.beginPath(); x.arc(W / 2, 640, 420, 0, Math.PI * 2); x.stroke();
  await document.fonts?.ready;
  x.textAlign = "center"; x.direction = "rtl"; x.fillStyle = "#eef5ef";
  x.font = "400 92px Lalezar, Cairo, sans-serif"; x.fillText("مدرج هلا", W / 2, 200);
  const cx = W / 2, cy = 640, r = 230;
  x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.closePath(); x.fillStyle = accent; x.fill(); x.clip();
  const pic = people[uid]?.avatar_path; let drawn = false;
  if (pic) {
    try { const img = new Image(); img.crossOrigin = "anonymous"; img.src = avatarUrl(pic); await img.decode(); x.drawImage(img, cx - r, cy - r, r * 2, r * 2); drawn = true; } catch {}
  }
  if (!drawn) { x.fillStyle = t ? inkFor(t.color) : "#fff"; x.font = "800 220px Cairo, sans-serif"; x.textBaseline = "middle"; x.fillText(nameOf(uid).trim().charAt(0), cx, cy + 10); x.textBaseline = "alphabetic"; }
  x.restore();
  x.lineWidth = 14; x.strokeStyle = "#f2b134"; x.beginPath(); x.arc(cx, cy, r + 8, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "#ffffff"; x.font = "800 96px Cairo, sans-serif"; x.fillText(nameOf(uid), W / 2, 1010);
  if (people[uid]?.username) { x.fillStyle = "#8fa898"; x.font = "600 60px Cairo, sans-serif"; x.direction = "ltr"; x.fillText("@" + people[uid].username, W / 2, 1095); x.direction = "rtl"; }
  if (t) {
    x.font = "800 52px Cairo, sans-serif"; const tw = x.measureText(t.name).width + 80;
    x.fillStyle = t.color; x.beginPath(); (x.roundRect ? x.roundRect(W / 2 - tw / 2, 1140, tw, 90, 45) : x.rect(W / 2 - tw / 2, 1140, tw, 90)); x.fill();
    x.fillStyle = inkFor(t.color); x.fillText(t.name, W / 2, 1203);
  }
  const ar = (n) => String(n || 0).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  [[c.posts, "منشور"], [c.followers, "متابع"], [c.following, "يتابع"], [c.takes_right, "رأي صدق"]].forEach(([n, label], i) => {
    const sx = W - 135 - i * 270;
    x.fillStyle = "rgba(255,255,255,.07)"; x.beginPath(); (x.roundRect ? x.roundRect(sx - 115, 1310, 230, 200, 36) : x.rect(sx - 115, 1310, 230, 200)); x.fill();
    x.fillStyle = "#fff"; x.font = "800 84px Cairo, sans-serif"; x.fillText(ar(n), sx, 1420);
    x.fillStyle = "#8fa898"; x.font = "600 40px Cairo, sans-serif"; x.fillText(label, sx, 1480);
  });
  x.fillStyle = "#f2b134"; x.font = "800 64px Cairo, sans-serif"; x.fillText("تابعني في مدرج هلا 🏟️", W / 2, 1680);
  const link = location.origin + location.pathname + (people[uid]?.username ? "?u=" + people[uid].username : `?view=community&user=${uid}`);
  x.fillStyle = "#8fa898"; x.font = "600 38px Cairo, sans-serif"; x.direction = "ltr"; x.fillText(link.replace(/^https?:\/\//, ""), W / 2, 1760);
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  const file = new File([blob], `hala-${people[uid]?.username || "profile"}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "مدرج هلا", text: "تابعني في مدرج هلا 🏟️ " + link }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  openSheet("📸 بطاقتك جاهزة", (s) => {
    const im = el("img", "ig-prev"); im.src = URL.createObjectURL(blob); s.append(im);
    s.append(el("p", "sheet-p", "اضغط مطوّل على الصورة واحفظها، وبعدين نزّلها ستوري في انستقرام. والرابط انسخ لك عشان تحطه في الستوري 👇"));
    navigator.clipboard?.writeText(link).catch(() => {});
    const a = el("a", "primary", "⬇️ حمّل الصورة"); a.href = im.src; a.download = file.name; a.style.textAlign = "center"; a.style.textDecoration = "none";
    const cl = el("button", "cancel", "سكّر"); cl.type = "button"; cl.onclick = closeSheet;
    s.append(a, cl);
  });
}
