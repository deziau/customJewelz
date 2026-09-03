'use strict';

/**
 * Keeps the app shell installable and openable offline. Anything under /api is
 * always fetched live — stock counts and orders must never come from a cache.
 */

const VERSION = 'cj-v1';
const SHELL = [
  '/', '/index.html', '/admin', '/admin.html',
  '/css/styles.css', '/css/admin.css',
  '/js/designer.js', '/js/admin.js',
  '/manifest.webmanifest',
  '/img/icon-192.png', '/img/icon-512.png', '/img/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;   // always live

  // Uploaded artwork: serve from cache once seen, refresh in the background.
  const runtime = url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/img/');

  event.respondWith(
    caches.match(request).then((hit) => {
      const live = fetch(request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return runtime ? (hit || live) : (live.then((r) => r || hit).catch(() => hit));
    })
  );
});
