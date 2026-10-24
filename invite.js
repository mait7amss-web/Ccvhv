// 🎁 الدعوات: every member has a personal invite link. A friend who signs up from it earns both of you
// points in دوري المدرج (supabase/invites.sql), and the top inviters show on a leaderboard.

// Remember the code from a shared link (?ref=username) until the newcomer has signed up
{
  const q = new URLSearchParams(location.search);
  const ref = q.get("ref");
  if (ref) {
    try { localStorage.setItem("hala.ref", ref.slice(0, 40)); } catch {}
    q.delete("ref");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : ""));
  }
}
const inviteLink = () => `${location.origin}${location.pathname}?ref=${encodeURIComponent(people[me.id]?.username || me.id)}`;
let inviteMine = null;   // how many friends I brought (loaded on demand)

async function inviteClaim() {
  let ref = null; try { ref = localStorage.getItem("hala.ref"); } catch {}
  if (!ref) return;
  const { data, error } = await sb.rpc("invite_claim", { code: ref });
  if (error && /does not exist|schema cache/.test(error.message || "")) return;   // not set up yet: try next time
  try { localStorage.removeItem("hala.ref"); } catch {}
  if (data?.name) setTimeout(() => toast(`🎁 انضميت بدعوة من ${data.name}! لكم الاثنين نقاط في دوري المدرج`), 1500);
}

async function inviteShare() {
  const url = inviteLink();
  const text = "تعال معي في مدرج هلا ⚽🔥 نتابع المباريات لايف مع الجمهور، نتوقع ونتنافس، ونحلل بأصواتنا 🎙️ سجّل من رابطي ونكسب الاثنين نقاط 👇";
  if (navigator.share) {
    try { await navigator.share({ title: "مدرج هلا", text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast("✅ انسخ الرابط، الصقه لأصحابك"); } catch { toast(url); }
}

function inviteSheet() {
  openSheet("🎁 ادعُ أصحابك", async (s) => {
    s.append(el("p", "sheet-p", "كل صاحب يسجّل من رابطك: أنت تاخذ ٣٠ نقطة في دوري المدرج، وهو ياخذ ١٥ نقطة. وإذا جبت ٣ أصحاب تصير 🎁 سفير المدرج."));
    const box = el("div", "inv-link");
    box.append(el("span", null, inviteLink()));
    s.append(box);
    const acts = el("div", "acts");
    const sh = el("button", "primary", "📤 أرسل الدعوة"); sh.type = "button"; sh.onclick = inviteShare;
    const wa = el("button", "ghost", "🟢 واتساب"); wa.type = "button";
    wa.onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent("تعال معي في مدرج هلا ⚽🔥 سجّل من رابطي ونكسب الاثنين نقاط 👇\n" + inviteLink()), "_blank");
    acts.append(sh, wa); s.append(acts);
    const stats = el("div", "inv-stats"); stats.append(el("div", "cm-loading", "يحمّل…")); s.append(stats);
    const c = el("button", "cancel", "سكّر"); c.type = "button"; c.onclick = closeSheet; s.append(c);
    const { data } = await sb.rpc("invite_stats");
    stats.textContent = "";
    if (!data) { stats.append(el("p", "sheet-p", "الدعوات تتجهز، جرّب بعد شوي.")); return; }
    inviteMine = data.mine || 0;
    const me1 = el("div", "inv-mine");
    me1.append(el("b", null, arNum(inviteMine)), el("span", null, inviteMine >= 3 ? "صاحب جبتهم · أنت 🎁 سفير المدرج" : `صاحب جبتهم · باقي لك ${arNum(3 - inviteMine)} وتصير سفير 🎁`));
    stats.append(me1);
    const top = (data.top || []).filter((x) => x.n > 0);
    if (top.length) {
      await loadPeople(top.map((x) => x.user_id));
      stats.append(el("h4", null, "🏆 أكثر واحد جاب أصحابه"));
      top.forEach((x, i) => {
        const r = el("button", "inv-row" + (x.user_id === me.id ? " me" : "")); r.type = "button";
        r.append(el("span", "inv-rank", i < 3 ? ["🥇", "🥈", "🥉"][i] : arNum(i + 1)), avatarEl(x.user_id), el("b", null, nameOf(x.user_id) + (x.n >= 3 ? " 🎁" : "")), el("span", "inv-n", arNum(x.n)));
        r.onclick = () => { if (x.user_id !== me.id) profileSheet(x.user_id); };
        stats.append(r);
      });
    }
  });
}

// A small card on top of the community feed (hidden for a week if closed)
function inviteStrip() {
  let hideUntil = 0; try { hideUntil = Number(localStorage.getItem("hala.invHide") || 0); } catch {}
  if (Date.now() < hideUntil || (inviteMine != null && inviteMine >= 3)) return el("div");
  const b = el("div", "inv-strip");
  const go = el("button", "inv-go"); go.type = "button";
  go.append(el("i", null, "🎁"), el("span", null, "ادعُ أصحابك وخذ ٣٠ نقطة عن كل واحد"));
  go.onclick = inviteSheet;
  const x = el("button", "inv-x", "✕"); x.type = "button"; x.setAttribute("aria-label", "إخفاء");
  x.onclick = () => { try { localStorage.setItem("hala.invHide", String(Date.now() + 7 * 86400000)); } catch {} b.remove(); };
  b.append(go, x);
  return b;
}

const _startChatInv = startChat;
startChat = async function () {
  const r = await _startChatInv();
  inviteClaim().catch(() => {});
  return r;
};
