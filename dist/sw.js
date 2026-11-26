"use strict";

const cachePrefix = "switchboard-shell-";
const cacheName = cachePrefix + "2";
const scope = new URL(self.registration.scope);
const shell = new URL("./index.html", scope);
const files = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];
const urls = new Set(files.map((file) => new URL(file, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...urls].map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;
  const isLaunch = url.pathname === scope.pathname || url.pathname === shell.pathname;
  const asset = request.mode === "navigate" && isLaunch ? shell.href : request.url;
  if (!urls.has(asset)) return;
  event.respondWith((async () => {
    return await caches.match(asset, { cacheName }) || fetch(request);
  })());
});
