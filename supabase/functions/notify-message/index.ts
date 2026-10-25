// Sends a push notification for each new chat message to everyone who chose
// that league in their notification settings, plus anyone mentioned or replied to
// (never to the sender, and never to people who blocked the sender).
// Called by the on_message_notify database trigger (see supabase/notifications.sql).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const LEAGUES: Record<string, string> = {
  epl: "الدوري الإنجليزي",
  laliga: "الدوري الإسباني",
  seriea: "الدوري الإيطالي",
  bundesliga: "الدوري الألماني",
  ligue1: "الدوري الفرنسي",
  ucl: "دوري أبطال أوروبا",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

let config: { secret: string; pub: string; priv: string } | null = null;
async function loadConfig() {
  if (config) return config;
  const [{ data: priv }, { data: pub }] = await Promise.all([
    sb.from("app_private").select("key,value").in("key", ["hook_secret", "vapid_private"]),
    sb.from("app_public").select("value").eq("key", "vapid_public").maybeSingle(),
  ]);
  const get = (k: string) => priv?.find((r) => r.key === k)?.value ?? "";
  config = { secret: get("hook_secret"), priv: get("vapid_private"), pub: pub?.value ?? "" };
  if (config.pub && config.priv) webpush.setVapidDetails("mailto:hala@example.com", config.pub, config.priv);
  return config;
}

// The app sends goal notifications, plus community pushes (new posts, replies, mentions, follows, quotes).
const GOALS_ONLY = true;

Deno.serve(async (req) => {
  const cfg = await loadConfig();
  if (!cfg.secret || req.headers.get("x-hala-secret") !== cfg.secret) return new Response("forbidden", { status: 403 });
  if (!cfg.pub || !cfg.priv) return new Response("push keys not set up yet", { status: 200 });

  const input = await req.json().catch(() => ({}));
  if (input.event_id) return crowdEvent(input.event_id);
  if (input.post_id) return newPost(input.post_id);
  if (input.notif_id) return communityNotif(input.notif_id);
  // Chat, debates, direct messages and other match moments do not send pushes
  if (GOALS_ONLY) return new Response("goals-only mode", { status: 200 });
  if (input.arena_id) return arenaStart(input.arena_id);
  if (input.notif_id) return communityNotif(input.notif_id);
  if (input.dm_id) return directMessage(input.dm_id);
  const id = input.id;
  if (!id) return new Response("bad request", { status: 400 });

  const BASE = "id,user_id,channel,body,image_path,poll,gif_url,sticker,audio_path,mentions,reply_to";
  let { data: msg, error } = await sb.from("messages").select(BASE + ",tactic,scenario,debate,match_id").eq("id", id).maybeSingle();
  if (error) ({ data: msg } = await sb.from("messages").select(BASE).eq("id", id).maybeSingle());
  if (!msg) return new Response("gone", { status: 200 });

  const { data: replied } = msg.reply_to
    ? await sb.from("messages").select("user_id").eq("id", msg.reply_to).maybeSingle()
    : { data: null };
  const direct = new Set<string>([...(msg.mentions || []), ...(replied?.user_id ? [replied.user_id] : [])]);
  direct.delete(msg.user_id);

  const [{ data: author }, { data: leagueSubs }, { data: directSubs }, { data: blockers }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", msg.user_id).maybeSingle(),
    // Match-room comments only notify people who were mentioned or replied to (no league-wide push per comment)
    msg.match_id ? Promise.resolve({ data: [] }) : sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").contains("leagues", [msg.channel]).neq("user_id", msg.user_id),
    direct.size ? sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").in("user_id", [...direct]) : Promise.resolve({ data: [] }),
    sb.from("blocks").select("blocker").eq("blocked", msg.user_id),
  ]);
  const blocked = new Set((blockers || []).map((b) => b.blocker));
  const subs = new Map<string, { endpoint: string; p256dh: string; auth: string; user_id: string }>();
  for (const s of [...(leagueSubs || []), ...(directSubs || [])]) if (!blocked.has(s.user_id)) subs.set(s.endpoint, s);
  if (!subs.size) return new Response("no subscribers", { status: 200 });

  const text = msg.tactic ? `🧠 لوحة تكتيك: ${msg.tactic.title || ""}`
    : msg.scenario ? `🎯 لو أنت المدرب: ${msg.scenario.text}`
    : msg.debate ? `⚔️ مناظرة: ${msg.debate.question}`
    : msg.poll ? `📊 تصويت: ${msg.poll.question}`
    : msg.body ? msg.body
    : msg.audio_path ? "🎤 رسالة صوتية"
    : msg.sticker ? "ملصق 😄"
    : msg.gif_url ? "GIF"
    : "📷 صورة";
  const name = author?.name || "شخص";
  const league = LEAGUES[msg.channel] || "";
  const payloadFor = (userId: string) => {
    const mentioned = (msg.mentions || []).includes(userId);
    const repliedTo = replied?.user_id === userId;
    const title = mentioned ? `${name} منشنك في ${league}` : repliedTo ? `${name} رد عليك في ${league}` : `${name} · ${league}`;
    return JSON.stringify({
      title,
      body: text.length > 140 ? text.slice(0, 139) + "…" : text,
      url: `./?league=${msg.channel}&view=chat${msg.match_id ? `&room=${msg.match_id}` : ""}`,
      tag: mentioned || repliedTo ? `direct-${msg.id}` : `chat-${msg.channel}`,
    });
  };

  const dead: string[] = [];
  await Promise.all([...subs.values()].map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payloadFor(s.user_id), { TTL: 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`sent ${subs.size - dead.length}`, { status: 200 });
});

// Crowd-confirmed or official goals, "the stadium exploded" moments, and live match moments
// (red card, VAR, kickoff, half time, full time).
const VAR_AR: Record<string, string> = {
  "Goal cancelled": "إلغاء هدف", "Goal Disallowed - offside": "إلغاء هدف بداعي التسلل", "Goal Disallowed - foul": "إلغاء هدف بسبب خطأ",
  "Penalty confirmed": "احتساب ضربة جزاء", "Penalty cancelled": "إلغاء ضربة جزاء", "Card upgrade": "تحويل الكرت لأحمر", "Goal confirmed": "تأكيد الهدف",
};
async function crowdEvent(eventId: number) {
  let { data: ev, error: evErr } = await sb.from("crowd_events").select("id,match_id,kind,side,emoji,minute,scorer,detail").eq("id", eventId).maybeSingle();
  if (evErr) ({ data: ev } = await sb.from("crowd_events").select("id,match_id,kind,side,emoji,minute").eq("id", eventId).maybeSingle());
  if (!ev) return new Response("gone", { status: 200 });
  if (GOALS_ONLY && ev.kind !== "official") return new Response("goals-only mode", { status: 200 });
  let { data: m, error: mErr } = await sb.from("matches").select("id,channel,home,away,live_home,live_away").eq("id", ev.match_id).maybeSingle();
  if (mErr) ({ data: m } = await sb.from("matches").select("id,channel,home,away").eq("id", ev.match_id).maybeSingle());
  if (!m) return new Response("gone", { status: 200 });
  // The official feed already told everyone about this goal
  if (ev.kind === "goal") {
    const { data: off } = await sb.from("crowd_events").select("id").eq("match_id", m.id).eq("kind", "official").gte("created_at", new Date(Date.now() - 4 * 60000).toISOString()).limit(1);
    if (off?.length) return new Response("official already sent", { status: 200 });
  }
  const since = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const users = new Set<string>();
  // People who switched on live alerts for this league
  const { data: liveSubs, error: lsErr } = await sb.from("push_subscriptions").select("user_id").eq("live", true).contains("leagues", [m.channel]);
  if (!lsErr) for (const x of liveSubs || []) users.add(x.user_id);
  // Goals and big moments also reach people who predicted the match or were in its room
  if (["goal", "official", "moment"].includes(ev.kind)) {
    const [{ data: preds }, { data: r30 }, { data: mo30 }] = await Promise.all([
      sb.from("predictions").select("user_id").eq("match_id", m.id),
      sb.from("live_reactions").select("user_id").eq("match_id", m.id).gte("created_at", since(40)),
      sb.from("momentum").select("user_id").eq("match_id", m.id).gte("updated_at", since(40)),
    ]);
    for (const x of [...(preds || []), ...(r30 || []), ...(mo30 || [])]) users.add(x.user_id);
    // ...except people active in the room right now (they saw it)
    const [{ data: r2 }, { data: rep2 }] = await Promise.all([
      sb.from("live_reactions").select("user_id").eq("match_id", m.id).gte("created_at", since(2)),
      sb.from("live_reports").select("user_id").eq("match_id", m.id).gte("created_at", since(3)),
    ]);
    for (const x of [...(r2 || []), ...(rep2 || [])]) users.delete(x.user_id);
  }
  if (!users.size) return new Response("no one to tell", { status: 200 });
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").in("user_id", [...users]);
  const team = ev.side === "home" ? m.home : m.away;
  const score = `${m.home} ${m.live_home ?? ""} - ${m.live_away ?? ""} ${m.away}`;
  const min = ev.minute ? ` · د ${ev.minute}'` : "";
  const room = `./?league=${m.channel}&view=chat&room=${m.id}`;
  const tag = `crowd-${m.id}`;
  const p = ({
    official: { title: `⚽ جوووول ${team}!`, body: `${score}${min}${ev.scorer ? ` · ${ev.scorer}` : ""}`, url: room, tag },
    goal: { title: `⚽ جوول لـ${team}! (حسب المدرج)`, body: `${m.home} × ${m.away}${min} · ادخل الغرفة وشوف ردة فعل الجمهور`, url: room, tag },
    moment: { title: `💥 المدرج انفجر! ${ev.emoji || "🔥"}`, body: `شي كبير صار في ${m.home} × ${m.away}. ادخل الغرفة`, url: room, tag },
    red: { title: `🟥 طرد! ${ev.scorer || ""} (${team})`, body: `${score}${min}`, url: room, tag: `ev-${ev.id}` },
    var: { title: `📺 الفار: ${VAR_AR[ev.detail] || ev.detail || "مراجعة"}`, body: `${team}${ev.scorer ? ` · ${ev.scorer}` : ""} · ${score}${min}`, url: room, tag: `ev-${ev.id}` },
    kickoff: { title: `🟢 بدأت: ${m.home} × ${m.away}`, body: "الغرفة مفتوحة، ادخل وتابع مع المدرج", url: room, tag },
    ht: { title: `⏸️ استراحة: ${score}`, body: "وش رايكم في الشوط الأول؟ الغرفة مفتوحة", url: room, tag },
    ft: { title: `🏁 انتهت: ${score}`, body: "شوف الإحصائيات وقيّم اللاعبين", url: `./?league=${m.channel}&view=pred`, tag },
  } as Record<string, { title: string; body: string; url: string; tag: string }>)[ev.kind];
  if (!p) return new Response("unknown kind", { status: 200 });
  const payload = JSON.stringify(p);
  const dead: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600 }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`${ev.kind} sent ${(subs || []).length - dead.length}`, { status: 200 });
}

// A structured debate filled its six seats: tell the debaters it starts in two minutes.
async function arenaStart(arenaId: number) {
  const { data: a } = await sb.from("arenas").select("id,channel,topic").eq("id", arenaId).maybeSingle();
  if (!a) return new Response("gone", { status: 200 });
  const { data: seats } = await sb.from("arena_seats").select("user_id").eq("arena_id", a.id);
  const users = (seats || []).map((s) => s.user_id);
  if (!users.length) return new Response("no one", { status: 200 });
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").in("user_id", users);
  const payload = JSON.stringify({
    title: "🎙️ النقاش المنظم يبدأ بعد دقيقتين!",
    body: `${a.topic} · اكتملت المقاعد، ادخل وجهّز كلمتك`,
    url: `./?league=${a.channel}&view=arena&arena=${a.id}`,
    tag: `arena-${a.id}`,
  });
  const dead: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 120 }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`arena sent ${(subs || []).length - dead.length}`, { status: 200 });
}

// Community: someone replied to you, mentioned you, followed you or quoted your post.
async function communityNotif(notifId: number) {
  const { data: n } = await sb.from("community_notifs").select("id,user_id,actor,kind,post_id,arena_id").eq("id", notifId).maybeSingle();
  if (!n) return new Response("gone", { status: 200 });
  const [{ data: actor }, { data: post }, { data: subs }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", n.actor).maybeSingle(),
    n.post_id ? sb.from("posts").select("id,body,root_id").eq("id", n.post_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", n.user_id),
  ]);
  if (!subs?.length) return new Response("no devices", { status: 200 });
  const name = actor?.name || "شخص";
  if (n.kind === "arena") {
    const { data: ar } = await sb.from("arenas").select("id,topic,channel").eq("id", n.arena_id).maybeSingle();
    if (!ar) return new Response("gone", { status: 200 });
    const payload = JSON.stringify({ title: `🎙️ ${name} يدعوك لنقاش منظم`, body: `${ar.topic} · ادخل واحجز مقعدك`, url: `./?league=${ar.channel}&view=arena&arena=${ar.id}`, tag: `arena-inv-${ar.id}` });
    await Promise.all(subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }).catch(() => {})));
    return new Response("arena invite sent", { status: 200 });
  }
  const title = { reply: `💬 ${name} رد عليك`, mention: `📣 ${name} منشنك`, follow: `👤 ${name} صار يتابعك`, quote: `✍️ ${name} اقتبس منشورك` }[n.kind as string] || `🌍 ${name}`;
  const text = post?.body ? (post.body.length > 140 ? post.body.slice(0, 139) + "…" : post.body) : n.kind === "follow" ? "شوف صفحته في المجتمع" : "افتح المجتمع";
  const url = n.kind === "follow" ? `./?view=community&user=${n.actor}` : `./?view=community&post=${n.post_id}`;
  const payload = JSON.stringify({ title, body: text, url, tag: `cm-${n.id}` });
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`community sent ${subs.length - dead.length}`, { status: 200 });
}

// Direct message: push to the other person, grouped per conversation (one notification per thread).
async function directMessage(dmId: number) {
  const { data: m } = await sb.from("dm_messages").select("id,thread_id,sender,body,image_path").eq("id", dmId).maybeSingle();
  if (!m) return new Response("gone", { status: 200 });
  const { data: th } = await sb.from("dm_threads").select("id,user_a,user_b").eq("id", m.thread_id).maybeSingle();
  if (!th) return new Response("gone", { status: 200 });
  const to = th.user_a === m.sender ? th.user_b : th.user_a;
  const [{ data: actor }, { data: subs }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", m.sender).maybeSingle(),
    sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", to),
  ]);
  if (!subs?.length) return new Response("no devices", { status: 200 });
  const text = m.body ? (m.body.length > 140 ? m.body.slice(0, 139) + "…" : m.body) : "📷 صورة";
  const payload = JSON.stringify({ title: `✉️ ${actor?.name || "رسالة جديدة"}`, body: text, url: `./?view=community&dm=${th.id}`, tag: `dm-${th.id}` });
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`dm sent ${subs.length - dead.length}`, { status: 200 });
}

// Someone wrote a new post in the community: tell everyone (who kept community alerts on), except the
// author and people who blocked them. One notification per post.
async function newPost(postId: number) {
  const { data: post } = await sb.from("posts").select("id,user_id,body,image_path,gif_url,audio_path,poll,quote_of,hidden,reply_to").eq("id", postId).maybeSingle();
  if (!post || post.hidden || post.reply_to) return new Response("skip", { status: 200 });
  const [{ data: actor }, { data: blockers }, subsRes] = await Promise.all([
    sb.from("profiles").select("name,banned").eq("id", post.user_id).maybeSingle(),
    sb.from("blocks").select("blocker").eq("blocked", post.user_id),
    sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").eq("community", true).neq("user_id", post.user_id),
  ]);
  if (actor?.banned) return new Response("skip", { status: 200 });
  let subs = subsRes.data;
  if (subsRes.error) subs = (await sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").neq("user_id", post.user_id)).data;
  const skip = new Set((blockers || []).map((b) => b.blocker));
  const list = (subs || []).filter((s) => !skip.has(s.user_id));
  if (!list.length) return new Response("no devices", { status: 200 });
  const text = post.body ? (post.body.length > 140 ? post.body.slice(0, 139) + "…" : post.body)
    : post.image_path ? "📷 صورة" : post.gif_url ? "🎞️ GIF" : post.audio_path ? "🎙️ مقطع صوتي" : post.poll ? "📊 تصويت" : "✍️ منشور جديد";
  const payload = JSON.stringify({ title: `📝 ${actor?.name || "عضو"} كتب في المجتمع`, body: text, url: `./?view=community&post=${post.id}`, tag: `post-${post.id}` });
  const dead: string[] = [];
  for (let i = 0; i < list.length; i += 50) {
    await Promise.all(list.slice(i, i + 50).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 }); }
      catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
    }));
  }
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`post sent ${list.length - dead.length}`, { status: 200 });
}
