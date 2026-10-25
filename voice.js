// 🎙️ المدرج الصوتي: a live audio space inside every match room, like X Spaces.
// You hear the room as soon as you walk in; tap «تكلم» to go on the mic (no limit on speakers).
// Audio goes phone-to-phone (WebRTC): each speaker sends their mic to everyone in the room, and the room's
// realtime channel (live.js) carries the connection setup and who is speaking (presence).

const VOICE_AUDIO_POOL = 16;   // audio players unlocked on entry; more are made if needed
let voiceIce = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const voice = {
  on: false, mic: null, speaking: false, muted: false,
  pcs: new Map(),        // "out:<user>" (my mic to them) or "in:<user>" (their mic to me) -> RTCPeerConnection
  audio: new Map(),      // speaker id -> <audio>
  pool: [],              // audio elements unlocked by the tap that opened the room (iPhone needs this)
  localMuted: new Set(), // speakers I muted for myself
  level: {}, ac: null, analyser: null, timer: 0,
};
// Optional TURN relay (for strict mobile networks): app_public.turn_servers = JSON list of ICE servers
sb.from("app_public").select("value").eq("key", "turn_servers").maybeSingle().then(({ data }) => {
  try { const extra = JSON.parse(data?.value || "[]"); if (Array.isArray(extra) && extra.length) voiceIce = voiceIce.concat(extra); } catch {}
}, () => {});

const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
/* ---------- the bar in the room ---------- */
const vBar = el("div", "spc-bar"); vBar.id = "vBar";
vBar.innerHTML = `<div class="spc-top"><span class="spc-live">🎙️ المدرج الصوتي <i>لايف</i></span><span class="spc-count" id="vCount"></span></div>
<div class="spc-spk" id="vSpk"></div>
<div class="spc-btns"><button type="button" class="spc-mic" id="vMic">🎙️ تكلم</button><button type="button" class="spc-out" id="vOut" aria-label="كتم الصوت">🔊</button></div>`;
$("rCrowd").after(vBar);
$("vMic").onclick = () => (voice.speaking ? voiceStopSpeaking() : voiceStartSpeaking());
$("vOut").onclick = () => {
  voice.muted = !voice.muted;
  for (const a of voice.audio.values()) a.muted = voice.muted;
  $("vOut").textContent = voice.muted ? "🔇" : "🔊";
  toast(voice.muted ? "🔇 كتمت صوت الغرفة" : "🔊 رجع الصوت");
};

/* ---------- entering / leaving (called from live.js) ---------- */
// Runs straight from the tap that opens the room, so the phone lets us play sound later.
function voiceEnter() {
  voiceLeave();
  voice.on = true;
  while (voice.pool.length < VOICE_AUDIO_POOL) {
    const a = document.createElement("audio"); a.autoplay = true; a.playsInline = true; a.setAttribute("playsinline", "");
    voice.pool.push(a); document.body.append(a); a.hidden = true;
  }
  for (const a of voice.pool) { if (!a.srcObject) { a.src = SILENT; a.play().catch(() => {}); } }
  voice.timer = setInterval(voiceLevels, 350);
  voiceDraw();
}
function voiceLeave() {
  if (voice.speaking) voiceStopSpeaking(true);
  for (const pc of voice.pcs.values()) try { pc.close(); } catch {}
  voice.pcs.clear();
  for (const [id, a] of voice.audio) { a.srcObject = null; voice.pool.push(a); }
  voice.audio.clear();
  clearInterval(voice.timer); voice.on = false; voice.level = {};
}

/* ---------- who's here, who's speaking ---------- */
function voicePeople() {
  const st = roomCh?.presenceState() || {};
  const here = new Set(), speakers = new Set();
  for (const [key, metas] of Object.entries(st)) {
    if (!key || key === me.id || blocked.has(key)) continue;
    here.add(key);
    if ((metas || []).some((x) => x.speaking)) speakers.add(key);
  }
  return { here, speakers };
}
function voicePresence() {
  if (!voice.on) return;
  const { here, speakers } = voicePeople();
  // I'm on the mic: connect to everyone new, drop people who left
  if (voice.speaking) for (const id of here) if (!voice.pcs.has("out:" + id)) voiceCallOut(id);
  for (const key of [...voice.pcs.keys()]) {
    const [dir, id] = key.split(":");
    if (!here.has(id) || (dir === "in" && !speakers.has(id))) voiceClose(key);
  }
  voiceDraw();
}
function voiceSend(payload) { roomCh?.send({ type: "broadcast", event: "rtc", payload: { ...payload, from: me.id } }); }
function voiceClose(key) {
  const pc = voice.pcs.get(key); if (pc) try { pc.close(); } catch {}
  voice.pcs.delete(key);
  const [dir, id] = key.split(":");
  if (dir === "in" && voice.audio.has(id)) { const a = voice.audio.get(id); a.srcObject = null; voice.audio.delete(id); voice.pool.push(a); }
}
function voicePc(key, peer) {
  const pc = new RTCPeerConnection({ iceServers: voiceIce });
  pc.onicecandidate = (e) => { if (e.candidate) voiceSend({ to: peer, kind: "ice", dir: key.startsWith("out") ? "out" : "in", cand: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      voiceClose(key);
      // try once more a bit later (networks change, phones lock)
      if (key.startsWith("out") && voice.speaking) setTimeout(() => { if (voice.speaking && !voice.pcs.has(key)) voiceCallOut(peer); }, 3000);
    }
  };
  voice.pcs.set(key, pc);
  return pc;
}
async function voiceCallOut(peer) {
  if (!voice.mic) return;
  const pc = voicePc("out:" + peer, peer);
  for (const t of voice.mic.getAudioTracks()) pc.addTrack(t, voice.mic);
  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    voiceSend({ to: peer, kind: "offer", sdp: { type: "offer", sdp: pc.localDescription.sdp } });
  } catch { voiceClose("out:" + peer); }
}
// Messages from the room channel
async function voiceSignal(p) {
  if (!voice.on || !p || p.to !== me.id || !p.from || blocked.has(p.from)) return;
  try {
    if (p.kind === "offer") {
      voiceClose("in:" + p.from);
      const pc = voicePc("in:" + p.from, p.from);
      pc.ontrack = (e) => {
        let a = voice.audio.get(p.from);
        if (!a) { a = voice.pool.pop() || document.createElement("audio"); a.autoplay = true; a.playsInline = true; voice.audio.set(p.from, a); }
        a.srcObject = e.streams[0] || new MediaStream([e.track]);
        a.muted = voice.muted || voice.localMuted.has(p.from);
        a.play().catch(() => voiceNeedsTap());
        voiceDraw();
      };
      await pc.setRemoteDescription(p.sdp);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      voiceSend({ to: p.from, kind: "answer", sdp: { type: "answer", sdp: pc.localDescription.sdp } });
    } else if (p.kind === "answer") {
      const pc = voice.pcs.get("out:" + p.from);
      if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(p.sdp);
    } else if (p.kind === "ice") {
      // their "out" connection is my "in" connection, and the other way round
      const pc = voice.pcs.get((p.dir === "out" ? "in:" : "out:") + p.from);
      if (pc && p.cand) await pc.addIceCandidate(p.cand).catch(() => {});
    } else if (p.kind === "bye") {
      voiceClose("in:" + p.from); voiceDraw();
    }
  } catch {}
}
// If the phone blocked sound, one tap anywhere in the room turns it on
function voiceNeedsTap() {
  if (voiceNeedsTap.on) return; voiceNeedsTap.on = true;
  toast("🔊 اضغط على الشاشة عشان تسمع المدرج الصوتي");
  const go = () => { voiceNeedsTap.on = false; for (const a of voice.audio.values()) a.play().catch(() => {}); };
  $("room").addEventListener("pointerdown", go, { once: true });
}

/* ---------- going on / off the mic ---------- */
async function voiceStartSpeaking() {
  if (!roomMatch || voice.speaking) return;
  const { here, speakers } = voicePeople();
  $("vMic").disabled = true;
  try {
    voice.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch { $("vMic").disabled = false; toast("لازم تسمح بالمايك عشان تتكلم."); return; }
  $("vMic").disabled = false;
  voice.speaking = true;
  try {
    voice.ac = voice.ac || new (window.AudioContext || window.webkitAudioContext)();
    voice.analyser = voice.ac.createAnalyser(); voice.analyser.fftSize = 256;
    voice.ac.createMediaStreamSource(voice.mic).connect(voice.analyser);
  } catch {}
  roomPresence.speaking = true; roomCh?.track(roomPresence);
  for (const id of here) voiceCallOut(id);
  voiceDraw();
}
function voiceStopSpeaking(silent) {
  if (!voice.speaking) return;
  voice.speaking = false;
  for (const key of [...voice.pcs.keys()]) if (key.startsWith("out:")) { voiceSend({ to: key.slice(4), kind: "bye" }); voiceClose(key); }
  voice.mic?.getTracks().forEach((t) => t.stop()); voice.mic = null; voice.analyser = null;
  roomPresence.speaking = false;
  if (!silent) { roomCh?.track(roomPresence); voiceDraw(); }
}

/* ---------- who's talking right now (glowing ring) ---------- */
function voiceLevels() {
  if (!voice.on) return;
  const lv = {};
  for (const [key, pc] of voice.pcs) {
    if (!key.startsWith("in:")) continue;
    const r = pc.getReceivers()[0];
    const s = r?.getSynchronizationSources?.()[0];
    lv[key.slice(3)] = s?.audioLevel || 0;
  }
  if (voice.analyser) {
    const d = new Uint8Array(voice.analyser.frequencyBinCount); voice.analyser.getByteFrequencyData(d);
    lv[me.id] = d.reduce((t, x) => t + x, 0) / d.length / 255 * 3;
  }
  voice.level = lv;
  for (const b of document.querySelectorAll("#vSpk .spc-sp")) b.classList.toggle("talk", (lv[b.dataset.id] || 0) > 0.03);
}
function voiceDraw() {
  if (!roomMatch) return;
  const { here, speakers } = voicePeople();
  const list = [...speakers]; if (voice.speaking) list.unshift(me.id);
  const box = $("vSpk"); box.textContent = "";
  if (!list.length) box.append(el("span", "spc-empty", "المنصة فاضية… اضغط «تكلم» وابدأ السالفة 🎙️"));
  const missing = list.filter((id) => !people[id] && !voiceDraw.tried.has(id));
  if (missing.length) { missing.forEach((id) => voiceDraw.tried.add(id)); loadPeople(missing).then(voiceDraw, () => {}); }
  for (const id of list) {
    const b = el("button", "spc-sp" + (voice.localMuted.has(id) ? " lm" : "")); b.type = "button"; b.dataset.id = id;
    b.append(avatarEl(id), el("span", null, id === me.id ? "أنت" : nameOf(id)));
    if (voice.localMuted.has(id)) b.append(el("i", null, "🔇"));
    b.onclick = () => (id === me.id ? null : voiceSpeakerMenu(id));
    box.append(b);
  }
  $("vCount").textContent = `🗣️ ${arNum(list.length)} على المايك، 👥 ${arNum(here.size + 1)} في الغرفة`;
  $("vMic").textContent = voice.speaking ? "✋ نزّل المايك" : "🎙️ تكلم";
  $("vMic").classList.toggle("on", voice.speaking);
}
function voiceSpeakerMenu(id) {
  openSheet(nameOf(id), (s) => {
    const add = (label, cls, fn) => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; s.append(b); };
    const lm = voice.localMuted.has(id);
    add(lm ? "🔊 رجّع صوته" : "🔇 اكتمه عندي", "ghost cm-wide", () => {
      if (lm) voice.localMuted.delete(id); else voice.localMuted.add(id);
      const a = voice.audio.get(id); if (a) a.muted = voice.muted || voice.localMuted.has(id);
      closeSheet(); voiceDraw();
    });
    add("👤 شوف بروفايله", "ghost cm-wide", () => { closeSheet(); profileSheet(id); });
    add("🚫 احظره", "ghost cm-wide danger", () => { closeSheet(); voiceClose("in:" + id); voiceClose("out:" + id); blockSheet(id); });
    add("إلغاء", "cancel", closeSheet);
  });
}
voiceDraw.tried = new Set();
