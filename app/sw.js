// BYX Rush Portal: keeps the app opening with weak or no signal.
// The app's own files load from the network first (so updates show right away)
// and fall back to the saved copy offline. Firebase's code is saved after first use.
var CACHE = "byx-rush-v3b";
var SHELL = ["./", "./index.html", "./firebase-config.js", "./manifest.json", "./icons/icon-192.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var sdk = url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0;
  var fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (sdk || fonts) {
    // Versioned files that never change: saved copy first.
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res;
      });
    }));
    return;
  }
  if (!sameOrigin) return; // Firebase data and sign-in go straight to the network.
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match("./index.html"); });
  }));
});
