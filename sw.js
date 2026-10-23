// مدرج هلا: يستقبل الإشعارات ويفتح التطبيق على الدوري الصحيح لما تضغطها.
// Keeps the app's files on the phone so it opens instantly, and refreshes them in the background.
const SHELL = "hala-shell-1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

const STATIC = /\.(?:js|css|png|jpg|jpeg|webp|svg|gif|woff2?|webmanifest)$/i;
async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    // Versioned files (?v=NN): drop older versions of the same file
    const u = new URL(req.url);
    if (u.searchParams.has("v")) {
      for (const k of await cache.keys()) { const ku = new URL(k.url); if (ku.origin === u.origin && ku.pathname === u.pathname && ku.search !== u.search) cache.delete(k); }
    }
    cache.put(req, res.clone());
  }
  return res;
}
async function networkFirst(req, ms) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req.url, { cache: "no-cache", credentials: "same-origin" }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), ms))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.endsWith("version.json") || u.pathname.endsWith("sw.js") || u.pathname.endsWith(".mp4")) return;   // always live
    if (req.mode === "navigate") return e.respondWith(networkFirst(req, 3500));
    if (STATIC.test(u.pathname)) return e.respondWith(u.searchParams.has("v") || u.pathname.includes("/stickers/") || /icon|apple-touch/.test(u.pathname) ? cacheFirst(req) : staleWhileRevalidate(req));
    return;
  }
  // The pinned Supabase library and the fonts never change
  if (u.hostname === "cdn.jsdelivr.net" || u.hostname === "fonts.gstatic.com") return e.respondWith(cacheFirst(req));
  if (u.hostname === "fonts.googleapis.com") return e.respondWith(staleWhileRevalidate(req));
  // Everything else (Supabase data, avatars, videos) goes straight to the network
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "مدرج هلا", {
    body: d.body || "",
    tag: d.tag,
    renotify: Boolean(d.tag),
    icon: "icon-192.png",
    badge: "icon-192.png",
    dir: "rtl",
    lang: "ar",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { try { await w.navigate(url); } catch {} return w.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
