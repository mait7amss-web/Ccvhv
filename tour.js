/* ---------- 🎓 الجولة التعريفية: spotlight on each part of the app, shown once ----------
   Bump TOUR_VERSION when there's something new everyone should see again. */

const TOUR_VERSION = "1";
const TOUR_STEPS = [
  { title: "هلا والله! 👋", text: "هذا مدرج هلا: بيت جماهير الكورة. خذ جولة سريعة (أقل من دقيقة) وتعرف كل شي." },
  { target: () => document.querySelector(".cm-chip"), mode: "community", title: "🌍 المجتمع", text: "مكان الكل: انشر رأيك وصورك وصوتك، تابع الناس، وشوف الترند. وجرّب 🔥 رأي جريء: توقّع شي قبل المباراة، ولو صدق ينختم منشورك ✅ وتاخذ نقاط." },
  { target: () => $("cViews"), mode: "community", title: "🔔 تابع اللي يهمك", text: "«الكل» لكل المنشورات، «أتابعهم» للي تتابعهم، «الترند» للهاشتاقات النارية، و🔔 إشعاراتك." },
  { target: () => document.querySelector("#chips .lg:not(.cm-chip)"), mode: "league", title: "⚽ الدوريات", text: "الدوريات الخمس الكبرى ودوري الأبطال. اختر أي دوري وتطلع لك مبارياته وتوقعاته." },
  { target: () => $("vChat"), mode: "league", title: "🏟️ غرف المباريات", text: "كل مباراة لها غرفة تفتح قبلها بساعة: علّق، تفاعل، صوّت، واضغط ⚽ جوول! مع الجمهور. الغرفة تنقفل بعد المباراة بساعتين. ومن داخلها تقدر تدعو المجتمع بضغطة 📣" },
  { target: () => $("vPred"), mode: "league", title: "🔮 التوقعات", text: "توقّع مين يفوز (+١٠)، واختر ⭐ نجم المباراة بعد ما تنزل التشكيلة (+٢٠). واضغط على أي مباراة تشوف إحصائياتها وتشكيلتها وتقيّم اللاعبين." },
  { target: () => $("vTable"), mode: "league", title: "🏆 دوري المدرج", text: "كل أسبوع جولة جديدة: تنافس مجموعتك، أول ٥ يصعدون وآخر ٥ يهبطون. اختر ⚽ تشكيلة الجولة (١١ لاعب)، وتاخذ نقاط حسب تقييمهم الرسمي. وعندك غريم أسبوعي، وحرب بين جماهير الأندية!" },
  { target: () => $("vArena"), mode: "league", title: "🎙️ نقاش منظم", text: "مناظرة ٣ ضد ٣: كل واحد يتكلم دقيقة بدوره، ٣٠ دقيقة وتقفل، وبعدها الجمهور يحكم مين فاز." },
  { target: () => $("meBtn"), title: "👤 صفحتك", text: "من هنا تفتح صفحتك: غيّر صورتك 📷، شوف محفوظاتك 🔖، واختر فريقك المفضل من ⚙️ الإعدادات عشان نقاطك تنضاف لجمهوره." },
  { title: "جاهز؟ 🔥", text: "آخر شي: فعّل الإشعارات عشان توصلك الأهداف والطرد والفار أول بأول، وتعرف إذا أحد رد عليك.", final: true },
];

let tourIdx = 0, tourWasCommunity = null;
const tourEl = el("div", "tour"); tourEl.hidden = true;
tourEl.innerHTML = `<div class="tour-ring" id="tourRing"></div><div class="tour-card" id="tourCard" role="dialog" aria-live="polite"></div>`;
document.body.append(tourEl);

function tourSeen() { try { return localStorage.getItem("hala.tour") === TOUR_VERSION; } catch { return true; } }
function tourMark() { try { localStorage.setItem("hala.tour", TOUR_VERSION); } catch {} }

async function tourMode(mode) {
  if (!mode || $("scroller").hidden) return;
  const want = mode === "community";
  if (community === want) return;
  setCommunity(want); cmStack = []; renderLeagues(); await refreshView(true);
}

async function startTour() {
  closeSheet();
  if (typeof roomMatch !== "undefined" && roomMatch) leaveRoom(true);
  tourWasCommunity = community;
  tourIdx = 0; tourEl.hidden = false;
  await showTourStep();
}
function endTour() {
  tourEl.hidden = true; tourMark();
  if (tourWasCommunity != null && community !== tourWasCommunity) { setCommunity(tourWasCommunity); cmStack = []; renderLeagues(); refreshView(true); }
}

async function showTourStep() {
  const st = TOUR_STEPS[tourIdx];
  await tourMode(st.mode);
  const ring = $("tourRing"), card = $("tourCard");
  card.textContent = "";
  const dots = el("div", "tour-dots");
  TOUR_STEPS.forEach((_, i) => dots.append(el("i", i === tourIdx ? "on" : null)));
  card.append(dots, el("h3", null, st.title), el("p", null, st.text));
  const acts = el("div", "tour-acts");
  if (st.final) {
    const notif = el("button", "primary", "🔔 فعّل الإشعارات"); notif.type = "button";
    notif.onclick = async () => { endTour(); await turnOnNotifications(); };
    const go = el("button", "cancel", "يلا نبدأ ⚽"); go.type = "button"; go.onclick = endTour;
    acts.append(notif, go);
  } else {
    const next = el("button", "primary", tourIdx ? "التالي ←" : "يلا نبدأ الجولة ←"); next.type = "button";
    next.onclick = () => { tourIdx++; showTourStep(); };
    const skip = el("button", "tour-skip", "تخطّي"); skip.type = "button"; skip.onclick = endTour;
    if (tourIdx) { const back = el("button", "tour-skip", "→ رجوع"); back.type = "button"; back.onclick = () => { tourIdx--; showTourStep(); }; acts.append(next, back, skip); }
    else acts.append(next, skip);
  }
  card.append(acts);

  // Spotlight the target, and put the card on the other half of the screen
  const t = st.target?.();
  const r = t && t.getBoundingClientRect();
  if (r && r.width) {
    const pad = 6;
    Object.assign(ring.style, { display: "block", top: r.top - pad + "px", left: r.left - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
    tourEl.classList.remove("center");
    const below = r.top + r.height / 2 < innerHeight / 2;
    card.style.top = below ? Math.min(r.bottom + 18, innerHeight - card.offsetHeight - 16) + "px" : "";
    card.style.bottom = below ? "" : Math.max(16, innerHeight - r.top + 18) + "px";
  } else {
    ring.style.display = "none";
    tourEl.classList.add("center");
    card.style.top = ""; card.style.bottom = "";
  }
}
addEventListener("resize", () => { if (!tourEl.hidden) showTourStep(); });

/* ---------- 🔔 "Turn on notifications" prompt for anyone who hasn't yet ---------- */
async function pushIsOn() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const sub = await currentSub().catch(() => null);
  return !!sub;
}
async function turnOnNotifications() {
  if (isIOS && !isStandalone()) { openSettings(); toast("على الآيفون: أضف التطبيق للشاشة الرئيسية أول، والخطوات تحت 🔔"); return; }
  const msg = await enablePush();
  toast(msg || "✅ تفعّلت الإشعارات: الأهداف والأحداث وكل شي");
}
function notifPromptDue() {
  try { return Date.now() - Number(localStorage.getItem("hala.notifAsk") || 0) > 2 * 86400000; } catch { return false; }
}
async function notifPrompt() {
  if (!notifPromptDue() || await pushIsOn()) return;
  if (pushSupported() && Notification.permission === "denied") return;
  try { localStorage.setItem("hala.notifAsk", String(Date.now())); } catch {}
  openSheet("🔔 لا يفوتك ولا هدف!", (s) => {
    const ios = isIOS && !isStandalone();
    s.append(el("p", "sheet-p", "فعّل الإشعارات ويوصلك أول بأول: ⚽ الأهداف، 🟥 الطرد، 📺 الفار، بداية ونهاية المباريات، ولما أحد يرد عليك أو يمنشنك."));
    if (ios) {
      s.append(el("p", "sheet-p", "على الآيفون لازم أول تضيف التطبيق للشاشة الرئيسية:"));
      const ol = el("ol", "steps");
      for (const t of ["اضغط زر المشاركة ⬆️ تحت في Safari", "اختر Add to Home Screen (إضافة إلى الشاشة الرئيسية)", "افتح مدرج هلا من الأيقونة الجديدة وفعّل الإشعارات"]) ol.append(el("li", null, t));
      s.append(ol);
    }
    const acts = el("div", "acts");
    if (!ios) {
      const on = el("button", "primary", "🔔 فعّلها الحين"); on.type = "button";
      on.onclick = async () => { on.disabled = true; const msg = await enablePush(); closeSheet(); toast(msg || "✅ تفعّلت الإشعارات: الأهداف والأحداث وكل شي"); };
      acts.append(on);
    }
    const later = el("button", "cancel", ios ? "تمام" : "بعدين"); later.type = "button"; later.onclick = closeSheet;
    acts.append(later); s.append(acts);
  });
}

// New users (and everyone once per TOUR_VERSION) get the tour after the app loads;
// otherwise people without notifications get the prompt.
const _startChatTour = startChat;
startChat = async function () {
  const r = await _startChatTour();
  setTimeout(() => {
    if (!me || $("scroller").hidden || openRoomId) return;
    if (!tourSeen()) startTour(); else notifPrompt();
  }, 1500);
  return r;
};
