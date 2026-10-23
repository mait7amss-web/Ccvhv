/* مدرج هلا — football chat for the five big leagues.
   Backend: Supabase (auth, Postgres with row-level security, storage, realtime). */

// The five big leagues. color/ink paint the tab when it's selected.
const CHANNELS = [
  { id: "epl",        short: "إنجليزي", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", name: "الدوري الإنجليزي الممتاز", color: "#8f3fd6", ink: "#ffffff" },
  { id: "laliga",     short: "إسباني",  flag: "🇪🇸", name: "الدوري الإسباني",          color: "#ff4b3e", ink: "#ffffff" },
  { id: "seriea",     short: "إيطالي",  flag: "🇮🇹", name: "الدوري الإيطالي",          color: "#1aa3ff", ink: "#04131f" },
  { id: "bundesliga", short: "ألماني",  flag: "🇩🇪", name: "الدوري الألماني",          color: "#e4202b", ink: "#ffffff" },
  { id: "ligue1",     short: "فرنسي",   flag: "🇫🇷", name: "الدوري الفرنسي",           color: "#dae025", ink: "#0d1400" },
  { id: "ucl",        short: "الأبطال", flag: "🏆", name: "دوري أبطال أوروبا",        color: "#c9d6ec", ink: "#0b1f6b" },
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

const APP_VERSION = 25; // keep in sync with version.json and the ?v= in index.html

// When a newer version is published, reload once to pick it up (the home-screen app can stay open for days).
async function checkForUpdate() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    const { v } = await r.json();
    if (v > APP_VERSION && sessionStorage.getItem("hala.reloadedFor") !== String(v)) {
      sessionStorage.setItem("hala.reloadedFor", String(v));
      location.reload();
    }
  } catch {}
}
checkForUpdate();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });

const EMOJIS = ["👍", "🔥", "😂", "😡"];
const BUCKET = "chat-images";
const AUDIO_BUCKET = "chat-audio";
// Built-in sticker pack: [id, label]. Older sticker files stay in /stickers so past messages still show.
const STICKERS = [["goal","هدددف!"],["gg","كفو!"],["champ","الأبطال"],["shh","اسكتوا!"],["miss","ضيّعها!"],["cry","يا حسرة"],["foul","وين الفاول؟"],["dive","تمثيل!"],["save","صدّة!"],["bicycle","مقصية!"],["sleep","الدفاع نايم"],["red","طرد!"],["offside","تسلل!"],["var","راجع الفار"]];
const OLD_STICKERS = { yellow: "إنذار!", wow: "يا ساتر!", fire: "نااار", remontada: "ريمونتادا", ref: "وين الحكم؟", penalty: "بلنتي!", lol: "ههههه" };
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
let view = "chat";             // chat | pred | table | arena
let openArenaId = null;        // structured debate opened from a notification
let openRoomId = null;         // match room opened from a notification
let communityLink = null;      // community post/profile opened from a notification or a shared link
try { channel = localStorage.getItem("hala.channel") || channel; view = localStorage.getItem("hala.view") || view; } catch {}
if (!CHANNELS.some(c => c.id === channel)) channel = CHANNELS[0].id;
{ // Opened from a notification: ?league=epl&view=pred
  const q = new URLSearchParams(location.search);
  if (q.get("league")) channel = q.get("league");
  if (q.get("view")) view = q.get("view");
  if (q.get("arena")) openArenaId = Number(q.get("arena")) || null;
  if (q.get("room")) openRoomId = Number(q.get("room")) || null;
  if (q.get("view") === "community") communityLink = { post: Number(q.get("post")) || null, user: q.get("user") || null, notifs: q.has("notifs") };
  if (q.has("league") || q.has("view")) history.replaceState(null, "", location.pathname);
}
if (!CHANNELS.some(c => c.id === channel)) channel = CHANNELS[0].id;
if (!["chat", "pred", "table", "arena"].includes(view)) view = "chat";
const swReady = "serviceWorker" in navigator ? navigator.serviceWorker.register("sw.js").catch(() => null) : Promise.resolve(null);

const byChannel = {};          // channel -> messages[] (ascending)
const people = {};             // user_id -> { name, team }
const signed = {};             // image_path -> { url, exp }
const reacts = {};             // message_id -> [{ user_id, emoji }]
const blocked = new Set();     // user ids I blocked
let isAdmin = false;
const hiddenLocal = new Set((() => { try { return JSON.parse(localStorage.getItem("hala.hidden") || "[]"); } catch { return []; } })());
function hideLocally(id) { hiddenLocal.add(id); try { localStorage.setItem("hala.hidden", JSON.stringify([...hiddenLocal].slice(-500))); } catch {} }
const votes = {};              // message_id -> { user_id: option }
const matchData = {};          // channel -> { matches, preds: { match_id: [prediction] } }
const motmMine = {};           // match_id -> my star-of-the-match pick
// Highest official rating in a finished match
function topRated(m) {
  if (!m.players || m.home_score == null) return null;
  return [...(m.players.home || []), ...(m.players.away || [])].sort((a, b) => b.rating - a.rating)[0] || null;
}
const seen = new Set();
let realtime = null;
let pickerFor = null;          // message id whose reaction picker is open

const lg = () => CHANNELS.find(c => c.id === channel);

/* ---------- Screens ---------- */
function show(which) {
  $("authScreen").hidden = which !== "auth";
  for (const id of ["chatHeader", "strip", "scroller"]) $(id).hidden = which !== "chat";
  $("chatFooter").hidden = true;   // the league chat became match rooms
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
  $("termsNote").hidden = m !== "up";
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
  if (mode === "up") {
    const { data: free, error: nErr } = await sb.rpc("name_available", { n: name });
    if (!nErr && free === false) return authMsg("الاسم \"" + name + "\" مستخدم من شخص ثاني. اختر اسم غيره.", "");
  }
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
  let { data, error } = await sb.from("profiles").select("id,name,team,avatar_path").in("id", missing);
  if (error) ({ data } = await sb.from("profiles").select("id,name,team").in("id", missing));
  for (const id of missing) if (!people[id]) people[id] = { name: "", team: null };
  for (const p of data || []) people[p.id] = { name: p.name, team: p.team, avatar_path: p.avatar_path || null };
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
// Profile photos live in the public "avatars" bucket.
const avatarUrl = (path) => `${cfg.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
function avatarEl(id) {
  const av = el("div", "avatar", nameOf(id).trim().charAt(0));
  const t = TEAM_BY_ID[people[id]?.team];
  av.style.background = t ? t.color : colorFor(id);
  av.style.color = t ? inkFor(t.color) : "#fff";
  const pic = people[id]?.avatar_path;
  if (pic) { av.textContent = ""; av.classList.add("has-pic"); av.style.backgroundImage = `url("${avatarUrl(pic)}")`; }
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
  const BASE = "id,user_id,channel,body,image_path,poll,created_at,hidden,reply_to,mentions,gif_url,sticker,audio_path,audio_secs";
  let data, error;
  for (const cols of [BASE + ",tactic,scenario,debate,match_id", BASE + ",tactic,scenario,debate", BASE]) {
    ({ data, error } = await sb.from("messages").select(cols).eq("channel", ch).order("created_at", { ascending: false }).limit(PAGE));
    if (!error) break;
  }
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
  await loadExtras(byChannel[ch]).catch(() => {});
}

// Signed URLs are cached per path; audio paths are stored under "a:" + path.
async function signUrls(paths, bucket = BUCKET, prefix = "") {
  const now = Date.now();
  const need = [...new Set(paths)].filter(p => !signed[prefix + p] || signed[prefix + p].exp < now + 60000);
  if (!need.length) return;
  const { data } = await sb.storage.from(bucket).createSignedUrls(need, 3600);
  for (const r of data || []) if (r.signedUrl) signed[prefix + r.path] = { url: r.signedUrl, exp: now + 3600000 };
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
  const [bl, ad] = await Promise.all([
    sb.from("blocks").select("blocked"),
    sb.from("admins").select("user_id").eq("user_id", me.id).maybeSingle(),
  ]);
  blocked.clear(); for (const b of bl.data || []) blocked.add(b.blocked);
  isAdmin = Boolean(ad.data);
  realtime?.unsubscribe();
  realtime = sb.channel("hala-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      const m = p.new; const list = byChannel[m.channel];
      if (list && !list.some(x => x.id === m.id)) { list.push(m); reacts[m.id] = []; if (m.poll) votes[m.id] = {}; rerenderIfShown(m.channel); }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
      const m = findMsg(p.new.id); if (!m) return;
      m.hidden = p.new.hidden;
      if (m.hidden && m.user_id !== me.id && !isAdmin) byChannel[m.channel] = byChannel[m.channel].filter(x => x.id !== m.id);
      rerenderIfShown(m.channel);
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
      if (p.eventType === "UPDATE" && p.new?.id) {
        // Live feed updates every minute: patch in place instead of reloading everything
        matchCache[p.new.id] = { ...(matchCache[p.new.id] || {}), ...p.new };
        if (typeof roomMatch !== "undefined" && roomMatch?.id === p.new.id) { Object.assign(roomMatch, p.new); drawRoomHeader(); }
        const list = matchData[ch]?.matches; const i = list ? list.findIndex(x => x.id === p.new.id) : -1;
        if (i >= 0) {
          list[i] = { ...list[i], ...p.new };
          if (view === "pred" && ch === channel && !document.activeElement?.classList.contains("goal")) renderPredictions();
          if (view === "chat" && ch === channel) renderRooms();
          return;
        }
      }
      if (ch) { delete matchData[ch]; } else { for (const k in matchData) delete matchData[k]; }
      refreshView();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "predictions" }, () => {
      for (const k in matchData) delete matchData[k];
      if (view !== "chat" && !document.activeElement?.classList.contains("goal")) refreshView();
    })
    .subscribe();
  startExtrasRealtime();
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
$("vArena").onclick = () => setView("arena");

async function refreshView(jump) {
  for (const [id, v] of [["vChat", "chat"], ["vPred", "pred"], ["vTable", "table"], ["vArena", "arena"]]) $(id).setAttribute("aria-pressed", String(view === v));
  $("thread").hidden = true;
  $("roomsView").hidden = view !== "chat";
  $("predView").hidden = view !== "pred";
  $("tableView").hidden = view !== "table";
  $("arenaView").hidden = view !== "arena";
  $("chatFooter").hidden = true;
  if (view === "arena") { if (jump) $("scroller").scrollTop = 0; return renderArenaView(); }
  if (view === "chat") {
    // "المباريات": a room per match instead of one league chat
    if (!matchData[channel]) await loadMatches(channel);
    renderRooms();
    if (jump) $("scroller").scrollTop = 0;
    return;
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
  const msgs = (byChannel[channel] || []).filter(m => !blocked.has(m.user_id) && !hiddenLocal.has(m.id));
  const ids = msgs.map(m => m.user_id);
  for (const id in reacts) for (const r of reacts[id]) ids.push(r.user_id);
  await Promise.all([
    loadPeople(ids),
    signUrls(msgs.filter(m => m.image_path).map(m => m.image_path)),
    signUrls(msgs.filter(m => m.audio_path).map(m => m.audio_path), AUDIO_BUCKET, "a:"),
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

function snippet(m) {
  if (!m) return "رسالة محذوفة";
  if (m.body) return m.body.length > 80 ? m.body.slice(0, 79) + "…" : m.body;
  if (m.poll) return "📊 " + m.poll.question;
  if (m.tactic) return "🧠 " + (m.tactic.title || "لوحة تكتيك");
  if (m.scenario) return "🎯 لو أنت المدرب: " + m.scenario.text;
  if (m.debate) return "⚔️ " + m.debate.question;
  if (m.image_path || m.localUrl) return "📷 صورة";
  if (m.gif_url) return "GIF";
  if (m.sticker) return "ملصق " + (STICKERS.find(s => s[0] === m.sticker)?.[1] || OLD_STICKERS[m.sticker] || "");
  if (m.audio_path || m.localAudio) return "🎤 رسالة صوتية " + fmtSecs(m.audio_secs || 0);
  return "";
}
const fmtSecs = (x) => { x = Math.round(x || 0); return Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };

// Message text with @mentions highlighted (only names the sender actually mentioned)
function bodyEl(m) {
  const box = el("div", "txt");
  const names = (m.mentions || []).map(id => people[id]?.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) { box.textContent = m.body; return box; }
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("@(" + names.map(esc).join("|") + ")", "g");
  let last = 0, mt;
  while ((mt = re.exec(m.body))) {
    box.append(m.body.slice(last, mt.index));
    const id = (m.mentions || []).find(i => people[i]?.name === mt[1]);
    box.append(el("span", "mention" + (id === me.id ? " me" : ""), mt[0]));
    last = mt.index + mt[0].length;
  }
  box.append(m.body.slice(last));
  return box;
}

function scrollToMsg(id) {
  const r = document.querySelector(`.row[data-id="${id}"]`);
  if (!r) { toast("الرسالة الأصلية قديمة ومو ظاهرة هنا."); return; }
  r.scrollIntoView({ block: "center", behavior: "smooth" });
  r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
}

function messageRow(m, cont) {
  const mine = m.user_id === me?.id;
  const bare = (m.sticker || m.gif_url) && !m.body && !m.reply_to;
  const row = el("div", "row " + (mine ? "mine" : "theirs") + (cont ? " cont" : "") + (seen.has(m.id) ? "" : " fresh") + ((m.mentions || []).includes(me?.id) ? " mentioned" : ""));
  row.dataset.id = m.id;
  seen.add(m.id);
  const wrap = el("div", "msgwrap");
  const b = el("div", "bubble" + (bare ? " bare" : ""));
  if (!mine && !cont) {
    const w = el("div", "who", nameOf(m.user_id));
    w.style.color = TEAM_BY_ID[people[m.user_id]?.team]?.color || colorFor(m.user_id);
    const tp = teamPill(m.user_id); if (tp) w.append(tp);
    w.style.cursor = "pointer";
    w.onclick = (e) => { e.stopPropagation(); profileSheet(m.user_id); };
    b.append(w);
  }
  const src = m.localUrl || signed[m.image_path]?.url;
  if (m.image_path || m.localUrl) {
    const pic = el("img", "pic"); pic.alt = "صورة";
    if (src) pic.src = src;
    pic.onclick = (e) => { e.stopPropagation(); if (pic.src) { $("viewerImg").src = pic.src; $("viewer").hidden = false; } };
    b.append(pic);
  }
  if (m.match_id && typeof roomTag === "function") { const tg = roomTag(m); if (tg) b.append(tg); }
  if (m.reply_to) {
    const orig = findMsg(m.reply_to);
    const q = el("button", "quote"); q.type = "button";
    q.append(el("b", null, orig ? nameOf(orig.user_id) : "رد على"), el("span", null, snippet(orig)));
    q.onclick = (e) => { e.stopPropagation(); scrollToMsg(m.reply_to); };
    b.append(q);
  }
  if (m.sticker) {
    const st = el("img", "sticker"); st.src = `stickers/${m.sticker}.webp`; st.alt = STICKERS.find(s => s[0] === m.sticker)?.[1] || OLD_STICKERS[m.sticker] || "ملصق";
    b.append(st);
  }
  if (m.gif_url) {
    const g = el("img", "pic gif"); g.src = m.gif_url; g.alt = "GIF"; g.loading = "lazy";
    g.onclick = (e) => { e.stopPropagation(); $("viewerImg").src = g.src; $("viewer").hidden = false; };
    b.append(g);
  }
  if (m.audio_path || m.localAudio) b.append(voiceEl(m));
  if (m.poll) b.append(pollEl(m));
  if (m.tactic) b.append(tacticCard(m));
  if (m.scenario) b.append(scenarioCard(m));
  if (m.debate) b.append(debateCard(m));
  if (m.body && !m.tactic) b.append(bodyEl(m));
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
    const acts = el("div", "msgacts");
    const act = (label, fn, cls) => { const x = el("button", cls || "", label); x.type = "button"; x.onclick = (e) => { e.stopPropagation(); pickerFor = null; fn(x); }; acts.append(x); };
    act("↩️ رد", () => setReply(m));
    if (!mine) {
      act("🚩 تبليغ", () => reportSheet(m));
      act("🚫 حظر " + nameOf(m.user_id), () => blockSheet(m.user_id));
    }
    if (isAdmin && !mine) act("🗑️ احذفها (مشرف)", (x) => deleteMessage(m, x), "danger");
    if (m.hidden && isAdmin) acts.append(el("span", "hidden-tag", "مخفية عن الناس"));
    if (acts.childNodes.length) wrap.append(acts);
  }
  const av = avatarEl(m.user_id);
  if (!mine) { av.style.cursor = "pointer"; av.onclick = (e) => { e.stopPropagation(); profileSheet(m.user_id); }; }
  row.append(av, wrap);
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
  const has = Boolean(msgEl.value.trim());
  sendBtn.disabled = !has; sendBtn.hidden = !has; $("micBtn").hidden = has;
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
  const mentions = [...mentionMap].filter(([n, id]) => body.includes("@" + n) && id !== me.id).map(([, id]) => id).slice(0, 20);
  const reply_to = replyTo?.id || null;
  msgEl.value = ""; grow(); showErr(""); clearReply(); closeMentions();
  const tmp = { id: "tmp" + Date.now(), user_id: me.id, channel, body, mentions, reply_to, created_at: new Date().toISOString(), pending: true };
  pending.push(tmp); render(true);
  try {
    await insertMessage({ channel: tmp.channel, body, ...(mentions.length ? { mentions } : {}), ...(reply_to ? { reply_to } : {}) });
    mentionMap.clear();
  } catch (err) {
    msgEl.value = body; grow();
    showErr(err?.code === "42501" ? "حسابك موقوف عن الكتابة بسبب مخالفة الشروط." : "ما وصلت الرسالة. تأكد من الاتصال وجرّب مرة ثانية.");
  } finally {
    pending.splice(pending.indexOf(tmp), 1); render(false);
  }
});

async function deleteMessage(m, btn) {
  btn.disabled = true;
  const { error } = await sb.from("messages").delete().eq("id", m.id);
  if (error) { btn.disabled = false; showErr("ما انحذفت الرسالة. جرّب مرة ثانية."); return; }
  if (m.image_path) sb.storage.from(BUCKET).remove([m.image_path]);
  if (m.audio_path) sb.storage.from(AUDIO_BUCKET).remove([m.audio_path]);
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
  const caption = msgEl.value.trim();
  msgEl.value = ""; grow();
  sendImageBlob(file, caption);
});

// Uploads an image (photo or an analysed frame) and posts it, with an optional caption.
async function sendImageBlob(file, caption) {
  showErr("");
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
    await insertMessage({ channel: tmp.channel, body: caption || null, image_path: path, ...(replyTo ? { reply_to: replyTo.id } : {}) });
    clearReply();
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
}

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
    await insertMessage({ channel, poll: { question, options }, ...(replyTo ? { reply_to: replyTo.id } : {}) });
    clearReply();
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
    if (!TEAMS[c.id]?.length) continue;
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
    if (error?.code === "23505") return "الاسم \"" + name + "\" مستخدم من شخص ثاني. اختر اسم غيره.";
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
  const stBox = el("div", "notif"); s.append(stBox); renderStats(stBox);
  const box = el("div", "notif"); s.append(box);
  renderNotif(box);
  const safety = el("div", "notif");
  safety.append(el("h4", null, "🛡️ الخصوصية والأمان"));
  const links = el("div", "linkrow");
  if (isAdmin) { const a = el("button", "small pri", "🚩 البلاغات"); a.type = "button"; a.onclick = adminSheet; links.append(a); }
  const bl = el("button", "small", `المحظورين (${blocked.size})`); bl.type = "button"; bl.onclick = blockedSheet; links.append(bl);
  const pv = el("a", "small", "الشروط والخصوصية"); pv.href = "privacy.html"; pv.target = "_blank"; pv.rel = "noopener"; links.append(pv);
  safety.append(links);
  const delAcc = el("button", "link danger", "حذف حسابي نهائيًا"); delAcc.type = "button"; delAcc.onclick = deleteAccountSheet;
  safety.append(delAcc);
  s.append(safety, out);
});

/* ---------- Report, block, admin, delete account ---------- */
function toast(text) {
  const t = el("div", "toast", text); document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

function reportSheet(m) {
  openSheet("تبليغ عن رسالة", (s) => {
    s.append(el("p", "sheet-p", "ليش تبلّغ عن رسالة " + nameOf(m.user_id) + "؟ بتنخفي الرسالة عندك على طول، والمشرف بيراجعها."));
    const reasons = ["شتم أو إساءة", "عنصرية أو كراهية", "محتوى غير لائق", "إزعاج أو سبام", "غير ذلك"];
    const box = el("div", "radios");
    reasons.forEach((r, i) => {
      const l = el("label", "tg"); const inp = el("input"); inp.type = "radio"; inp.name = "reason"; inp.value = r; inp.id = "reason" + i; if (!i) inp.checked = true;
      l.append(el("span", null, r), inp); box.append(l);
    });
    s.append(box);
    sheetActions(s, "أرسل البلاغ", async () => {
      const reason = s.querySelector("input[name=reason]:checked").value;
      const { error } = await sb.from("reports").insert({ message_id: m.id, reported_user: m.user_id, reason });
      if (error && error.code !== "23505") return "ما وصل البلاغ. جرّب مرة ثانية.";
      hideLocally(m.id); render(false);
      toast("وصلنا بلاغك، شكرًا. الرسالة انخفت عندك.");
    });
  });
}

function blockSheet(userId) {
  openSheet("حظر " + nameOf(userId), (s) => {
    s.append(el("p", "sheet-p", "ما بتشوف رسايله ولا تصويتاته بعد كذا. ما بيوصله إنك حظرته، وتقدر تلغي الحظر من ملفك."));
    sheetActions(s, "احظره", async () => {
      const { error } = await sb.from("blocks").insert({ blocked: userId });
      if (error && error.code !== "23505") return "ما انحفظ الحظر. جرّب مرة ثانية.";
      blocked.add(userId); render(false);
      toast("تم حظر " + nameOf(userId) + ".");
    });
  });
}

function blockedSheet() {
  openSheet("المحظورين", async (s) => {
    const list = el("div", "preds"); s.append(list);
    if (!blocked.size) list.append(el("p", "sheet-p", "ما حظرت أحد."));
    await loadPeople([...blocked]);
    for (const id of blocked) {
      const r = el("div", "pr"); const un = el("button", "small", "إلغاء الحظر"); un.type = "button";
      un.onclick = async () => {
        un.disabled = true;
        const { error } = await sb.from("blocks").delete().match({ blocker: me.id, blocked: id });
        if (error) { un.disabled = false; return; }
        blocked.delete(id); r.remove(); render(false);
      };
      r.append(el("span", "who2", nameOf(id)), un); list.append(r);
    }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

function deleteAccountSheet() {
  openSheet("حذف الحساب", (s) => {
    s.append(el("p", "sheet-p", "بينحذف حسابك وكل رسايلك وصورك وتوقعاتك نهائيًا، وما نقدر نرجعها. عشان تأكد، اكتب كلمة: احذف"));
    const inp = textInput("delConfirm", 10); inp.placeholder = "احذف"; s.append(inp);
    sheetActions(s, "احذف حسابي", async () => {
      if (inp.value.trim() !== "احذف") return "اكتب كلمة: احذف";
      try {
        for (const bk of [BUCKET, AUDIO_BUCKET]) {
          const { data: files } = await sb.storage.from(bk).list(me.id, { limit: 1000 });
          if (files?.length) await sb.storage.from(bk).remove(files.map(f => `${me.id}/${f.name}`));
        }
      } catch {}
      try { const sub = await currentSub(); if (sub) await sub.unsubscribe(); } catch {}
      const { error } = await sb.rpc("delete_my_account");
      if (error) return "ما انحذف الحساب. جرّب مرة ثانية.";
      await sb.auth.signOut().catch(() => {});
      location.reload();
    });
  });
}

function adminSheet() {
  openSheet("🚩 البلاغات", async (s) => {
    const body = el("div", "preds"); s.append(body);
    body.append(el("p", "sheet-p", "يحمّل…"));
    const { data, error } = await sb.from("reports")
      .select("id,message_id,reported_user,reporter,reason,created_at,messages(body,image_path,poll,channel,hidden)")
      .eq("status", "open").order("created_at", { ascending: false }).limit(200);
    const { data: bannedRows } = await sb.from("profiles").select("id,name").eq("banned", true);
    body.textContent = "";
    if (error) { body.append(el("p", "sheet-p", "ما قدرنا نجيب البلاغات.")); return; }
    const groups = new Map();
    for (const r of data) { const g = groups.get(r.message_id) || { ...r, reasons: [], reporters: [] }; g.reasons.push(r.reason); g.reporters.push(r.reporter); groups.set(r.message_id, g); }
    await loadPeople([...data.flatMap(r => [r.reported_user, r.reporter])]);
    if (!groups.size) body.append(el("p", "sheet-p", "ما فيه بلاغات مفتوحة 👌"));
    for (const g of groups.values()) {
      const card = el("div", "match");
      const msg = g.messages || {};
      const txt = msg.poll ? "📊 " + msg.poll.question : msg.body || (msg.image_path ? "📷 صورة" : "—");
      card.append(el("div", "when", `${nameOf(g.reported_user)} · ${CHANNELS.find(c => c.id === msg.channel)?.short || ""}${msg.hidden ? " · مخفية" : ""}`));
      card.append(el("div", null, txt));
      card.append(el("div", "note", `${g.reporters.length} بلاغ: ${[...new Set(g.reasons)].join("، ")}`));
      const row = el("div", "mrow");
      const btn = (label, fn, cls) => { const b = el("button", "small " + (cls || ""), label); b.type = "button"; b.onclick = async () => { b.disabled = true; await fn(); adminSheet(); }; row.append(b); };
      btn("احذف الرسالة", async () => { await sb.from("messages").delete().eq("id", g.message_id); for (const ch in byChannel) byChannel[ch] = byChannel[ch].filter(x => x.id !== g.message_id); }, "pri");
      btn("أوقف الحساب", () => sb.rpc("set_banned", { target: g.reported_user, ban: true }));
      btn("ما فيها شي", () => sb.rpc("set_hidden", { msg: g.message_id, hide: false }));
      card.append(row); body.append(card);
    }
    if (bannedRows?.length) {
      s.append(el("h4", null, "الحسابات الموقوفة"));
      for (const p of bannedRows) {
        const r = el("div", "pr"); const un = el("button", "small", "رفع الإيقاف"); un.type = "button";
        un.onclick = async () => { un.disabled = true; await sb.rpc("set_banned", { target: p.id, ban: false }); r.remove(); };
        r.append(el("span", "who2", p.name), un); s.append(r);
      }
    }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = () => { closeSheet(); render(false); }; s.append(c);
  });
}

/* ---------- Matches & predictions ---------- */
async function loadMatches(ch) {
  const MBASE = "id,channel,created_by,home,away,kickoff,home_score,away_score,status,external_id";
  let matches, error;
  for (const cols of [MBASE + ",lineups,events,live_home,live_away,minute,stats,players,live_at", MBASE + ",lineups,events", MBASE]) {
    ({ data: matches, error } = await sb.from("matches").select(cols).eq("channel", ch).order("kickoff", { ascending: false }).limit(150));
    if (!error) break;
  }
  for (const m of matches || []) matchCache[m.id] = m;
  if (error) { matchData[ch] = { matches: [], preds: {}, error: true }; return; }
  const ids = matches.map(m => m.id);
  const { data: preds } = ids.length
    ? await sb.from("predictions").select("match_id,user_id,home,away").in("match_id", ids)
    : { data: [] };
  const byMatch = {};
  for (const p of preds || []) (byMatch[p.match_id] ||= []).push(p);
  if (ids.length) {
    const { data: mp } = await sb.from("motm_picks").select("match_id,player").eq("user_id", me.id).in("match_id", ids);
    for (const x of mp || []) motmMine[x.match_id] = x.player;
  }
  matchData[ch] = { matches, preds: byMatch };
  await loadPeople([...matches.map(m => m.created_by), ...(preds || []).map(p => p.user_id)].filter(Boolean));
}

const sign = (n) => Math.sign(n);
// Predictions are now just who wins (stored as 1-0, 0-0, 0-1): +10 when right.
function pointsFor(p, m) {
  if (m.home_score == null || m.away_score == null) return null;
  return sign(p.home - p.away) === sign(m.home_score - m.away_score) ? 10 : 0;
}
function ptsBadge(n) { return el("span", "pts p" + (n ? 3 : 0), n ? "+١٠ صح" : "٠"); }
const pickLabel = (p, m) => { const d = sign(p.home - p.away); return d > 0 ? "فوز " + m.home : d < 0 ? "فوز " + m.away : "تعادل"; };

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
  const ht = el("div"); ht.append(el("h2", null, "توقعات الجولة"), el("p", null, "توقّع مين يفوز (+١٠) ونجم المباراة (+٢٠) قبل صافرة البداية. النقاط تدخل في دوري المدرج 🏆"));
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
  else if (started && !done) when.append(el("span", "live", m.status === "PAUSED" ? "● استراحة" : m.minute != null && typeof liveMinute === "function" ? "● " + liveMinute(m).label : "● جارية"));
  else if (done) when.append(el("span", null, "انتهت"));
  card.append(when);

  const sc = el("div", "score");
  const mid = el("div", "mid");
  const myPred = preds.find(p => p.user_id === me.id);
  if (!started) {
    mid.append(el("span", "vs", "ضد"));
  } else if (done) {
    mid.append(el("span", null, m.home_score), el("span", "vs", "-"), el("span", null, m.away_score));
  } else if (m.live_home != null && m.live_away != null) {
    mid.classList.add("livesc");
    mid.append(el("span", null, m.live_home), el("span", "vs", "-"), el("span", null, m.live_away));
  } else {
    mid.append(el("span", "vs", "ضد"));
  }
  // Arabic reading order: home team on the right with its score beside it.
  sc.append(el("div", "tm h", m.home), mid, el("div", "tm a", m.away));
  card.append(sc);

  const rowEl = el("div", "mrow");
  if (!started) {
    // Who wins? three buttons
    const picks = el("div", "picks");
    const mySign = myPred ? sign(myPred.home - myPred.away) : null;
    for (const [d, label] of [[1, m.home], [0, "تعادل"], [-1, m.away]]) {
      const b = el("button", "pick" + (mySign === d ? " on" : ""), label); b.type = "button";
      b.onclick = async () => {
        const [h, a] = d > 0 ? [1, 0] : d < 0 ? [0, 1] : [0, 0];
        picks.querySelectorAll("button").forEach(x => x.disabled = true);
        const { error } = await sb.from("predictions").upsert({ match_id: m.id, user_id: me.id, home: h, away: a, updated_at: new Date().toISOString() }, { onConflict: "match_id,user_id" });
        if (error) { toast(new Date(m.kickoff) <= Date.now() ? "بدأت المباراة، ما يمديك تتوقع." : "ما انحفظ. جرّب مرة ثانية."); renderPredictions(); return; }
        const list = matchData[channel].preds[m.id] ||= [];
        const ex = list.find(p => p.user_id === me.id);
        if (ex) { ex.home = h; ex.away = a; } else list.push({ match_id: m.id, user_id: me.id, home: h, away: a });
        renderPredictions();
      };
      picks.append(b);
    }
    card.append(picks);
    rowEl.append(el("span", "note", myPred ? `توقعك: ${pickLabel(myPred, m)}` : "مين بيفوز؟ اختر 👆"));
    // Star of the match: once the lineups are out
    const mine = motmMine[m.id];
    const st = el("button", "small" + (mine ? "" : " pri"), m.lineups ? (mine ? `⭐ نجمك: ${mine}` : "⭐ اختر نجم المباراة") : "⭐ نجم المباراة: بعد التشكيلة"); st.type = "button";
    st.disabled = !m.lineups;
    st.onclick = () => motmSheet(m);
    rowEl.append(st);
  } else {
    rowEl.append(el("span", "note", preds.length ? `${preds.length} توقّعوا` : "ما أحد توقّع"));
  }
  if (m.created_by === me.id) {
    const edit = el("button", "small", done ? "عدّل النتيجة" : started ? "حط النتيجة" : "تعديل"); edit.type = "button";
    edit.onclick = () => started ? resultSheet(m) : addMatchSheet(m);
    rowEl.append(edit);
  }
  card.append(rowEl);

  if (started) {
    const star = topRated(m);
    const mine = motmMine[m.id];
    if (star || mine) {
      const line = el("div", "starline");
      if (star) line.append(el("span", null, `⭐ نجم المباراة: ${star.name} (${Number(star.rating).toFixed(1)})`));
      if (mine) line.append(el("span", mine === star?.name ? "ok" : null, mine === star?.name ? "✅ جبته! +٢٠" : `اخترت ${mine}`));
      card.append(line);
    }
  }
  if (started && preds.length) {
    const list = el("div", "preds");
    const sorted = preds.slice().sort((a, b) => (pointsFor(b, m) ?? 0) - (pointsFor(a, m) ?? 0));
    for (const p of sorted) {
      const r = el("div", "pr");
      const w = el("span", "who2", nameOf(p.user_id) + (p.user_id === me.id ? " (أنت)" : ""));
      const g = el("span", "g", pickLabel(p, m));
      const pts = pointsFor(p, m); if (pts != null) g.append(ptsBadge(pts));
      r.append(w, g); list.append(r);
    }
    card.append(list);
  }
  const tools = el("div", "mrow");
  // One button: the lineup, where you also rate the players (tap a player)
  if (m.lineups) { const b = el("button", "small", started ? "📋 التشكيلة وتقييم اللاعبين ⭐" : "📋 التشكيلة"); b.type = "button"; b.onclick = () => lineupSheet(m); tools.append(b); }
  if (m.stats) { const b = el("button", "small", "📊 الإحصائيات"); b.type = "button"; b.onclick = () => statsSheet(m); tools.append(b); }
  if (started && !m.lineups) { const b = el("button", "small", "⭐ قيّم اللاعبين"); b.type = "button"; b.onclick = () => ratingsSheet(m); tools.append(b); }
  if (inLiveWindow(m)) { const b = el("button", "small pri", "🔴 غرفة المباراة"); b.type = "button"; b.onclick = () => enterRoom(m); tools.prepend(b); }
  else if (started && Date.now() - new Date(m.kickoff) < 4 * 86400000) { const b = el("button", "small", "📊 تقرير المدرج"); b.type = "button"; b.onclick = () => matchReport(m); tools.append(b); }
  if (tools.childNodes.length) card.append(tools);
  // Tap a started match to see its details (stats, lineups, events)
  if (started) {
    card.classList.add("tappable");
    card.onclick = (e) => {
      if (e.target.closest("button, input, select, a")) return;
      if (m.stats || m.lineups) statsSheet(m);
      else toast(done ? "تفاصيل هالمباراة للحين ما وصلت. جرّب بعد شوي." : "التفاصيل تطلع أول ما تبدأ المباراة.");
    };
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

/* ---------- Reply ---------- */
let replyTo = null;
function setReply(m) {
  replyTo = m;
  $("rbName").textContent = "رد على " + (m.user_id === me.id ? "نفسك" : nameOf(m.user_id));
  $("rbText").textContent = snippet(m);
  $("replyBar").hidden = false;
  msgEl.focus();
}
function clearReply() { replyTo = null; $("replyBar").hidden = true; }
$("rbClose").onclick = clearReply;

/* ---------- @mentions ---------- */
const mentionMap = new Map(); // name -> user id, for names picked from the list
let mentionSeq = 0;
function closeMentions() { $("mentionBox").hidden = true; $("mentionBox").textContent = ""; }
async function onMentionInput() {
  const pos = msgEl.selectionStart ?? msgEl.value.length;
  const before = msgEl.value.slice(0, pos);
  const mt = before.match(/(^|\s)@([^\s@]{0,20})$/);
  if (!mt) return closeMentions();
  const q = mt[2], seq = ++mentionSeq;
  // people seen in this league first, then a name search
  const local = Object.entries(people).filter(([id, p]) => id !== me.id && p.name && p.name.startsWith(q)).map(([id, p]) => ({ id, name: p.name, team: p.team }));
  let found = local;
  if (q.length >= 1) {
    const { data } = await sb.from("profiles").select("id,name,team").ilike("name", q.replace(/[%_]/g, "") + "%").neq("id", me.id).limit(8);
    if (seq !== mentionSeq) return;
    for (const p of data || []) { people[p.id] = { name: p.name, team: p.team }; if (!found.some(f => f.id === p.id)) found.push(p); }
  }
  found = found.slice(0, 6);
  const box = $("mentionBox"); box.textContent = "";
  if (!found.length) return closeMentions();
  for (const p of found) {
    const b = el("button", "mopt"); b.type = "button";
    b.append(avatarEl(p.id), el("span", null, p.name));
    const tp = teamPill(p.id); if (tp) b.append(tp);
    b.onmousedown = (e) => e.preventDefault(); // keep the keyboard open
    b.onclick = () => {
      const start = before.length - q.length - 1;
      msgEl.value = msgEl.value.slice(0, start) + "@" + p.name + " " + msgEl.value.slice(pos);
      const caret = start + p.name.length + 2;
      msgEl.setSelectionRange(caret, caret);
      mentionMap.set(p.name, p.id);
      closeMentions(); grow(); msgEl.focus();
    };
    box.append(b);
  }
  box.hidden = false;
}
msgEl.addEventListener("input", onMentionInput);
msgEl.addEventListener("blur", () => setTimeout(closeMentions, 150));

/* ---------- Plus menu (photo, poll) ---------- */
$("plusBtn").onclick = () => openSheet("أرسل", (s) => {
  const list = el("div", "plusmenu");
  const item = (icon, label, sub, fn) => {
    const b = el("button", "plusitem"); b.type = "button";
    const t = el("div"); t.append(el("b", null, label), el("small", null, sub));
    b.append(el("i", null, icon), t);
    b.onclick = () => { closeSheet(); fn(); };
    list.append(b);
  };
  item("📷", "صورة من الاستديو", "صورة أو GIF من جوالك", () => $("attachBtn").click());
  item("📊", "تصويت", "سؤال مع خيارين لين أربعة", () => $("pollBtn").click());
  item("😎", "ملصق أو GIF", "ملصقات الكورة أو بحث GIF", () => $("stickerBtn").click());
  item("🧠", "لوحة تكتيك", "ارسم الخطة والتحركات على الملعب", () => tacticEditor());
  item("⚔️", "مناظرة", "سؤال بطرفين، وأقوى حجة تفوز", () => debateComposer());
  s.append(list);
});

/* ---------- Stickers & GIFs ---------- */
async function sendMedia(row, previewKey) {
  const tmp = { id: "tmp" + Date.now(), user_id: me.id, channel, created_at: new Date().toISOString(), pending: true, reply_to: replyTo?.id || null, ...row };
  const reply_to = replyTo?.id || null; clearReply();
  pending.push(tmp); render(true);
  try { await insertMessage({ channel, ...row, ...(reply_to ? { reply_to } : {}) }); }
  catch (err) { showErr(err?.code === "42501" ? "حسابك موقوف عن الكتابة بسبب مخالفة الشروط." : "ما انرسل. جرّب مرة ثانية."); }
  finally { pending.splice(pending.indexOf(tmp), 1); render(false); }
}
let stickerTab = "stickers";
$("stickerBtn").onclick = () => openSheet("ملصقات وGIF", (s) => {
  const tabs = el("div", "tabs stabs");
  const t1 = el("button", null, "⚽ ملصقات"), t2 = el("button", null, "GIF");
  t1.type = t2.type = "button";
  tabs.append(t1, t2); s.append(tabs);
  const body = el("div"); s.append(body);
  const show = (tab) => {
    stickerTab = tab;
    t1.setAttribute("aria-selected", String(tab === "stickers")); t2.setAttribute("aria-selected", String(tab === "gif"));
    body.textContent = "";
    if (tab === "stickers") {
      const g = el("div", "stgrid");
      for (const [id, label] of STICKERS) {
        const b = el("button"); b.type = "button"; b.setAttribute("aria-label", label);
        const im = el("img"); im.src = `stickers/${id}.webp`; im.alt = label; b.append(im);
        b.onclick = () => { closeSheet(); sendMedia({ sticker: id }); };
        g.append(b);
      }
      body.append(g);
    } else gifPanel(body);
  };
  t1.onclick = () => show("stickers"); t2.onclick = () => show("gif");
  show(stickerTab);
});

function gifPanel(body) {
  const key = (window.HALA_CONFIG || {}).giphyKey;
  if (!key) {
    body.append(el("p", "sheet-p", "بحث الـGIF للحين ما تفعّل. تقدر ترسل GIF من الاستديو من زر + ← صورة من الاستديو."));
    return;
  }
  const inp = el("input"); inp.type = "search"; inp.id = "gifQ"; inp.placeholder = "دوّر GIF… مثلًا: goal، ميسي، celebration";
  const grid = el("div", "gifgrid");
  const credit = el("div", "giphy", "Powered by GIPHY");
  body.append(inp, grid, credit);
  let seq = 0, timer = null;
  const load = async (q) => {
    const my = ++seq;
    grid.textContent = ""; grid.append(el("p", "sheet-p", "يحمّل…"));
    const url = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=ar`
      : `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=football%20goal&limit=24&rating=pg-13`;
    try {
      const r = await fetch(url); const j = await r.json();
      if (my !== seq) return;
      grid.textContent = "";
      for (const g of j.data || []) {
        const im = g.images?.fixed_width; if (!im?.url) continue;
        const b = el("button"); b.type = "button";
        const i = el("img"); i.src = im.webp || im.url; i.alt = g.title || "GIF"; i.loading = "lazy"; b.append(i);
        b.onclick = () => { closeSheet(); sendMedia({ gif_url: im.url.split("?")[0] }); };
        grid.append(b);
      }
      if (!grid.childNodes.length) grid.append(el("p", "sheet-p", "ما لقينا شي. جرّب كلمة ثانية."));
    } catch { grid.textContent = ""; grid.append(el("p", "sheet-p", "ما قدرنا نجيب الـGIF. تأكد من الاتصال.")); }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(inp.value.trim()), 350); };
  load("");
}

/* ---------- Voice messages ---------- */
const player = new Audio(); let playingId = null;
player.addEventListener("timeupdate", () => updateVoiceUI());
player.addEventListener("ended", () => { playingId = null; updateVoiceUI(); });
player.addEventListener("pause", () => updateVoiceUI());
function updateVoiceUI() {
  for (const v of document.querySelectorAll(".voice")) {
    const on = v.dataset.voice === String(playingId) && !player.paused;
    v.querySelector(".vplay").textContent = on ? "❚❚" : "▶";
    const dur = player.duration && isFinite(player.duration) ? player.duration : Number(v.dataset.secs) || 1;
    const p = v.dataset.voice === String(playingId) ? Math.min(1, player.currentTime / dur) : 0;
    v.querySelector(".vfill").style.width = (p * 100) + "%";
    v.querySelector(".vtime").textContent = v.dataset.voice === String(playingId) ? fmtSecs(player.currentTime) : fmtSecs(Number(v.dataset.secs));
  }
}
function voiceEl(m) {
  const v = el("div", "voice"); v.dataset.voice = m.id; v.dataset.secs = m.audio_secs || 0;
  const btn = el("button", "vplay", "▶"); btn.type = "button"; btn.setAttribute("aria-label", "شغّل الرسالة الصوتية");
  const bar = el("div", "vbar"); bar.append(el("div", "vfill"));
  v.append(btn, bar, el("span", "vtime", fmtSecs(m.audio_secs)));
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (playingId === m.id && !player.paused) { player.pause(); return; }
    if (playingId !== m.id) {
      let src = m.localAudio || signed["a:" + m.audio_path]?.url;
      if (!src && m.audio_path) { await signUrls([m.audio_path], AUDIO_BUCKET, "a:"); src = signed["a:" + m.audio_path]?.url; }
      if (!src) { toast("ما قدرنا نشغّل الرسالة."); return; }
      player.src = src; playingId = m.id;
    }
    try { await player.play(); } catch { toast("ما قدرنا نشغّل الرسالة."); }
    updateVoiceUI();
  };
  bar.onclick = (e) => {
    e.stopPropagation();
    if (playingId !== m.id || !isFinite(player.duration)) return;
    const r = bar.getBoundingClientRect();
    player.currentTime = player.duration * Math.min(1, Math.max(0, (r.right - e.clientX) / r.width)); // RTL: progress grows from the right
  };
  setTimeout(updateVoiceUI, 0);
  return v;
}

let rec = null, recChunks = [], recStart = 0, recTimer = null, recStream = null, recCancelled = false;
const MAX_REC = 120;
function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}
$("micBtn").onclick = async () => {
  const mime = pickMime();
  if (mime === null || !navigator.mediaDevices?.getUserMedia) { showErr("جهازك ما يدعم تسجيل الصوت من المتصفح."); return; }
  try { recStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { showErr("لازم تسمح للتطبيق يستخدم المايك عشان تسجّل."); return; }
  showErr("");
  recChunks = []; recCancelled = false;
  rec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
  rec.onstop = onRecStop;
  rec.start(250); recStart = Date.now();
  $("composer").hidden = true; $("recBar").hidden = false;
  $("recTime").textContent = "0:00";
  recTimer = setInterval(() => {
    const secs = (Date.now() - recStart) / 1000;
    $("recTime").textContent = fmtSecs(secs);
    if (secs >= MAX_REC) $("recSend").click();
  }, 250);
};
function endRecUI() {
  clearInterval(recTimer);
  recStream?.getTracks().forEach(t => t.stop()); recStream = null;
  $("composer").hidden = false; $("recBar").hidden = true;
}
$("recCancel").onclick = () => { recCancelled = true; rec?.state !== "inactive" && rec.stop(); endRecUI(); };
$("recSend").onclick = () => { recCancelled = false; rec?.state !== "inactive" && rec.stop(); endRecUI(); };
async function onRecStop() {
  const secs = Math.min(MAX_REC, (Date.now() - recStart) / 1000);
  if (recCancelled) return;
  if (secs < 0.8) { toast("التسجيل قصير مرة. اضغط المايك وتكلم."); return; }
  const type = (rec.mimeType || recChunks[0]?.type || "audio/mp4").split(";")[0];
  const blob = new Blob(recChunks, { type });
  const ext = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/aac": "aac", "audio/mpeg": "mp3" }[type] || "m4a";
  const reply_to = replyTo?.id || null; clearReply();
  const tmp = { id: "tmp" + Date.now(), user_id: me.id, channel, created_at: new Date().toISOString(), pending: true, localAudio: URL.createObjectURL(blob), audio_secs: secs, reply_to };
  pending.push(tmp); render(true);
  try {
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(AUDIO_BUCKET).upload(path, blob, { contentType: type });
    if (up.error) throw up.error;
    signed["a:" + path] = { url: tmp.localAudio, exp: Date.now() + 3000000 };
    await insertMessage({ channel: tmp.channel, audio_path: path, audio_secs: Math.round(secs * 10) / 10, ...(reply_to ? { reply_to } : {}) });
  } catch (err) {
    showErr(err?.code === "42501" ? "حسابك موقوف عن الكتابة بسبب مخالفة الشروط." : "ما انرسلت الرسالة الصوتية. جرّب مرة ثانية.");
  } finally { pending.splice(pending.indexOf(tmp), 1); render(false); }
}
