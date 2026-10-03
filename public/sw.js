// Strength Matrix service worker.
//
// The reason this exists: the app is installed to a home screen with display
// "standalone", which means no address bar and no reload button. Without a
// service worker, opening it in a gym with no signal produced a blank window
// with nothing to act on — and every in-session recovery path in the app
// assumes the app can boot, which required the network every single time.
//
// The strategy is deliberately small. There is no build-time manifest, so
// nothing here needs regenerating when an asset hash changes:
//
//   navigations and index.html  network first, cache as fallback
//     so the in-app "new build available" check still sees the real server and
//     the athlete still chooses when to take an update, while an offline launch
//     gets the last shell that worked.
//
//   same-origin static assets   cache first, refreshed in the background
//     the hashed /assets/* files never change under a given name, so serving
//     them from cache is both correct and instant.
//
//   everything else             untouched
//     Supabase is a different origin and never goes near this cache. Training
//     data syncs the way it always did; this only makes the shell openable.

const CACHE = "strength-matrix-shell-v1";
const SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAsset(url) {
  return url.pathname.startsWith("/assets/")
    || /\.(?:js|css|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || caches.match("/")))
    );
    return;
  }

  if (!isAsset(url)) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
