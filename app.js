/* مدرج هلا — football chat for the five big leagues.
   Backend: Supabase (auth, Postgres with row-level security, storage, realtime). */

// The five big leagues. color/ink paint the tab when it's selected.
const CHANNELS = [
  { id: "epl",        short: "إنجليزي", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", name: "الدوري الإنجليزي الممتاز", color: "#8f3fd6", ink: "#ffffff" },
  { id: "laliga",     short: "إسباني",  flag: "🇪🇸", name: "الدوري الإسباني",          color: "#ff4b3e", ink: "#ffffff" },
  { id: "seriea",     short: "إيطالي",  flag: "🇮🇹", name: "الدوري الإيطالي",          color: "#1aa3ff", ink: "#04131f" },
  { id: "bundesliga", short: "ألماني",  flag: "🇩🇪", name: "الدوري الألماني",          color: "#e4202b", ink: "#ffffff" },
  { id: "ligue1",     short: "فرنسي",   flag: "🇫🇷", name: "الدوري الفرنسي",           color: "#dae025", ink: "#0d1400" },
];

// Favorite-team choices: [id, Arabic name, club color]
const TEAMS = {
  epl: [["arsenal","أرسنال","#ef0107"],["chelsea","تشيلسي","#034694"],["liverpool","ليفربول","#c8102e"],["mancity","مانشستر سيتي","#6cabdd"],["manutd","مانشستر يونايتد","#da291c"],["tottenham","توتنهام","#132257"],["newcastle","نيوكاسل","#241f20"],["astonvilla","أستون فيلا","#670e36"]],
  laliga: [["realmadrid","ريال مدريد","#febe10"],["barcelona","برشلونة","#a50044"],["atletico","أتلتيكو مدريد","#cb3524"],["sevilla","إشبيلية","#d71920"],["realsociedad","ريال سوسيداد","#0067b1"],["betis","ريال بيتيس","#00954c"],["athletic","أتلتيك بلباو","#ee2523"],["villarreal","فياريال","#ffe667"]],
  seriea: [["juventus","يوفنتوس","#1a1a1a"],["inter","إنتر","#010e80"],["milan","ميلان","#fb090b"],["napoli","نابولي","#12a0d7"],["roma","روما","#8e1f2f"],["lazio","لاتسيو","#87d8f7"],["atalanta","أتالانتا","#1e71b8"],["fiorentina","فيورنتينا","#482e92"]],
  bundesliga: [["bayern","بايرن ميونخ","#dc052d"],["dortmund","دورتموند","#fde100"],["leverkusen","ليفركوزن","#e32221"],["leipzig","لايبزيغ","#dd0741"],["frankfurt","فرانكفورت","#e1000f"],["stuttgart","شتوتغارت","#e32219"],["gladbach","مونشنغلادباخ","#1a1a1a"],["wolfsburg","فولفسبورغ","#65b32e"]],
  ligue1: [["psg","باريس سان جيرمان","#004170"],["marseille","مارسيليا","#2faee0"],["lyon","ليون","#da0812"],["monaco","موناكو","#e7242d"],["lille","ليل","#e01e13"],["nice","نيس","#c8102e"],["lens","لانس","#ffd100"],["rennes","رين","#e13327"]],
};
const TEAM_BY_ID = {};
for (const lg in TEAMS) for (const [id, name, color] of TEAMS[lg]) TEAM_BY_ID[id] = { id, name, color };

const EMOJIS = ["👍", "🔥", "😂", "😡"];
const BUCKET = "chat-images";
const PAGE = 200;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const cfg = window.HALA_CONFIG || {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
  $("setupScreen").hidden = false;
  throw new Error("Hala: missing Supabase config");
}
// Read before the client clears the link details from the address bar.
const linkInfo = new URLSearchParams((location.hash || "").slice(1) + "&" + location.search.slice(1));
let recovering = linkInfo.get("type") === "recovery";
const linkError = linkInfo.get("error_code");
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

/* ---------- State ---------- */
let me = null;                 // auth user
let channel = CHANNELS[0].id;
let view = "chat";             // chat | pred | table
try { channel = localStorage.getItem("hala.channel") || channel; view = localStorage.getItem("hala.view") || view; } catch {}
if (!CHANNELS.some(c => c.id === channel)) channel = CHANNELS[0].id;
{ // Opened from a notification: ?league=epl&view=pred
  const q = new URLSearchParams(location.search);
  if (q.get("league")) channel = q.get("league");
  if (q.get("view")) view = q.get("view");
  if (q.has("league") || q.has("view")) history.replaceState(null, "", location.pathname);
}
if (!CHANNELS.some(c => c.id === channel)) channel = CHANNELS[0].id;
if (!["chat", "pred", "table"].includes(view)) view = "chat";
const swReady = "serviceWorker" in navigator ? navigator.serviceWorker.register("sw.js").catch(() => null) : Promise.resolve(null);

const byChannel = {};          // channel -> messages[] (ascending)
const people = {};             // user_id -> { name, team }
const signed = {};             // image_path -> { url, exp }
const reacts = {};             // message_id -> [{ user_id, emoji }]
const votes = {};              // message_id -> { user_id: option }
const matchData = {};          // channel -> { matches, preds: { match_id: [prediction] } }
const seen = new Set();
let realtime = null;
let pickerFor = null;          // message id whose reaction picker is open

const lg = () => CHANNELS.find(c => c.id === channel);

/* ---------- Screens ---------- */
function show(which) {
  $("authScreen").hidden = which !== "auth";
  for (const id of ["chatHeader", "strip", "scroller"]) $(id).hidden = which !== "chat";
  $("chatFooter").hidden = which !== "chat" || view !== "chat";
}

/* ---------- Auth ---------- */
let mode = "in";
// Modes: in (sign in), up (sign up), forgot (ask for reset email), reset (set new password)
const LEAD = "نقاشات الكورة في الدوريات الخمس الكبرى. سجّل دخولك وخلنا نسولف.";
const MODE_TEXT = {
  in:     { title: "مدرج هلا", lead: LEAD, btn: "دخول" },
  up:     { title: "مدرج هلا", lead: LEAD, btn: "سوّ الحساب" },
  forgot: { title: "نسيت كلمة المرور؟", lead: "اكتب إيميلك ونرسل لك رابط تختار فيه كلمة مرور جديدة.", btn: "أرسل الرابط" },
  reset:  { title: "كلمة مرور جديدة", lead: "اختر كلمة مرور جديدة لحسابك.", btn: "احفظ كلمة المرور" },
};
function setMode(m) {
  mode = m;
  const t = MODE_TEXT[m];
  $("authTitle").textContent = t.title;
  $("authLead").textContent = t.lead;
  $("authBtn").textContent = t.btn;
  $("authTabs").hidden = m === "forgot" || m === "reset";
  $("tabIn").setAttribute("aria-selected", String(m === "in"));
  $("tabUp").setAttribute("aria-selected", String(m === "up"));
  $("nameField").hidden = m !== "up";
  $("emailField").hidden = m === "reset";
  $("passField").hidden = m === "forgot";
  $("passLabel").textContent = m === "reset" ? "كلمة المرور الجديدة" : "كلمة المرور";
  $("passInput").autocomplete = m === "in" ? "current-password" : "new-password";
  $("forgotBtn").hidden = m !== "in";
  $("backBtn").hidden = m !== "forgot";
  authMsg("", "");
}
$("forgotBtn").onclick = () => setMode("forgot");
$("backBtn").onclick = () => setMode("in");
$("tabIn").onclick = () => setMode("in");
$("tabUp").onclick = () => setMode("up");
function authMsg(err, ok) {
  $("authErr").textContent = err; $("authErr").hidden = !err;
  $("authOk").textContent = ok; $("authOk").hidden = !ok;
}
function authError(e) {
  const m = (e && e.message || "").toLowerCase();
  if (m.includes("invalid login")) return "الإيميل أو كلمة المرور غلط.";
  if (m.includes("not confirmed")) return "لازم تأكد إيميلك أول. شوف بريدك واضغط رابط التأكيد.";
  if (m.includes("already registered")) return "هالإيميل مسجل من قبل. جرّب تسجيل الدخول.";
  if (m.includes("different from the old")) return "اختر كلمة مرور غير القديمة.";
  if (m.includes("session") || m.includes("expired")) return "انتهت صلاحية الرابط. اطلب رابط جديد من \"نسيت كلمة المرور؟\".";
  if (m.includes("password")) return "كلمة المرور لازم تكون ٦ أحرف أو أكثر.";
  if (m.includes("rate")) return "محاولات كثيرة. انتظر شوي وجرّب.";
  return "صار خطأ: " + (e && e.message || "غير معروف");
}
$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("emailInput").value.trim();
  const password = $("passInput").value;
  const name = $("nameInput").value.trim();
  if (mode === "forgot" && !email) return authMsg("اكتب إيميلك.", "");
  if (mode === "reset" && password.length < 6) return authMsg("كلمة المرور لازم تكون ٦ أحرف أو أكثر.", "");
  if ((mode === "in" || mode === "up") && (!email || !password)) return authMsg("اكتب الإيميل وكلمة المرور.", "");
  if (mode === "up" && !name) return authMsg("اكتب اسمك.", "");
  $("authBtn").disabled = true; authMsg("", "");
  try {
    if (mode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      authMsg("", "إذا الإيميل مسجل عندنا، بيوصلك رابط خلال دقايق. افتحه من نفس الجوال واختر كلمة مرور جديدة. شيّك على الـ Spam إذا ما لقيته.");
    } else if (mode === "reset") {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      recovering = false;
      $("passInput").value = "";
      startChat();
    } else if (mode === "in") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { name }, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!data.session) authMsg("", "تم! أرسلنا لك رابط تأكيد على الإيميل. اضغطه وبعدها سجّل دخول.");
    }
  } catch (err) {
    authMsg(authError(err), "");
  } finally {
    $("authBtn").disabled = false;
  }
});

let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  const u = session?.user || null;
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (recovering && u) {
    me = u; booted = true;
    setTimeout(() => { show("auth"); if (mode !== "reset") setMode("reset"); }, 0);
    return;
  }
  if (booted && u?.id === me?.id) return;
  booted = true;
  me = u;
  // run outside the auth callback so Supabase calls inside don't deadlock
  setTimeout(() => {
    if (me) return startChat();
    stopChat();
    if (linkError === "otp_expired") { setMode("forgot"); authMsg("انتهت صلاحية الرابط. اكتب إيميلك ونرسل لك رابط جديد.", ""); }
  }, 0);
});

/* ---------- People ---------- */
async function loadPeople(ids, force) {
  const missing = [...new Set(ids)].filter(id => force || !(id in people));
  if (!missing.length) return;
  const { data } = await sb.from("profiles").select("id,name,team").in("id", missing);
  for (const id of missing) if (!people[id]) people[id] = { name: "", team: null };
  for (const p of data || []) people[p.id] = { name: p.name, team: p.team };
}
const nameOf = (id) => people[id]?.name || "شخص";

function colorFor(id) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 42%)`;
}
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}
function avatarEl(id) {
  const av = el("div", "avatar", nameOf(id).trim().charAt(0));
  const t = TEAM_BY_ID[people[id]?.team];
  av.style.background = t ? t.color : colorFor(id);
  av.style.color = t ? inkFor(t.color) : "#fff";
  return av;
}
function teamPill(id) {
  const t = TEAM_BY_ID[people[id]?.team];
  if (!t) return null;
  const p = el("span", "team", t.name);
  p.style.background = t.color; p.style.color = inkFor(t.color);
  return p;
}
function renderMe() {
  $("meName").textContent = nameOf(me.id);
  const a = avatarEl(me.id);
  $("meAvatar").replaceWith(a); a.id = "meAvatar";
}

/* ---------- Messages, reactions, votes ---------- */
async function loadChannel(ch) {
  const { data, error } = await sb.from("messages")
    .select("id,user_id,channel,body,image_path,poll,created_at")
    .eq("channel", ch).order("created_at", { ascending: false }).limit(PAGE);
  if (error) { showErr("ما قدرنا نجيب الرسائل. تأكد من الاتصال."); return; }
  const fresh = (data || []).reverse();
  const extra = (byChannel[ch] || []).filter(m => !fresh.some(f => f.id === m.id));
  byChannel[ch] = fresh.concat(extra).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of byChannel[ch]) seen.add(m.id);
  const ids = byChannel[ch].map(m => m.id);
  const pollIds = byChannel[ch].filter(m => m.poll).map(m => m.id);
  const [r, v] = await Promise.all([
    ids.length ? sb.from("reactions").select("message_id,user_id,emoji").in("message_id", ids) : { data: [] },
    pollIds.length ? sb.from("poll_votes").select("message_id,user_id,option").in("message_id", pollIds) : { data: [] },
  ]);
  for (const id of ids) reacts[id] = [];
  for (const x of r.data || []) reacts[x.message_id].push({ user_id: x.user_id, emoji: x.emoji });
  for (const id of pollIds) votes[id] = {};
  for (const x of v.data || []) votes[x.message_id][x.user_id] = x.option;
}

async function signUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter(p => !signed[p] || signed[p].exp < now + 60000);
  if (!need.length) return;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
  for (const r of data || []) if (r.signedUrl) signed[r.path] = { url: r.signedUrl, exp: now + 3600000 };
}

function findMsg(id) {
  for (const ch in byChannel) { const m = byChannel[ch].find(x => x.id === id); if (m) return m; }
  return null;
}
function rerenderIfShown(ch) { if (ch === channel && view === "chat") render(false); }

async function startChat() {
  show("chat");
  renderLeagues();
  await loadPeople([me.id]);
  renderMe();
  realtime?.unsubscribe();
  realtime = sb.channel("hala-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      const m = p.new; const list = byChannel[m.channel];
      if (list && !list.some(x => x.id === m.id)) { list.push(m); reacts[m.id] = []; if (m.poll) votes[m.id] = {}; rerenderIfShown(m.channel); }
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (p) => {
      for (const ch in byChannel) byChannel[ch] = byChannel[ch].filter(x => x.id !== p.old.id);
      rerenderIfShown(channel);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, (p) => {
      const row = p.eventType === "DELETE" ? p.old : p.new;
      const list = reacts[row.message_id]; if (!list) return;
      const i = list.findIndex(x => x.user_id === row.user_id && x.emoji === row.emoji);
      if (p.eventType === "DELETE") { if (i >= 0) list.splice(i, 1); }
      else if (i < 0) list.push({ user_id: row.user_id, emoji: row.emoji });
      const m = findMsg(row.message_id); if (m) rerenderIfShown(m.channel);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, (p) => {
      const row = p.eventType === "DELETE" ? p.old : p.new;
      const v = votes[row.message_id]; if (!v) return;
      if (p.eventType === "DELETE") delete v[row.user_id]; else v[row.user_id] = row.option;
      const m = findMsg(row.message_id); if (m) rerenderIfShown(m.channel);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (p) => {
      const ch = (p.new && p.new.channel) || null;
      if (ch) { delete matchData[ch]; } else { for (const k in matchData) delete matchData[k]; }
      if (view !== "chat") refreshView();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
      for (const k in matchData) delete matchData[k];
      if (view !== "chat" && !document.activeElement?.classList.contains("goal")) refreshView();
    })
    .subscribe();
  await openChannel(channel);
}

function stopChat() {
  realtime?.unsubscribe(); realtime = null;
  for (const k in byChannel) delete byChannel[k];
  for (const k in matchData) delete matchData[k];
  closeSheet();
  show("auth"); setMode("in");
}

async function openChannel(ch) {
  channel = ch; pickerFor = null;
  try { localStorage.setItem("hala.channel", ch); } catch {}
  renderLeagues();
  await refreshView(true);
}

async function setView(v) {
  view = v;
  try { localStorage.setItem("hala.view", v); } catch {}
  await refreshView(true);
}
$("vChat").onclick = () => setView("chat");
$("vPred").onclick = () => setView("pred");
$("vTable").onclick = () => setView("table");

async function refreshView(jump) {
  for (const [id, v] of [["vChat", "chat"], ["vPred", "pred"], ["vTable", "table"]]) $(id).setAttribute("aria-pressed", String(view === v));
  $("thread").hidden = view !== "chat";
  $("predView").hidden = view !== "pred";
  $("tableView").hidden = view !== "table";
  $("chatFooter").hidden = view !== "chat";
  if (view === "chat") {
    if (!byChannel[channel]) { $("thread").textContent = ""; await loadChannel(channel); }
    return render(jump);
  }
  if (!matchData[channel]) await loadMatches(channel);
  if (view === "pred") renderPredictions(); else renderTable();
  if (jump) $("scroller").scrollTop = 0;
}

/* ---------- Render: leagues ---------- */
function renderLeagues() {
  const box = $("chips"); box.textContent = "";
  for (const c of CHANNELS) {
    const b = el("button", "lg"); b.type = "button"; b.title = c.name;
    b.style.setProperty("--c", c.color); b.style.setProperty("--ci", c.ink);
    b.setAttribute("aria-pressed", String(c.id === channel));
    const f = el("span", "flag", c.flag); f.setAttribute("aria-hidden", "true");
    b.append(f, el("span", "nm", c.short));
    b.onclick = () => openChannel(c.id);
    box.append(b);
  }
  document.body.dataset.league = channel;
  $("leagueName").textContent = lg().flag + " " + lg().name;
}

/* ---------- Render: chat ---------- */
const timeFmt = new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" });
const kickFmt = new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

let renderSeq = 0;
async function render(jump) {
  const seq = ++renderSeq;
  const msgs = byChannel[channel] || [];
  const ids = msgs.map(m => m.user_id);
  for (const id in reacts) for (const r of reacts[id]) ids.push(r.user_id);
  await Promise.all([
    loadPeople(ids),
    signUrls(msgs.filter(m => m.image_path).map(m => m.image_path)),
  ]).catch(() => {});
  if (seq !== renderSeq) return;
  const sc = $("scroller");
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  const t = $("thread"); t.textContent = "";
  if (!msgs.length && !pending.some(p => p.channel === channel)) {
    const e = el("div", "empty");
    const ico = el("span", "ico", "⚽"); ico.setAttribute("aria-hidden", "true");
    e.append(ico, el("strong", null, "الملعب فاضي"), "افتح النقاش عن " + lg().name + ": نتيجة، انتقال، أو سوّ تصويت 📊");
    t.append(e);
  }
  let lastDay = "", lastUid = null;
  for (const m of [...msgs, ...pending.filter(p => p.channel === channel)]) {
    const ts = new Date(m.created_at);
    const d = dayFmt.format(ts);
    if (d !== lastDay) { t.append(el("div", "day", d)); lastDay = d; lastUid = null; }
    t.append(messageRow(m, m.user_id === lastUid));
    lastUid = m.user_id;
  }
  if (jump || nearBottom) sc.scrollTop = sc.scrollHeight;
}

function messageRow(m, cont) {
  const mine = m.user_id === me?.id;
  const row = el("div", "row " + (mine ? "mine" : "theirs") + (cont ? " cont" : "") + (seen.has(m.id) ? "" : " fresh"));
  seen.add(m.id);
  const wrap = el("div", "msgwrap");
  const b = el("div", "bubble");
  if (!mine && !cont) {
    const w = el("div", "who", nameOf(m.user_id));
    w.style.color = TEAM_BY_ID[people[m.user_id]?.team]?.color || colorFor(m.user_id);
    const tp = teamPill(m.user_id); if (tp) w.append(tp);
    b.append(w);
  }
  const src = m.localUrl || signed[m.image_path]?.url;
  if (m.image_path || m.localUrl) {
    const pic = el("img", "pic"); pic.alt = "صورة";
    if (src) pic.src = src;
    pic.onclick = (e) => { e.stopPropagation(); if (pic.src) { $("viewerImg").src = pic.src; $("viewer").hidden = false; } };
    b.append(pic);
  }
  if (m.poll) b.append(pollEl(m));
  if (m.body) b.append(el("div", null, m.body));
  const list = reacts[m.id] || [];
  if (list.length) {
    const box = el("div", "reacts");
    for (const em of EMOJIS) {
      const who = list.filter(r => r.emoji === em);
      if (!who.length) continue;
      const on = who.some(r => r.user_id === me.id);
      const c = el("button", "rc" + (on ? " on" : ""), em + " " + who.length);
      c.type = "button"; c.title = who.map(r => nameOf(r.user_id)).join("، ");
      c.onclick = (e) => { e.stopPropagation(); toggleReact(m, em); };
      box.append(c);
    }
    b.append(box);
  }
  const meta = el("div", "meta");
  if (mine && !m.pending) {
    const del = el("button", "del", "حذف"); del.type = "button";
    del.onclick = (e) => { e.stopPropagation(); deleteMessage(m, del); };
    meta.append(del);
  }
  meta.append(el("span", null, m.pending ? "يُرسل…" : timeFmt.format(new Date(m.created_at))));
  b.append(meta);
  if (!m.pending) b.onclick = () => { pickerFor = pickerFor === m.id ? null : m.id; render(false); };
  wrap.append(b);
  if (pickerFor === m.id) {
    const pk = el("div", "picker");
    for (const em of EMOJIS) {
      const on = list.some(r => r.user_id === me.id && r.emoji === em);
      const x = el("button", on ? "on" : "", em); x.type = "button"; x.setAttribute("aria-label", "تفاعل " + em);
      x.onclick = (e) => { e.stopPropagation(); pickerFor = null; toggleReact(m, em); };
      pk.append(x);
    }
    wrap.append(pk);
  }
  row.append(avatarEl(m.user_id), wrap);
  return row;
}

function pollEl(m) {
  const box = el("div", "poll");
  box.append(el("div", "q", m.poll.question));
  const v = votes[m.id] || {};
  const counts = m.poll.options.map((_, i) => Object.values(v).filter(o => o === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const mineOpt = v[me.id];
  m.poll.options.forEach((label, i) => {
    const o = el("button", "opt" + (mineOpt === i ? " on" : "")); o.type = "button";
    const pct = total ? Math.round(counts[i] / total * 100) : 0;
    const bar = el("span", "bar"); bar.style.width = pct + "%";
    o.append(bar, el("span", "lbl", label), el("span", "n", total ? pct + "٪" : ""));
    o.onclick = (e) => { e.stopPropagation(); castVote(m, i); };
    box.append(o);
  });
  box.append(el("div", "tot", total ? `${total} صوت` : "ما أحد صوّت للحين"));
  return box;
}

async function toggleReact(m, em) {
  const list = reacts[m.id] || (reacts[m.id] = []);
  const i = list.findIndex(r => r.user_id === me.id && r.emoji === em);
  if (i >= 0) {
    list.splice(i, 1); render(false);
    const { error } = await sb.from("reactions").delete().match({ message_id: m.id, user_id: me.id, emoji: em });
    if (error) { list.push({ user_id: me.id, emoji: em }); render(false); showErr("ما انشال التفاعل. جرّب مرة ثانية."); }
  } else {
    list.push({ user_id: me.id, emoji: em }); render(false);
    const { error } = await sb.from("reactions").insert({ message_id: m.id, emoji: em });
    if (error && error.code !== "23505") {
      const j = list.findIndex(r => r.user_id === me.id && r.emoji === em); if (j >= 0) list.splice(j, 1);
      render(false); showErr("ما انحفظ التفاعل. جرّب مرة ثانية.");
    }
  }
}

async function castVote(m, option) {
  const v = votes[m.id] || (votes[m.id] = {});
  const before = v[me.id];
  if (before === option) {
    delete v[me.id]; render(false);
    const { error } = await sb.from("poll_votes").delete().match({ message_id: m.id, user_id: me.id });
    if (error) { v[me.id] = before; render(false); showErr("ما انشال صوتك. جرّب مرة ثانية."); }
    return;
  }
  v[me.id] = option; render(false);
  const { error } = await sb.from("poll_votes").upsert({ message_id: m.id, user_id: me.id, option }, { onConflict: "message_id,user_id" });
  if (error) { if (before === undefined) delete v[me.id]; else v[me.id] = before; render(false); showErr("ما انحفظ صوتك. جرّب مرة ثانية."); }
}

/* ---------- Sending ---------- */
const pending = [];
function showErr(text) { $("err").textContent = text; $("err").hidden = !text; }

const msgEl = $("msg"), sendBtn = $("sendBtn");
function grow() {
  msgEl.style.height = "auto"; msgEl.style.height = Math.min(msgEl.scrollHeight, 120) + "px";
  sendBtn.disabled = !msgEl.value.trim();
}
msgEl.addEventListener("input", grow);
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); }
});

async function insertMessage(row) {
  const { data, error } = await sb.from("messages").insert(row).select().single();
  if (error) throw error;
  const list = byChannel[data.channel] || (byChannel[data.channel] = []);
  if (!list.some(x => x.id === data.id)) list.push(data);
  reacts[data.id] = reacts[data.id] || [];
  if (data.poll) votes[data.id] = votes[data.id] || {};
  seen.add(data.id);
  return data;
}

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = msgEl.value.trim();
  if (!body) return;
  msgEl.value = ""; grow(); showErr("");
  const tmp = { id: "tmp" + Date.now(), user_id: me.id, channel, body, created_at: new Date().toISOString(), pending: true };
  pending.push(tmp); render(true);
  try {
    await insertMessage({ channel: tmp.channel, body });
  } catch {
    msgEl.value = body; grow();
    showErr("ما وصلت الرسالة. تأكد من الاتصال وجرّب مرة ثانية.");
  } finally {
    pending.splice(pending.indexOf(tmp), 1); render(false);
  }
});

async function deleteMessage(m, btn) {
  btn.disabled = true;
  const { error } = await sb.from("messages").delete().eq("id", m.id);
  if (error) { btn.disabled = false; showErr("ما انحذفت الرسالة. جرّب مرة ثانية."); return; }
  if (m.image_path) sb.storage.from(BUCKET).remove([m.image_path]);
  byChannel[m.channel] = byChannel[m.channel].filter(x => x.id !== m.id);
  render(false);
}

/* ---------- Photos ---------- */
$("attachBtn").onclick = () => $("picker").click();
$("viewer").onclick = () => { $("viewer").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("viewer").hidden = true; closeSheet(); } });

// Shrink big gallery photos so they upload fast and fit the 5 MB limit.
async function shrink(file) {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5e6 && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.85));
  } catch { return file; }
}

$("picker").addEventListener("change", async () => {
  const file = $("picker").files[0];
  $("picker").value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) { showErr("اختر صورة فقط."); return; }
  showErr("");
  const caption = msgEl.value.trim();
  msgEl.value = ""; grow();
  const tmp = { id: "tmp" + Date.now(), user_id: me.id, channel, body: caption, created_at: new Date().toISOString(), localUrl: URL.createObjectURL(file), pending: true };
  pending.push(tmp); render(true);
  $("attachBtn").disabled = true;
  try {
    const blob = await shrink(file);
    const ext = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] || "jpg";
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (up.error) throw up.error;
    signed[path] = { url: tmp.localUrl, exp: Date.now() + 3000000 };
    await insertMessage({ channel: tmp.channel, body: caption || null, image_path: path });
  } catch (err) {
    msgEl.value = caption; grow();
    const m = String(err?.message || "").toLowerCase();
    if (m.includes("size") || m.includes("large")) showErr("الصورة كبيرة مرة. الحد ٥ ميجا.");
    else if (m.includes("mime")) showErr("نوع الصورة غير مدعوم. جرّب JPG أو PNG.");
    else showErr("ما انرفعت الصورة. تأكد من الاتصال وجرّب مرة ثانية.");
  } finally {
    pending.splice(pending.indexOf(tmp), 1);
    $("attachBtn").disabled = false;
    render(false);
  }
});

/* ---------- Bottom sheet ---------- */
function openSheet(title, build) {
  const s = $("sheet"); s.textContent = "";
  s.append(el("h3", null, title));
  build(s);
  $("sheetBg").hidden = false;
  const first = s.querySelector("input, select, textarea"); if (first) first.focus();
}
function closeSheet() { $("sheetBg").hidden = true; $("sheet").textContent = ""; }
$("sheetBg").addEventListener("click", (e) => { if (e.target === $("sheetBg")) closeSheet(); });
function field(label, input) { const l = el("label", null, label); l.append(input); return l; }
function textInput(id, max, value) { const i = el("input"); i.type = "text"; i.id = id; i.maxLength = max; if (value) i.value = value; return i; }
function sheetActions(s, okText, onOk) {
  const err = el("div", "err"); err.hidden = true;
  const acts = el("div", "acts");
  const ok = el("button", "primary", okText); ok.type = "button";
  const cancel = el("button", "cancel", "إلغاء"); cancel.type = "button"; cancel.onclick = closeSheet;
  ok.onclick = async () => {
    err.hidden = true; ok.disabled = true;
    try { const msg = await onOk(); if (msg) { err.textContent = msg; err.hidden = false; } else closeSheet(); }
    catch { err.textContent = "صار خطأ. تأكد من الاتصال وجرّب مرة ثانية."; err.hidden = false; }
    finally { ok.disabled = false; }
  };
  acts.append(ok, cancel);
  s.append(err, acts);
}

/* ---------- Polls ---------- */
$("pollBtn").onclick = () => openSheet("تصويت جديد 📊", (s) => {
  const q = textInput("pollQ", 200, msgEl.value.trim());
  q.placeholder = "مثال: مين أحسن لاعب في المباراة؟";
  s.append(field("السؤال", q));
  const opts = [];
  for (let i = 0; i < 4; i++) {
    const o = textInput("pollO" + i, 60); o.placeholder = i < 2 ? "خيار " + (i + 1) : "خيار " + (i + 1) + " (اختياري)";
    opts.push(o); s.append(o);
  }
  sheetActions(s, "انشر التصويت", async () => {
    const question = q.value.trim();
    const options = opts.map(o => o.value.trim()).filter(Boolean);
    if (!question) return "اكتب السؤال.";
    if (options.length < 2) return "اكتب خيارين على الأقل.";
    await insertMessage({ channel, poll: { question, options } });
    msgEl.value = ""; grow();
    render(true);
  });
});

/* ---------- Profile (name + favorite team) ---------- */
$("meBtn").onclick = () => openSheet("ملفي", (s) => {
  const nm = textInput("profName", 40, people[me.id]?.name || "");
  s.append(field("اسمك", nm));
  const sel = el("select"); sel.id = "profTeam";
  sel.append(new Option("بدون فريق", ""));
  for (const c of CHANNELS) {
    const g = document.createElement("optgroup"); g.label = c.flag + " " + c.name;
    for (const [id, name] of TEAMS[c.id]) g.append(new Option(name, id));
    sel.append(g);
  }
  sel.value = people[me.id]?.team || "";
  s.append(field("فريقك المفضل", sel));
  sheetActions(s, "احفظ", async () => {
    const name = nm.value.trim();
    if (!name) return "اكتب اسمك.";
    const { error } = await sb.from("profiles").update({ name, team: sel.value || null }).eq("id", me.id);
    if (error) return "ما انحفظ. جرّب مرة ثانية.";
    people[me.id] = { name, team: sel.value || null };
    renderMe(); refreshView();
  });
  const out = el("button", "link danger", "تسجيل خروج"); out.type = "button";
  out.onclick = async () => {
    closeSheet();
    try { const sub = await currentSub(); if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } } catch {}
    sb.auth.signOut();
  };
  const box = el("div", "notif"); s.append(box);
  renderNotif(box);
  s.append(out);
});

/* ---------- Matches & predictions ---------- */
async function loadMatches(ch) {
  const { data: matches, error } = await sb.from("matches")
    .select("id,channel,created_by,home,away,kickoff,home_score,away_score,status,external_id")
    .eq("channel", ch).order("kickoff", { ascending: false }).limit(150);
  if (error) { matchData[ch] = { matches: [], preds: {}, error: true }; return; }
  const ids = matches.map(m => m.id);
  const { data: preds } = ids.length
    ? await sb.from("predictions").select("match_id,user_id,home,away").in("match_id", ids)
    : { data: [] };
  const byMatch = {};
  for (const p of preds || []) (byMatch[p.match_id] ||= []).push(p);
  matchData[ch] = { matches, preds: byMatch };
  await loadPeople([...matches.map(m => m.created_by), ...(preds || []).map(p => p.user_id)].filter(Boolean));
}

const sign = (n) => Math.sign(n);
function pointsFor(p, m) {
  if (m.home_score == null || m.away_score == null) return null;
  if (p.home === m.home_score && p.away === m.away_score) return 3;
  return sign(p.home - p.away) === sign(m.home_score - m.away_score) ? 1 : 0;
}
function ptsBadge(n) { return el("span", "pts p" + n, n === 3 ? "+٣ بالضبط" : n === 1 ? "+١ النتيجة" : "٠"); }

function goalInput(val, label) {
  const i = el("input", "goal"); i.type = "number"; i.inputMode = "numeric"; i.min = 0; i.max = 30;
  i.setAttribute("aria-label", label); if (val != null) i.value = val;
  return i;
}
const goalVal = (i) => { const n = parseInt(i.value, 10); return Number.isInteger(n) && n >= 0 && n <= 30 ? n : null; };

function renderPredictions() {
  const box = $("predView"); box.textContent = "";
  const data = matchData[channel] || { matches: [], preds: {} };
  const head = el("div", "pane-head");
  const ht = el("div"); ht.append(el("h2", null, "توقعات الجولة"), el("p", null, "توقّع النتيجة قبل صافرة البداية. التوقعات تنكشف أول ما تبدأ المباراة."));
  head.append(ht); box.append(head);
  if (data.error) { box.append(el("div", "rules", "ما قدرنا نجيب المباريات. تأكد إن تحديث قاعدة البيانات انشغل، وحدّث الصفحة.")); return; }
  const now = Date.now();
  const upcoming = data.matches.filter(m => new Date(m.kickoff) > now).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const started = data.matches.filter(m => new Date(m.kickoff) <= now);
  if (!data.matches.length) {
    const e = el("div", "empty"); const ico = el("span", "ico", "🏟️"); ico.setAttribute("aria-hidden", "true");
    e.append(ico, el("strong", null, "ما فيه مباريات"), "مباريات الأسبوع الجاي تنضاف هنا تلقائي. ارجع بعد شوي.");
    box.append(e); return;
  }
  if (upcoming.length) { box.append(el("div", "sec", "الجاية")); for (const m of upcoming) box.append(matchCard(m, data.preds[m.id] || [], false)); }
  if (started.length) { box.append(el("div", "sec", "اللي لعبت")); for (const m of started) box.append(matchCard(m, data.preds[m.id] || [], true)); }
}

function matchCard(m, preds, started) {
  const card = el("div", "match");
  const done = m.home_score != null && m.away_score != null;
  const when = el("div", "when");
  when.append(el("span", null, kickFmt.format(new Date(m.kickoff))));
  const off = { POSTPONED: "تأجلت", SUSPENDED: "توقفت", CANCELLED: "ألغيت" }[m.status];
  if (off) when.append(el("span", "live", off));
  else if (started && !done) when.append(el("span", "live", m.status === "PAUSED" ? "● استراحة" : "● جارية"));
  else if (done) when.append(el("span", null, "انتهت"));
  card.append(when);

  const sc = el("div", "score");
  const mid = el("div", "mid");
  const myPred = preds.find(p => p.user_id === me.id);
  let hIn, aIn;
  if (!started) {
    hIn = goalInput(myPred?.home, "أهداف " + m.home); aIn = goalInput(myPred?.away, "أهداف " + m.away);
    mid.append(hIn, el("span", "vs", "-"), aIn);
  } else if (done) {
    mid.append(el("span", null, m.home_score), el("span", "vs", "-"), el("span", null, m.away_score));
  } else {
    mid.append(el("span", "vs", "ضد"));
  }
  // Arabic reading order: home team on the right with its score beside it.
  sc.append(el("div", "tm h", m.home), mid, el("div", "tm a", m.away));
  card.append(sc);

  const rowEl = el("div", "mrow");
  if (!started) {
    const note = el("span", "note", myPred ? `توقعك: ${myPred.home} - ${myPred.away}` : "ما توقعت للحين");
    const save = el("button", "small pri", myPred ? "عدّل توقعي" : "احفظ توقعي"); save.type = "button";
    save.onclick = async () => {
      const h = goalVal(hIn), a = goalVal(aIn);
      if (h == null || a == null) { note.textContent = "اكتب أهداف الفريقين (من ٠ إلى ٣٠)."; return; }
      save.disabled = true;
      const { error } = await sb.from("predictions").upsert({ match_id: m.id, user_id: me.id, home: h, away: a, updated_at: new Date().toISOString() }, { onConflict: "match_id,user_id" });
      save.disabled = false;
      if (error) { note.textContent = new Date(m.kickoff) <= Date.now() ? "بدأت المباراة، ما يمديك تتوقع." : "ما انحفظ. جرّب مرة ثانية."; return; }
      const list = matchData[channel].preds[m.id] ||= [];
      const ex = list.find(p => p.user_id === me.id);
      if (ex) { ex.home = h; ex.away = a; } else list.push({ match_id: m.id, user_id: me.id, home: h, away: a });
      renderPredictions();
    };
    rowEl.append(note, save);
  } else {
    rowEl.append(el("span", "note", preds.length ? `${preds.length} توقّعوا` : "ما أحد توقّع"));
  }
  if (m.created_by === me.id) {
    const edit = el("button", "small", done ? "عدّل النتيجة" : started ? "حط النتيجة" : "تعديل"); edit.type = "button";
    edit.onclick = () => started ? resultSheet(m) : addMatchSheet(m);
    rowEl.append(edit);
  }
  card.append(rowEl);

  if (started && preds.length) {
    const list = el("div", "preds");
    const sorted = preds.slice().sort((a, b) => (pointsFor(b, m) ?? 0) - (pointsFor(a, m) ?? 0));
    for (const p of sorted) {
      const r = el("div", "pr");
      const w = el("span", "who2", nameOf(p.user_id) + (p.user_id === me.id ? " (أنت)" : ""));
      const g = el("span", "g", `${p.home} - ${p.away}`);
      const pts = pointsFor(p, m); if (pts != null) g.append(ptsBadge(pts));
      r.append(w, g); list.append(r);
    }
    card.append(list);
  }
  const by = el("div", null, m.created_by ? "أضافها " + nameOf(m.created_by) : "🤖 مباراة رسمية، النتيجة تنحط تلقائي");
  by.style.cssText = "font-size:11px;color:var(--muted)";
  card.append(by);
  return card;
}

function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addMatchSheet(existing) {
  const editing = existing && existing.id;
  openSheet(editing ? "تعديل المباراة" : "مباراة جديدة ⚽", (s) => {
    const r = el("div", "row2");
    const h = textInput("mHome", 40, existing?.home); h.placeholder = "مثال: ليفربول";
    const a = textInput("mAway", 40, existing?.away); a.placeholder = "مثال: أرسنال";
    r.append(field("صاحب الأرض", h), field("الضيف", a));
    s.append(r);
    const k = el("input"); k.type = "datetime-local"; k.id = "mKick";
    const def = existing?.kickoff ? new Date(existing.kickoff) : (() => { const d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0); d.setHours(20); return d; })();
    k.value = toLocalInput(def);
    s.append(field("موعد البداية (بتوقيتك)", k));
    sheetActions(s, editing ? "احفظ" : "أضف المباراة", async () => {
      const home = h.value.trim(), away = a.value.trim();
      if (!home || !away) return "اكتب اسم الفريقين.";
      const when = new Date(k.value);
      if (isNaN(when)) return "اختر موعد المباراة.";
      if (!editing && when <= new Date()) return "الموعد لازم يكون بعد الحين.";
      const row = { home, away, kickoff: when.toISOString() };
      const { error } = editing
        ? await sb.from("matches").update(row).eq("id", existing.id)
        : await sb.from("matches").insert({ ...row, channel });
      if (error) return "ما انحفظت المباراة. جرّب مرة ثانية.";
      delete matchData[channel]; await refreshView();
    });
    if (editing) {
      const del = el("button", "link danger", "احذف المباراة"); del.type = "button";
      del.onclick = async () => {
        if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "متأكد؟ اضغط مرة ثانية للحذف"; return; }
        const { error } = await sb.from("matches").delete().eq("id", existing.id);
        if (!error) { closeSheet(); delete matchData[channel]; refreshView(); }
      };
      s.append(del);
    }
  });
}

function resultSheet(m) {
  openSheet("النتيجة النهائية", (s) => {
    const r = el("div", "row2");
    const h = goalInput(m.home_score, m.home); const a = goalInput(m.away_score, m.away);
    h.style.width = "100%"; a.style.width = "100%";
    r.append(field(m.home, h), field(m.away, a));
    s.append(r);
    sheetActions(s, "احفظ النتيجة", async () => {
      const hs = goalVal(h), as = goalVal(a);
      if (hs == null || as == null) return "اكتب أهداف الفريقين.";
      const { error } = await sb.from("matches").update({ home_score: hs, away_score: as }).eq("id", m.id);
      if (error) return "ما انحفظت النتيجة. جرّب مرة ثانية.";
      delete matchData[channel]; await refreshView();
    });
  });
}

/* ---------- League table ---------- */
function renderTable() {
  const box = $("tableView"); box.textContent = "";
  const data = matchData[channel] || { matches: [], preds: {} };
  const head = el("div", "pane-head");
  const ht = el("div"); ht.append(el("h2", null, "ترتيب المتوقعين"), el("p", null, lg().name));
  head.append(ht); box.append(head);
  const rows = {};
  for (const m of data.matches) {
    for (const p of data.preds[m.id] || []) {
      const pts = pointsFor(p, m); if (pts == null) continue;
      const r = rows[p.user_id] ||= { id: p.user_id, pts: 0, exact: 0, played: 0 };
      r.pts += pts; r.played++; if (pts === 3) r.exact++;
    }
  }
  const list = Object.values(rows).sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.played - b.played);
  if (!list.length) {
    const e = el("div", "empty"); const ico = el("span", "ico", "🏆"); ico.setAttribute("aria-hidden", "true");
    e.append(ico, el("strong", null, "الترتيب فاضي"), "يطلع الترتيب أول ما تنحط نتيجة مباراة فيها توقعات.");
    box.append(e);
  } else {
    const wrap = el("div"); wrap.style.overflowX = "auto";
    const t = el("table", "table");
    const thead = el("thead"); const hr = el("tr");
    for (const [txt, cls] of [["#", ""], ["المتوقع", "nm"], ["توقعات", ""], ["بالضبط", ""], ["نقاط", ""]]) hr.append(el("th", cls, txt));
    thead.append(hr); t.append(thead);
    const tb = el("tbody");
    let rank = 0, prev = null;
    list.forEach((r, i) => {
      if (!prev || prev.pts !== r.pts || prev.exact !== r.exact) rank = i + 1;
      prev = r;
      const tr = el("tr", (r.id === me.id ? "me " : "") + (rank <= 3 ? "r" + rank : ""));
      const rk = el("td"); rk.append(el("span", "rank", rank));
      const nm = el("td", "nm", nameOf(r.id)); const tp = teamPill(r.id); if (tp) nm.append(tp);
      tr.append(rk, nm, el("td", null, r.played), el("td", null, r.exact), el("td", "pt", r.pts));
      tb.append(tr);
    });
    t.append(tb); wrap.append(t); box.append(wrap);
  }
  box.append(el("div", "rules", "النقاط: ٣ إذا جبت النتيجة بالضبط، و١ إذا جبت الفايز أو التعادل بس. النتايج تنحط تلقائي بعد نهاية كل مباراة."));
}

/* ---------- Push notifications ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSub() {
  const reg = await swReady; if (!reg) return null;
  return reg.pushManager.getSubscription();
}
function b64ToBytes(b64) {
  const pad = "=".repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function renderNotif(box) {
  box.textContent = "";
  box.append(el("h4", null, "🔔 الإشعارات"));
  if (isIOS && !isStandalone()) {
    box.append(el("p", null, "عشان توصلك الإشعارات على الآيفون، لازم تضيف التطبيق للشاشة الرئيسية:"));
    const ol = el("ol", "steps");
    for (const t of ["اضغط زر المشاركة ⬆️ تحت في Safari", "اختر Add to Home Screen (إضافة إلى الشاشة الرئيسية)", "افتح مدرج هلا من الأيقونة الجديدة", "ارجع هنا وفعّل الإشعارات"]) ol.append(el("li", null, t));
    box.append(ol);
    return;
  }
  if (!pushSupported()) { box.append(el("p", null, "هالمتصفح ما يدعم الإشعارات. جرّب Chrome أو Safari بآخر تحديث.")); return; }
  if (Notification.permission === "denied") { box.append(el("p", null, "الإشعارات مقفلة لهالموقع. فعّلها من إعدادات الجوال أو المتصفح، وبعدها ارجع هنا.")); return; }

  const sub = await currentSub();
  const { data: row } = sub ? await sb.from("push_subscriptions").select("*").eq("endpoint", sub.endpoint).maybeSingle() : { data: null };
  if (!sub || !row) {
    box.append(el("p", null, "تذكير قبل المباراة إذا ما توقعت، ونتيجتك أول ما تخلص، ورسايل الدوريات اللي تختارها."));
    const on = el("button", "primary", "فعّل الإشعارات"); on.type = "button";
    const err = el("div", "err"); err.hidden = true;
    on.onclick = async () => {
      on.disabled = true; err.hidden = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("لازم تسمح بالإشعارات عشان توصلك.");
        const { data: k } = await sb.from("app_public").select("value").eq("key", "vapid_public").maybeSingle();
        if (!k?.value) throw new Error("الإشعارات للحين ما تجهزت من جهة السيرفر. جرّب بعد شوي.");
        const reg = await swReady; if (!reg) throw new Error("ما قدرنا نشغّل الإشعارات على هالجهاز.");
        const s2 = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.value) });
        const j = s2.toJSON();
        const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: me.id, leagues: [channel] }, { onConflict: "endpoint" });
        if (error) throw new Error("ما انحفظ الاشتراك. جرّب مرة ثانية.");
        renderNotif(box);
      } catch (e) { err.textContent = e.message || "صار خطأ."; err.hidden = false; on.disabled = false; }
    };
    box.append(on, err);
    return;
  }

  const save = async (patch, input) => {
    input.disabled = true;
    const { error } = await sb.from("push_subscriptions").update(patch).eq("endpoint", sub.endpoint);
    input.disabled = false;
    if (error) { input.checked = !input.checked; }
    else Object.assign(row, patch);
  };
  const toggle = (label, key) => {
    const l = el("label", "tg"); const i = el("input"); i.type = "checkbox"; i.checked = row[key]; i.id = "n-" + key;
    i.onchange = () => save({ [key]: i.checked }, i);
    l.append(el("span", null, label), i); return l;
  };
  box.append(toggle("⏰ تذكير قبل المباراة بساعة إذا ما توقعت", "reminders"), toggle("⚽ النتيجة ونقاطك", "results"));
  box.append(el("p", null, "💬 رسايل جديدة من:"));
  const grid = el("div", "lgs");
  for (const c of CHANNELS) {
    const l = el("label"); const i = el("input"); i.type = "checkbox"; i.id = "n-lg-" + c.id; i.checked = row.leagues.includes(c.id);
    i.onchange = () => {
      const next = CHANNELS.map(x => x.id).filter(id => id === c.id ? i.checked : row.leagues.includes(id));
      save({ leagues: next }, i);
    };
    l.append(i, el("span", null, c.flag + " " + c.short)); grid.append(l);
  }
  box.append(grid);
  const off = el("button", "link", "أوقف الإشعارات على هالجهاز"); off.type = "button";
  off.onclick = async () => {
    off.disabled = true;
    await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => {});
    renderNotif(box);
  };
  box.append(off);
}
