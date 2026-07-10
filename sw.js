// Service worker do LLG Financeiro — app-shell offline.
// REGRA DE OURO: dado financeiro (Supabase, /api/chat) NUNCA e cacheado — sempre rede.
// So o "casco" estatico (HTML/CSS/JS/icones) fica em cache para abrir offline.
const CACHE = 'llg-fin-v3';
const SHELL = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/config.js', '/js/estado.js', '/js/dados.js', '/js/calculo.js',
  '/js/ui-contas.js', '/js/ui-retirada.js', '/js/ui-relatorio.js',
  '/js/ui-painel.js', '/js/ui-graficos.js', '/js/chat-ia.js',
  '/js/auth.js', '/js/ofx-import.js', '/js/ui-razao.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return; // POST/PATCH/DELETE nunca passam pelo cache
  const url = new URL(request.url);

  // Dados dinamicos: sempre rede, nunca cache (saldos, receitas, chat IA...).
  if (url.hostname.endsWith('supabase.co') || url.pathname.startsWith('/api/')) return;

  // Navegacao (abrir o app): rede primeiro, cai pro index cacheado se offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Demais assets: cache primeiro; se nao tem, busca na rede e cacheia (so mesmo-origem).
  e.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
