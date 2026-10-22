// مدرج هلا: يستقبل الإشعارات ويفتح التطبيق على الدوري الصحيح لما تضغطها.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
