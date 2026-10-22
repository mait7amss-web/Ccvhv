/* ---------- النقاش المنظم: ٣ ضد ٣، دقيقة لكل متكلم، ٣٠ دقيقة ويقفل ----------
   Turn t (0..29) lasts one minute from starts_at + t min.
   Speaker: side t % 2, seat floor(t / 2) % 3  →  A1, B1, A2, B2, A3, B3, A1, ...
   The server (supabase/arena.sql) enforces seats, turns and timing; this file only shows them. */

const AR_TURNS = 30, AR_TURN_MS = 60000, AR_TOTAL_MS = AR_TURNS * AR_TURN_MS;
const AR_GRACE_MS = 20000;         // matches the 20 s upload grace in arena_speak
const AR_STALE_MS = 24 * 3600000;  // waiting debates older than this are hidden
const arenaLists = {};             // channel -> arenas[] (newest first)
const arenaSeats = {};             // arena id -> seats[]
const arenaFull = {};              // arena id -> { turns[], votes[] }
let arenaOpen = null;              // arena id shown in the room, or null for the list
let arenaClock = 0;                // server time minus local time (ms)
let arenaTick = null, arenaLastTurn = null, arenaDraft = "", arenaMissing = false;
let arRec = null, arRecChunks = [], arRecT0 = 0, arRecStream = null, arRecCancel = false;

const arNow = () => Date.now() + arenaClock;
const arSpeaker = (t) => ({ side: t % 2, seat: Math.floor(t / 2) % 3 });
const arDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
function arState(a) {
  if (!a.starts_at) return { phase: "waiting" };
  const start = new Date(a.starts_at).getTime(), now = arNow();
  if (now < start) return { phase: "soon", left: start - now };
  if (now >= start + AR_TOTAL_MS) return { phase: "closed" };
  const turn = Math.floor((now - start) / AR_TURN_MS);
  return { phase: "live", turn, turnLeft: start + (turn + 1) * AR_TURN_MS - now, left: start + AR_TOTAL_MS - now };
}
const arSeatOf = (id, uid) => (arenaSeats[id] || []).find((s) => s.user_id === uid);
const arWho = (id, side, seat) => (arenaSeats[id] || []).find((s) => s.side === side && s.seat === seat)?.user_id;
const arFind = (id) => Object.values(arenaLists).flat().find((a) => a.id === id);

async function arSyncClock() {
  const t0 = Date.now();
  const { data, error } = await sb.rpc("arena_now");
  if (!error && data) arenaClock = new Date(data).getTime() - (t0 + Date.now()) / 2;
}

/* ---------- loading ---------- */
async function loadArenas(ch) {
  const { data, error } = await sb.from("arenas").select("*").eq("channel", ch).order("created_at", { ascending: false }).limit(40);
  if (error) { arenaMissing = true; arenaLists[ch] = []; return; }
  arenaMissing = false;
  const list = (data || []).filter((a) => a.starts_at || arNow() - new Date(a.created_at).getTime() < AR_STALE_MS);
  arenaLists[ch] = list;
  await loadArenaSeats(list.map((a) => a.id));
}
async function loadArenaSeats(ids) {
  if (!ids.length) return;
  const { data } = await sb.from("arena_seats").select("arena_id,side,seat,user_id").in("arena_id", ids);
  for (const id of ids) arenaSeats[id] = [];
  for (const s of data || []) (arenaSeats[s.arena_id] ||= []).push(s);
  await loadPeople((data || []).map((s) => s.user_id));
}
async function loadArenaRoom(id) {
  const [{ data: a }, { data: turns }, { data: votes }] = await Promise.all([
    sb.from("arenas").select("*").eq("id", id).maybeSingle(),
    sb.from("arena_turns").select("*").eq("arena_id", id).order("turn", { ascending: true }),
    sb.from("arena_votes").select("user_id,side").eq("arena_id", id),
  ]);
  if (!a) { arenaOpen = null; return; }
  const list = (arenaLists[a.channel] ||= []);
  const i = list.findIndex((x) => x.id === a.id);
  if (i >= 0) list[i] = a; else list.unshift(a);
  arenaFull[id] = { turns: turns || [], votes: votes || [] };
  await loadArenaSeats([id]);
  await loadPeople((turns || []).map((t) => t.user_id));
}

/* ---------- the view ---------- */
async function renderArenaView() {
  if (openArenaId) { arenaOpen = openArenaId; openArenaId = null; }
  if (!arenaClock) arSyncClock();
  if (arenaOpen) {
    await loadArenaRoom(arenaOpen);
    if (arenaOpen && arFind(arenaOpen)?.channel !== channel) arenaOpen = null;
  }
  if (!arenaOpen) await loadArenas(channel);
  drawArena();
  startArenaTick();
}
function drawArena() {
  if (view !== "arena") return;
  arenaLastTurn = null;
  if (arenaOpen && arFind(arenaOpen)) drawArenaRoom(arFind(arenaOpen)); else drawArenaList();
}

function drawArenaList() {
  const box = $("arenaView"); box.textContent = "";
  const head = el("div", "pane-head");
  const ht = el("div"); ht.append(el("h2", null, "🎙️ نقاش منظم"), el("p", null, "٣ ضد ٣ · دقيقة لكل متكلم · ٣٠ دقيقة ويقفل"));
  const add = el("button", "ghost", "+ نقاش جديد"); add.type = "button"; add.onclick = arenaCreateSheet;
  head.append(ht, add); box.append(head);
  if (arenaMissing) {
    box.append(arEmpty("🛠️", "القسم يتجهز", "قريب بيشتغل إن شاء الله."));
    return;
  }
  const list = arenaLists[channel] || [];
  if (!list.length) {
    box.append(arEmpty("🎙️", "ما فيه نقاشات للحين", "افتح نقاش، اختر موضوع وفريقين، وخل الشلة ينضمون. أول ما تكتمل الست مقاعد يبدأ."));
    return;
  }
  const groups = [["live", "🔴 شغّال الحين"], ["soon", "⏳ يبدأ بعد شوي"], ["waiting", "👥 يحتاج لاعبين"], ["closed", "🏁 انتهى"]];
  for (const [phase, title] of groups) {
    const items = list.filter((a) => arState(a).phase === phase);
    if (!items.length) continue;
    box.append(el("div", "ar-group", title));
    for (const a of items) box.append(arenaCard(a));
  }
}
function arEmpty(ico, title, text) {
  const e = el("div", "empty"); const i = el("span", "ico", ico); i.setAttribute("aria-hidden", "true");
  e.append(i, el("strong", null, title), el("div", null, text));
  return e;
}
function arenaCard(a) {
  const c = el("button", "ar-card"); c.type = "button";
  c.append(el("div", "ar-topic", a.topic));
  const vs = el("div", "ar-vs");
  vs.append(el("span", "ar-a", a.side_a), el("i", null, "×"), el("span", "ar-b", a.side_b));
  c.append(vs);
  const meta = el("div", "ar-meta", arMetaText(a));
  meta.dataset.arMeta = a.id;
  c.append(meta);
  c.onclick = async () => { arenaOpen = a.id; await renderArenaView(); $("scroller").scrollTop = 0; };
  return c;
}

function arMetaText(a) {
  const st = arState(a), seats = arenaSeats[a.id] || [];
  const mine = arSeatOf(a.id, me.id) ? " · أنت فيه" : "";
  return (st.phase === "waiting" ? `${arDigits(seats.length)}/٦ لاعبين`
    : st.phase === "soon" ? `يبدأ بعد ${fmtSecs(st.left / 1000)}`
    : st.phase === "live" ? `🔴 الدور ${arDigits(st.turn + 1)} من ٣٠ · باقي ${fmtSecs(st.left / 1000)}`
    : "انتهى") + mine;
}

function drawArenaRoom(a) {
  const box = $("arenaView"); box.textContent = "";
  const st = arState(a);
  const mySeat = arSeatOf(a.id, me.id);
  const back = el("button", "ar-back", "→ كل النقاشات"); back.type = "button";
  back.onclick = async () => { arenaOpen = null; await renderArenaView(); };
  box.append(back);

  const top = el("div", "ar-head");
  top.append(el("div", "ar-topic big", a.topic));
  const status = el("div", "ar-status"); status.id = "arStatus";
  top.append(status);
  if (st.phase === "live") { const bar = el("div", "ar-total"); const f = el("i"); f.id = "arTotalFill"; bar.append(f); top.append(bar); }
  box.append(top);

  // The two teams
  const teams = el("div", "ar-teams");
  for (const side of [0, 1]) {
    const col = el("div", "ar-team " + (side ? "b" : "a"));
    col.append(el("div", "ar-tname", side ? a.side_b : a.side_a));
    for (let seat = 0; seat < 3; seat++) {
      const uid = arWho(a.id, side, seat);
      const row = el("div", "ar-seat"); row.dataset.side = side; row.dataset.seat = seat;
      if (uid) {
        row.append(avatarEl(uid), el("span", "n", nameOf(uid) + (uid === me.id ? " (أنت)" : "")));
      } else {
        const av = el("div", "avatar ar-free", "؟"); row.append(av, el("span", "n muted", "مقعد فاضي"));
      }
      col.append(row);
    }
    const free = (arenaSeats[a.id] || []).filter((s) => s.side === side).length < 3;
    if (st.phase === "waiting" && free && mySeat?.side !== side) {
      const j = el("button", "primary ar-join", mySeat ? "انتقل لهالفريق" : "انضم"); j.type = "button";
      j.onclick = () => arenaJoin(a, side, j);
      col.append(j);
    }
    teams.append(col);
  }
  box.append(teams);

  if (st.phase === "waiting") {
    const n = (arenaSeats[a.id] || []).length;
    box.append(el("p", "sheet-p ar-note", `يبدأ النقاش تلقائي بعد دقيقتين من اكتمال الست مقاعد. باقي ${arDigits(6 - n)}. شارك الرابط مع الشلة!`));
    const acts = el("div", "ar-acts");
    const share = el("button", "ghost", "📤 ادعُ الشلة"); share.type = "button"; share.onclick = () => arenaShare(a);
    acts.append(share);
    if (mySeat) { const lv = el("button", "ghost", "انسحب"); lv.type = "button"; lv.onclick = () => arenaLeave(a); acts.append(lv); }
    if (a.created_by === me.id || isAdmin) { const del = el("button", "ghost danger", "احذف النقاش"); del.type = "button"; del.onclick = () => arenaDelete(a); acts.append(del); }
    box.append(acts);
  } else if (isAdmin) {
    const del = el("button", "link danger", "حذف النقاش (مشرف)"); del.type = "button"; del.onclick = () => arenaDelete(a); box.append(del);
  }

  // My turn: say something
  const mine = st.phase === "live" && mySeat && arSpeaker(st.turn).side === mySeat.side && arSpeaker(st.turn).seat === mySeat.seat;
  const full = arenaFull[a.id] || { turns: [], votes: [] };
  if (mine) {
    const spoke = full.turns.some((t) => t.turn === st.turn);
    box.append(spoke ? el("div", "ar-done", "✅ وصلت كلمتك. انتظر دورك الجاي.") : arenaComposer(a, st.turn));
  } else if (st.phase === "live" && mySeat) {
    const next = arNextTurn(a, mySeat, st.turn);
    if (next != null) box.append(el("div", "ar-done", `دورك الجاي بعد ${fmtSecs((new Date(a.starts_at).getTime() + next * AR_TURN_MS - arNow()) / 1000)}`));
  }

  // Votes after the end
  if (st.phase === "closed") box.append(arenaVotes(a, full.votes, !!mySeat));

  // The feed of turns
  if (a.starts_at && st.phase !== "soon") {
    const feed = el("div", "ar-feed");
    const upto = st.phase === "closed" ? AR_TURNS - 1 : st.turn;
    for (let t = upto; t >= 0; t--) {
      const sp = arSpeaker(t), uid = arWho(a.id, sp.side, sp.seat);
      const said = full.turns.find((x) => x.turn === t);
      if (!said && st.phase === "closed") continue;
      const row = el("div", "ar-turn " + (sp.side ? "b" : "a"));
      const hd = el("div", "ar-th");
      hd.append(el("b", null, nameOf(said?.user_id || uid)), el("span", null, `${sp.side ? a.side_b : a.side_a} · الدور ${arDigits(t + 1)}`));
      row.append(hd);
      if (said?.audio_path) row.append(voiceEl({ id: "ar" + said.id, audio_path: said.audio_path, audio_secs: said.audio_secs }));
      if (said?.body) row.append(el("div", "ar-body", said.body));
      if (!said) row.append(el("div", "ar-body muted", t === st.turn && st.phase === "live" ? "🎙️ يتكلم الحين…" : "⏭️ ما تكلم في دوره"));
      if (!said && t === st.turn && st.phase === "live") row.classList.add("now");
      feed.append(row);
    }
    if (!feed.childElementCount) feed.append(el("div", "ar-done", "ما أحد تكلم في هالنقاش."));
    box.append(feed);
  }
  arenaTickUI();
}
function arNextTurn(a, seat, cur) {
  for (let t = cur + 1; t < AR_TURNS; t++) { const s = arSpeaker(t); if (s.side === seat.side && s.seat === seat.seat) return t; }
  return null;
}

/* ---------- timers ---------- */
function startArenaTick() {
  clearInterval(arenaTick);
  arenaTick = setInterval(() => {
    if (view !== "arena" || $("scroller").hidden) return;
    if (!arenaOpen) { for (const m of document.querySelectorAll("[data-ar-meta]")) { const a = arFind(Number(m.dataset.arMeta)); if (a) m.textContent = arMetaText(a); } return; }
    const a = arFind(arenaOpen); if (!a) return;
    const st = arState(a);
    const key = st.phase + ":" + (st.turn ?? "");
    if (arenaLastTurn !== null && key !== arenaLastTurn) {
      // A new turn (or the start/end): redraw, and buzz the next speaker.
      if (arRec) arRecStop(true);
      const seat = arSeatOf(a.id, me.id);
      if (st.phase === "live" && seat && arSpeaker(st.turn).side === seat.side && arSpeaker(st.turn).seat === seat.seat) {
        toast("🎙️ دورك! عندك دقيقة"); navigator.vibrate?.(200);
      }
      drawArenaRoom(a);
    }
    arenaLastTurn = key;
    arenaTickUI();
  }, 500);
}
function arenaTickUI() {
  const a = arenaOpen && arFind(arenaOpen); if (!a || !$("arStatus")) return;
  const st = arState(a), n = (arenaSeats[a.id] || []).length;
  $("arStatus").textContent = st.phase === "waiting" ? `👥 ${arDigits(n)}/٦ لاعبين · ينتظر يكتمل`
    : st.phase === "soon" ? `⏳ يبدأ بعد ${fmtSecs(st.left / 1000)}`
    : st.phase === "live" ? `🔴 مباشر · الدور ${arDigits(st.turn + 1)}/٣٠ · باقي ${fmtSecs(st.left / 1000)}`
    : "🏁 انتهى النقاش";
  if (st.phase === "live") {
    $("arTotalFill") && ($("arTotalFill").style.width = (100 - st.left / AR_TOTAL_MS * 100) + "%");
    const sp = arSpeaker(st.turn);
    for (const r of document.querySelectorAll(".ar-seat")) {
      const on = Number(r.dataset.side) === sp.side && Number(r.dataset.seat) === sp.seat;
      r.classList.toggle("speaking", on);
      let clock = r.querySelector(".ar-clock");
      if (on) { if (!clock) { clock = el("span", "ar-clock"); r.append(clock); } clock.textContent = fmtSecs(st.turnLeft / 1000); }
      else clock?.remove();
    }
    const myClock = $("arMyClock"); if (myClock) myClock.textContent = fmtSecs(st.turnLeft / 1000);
    if (arRec && st.turnLeft < 1200) arRecStop(false); // out of time: send what was recorded
  }
}

/* ---------- speaking ---------- */
function arenaComposer(a, turn) {
  const box = el("div", "ar-compose");
  const hd = el("div", "ar-th");
  hd.append(el("b", null, "🎙️ دورك! تكلّم"), el("span", "ar-myclock")); hd.lastChild.id = "arMyClock";
  const ta = el("textarea"); ta.rows = 3; ta.maxLength = 600; ta.placeholder = "اكتب كلمتك… أو سجّلها بصوتك"; ta.value = arenaDraft;
  ta.oninput = () => { arenaDraft = ta.value; };
  const acts = el("div", "ar-acts");
  const send = el("button", "primary", "أرسل كلمتي"); send.type = "button";
  send.onclick = async () => {
    const txt = ta.value.trim(); if (!txt) { ta.focus(); return; }
    send.disabled = true;
    if (await arenaSpeak(a, turn, { txt })) arenaDraft = "";
    send.disabled = false;
  };
  const mic = el("button", "ghost ar-mic", "🎤 سجّل بصوتك"); mic.type = "button"; mic.id = "arMic";
  mic.onclick = () => (arRec ? arRecStop(false) : arRecStart(a, turn));
  acts.append(send, mic);
  box.append(hd, ta, acts);
  return box;
}
async function arenaSpeak(a, turn, { txt = null, path = null, secs = null }) {
  const { error } = await sb.rpc("arena_speak", { a: a.id, t: turn, txt, path, secs });
  if (error) {
    const m = error.message || "";
    toast(/not your time|not your turn/.test(m) ? "خلص وقت دورك 😅" : /banned/.test(m) ? "حسابك موقوف عن الكتابة." : /duplicate|unique/.test(m) ? "كلمتك وصلت من قبل." : "ما انرسلت. جرّب مرة ثانية.");
    drawArena();
    return false;
  }
  await loadArenaRoom(a.id); drawArena();
  return true;
}
async function arRecStart(a, turn) {
  const mime = pickMime();
  if (mime === null || !navigator.mediaDevices?.getUserMedia) { toast("جهازك ما يدعم تسجيل الصوت من المتصفح."); return; }
  try { arRecStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toast("لازم تسمح للتطبيق يستخدم المايك."); return; }
  arRecChunks = []; arRecCancel = false;
  arRec = new MediaRecorder(arRecStream, mime ? { mimeType: mime } : undefined);
  arRec.ondataavailable = (e) => { if (e.data?.size) arRecChunks.push(e.data); };
  arRec.onstop = () => arRecDone(a, turn);
  arRec.start(250); arRecT0 = Date.now();
  const mic = $("arMic"); if (mic) { mic.textContent = "⏹️ وقّف وأرسل"; mic.classList.add("rec"); }
}
function arRecStop(cancel) {
  if (!arRec) return;
  arRecCancel = cancel;
  const r = arRec; arRec = null;
  if (r.state !== "inactive") r.stop();
  arRecStream?.getTracks().forEach((t) => t.stop()); arRecStream = null;
  const mic = $("arMic"); if (mic) { mic.textContent = cancel ? "🎤 سجّل بصوتك" : "⏳ يرسل…"; mic.classList.remove("rec"); mic.disabled = !cancel; }
}
async function arRecDone(a, turn) {
  if (arRecCancel) return;
  const secs = (Date.now() - arRecT0) / 1000;
  if (secs < 0.8) { toast("التسجيل قصير مرة."); drawArena(); return; }
  const type = (arRecChunks[0]?.type || "audio/mp4").split(";")[0];
  const blob = new Blob(arRecChunks, { type });
  const ext = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/aac": "aac", "audio/mpeg": "mp3" }[type] || "m4a";
  const path = `${me.id}/arena-${crypto.randomUUID()}.${ext}`;
  const up = await sb.storage.from(AUDIO_BUCKET).upload(path, blob, { contentType: type });
  if (up.error) { toast("ما انرفع التسجيل. جرّب تكتب."); drawArena(); return; }
  signed["a:" + path] = { url: URL.createObjectURL(blob), exp: Date.now() + 3000000 };
  await arenaSpeak(a, turn, { path, secs: Math.round(secs * 10) / 10, txt: arenaDraft.trim() || null });
  arenaDraft = "";
}

/* ---------- joining, leaving, creating ---------- */
async function arenaJoin(a, side, btn) {
  btn.disabled = true;
  const { error } = await sb.rpc("arena_join", { a: a.id, my_side: side });
  if (error) toast(/full/.test(error.message) ? "الفريق اكتمل." : /started/.test(error.message) ? "النقاش بدأ." : /banned/.test(error.message) ? "حسابك موقوف." : "ما قدرنا نضيفك. جرّب مرة ثانية.");
  await loadArenaRoom(a.id); drawArena();
}
async function arenaLeave(a) {
  const { error } = await sb.rpc("arena_leave", { a: a.id });
  if (error) toast("ما تقدر تنسحب بعد ما بدأ.");
  if (!error && (arenaSeats[a.id] || []).length <= 1) { arenaOpen = null; return renderArenaView(); }
  await loadArenaRoom(a.id); drawArena();
}
function arenaDelete(a) {
  openSheet("حذف النقاش", (s) => {
    s.append(el("p", "sheet-p", "متأكد تبي تحذف هالنقاش؟"));
    sheetActions(s, "احذف", async () => {
      const { error } = await sb.rpc("arena_delete", { a: a.id });
      if (error) return "ما قدرنا نحذفه.";
      arenaOpen = null; delete arenaFull[a.id];
      arenaLists[a.channel] = (arenaLists[a.channel] || []).filter((x) => x.id !== a.id);
      drawArena();
    });
  });
}
function arenaShare(a) {
  const url = location.origin + location.pathname + `?league=${a.channel}&view=arena&arena=${a.id}`;
  const text = `🎙️ نقاش منظم في مدرج هلا: ${a.topic}\n${a.side_a} ضد ${a.side_b} · ناقصنا لاعبين، تعال!`;
  if (navigator.share) navigator.share({ title: "مدرج هلا", text, url }).catch(() => {});
  else navigator.clipboard?.writeText(text + "\n" + url).then(() => toast("انسخ الرابط ✅"), () => {});
}
function arenaCreateSheet() {
  openSheet("🎙️ نقاش منظم جديد", (s) => {
    s.append(el("p", "sheet-p", "٣ ضد ٣. كل واحد يتكلم دقيقة بالدور، والنقاش كامل ٣٠ دقيقة ويقفل. بعدها الجمهور يصوّت مين فاز."));
    const topic = textInput("arTopic", 140); topic.placeholder = "مثال: ميسي أفضل من رونالدو؟";
    const a = textInput("arA", 30, "مع"), b = textInput("arB", 30, "ضد");
    const pick = el("select"); pick.id = "arPick";
    const sync = () => { pick.textContent = ""; for (const [v, t] of [["0", a.value || "الفريق الأول"], ["1", b.value || "الفريق الثاني"]]) { const o = el("option", null, t); o.value = v; pick.append(o); } };
    a.oninput = b.oninput = () => { const v = pick.value; sync(); pick.value = v; };
    sync();
    const two = el("div", "ar-two"); two.append(field("الفريق الأول", a), field("الفريق الثاني", b));
    s.append(field("الموضوع", topic), two, field("أنت مع أي فريق؟", pick));
    sheetActions(s, "افتح النقاش", async () => {
      const t = topic.value.trim(), sa = a.value.trim(), sb2 = b.value.trim();
      if (t.length < 5) return "اكتب موضوع أوضح (٥ حروف على الأقل).";
      if (!sa || !sb2) return "اكتب اسم الفريقين.";
      const { data, error } = await sb.rpc("arena_create", { ch: channel, t, a: sa, b: sb2, my_side: Number(pick.value) });
      if (error) return /too many/.test(error.message) ? "فتحت نقاشات كثير. انتظر شوي." : /banned/.test(error.message) ? "حسابك موقوف." : "ما قدرنا نفتح النقاش.";
      arenaOpen = data; await renderArenaView();
    });
  });
}

/* ---------- the audience decides ---------- */
function arenaVotes(a, votes, debater) {
  const box = el("div", "ar-votes");
  const n = [0, 1].map((s) => votes.filter((v) => v.side === s).length), total = n[0] + n[1];
  const mine = votes.find((v) => v.user_id === me.id)?.side;
  const open = arNow() < new Date(a.starts_at).getTime() + 48 * 3600000;
  const lead = n[0] === n[1] ? null : n[0] > n[1] ? 0 : 1;
  box.append(el("div", "ar-th", total ? (lead == null ? "🤝 تعادل للحين" : `🏆 الجمهور يقول: ${lead ? a.side_b : a.side_a}`) : "مين فاز في النقاش؟"));
  for (const side of [0, 1]) {
    const b = el("button", "ar-vote " + (side ? "b" : "a")); b.type = "button";
    const pct = total ? Math.round(n[side] / total * 100) : 0;
    const fill = el("i"); fill.style.width = pct + "%";
    b.append(fill, el("span", null, (mine === side ? "✓ " : "") + (side ? a.side_b : a.side_a)), el("em", null, total ? `${arDigits(n[side])} صوت (${arDigits(pct)}٪)` : ""));
    b.disabled = debater || !open;
    b.onclick = async () => {
      const { error } = await sb.rpc("arena_vote", { a: a.id, pick: side });
      if (error) { toast("ما انحسب صوتك."); return; }
      await loadArenaRoom(a.id); drawArena();
    };
    box.append(b);
  }
  if (debater) box.append(el("p", "sheet-p", "المتناقشين ما يصوتون، الحكم للجمهور 😄"));
  else if (!open) box.append(el("p", "sheet-p", "التصويت انتهى."));
  return box;
}

/* ---------- live updates ---------- */
let arenaRealtime = null, arenaReloadT = null;
function startArenaRealtime() {
  if (arenaRealtime) return;
  const bump = (p) => {
    const row = p.new && Object.keys(p.new).length ? p.new : p.old || {};
    const id = row.arena_id ?? row.id;
    clearTimeout(arenaReloadT);
    arenaReloadT = setTimeout(async () => {
      if (view !== "arena") { delete arenaLists[channel]; return; }
      if (arenaOpen && (id == null || id === arenaOpen || p.table === "arenas")) { await loadArenaRoom(arenaOpen); drawArena(); }
      else if (!arenaOpen) { await loadArenas(channel); drawArena(); }
    }, 300);
  };
  arenaRealtime = sb.channel("hala-arena");
  for (const t of ["arenas", "arena_seats", "arena_turns", "arena_votes"]) arenaRealtime.on("postgres_changes", { event: "*", schema: "public", table: t }, bump);
  arenaRealtime.subscribe();
}
const _startChatArena = startChat;
startChat = async function () { const r = await _startChatArena(); startArenaRealtime(); return r; };
