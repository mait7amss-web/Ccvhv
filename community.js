/* ---------- 🌍 المجتمع العام: منشورات للجميع مثل تويتر، ومعها "رأي جريء" ----------
   Lives above the leagues as its own chip. Data and rules are in supabase/community.sql. */

const CM_COLS = "id,user_id,body,image_path,gif_url,audio_path,audio_secs,poll,take_match_id,reply_to,root_id,quote_of,mentions,tags,like_count,reply_count,repost_count,hidden,created_at";
const CM_PAGE = 25;
const cmPosts = {};                 // id -> post
const cmFeeds = {};                 // key -> { ids: [], done: bool }
const cmLiked = new Set();          // post ids I liked
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
  for (const id of ["thread", "predView", "tableView", "arenaView", "chatFooter", "liveBanner"]) if ($(id)) $(id).hidden = true;
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
  const mids = [...new Set(fresh.map((p) => p.take_match_id).filter((m) => m && !cmMatches[m]))];
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
  const [{ data: fol }, { count }] = await Promise.all([
    sb.from("follows").select("followee").eq("follower", me.id),
    sb.from("community_notifs").select("id", { count: "exact", head: true }).eq("read", false),
  ]);
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
  }
  for (const b of cmTabs.children) b.setAttribute("aria-pressed", String(!cmPage() && b.dataset.tab === cmTab));
  cmFab.hidden = !community || cmPage()?.kind === "thread";
  await cmLoadBasics();
  const page = cmPage();
  if (jump) { cmView.textContent = ""; cmView.append(el("div", "cm-loading", "يحمّل…")); }
  let draw;
  if (page?.kind === "thread") { const rootId = await cmLoadThread(page.id); draw = () => cmDrawThread(rootId, page.id); }
  else if (page?.kind === "user") { await Promise.all([cmLoadFeed("user:" + page.id), loadPeople([page.id])]); const { data } = await sb.rpc("profile_counts", { u: page.id }); draw = () => cmDrawProfile(page.id, data || {}); }
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
  const feed = cmFeeds[key] || { ids: [] };
  const list = feed.ids.map((id) => cmPosts[id]).filter(cmVisible);
  if (!list.length) {
    cmView.append(key === "following"
      ? cmEmpty("👥", "ما تتابع أحد للحين", "تابع الناس اللي يعجبك كلامهم من صفحاتهم، ومنشوراتهم بتطلع هنا.")
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
  const av = avatarEl(uid); av.classList.add("big");
  const info = el("div", "cm-pinfo");
  info.append(el("b", null, nameOf(uid)));
  const pill = teamPill(uid); if (pill) info.append(pill);
  head.append(av, info);
  if (uid !== me.id) {
    const following = cmFollowing.has(uid);
    const f = el("button", following ? "ghost" : "primary cm-follow", following ? "تتابعه ✓" : "تابع"); f.type = "button";
    f.onclick = () => cmToggleFollow(uid, f);
    head.append(f);
  }
  cmView.append(head);
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
  const names = (p.mentions || []).map((id) => people[id]?.name).filter(Boolean).sort((a, b) => b.length - a.length);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp((names.length ? "@(" + names.map(esc).join("|") + ")|" : "") + "#([0-9A-Za-z_\\u0621-\\u064A\\u0660-\\u0669]{2,30})", "g");
  let last = 0, mt;
  while ((mt = re.exec(p.body))) {
    box.append(p.body.slice(last, mt.index));
    if (mt[0][0] === "@") {
      const id = (p.mentions || []).find((i) => people[i]?.name === mt[1]);
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
function postActions(p) {
  const row = el("div", "post-acts");
  const act = (ico, n, cls, fn, label) => {
    const b = el("button", "pa " + (cls || "")); b.type = "button"; b.setAttribute("aria-label", label);
    b.append(el("span", "i", ico), el("span", "n", n ? arNum(n) : ""));
    b.onclick = (e) => { e.stopPropagation(); fn(b); };
    row.append(b);
  };
  act("💬", p.reply_count, "", () => composeSheet({ reply: p }), "رد");
  act("🔁", p.repost_count, "", () => repostSheet(p), "إعادة نشر");
  act(cmLiked.has(p.id) ? "❤️" : "🤍", p.like_count, cmLiked.has(p.id) ? "on" : "", (b) => cmToggleLike(p, b), "إعجاب");
  act("📤", 0, "", () => cmShare(p), "مشاركة");
  return row;
}
async function cmToggleLike(p, b) {
  const on = !cmLiked.has(p.id);
  if (on) { cmLiked.add(p.id); p.like_count++; } else { cmLiked.delete(p.id); p.like_count = Math.max(0, p.like_count - 1); }
  b.classList.toggle("on", on);
  b.querySelector(".i").textContent = on ? "❤️" : "🤍";
  b.querySelector(".n").textContent = p.like_count ? arNum(p.like_count) : "";
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
const CM_NOTIF = { like: "❤️ أعجبه منشورك", reply: "💬 رد عليك", follow: "👤 صار يتابعك", repost: "🔁 أعاد نشر منشورك", quote: "✍️ اقتبس منشورك", mention: "📣 منشنك" };
async function cmLoadNotifs() {
  const { data } = await sb.from("community_notifs").select("id,actor,kind,post_id,read,created_at").order("created_at", { ascending: false }).limit(60);
  const list = data || [];
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
    row.append(avatarEl(n.actor), txt, el("span", "post-time", cmAgo(n.created_at)));
    row.onclick = () => (n.kind === "follow" || !n.post_id ? cmOpen("user", n.actor) : cmOpen("thread", n.post_id));
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
function composeSheet({ reply = null, quote = null, take = false }) {
  const title = reply ? "💬 رد على " + nameOf(reply.user_id) : quote ? "✍️ اقتباس" : take ? "🔥 رأي جريء" : "✍️ منشور جديد";
  openSheet(title, async (s) => {
    let att = null;               // { kind: "image"|"gif"|"audio"|"poll", ... }
    let takeOn = take;
    const ta = el("textarea", "cm-ta"); ta.rows = 4; ta.maxLength = 500;
    ta.placeholder = reply ? "اكتب ردك…" : take ? "مثال: صلاح بيسجل هاتريك اليوم 🔥" : "وش في بالك؟ استخدم # للهاشتاق و @ للمنشن";
    const count = el("span", "cm-count", "٥٠٠");
    ta.oninput = () => { count.textContent = arNum(500 - ta.value.length); };
    if (quote) { const q = el("div", "post-quote"); q.append(el("b", null, nameOf(quote.user_id)), el("div", null, quote.body || "منشور")); s.append(q); }
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
    if (!reply && !quote) {
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
        const { data } = await sb.from("profiles").select("id,name").in("name", names);
        row.mentions = (data || []).map((x) => x.id).filter((id) => id !== me.id);
        for (const x of data || []) people[x.id] = people[x.id] || { name: x.name, team: null };
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
      toast(row.take_match_id ? "🔥 رأيك الجريء نزل! نشوف بعد المباراة" : reply ? "انرسل ردك ✅" : "انتشر ✅");
      drawCommunity(!reply);
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
drawLiveBanner = function () { _drawLiveBannerCm(); if (community) $("liveBanner").hidden = true; };
