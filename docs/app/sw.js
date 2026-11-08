// Keeps Ervo working offline once it's added to the home screen.
// Bump VERSION with every release so phones pick up the new files.
const VERSION = "ervo-0.4.2";
const FILES = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "suggestions.js",
  "config.js",
  "version.json",
  "img/looks.json",
  "manifest.webmanifest",
  "img/ervo-symbol.svg",
  "img/ervo-symbol-white.svg",
  "img/ervo-wordmark.svg",
  "img/ervo-wordmark-white.svg",
  "img/ervo-classic.png",
  "img/ervo-business.png",
  "img/ervo-king.png",
  "img/ervo-detective.png",
  "img/ervo-explorer.png",
  "img/ervo-scientist.png",
  "img/ervo-wizard.png",
  "img/ervo-ninja.png",
  "img/ervo-samurai.png",
  "img/ervo-pirate.png",
  "img/ervo-pilot.png",
  "img/ervo-athlete.png",
  "img/ervo-soccer.png",
  "img/ervo-musician.png",
  "img/ervo-chef.png",
  "img/ervo-creative.png",
  "img/ervo-gamer.png",
  "img/ervo-space.png",
  "img/ervo-scholar.png",
  "img/ervo-tech.png",
  "img/ervo-builder.png",
  "img/ervo-winter.png",
  "img/ervo-holiday.png",
  "img/apple-touch-icon.png",
  "img/icon-192.png",
  "img/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up right away; fall back to the saved copy offline
self.addEventListener("fetch", (event) => {
  // Only Ervo's own files; weather, news and the AI server always go to the network
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("index.html")))
  );
});
