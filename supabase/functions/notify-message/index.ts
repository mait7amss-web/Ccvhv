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

Deno.serve(async (req) => {
  const cfg = await loadConfig();
  if (!cfg.secret || req.headers.get("x-hala-secret") !== cfg.secret) return new Response("forbidden", { status: 403 });
  if (!cfg.pub || !cfg.priv) return new Response("push keys not set up yet", { status: 200 });

  const input = await req.json().catch(() => ({}));
  if (input.event_id) return crowdEvent(input.event_id);
  if (input.arena_id) return arenaStart(input.arena_id);
  const id = input.id;
  if (!id) return new Response("bad request", { status: 400 });

  const BASE = "id,user_id,channel,body,image_path,poll,gif_url,sticker,audio_path,mentions,reply_to";
  let { data: msg, error } = await sb.from("messages").select(BASE + ",tactic,scenario,debate").eq("id", id).maybeSingle();
  if (error) ({ data: msg } = await sb.from("messages").select(BASE).eq("id", id).maybeSingle());
  if (!msg) return new Response("gone", { status: 200 });

  const { data: replied } = msg.reply_to
    ? await sb.from("messages").select("user_id").eq("id", msg.reply_to).maybeSingle()
    : { data: null };
  const direct = new Set<string>([...(msg.mentions || []), ...(replied?.user_id ? [replied.user_id] : [])]);
  direct.delete(msg.user_id);

  const [{ data: author }, { data: leagueSubs }, { data: directSubs }, { data: blockers }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", msg.user_id).maybeSingle(),
    sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").contains("leagues", [msg.channel]).neq("user_id", msg.user_id),
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
      url: `./?league=${msg.channel}&view=chat`,
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

// Crowd-confirmed goal or "the stadium exploded" moment: tell people who predicted the match
// or were in its room recently, but not those active in the room in the last 2 minutes (they saw it).
async function crowdEvent(eventId: number) {
  const { data: ev } = await sb.from("crowd_events").select("id,match_id,kind,side,emoji,minute").eq("id", eventId).maybeSingle();
  if (!ev) return new Response("gone", { status: 200 });
  const { data: m } = await sb.from("matches").select("id,channel,home,away").eq("id", ev.match_id).maybeSingle();
  if (!m) return new Response("gone", { status: 200 });
  const since = (min: number) => new Date(Date.now() - min * 60000).toISOString();
  const [{ data: preds }, { data: r30 }, { data: mo30 }, { data: r2 }, { data: rep2 }] = await Promise.all([
    sb.from("predictions").select("user_id").eq("match_id", m.id),
    sb.from("live_reactions").select("user_id").eq("match_id", m.id).gte("created_at", since(40)),
    sb.from("momentum").select("user_id").eq("match_id", m.id).gte("updated_at", since(40)),
    sb.from("live_reactions").select("user_id").eq("match_id", m.id).gte("created_at", since(2)),
    sb.from("live_reports").select("user_id").eq("match_id", m.id).gte("created_at", since(3)),
  ]);
  const watching = new Set([...(r2 || []), ...(rep2 || [])].map((x) => x.user_id));
  const users = new Set([...(preds || []), ...(r30 || []), ...(mo30 || [])].map((x) => x.user_id).filter((u) => !watching.has(u)));
  if (!users.size) return new Response("no one to tell", { status: 200 });
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").in("user_id", [...users]);
  const team = ev.side === "home" ? m.home : m.away;
  const payload = JSON.stringify(ev.kind === "goal"
    ? { title: `⚽ جوول لـ${team}! (حسب المدرج)`, body: `${m.home} × ${m.away}${ev.minute ? ` · د ${ev.minute}'` : ""} · ادخل الغرفة وشوف ردة فعل الجمهور`, url: `./?league=${m.channel}&view=pred`, tag: `crowd-${m.id}` }
    : { title: `💥 المدرج انفجر! ${ev.emoji || "🔥"}`, body: `شي كبير صار في ${m.home} × ${m.away}. ادخل الغرفة`, url: `./?league=${m.channel}&view=pred`, tag: `crowd-${m.id}` });
  const dead: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600 }); }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`crowd sent ${(subs || []).length - dead.length}`, { status: 200 });
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
