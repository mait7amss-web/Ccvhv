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

  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return new Response("bad request", { status: 400 });

  const { data: msg } = await sb.from("messages")
    .select("id,user_id,channel,body,image_path,poll,gif_url,sticker,audio_path,mentions,reply_to")
    .eq("id", id).maybeSingle();
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

  const text = msg.poll ? `📊 تصويت: ${msg.poll.question}`
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
