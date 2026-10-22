// Sends a push notification for each new chat message to everyone who chose
// that league in their notification settings (except the sender).
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

  const { data: msg } = await sb.from("messages").select("id,user_id,channel,body,image_path,poll").eq("id", id).maybeSingle();
  if (!msg) return new Response("gone", { status: 200 });

  const [{ data: author }, { data: subs }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", msg.user_id).maybeSingle(),
    sb.from("push_subscriptions").select("endpoint,p256dh,auth,user_id").contains("leagues", [msg.channel]).neq("user_id", msg.user_id),
  ]);
  if (!subs?.length) return new Response("no subscribers", { status: 200 });

  const text = msg.poll ? `📊 تصويت: ${msg.poll.question}` : msg.body ? msg.body : "📷 صورة";
  const payload = JSON.stringify({
    title: `${author?.name || "شخص"} · ${LEAGUES[msg.channel] || ""}`,
    body: text.length > 140 ? text.slice(0, 139) + "…" : text,
    url: `./?league=${msg.channel}&view=chat`,
    tag: `chat-${msg.channel}`,
  });

  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }));
  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return new Response(`sent ${subs.length - dead.length}`, { status: 200 });
});
