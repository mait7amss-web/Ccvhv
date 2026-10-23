// مدرج هلا: الرسايل الخاصة (الدايركت). Inbox + one-to-one conversations, live, with read receipts.
// Tables and rules live in supabase/dm.sql.

const dmThreads = new Map();      // thread id -> thread row
const dmMsgs = {};                // thread id -> messages[] (ascending)
let dmOpen = null;                // open thread id, or 0 for the inbox, or null when closed
let dmMissing = false;
let dmPolicy = "all";

/* ---------- the ✉️ button next to my avatar ---------- */
const dmBtn = el("button", "dm-btn", "✉️"); dmBtn.type = "button";
dmBtn.setAttribute("aria-label", "الرسايل");
const dmBadge = el("span", "cm-badge"); dmBadge.hidden = true; dmBtn.append(dmBadge);
dmBtn.onclick = () => dmShowInbox();
$("meBtn").before(dmBtn);

/* ---------- the full-screen pane ---------- */
const dmPane = el("div", "room dm"); dmPane.id = "dmPane"; dmPane.hidden = true;
const dmHead = el("div", "rhead dm-head");
const dmBack = el("button", "ghost", "→"); dmBack.type = "button"; dmBack.setAttribute("aria-label", "رجوع");
const dmTitle = el("div", "dm-title");
const dmMenuBtn = el("button", "ghost", "⋯"); dmMenuBtn.type = "button"; dmMenuBtn.setAttribute("aria-label", "خيارات");
dmHead.append(dmBack, dmTitle, dmMenuBtn);
const dmBody = el("div", "rbody dm-body");
const dmCompose = el("form", "rcompose dm-compose");
const dmInput = el("input"); dmInput.type = "text"; dmInput.maxLength = 1000; dmInput.placeholder = "اكتب رسالة…"; dmInput.enterKeyHint = "send";
const dmPic = el("input"); dmPic.type = "file"; dmPic.accept = "image/*"; dmPic.hidden = true;
const dmPicBtn = el("button", "ghost dm-pic", "📷"); dmPicBtn.type = "button"; dmPicBtn.setAttribute("aria-label", "صورة");
const dmSend = el("button", "primary dm-send", "إرسال"); dmSend.type = "submit";
dmCompose.append(dmPicBtn, dmInput, dmSend, dmPic);
dmPane.append(dmHead, dmBody, dmCompose);
document.body.append(dmPane);

dmBack.onclick = () => { if (dmOpen) dmShowInbox(); else dmClose(); };
dmPicBtn.onclick = () => dmPic.click();

const dmOther = (t) => (t.user_a === me.id ? t.user_b : t.user_a);
const dmMyRead = (t) => (t.user_a === me.id ? t.a_read_at : t.b_read_at);
const dmTheirRead = (t) => (t.user_a === me.id ? t.b_read_at : t.a_read_at);
const dmUnread = (t) => t.last_sender && t.last_sender !== me.id && new Date(t.last_at) > new Date(dmMyRead(t));
function dmTime(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit" }).format(d);
  return cmAgo(iso);
}
function dmSetBadge() {
  let n = 0;
  for (const t of dmThreads.values()) if (!blocked.has(dmOther(t)) && dmUnread(t)) n++;
  dmBadge.textContent = n > 9 ? "+٩" : n ? arNum(n) : "";
  dmBadge.hidden = !n;
}
function dmErr(error) {
  const m = String(error?.message || "");
  if (/blocked/.test(m)) return "ما تقدر تراسل هالشخص.";
  if (/closed/.test(m)) return "هالشخص مسكّر الرسايل الخاصة.";
  if (/banned/.test(m)) return "حسابك موقوف.";
  if (/slow down/.test(m)) return "شوي شوي 😅 انتظر دقيقة.";
  if (/does not exist|schema cache|relation/.test(m)) { dmMissing = true; return "الرسايل الخاصة تتجهز، قريب بتشتغل."; }
  return "ما انرسلت. تأكد من الاتصال وجرّب مرة ثانية.";
}

/* ---------- loading ---------- */
async function dmLoadThreads() {
  const { data, error } = await sb.from("dm_threads").select("*").order("last_at", { ascending: false }).limit(200);
  if (error) { if (/does not exist|schema cache|relation/.test(error.message || "")) dmMissing = true; return; }
  for (const t of data || []) dmThreads.set(t.id, t);
  await loadPeople((data || []).map(dmOther));
  dmSetBadge();
}
async function dmLoadMessages(id) {
  const { data } = await sb.from("dm_messages").select("id,thread_id,sender,body,image_path,created_at")
    .eq("thread_id", id).order("created_at", { ascending: false }).limit(80);
  dmMsgs[id] = (data || []).reverse();
  await signUrls(dmMsgs[id].filter((m) => m.image_path).map((m) => m.image_path));
}

/* ---------- inbox ---------- */
function dmPaneOpen() {
  dmPane.hidden = false;
  document.body.classList.add("dm-on");
}
function dmClose() {
  dmOpen = null; dmPane.hidden = true;
  document.body.classList.remove("dm-on");
}
async function dmShowInbox() {
  dmOpen = 0; dmPaneOpen();
  dmTitle.textContent = "✉️ الرسايل"; dmCompose.hidden = true;
  dmMenuBtn.textContent = "⚙️"; dmMenuBtn.setAttribute("aria-label", "مين يقدر يراسلني");
  dmMenuBtn.onclick = dmSettingsSheet;
  if (!dmThreads.size) { dmBody.textContent = ""; dmBody.append(el("div", "cm-loading", "يحمّل…")); await dmLoadThreads(); }
  if (dmOpen !== 0) return;
  dmDrawInbox();
}
function dmDrawInbox() {
  dmBody.textContent = "";
  if (dmMissing) { dmBody.append(cmEmpty("🛠️", "الرسايل الخاصة تتجهز", "قريب بتشتغل إن شاء الله.")); return; }
  const newBtn = el("button", "primary cm-wide", "✍️ رسالة جديدة"); newBtn.type = "button";
  newBtn.onclick = dmNewSheet;
  dmBody.append(newBtn);
  const list = [...dmThreads.values()].filter((t) => !blocked.has(dmOther(t)) && t.last_sender)
    .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  if (!list.length) { dmBody.append(cmEmpty("✉️", "ما عندك رسايل للحين", "افتح بروفايل أي شخص واضغط «✉️ راسله»، أو اضغط «رسالة جديدة» فوق.")); return; }
  for (const t of list) {
    const uid = dmOther(t);
    const row = el("button", "dm-item" + (dmUnread(t) ? " unread" : "")); row.type = "button";
    const info = el("div", "dm-info");
    const top = el("div", "dm-top");
    const nm = el("b", null, nameOf(uid));
    top.append(nm);
    const lvb = levelBadge(uid); if (lvb) { lvb.onclick = null; lvb.style.pointerEvents = "none"; top.append(lvb); }
    top.append(el("span", "dm-when", dmTime(t.last_at)));
    const prev = (t.last_sender === me.id ? "أنت: " : "") + (t.last_body || "");
    info.append(top, el("div", "dm-prev", prev));
    row.append(avatarEl(uid), info);
    if (dmUnread(t)) row.append(el("span", "dm-dot"));
    row.onclick = () => dmShowThread(t.id);
    dmBody.append(row);
  }
}

/* ---------- one conversation ---------- */
async function dmShowThread(id) {
  dmOpen = id; dmPaneOpen();
  let t = dmThreads.get(id);
  if (!t) {
    const { data } = await sb.from("dm_threads").select("*").eq("id", id).maybeSingle();
    if (!data) { toast("ما لقينا المحادثة."); dmShowInbox(); return; }
    dmThreads.set(id, data); t = data;
  }
  const uid = dmOther(t);
  await loadPeople([uid]);
  dmTitle.textContent = "";
  const who = el("button", "dm-who"); who.type = "button";
  const av = avatarEl(uid);
  const nm = el("div"); nm.append(el("b", null, nameOf(uid)));
  if (people[uid]?.username) nm.append(el("span", "cm-handle", "@" + people[uid].username));
  who.append(av, nm);
  who.onclick = () => profileSheet(uid);
  dmTitle.append(who);
  dmMenuBtn.textContent = "⋯"; dmMenuBtn.setAttribute("aria-label", "خيارات");
  dmMenuBtn.onclick = () => dmThreadMenu(t);
  dmCompose.hidden = blocked.has(uid);
  dmBody.textContent = ""; dmBody.append(el("div", "cm-loading", "يحمّل…"));
  await dmLoadMessages(id);
  if (dmOpen !== id) return;
  dmDrawThread();
  dmMarkRead(t);
  if (!blocked.has(uid) && matchMedia("(pointer: fine)").matches) dmInput.focus();
}
function dmDrawThread() {
  const t = dmThreads.get(dmOpen); if (!t) return;
  const uid = dmOther(t);
  const list = dmMsgs[dmOpen] || [];
  dmBody.textContent = "";
  if (blocked.has(uid)) dmBody.append(el("div", "dm-note", "🚫 حظرت هالشخص. ألغِ الحظر من الإعدادات عشان تراسله."));
  if (!list.length) {
    const hi = el("div", "dm-hello");
    const av = avatarEl(uid); av.classList.add("big");
    hi.append(av, el("b", null, nameOf(uid)), el("span", null, "ابدأ السالفة 👋 الرسايل بينكم بس."));
    dmBody.append(hi);
  }
  let lastDay = "";
  const myLast = [...list].reverse().find((m) => m.sender === me.id);
  for (const m of list) {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      dmBody.append(el("div", "dm-day", new Intl.DateTimeFormat("ar", { weekday: "long", day: "numeric", month: "long" }).format(new Date(m.created_at))));
    }
    const mine = m.sender === me.id;
    const row = el("div", "dm-row " + (mine ? "mine" : "theirs") + (m.pending ? " pending" : ""));
    const b = el("div", "bubble");
    if (m.image_path || m.localUrl) {
      const img = el("img", "dm-img"); img.alt = "صورة"; img.loading = "lazy";
      img.src = m.localUrl || signed[m.image_path]?.url || "";
      img.onclick = (e) => { e.stopPropagation(); $("viewerImg").src = img.src; $("viewer").hidden = false; };
      b.append(img);
    }
    if (m.body) b.append(el("div", null, m.body));
    const meta = el("span", "dm-meta", m.pending ? "يرسل…" : new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit" }).format(new Date(m.created_at)));
    b.append(meta);
    row.append(b);
    if (mine && m === myLast && !m.pending) {
      const seen = new Date(dmTheirRead(t)) >= new Date(m.created_at);
      row.append(el("span", "dm-seen", seen ? "✓✓ شافها" : "✓ وصلت"));
    }
    if (!m.pending) row.onclick = () => dmMsgMenu(m);
    dmBody.append(row);
  }
  dmBody.scrollTop = dmBody.scrollHeight;
}
async function dmMarkRead(t) {
  if (!dmUnread(t)) return;
  const now = new Date().toISOString();
  if (t.user_a === me.id) t.a_read_at = now; else t.b_read_at = now;
  dmSetBadge();
  await sb.rpc("dm_read", { t: t.id });
}

/* ---------- sending ---------- */
dmCompose.onsubmit = async (e) => {
  e.preventDefault();
  const body = dmInput.value.trim();
  if (!body || !dmOpen) return;
  dmInput.value = "";
  await dmSendMsg({ body });
};
dmPic.onchange = async () => {
  const f = dmPic.files[0]; dmPic.value = "";
  if (!f || !f.type.startsWith("image/") || !dmOpen) return;
  const id = dmOpen;
  const tmp = { id: "tmp" + Date.now(), thread_id: id, sender: me.id, body: null, created_at: new Date().toISOString(), localUrl: URL.createObjectURL(f), pending: true };
  (dmMsgs[id] ||= []).push(tmp); dmDrawThread();
  try {
    const blob = await shrink(f);
    const ext = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] || "jpg";
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (up.error) throw up.error;
    signed[path] = { url: tmp.localUrl, exp: Date.now() + 3000000 };
    dmMsgs[id] = dmMsgs[id].filter((m) => m !== tmp);
    await dmSendMsg({ image_path: path }, id);
  } catch (err) {
    dmMsgs[id] = (dmMsgs[id] || []).filter((m) => m !== tmp);
    if (dmOpen === id) dmDrawThread();
    toast("ما انرفعت الصورة. جرّب مرة ثانية.");
  }
};
async function dmSendMsg(fields, id = dmOpen) {
  const tmp = { id: "tmp" + Date.now(), thread_id: id, sender: me.id, created_at: new Date().toISOString(), pending: true, ...fields };
  if (fields.image_path) tmp.localUrl = signed[fields.image_path]?.url;
  (dmMsgs[id] ||= []).push(tmp);
  if (dmOpen === id) dmDrawThread();
  const { data, error } = await sb.from("dm_messages").insert({ thread_id: id, sender: me.id, ...fields }).select("id,thread_id,sender,body,image_path,created_at").single();
  const list = dmMsgs[id];
  const i = list.indexOf(tmp);
  if (error) {
    if (i >= 0) list.splice(i, 1);
    if (fields.body && dmOpen === id && !dmInput.value) dmInput.value = fields.body;
    toast(dmErr(error));
  } else if (i >= 0) {
    if (list.some((m) => m.id === data.id)) list.splice(i, 1); else list[i] = data;
    const t = dmThreads.get(id);
    if (t) { t.last_at = data.created_at; t.last_sender = me.id; t.last_body = data.body || "📷 صورة"; }
  }
  if (dmOpen === id) dmDrawThread();
}

/* ---------- start a conversation ---------- */
async function dmStart(uid) {
  if (!uid || uid === me.id) return;
  if (blocked.has(uid)) { toast("ألغِ الحظر أول عشان تراسله."); return; }
  const { data, error } = await sb.rpc("dm_open", { target: uid });
  if (error) { toast(dmErr(error)); return; }
  closeSheet();
  if (typeof roomMatch !== "undefined" && roomMatch) leaveRoom();
  if (!dmThreads.has(data)) {
    const { data: t } = await sb.from("dm_threads").select("*").eq("id", data).maybeSingle();
    if (t) dmThreads.set(t.id, t);
  }
  dmShowThread(data);
}
function dmNewSheet() {
  openSheet("✍️ رسالة جديدة", (s) => {
    s.append(el("p", "sheet-p", "ابحث بالاسم أو اليوزر."));
    const q = el("input"); q.type = "search"; q.placeholder = "مثال: @ahmad"; q.maxLength = 30;
    const res = el("div", "dm-pick");
    s.append(q, res);
    let seq = 0;
    const show = (rows) => {
      res.textContent = "";
      for (const p of rows) {
        if (p.id === me.id || blocked.has(p.id)) continue;
        people[p.id] = { ...(people[p.id] || {}), ...p };
        const r = el("button", "dm-item"); r.type = "button";
        const info = el("div", "dm-info");
        info.append(el("b", null, nameOf(p.id)));
        if (p.username) info.append(el("span", "cm-handle", "@" + p.username));
        r.append(avatarEl(p.id), info);
        r.onclick = () => dmStart(p.id);
        res.append(r);
      }
      if (!res.children.length) res.append(el("p", "sheet-p", "ما لقينا أحد."));
    };
    const search = async () => {
      const my = ++seq;
      const v = q.value.trim().replace(/^@/, "").replace(/[%_,()]/g, "");
      let rows;
      if (!v) {
        // People I follow first
        const ids = [...cmFollowing].slice(0, 30);
        if (!ids.length) { res.textContent = ""; res.append(el("p", "sheet-p", "تابع ناس من المجتمع وبيطلعون هنا.")); return; }
        ({ data: rows } = await sb.from("profiles").select("id,name,team,avatar_path,username").in("id", ids));
      } else {
        ({ data: rows } = await sb.from("profiles").select("id,name,team,avatar_path,username").or(`username.ilike.${v.toLowerCase()}%,name.ilike.%${v}%`).limit(20));
      }
      if (my === seq) show(rows || []);
    };
    let tmr; q.oninput = () => { clearTimeout(tmr); tmr = setTimeout(search, 250); };
    search();
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

/* ---------- menus ---------- */
function dmMsgMenu(m) {
  const mine = m.sender === me.id;
  openSheet("الرسالة", (s) => {
    const add = (label, cls, fn) => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; s.append(b); };
    if (m.body) add("📋 انسخ", "ghost cm-wide", async () => { try { await navigator.clipboard.writeText(m.body); toast("انتسخت"); } catch {} closeSheet(); });
    if (mine) add("🗑️ احذفها عند الطرفين", "ghost cm-wide danger", async () => {
      closeSheet();
      const { error } = await sb.from("dm_messages").delete().eq("id", m.id);
      if (error) { toast("ما انحذفت."); return; }
      if (m.image_path) sb.storage.from(BUCKET).remove([m.image_path]).catch(() => {});
      dmMsgs[m.thread_id] = (dmMsgs[m.thread_id] || []).filter((x) => x.id !== m.id);
      if (dmOpen === m.thread_id) dmDrawThread();
    });
    add("إلغاء", "cancel", closeSheet);
  });
}
function dmThreadMenu(t) {
  const uid = dmOther(t);
  openSheet(nameOf(uid), (s) => {
    const add = (label, cls, fn) => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; s.append(b); };
    add("👤 شوف بروفايله", "ghost cm-wide", () => { closeSheet(); profileSheet(uid); });
    add("🚩 بلّغ عن المحادثة", "ghost cm-wide", () => { closeSheet(); dmReportSheet(t); });
    if (!blocked.has(uid)) add("🚫 احظره", "ghost cm-wide danger", () => { closeSheet(); blockSheet(uid); });
    add("إلغاء", "cancel", closeSheet);
  });
}
function dmReportSheet(t) {
  const uid = dmOther(t);
  openSheet("🚩 بلاغ عن " + nameOf(uid), (s) => {
    s.append(el("p", "sheet-p", "وش المشكلة؟ المشرفين بيشوفون البلاغ."));
    for (const r of ["إزعاج أو سبام", "سب أو تحرش", "محتوى غير لائق", "احتيال", "شي ثاني"]) {
      const b = el("button", "ghost cm-wide", r); b.type = "button";
      b.onclick = async () => {
        const { error } = await sb.from("dm_reports").insert({ thread_id: t.id, reported: uid, reason: r });
        closeSheet();
        toast(error ? "ما انرسل البلاغ." : "✅ وصل البلاغ. تقدر تحظره بعد.");
      };
      s.append(b);
    }
    const c = el("button", "cancel", "إلغاء"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}
function dmSettingsSheet() {
  openSheet("⚙️ مين يقدر يراسلني؟", (s) => {
    s.append(el("p", "sheet-p", "المحادثات اللي بدأت قبل تبقى مفتوحة. الحظر يوقف أي أحد."));
    for (const [v, label] of [["all", "🌍 الكل"], ["following", "👥 بس اللي أتابعهم"], ["none", "🔒 ولا أحد"]]) {
      const b = el("button", v === dmPolicy ? "primary cm-wide" : "ghost cm-wide", (v === dmPolicy ? "✓ " : "") + label); b.type = "button";
      b.onclick = async () => {
        const { error } = await sb.from("profiles").update({ dm_policy: v }).eq("id", me.id);
        if (error) { toast("ما انحفظ."); return; }
        dmPolicy = v; closeSheet(); toast("✅ انحفظ");
      };
      s.append(b);
    }
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; s.append(c);
  });
}

/* ---------- live ---------- */
let dmRealtime = null;
function dmStartRealtime() {
  if (dmRealtime) return;
  dmRealtime = sb.channel("hala-dm")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, async ({ new: m }) => {
      if (!m) return;
      let t = dmThreads.get(m.thread_id);
      if (!t) {
        const { data } = await sb.from("dm_threads").select("*").eq("id", m.thread_id).maybeSingle();
        if (!data) return;
        dmThreads.set(data.id, data); t = data;
        await loadPeople([dmOther(t)]);
      }
      t.last_at = m.created_at; t.last_sender = m.sender; t.last_body = m.body ? m.body.slice(0, 120) : "📷 صورة";
      if (m.sender === me.id) { dmSetBadge(); return; }
      if (blocked.has(m.sender)) return;
      if (dmMsgs[m.thread_id] && !dmMsgs[m.thread_id].some((x) => x.id === m.id)) {
        if (m.image_path) await signUrls([m.image_path]);
        dmMsgs[m.thread_id].push(m);
      }
      if (dmOpen === m.thread_id && !document.hidden) { dmDrawThread(); dmMarkRead(t); }
      else {
        dmSetBadge();
        if (dmOpen === 0) dmDrawInbox();
        else toast(`✉️ ${nameOf(m.sender)}: ${m.body ? m.body.slice(0, 40) : "📷 صورة"}`);
      }
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "dm_messages" }, ({ old: m }) => {
      for (const id in dmMsgs) {
        const n = dmMsgs[id].length;
        dmMsgs[id] = dmMsgs[id].filter((x) => x.id !== m?.id);
        if (dmMsgs[id].length !== n && dmOpen === Number(id)) dmDrawThread();
      }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_threads" }, ({ new: t }) => {
      if (!t) return;
      const old = dmThreads.get(t.id);
      dmThreads.set(t.id, { ...(old || {}), ...t });
      dmSetBadge();
      if (dmOpen === t.id && old && dmTheirRead(old) !== dmTheirRead(t)) dmDrawThread();
    })
    .subscribe();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && dmOpen) { const t = dmThreads.get(dmOpen); if (t) { dmDrawThread(); dmMarkRead(t); } }
});

const _startChatDm = startChat;
startChat = async function () {
  const r = await _startChatDm();
  dmStartRealtime();
  dmLoadThreads().then(() => { if (dmOpen === 0) dmDrawInbox(); });
  sb.from("profiles").select("dm_policy").eq("id", me.id).maybeSingle().then(({ data }) => { if (data?.dm_policy) dmPolicy = data.dm_policy; });
  if (openDmId) { const id = openDmId; openDmId = null; dmShowThread(id); }
  return r;
};
