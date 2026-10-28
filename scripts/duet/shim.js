// Runs in the Duet page before the app. The page is a published artifact with
// no dev server, so this answers the app's /api requests from the snapshot
// files published beside it. build-page.mjs fills in SNAP from the
// snapshot's manifest. The key and FRED-chunk rules repeat scripts/duet/shared.mjs.
(function () {
  var SNAP = __SNAP__;
  var M = SNAP.routes, GEO = SNAP.geo, N = SNAP.fredChunks;
  var IGNORE = {}; SNAP.ignored.forEach(function (k) { IGNORE[k] = 1; });
  var orig = window.fetch.bind(window);
  var base = document.baseURI;
  var cache = {};
  function rel(p) { return new URL(p, base).href; }
  function load(p) { return cache[p] || (cache[p] = orig(rel(p)).then(function (r) { if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); })); }
  function json(body, status) { return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
  function chunk(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) >>> 0; return x % N; }
  function key(u) {
    var ps = [];
    u.searchParams.forEach(function (v, k) { if (!IGNORE[k]) ps.push(k + '=' + v); });
    ps.sort();
    return u.pathname.replace(/\/+$/, '') + (ps.length ? '?' + ps.join('&') : '');
  }
  function fred(u) {
    var id = (u.searchParams.get('series_id') || '').trim();
    var limit = Math.max(1, parseInt(u.searchParams.get('limit') || '100', 10) || 100);
    return load('data/fred/' + chunk(id) + '.json').then(function (t) {
      var obs = JSON.parse(t)[id];
      if (!obs) return json({ error: 'FRED series ' + id + ' is not in this snapshot' }, 404);
      // the relay's shape: FRED's native envelope, newest first
      return json({ observations: obs.slice(-limit).reverse().map(function (o) { return { date: o[0], value: String(o[1]) }; }) });
    });
  }
  function route(u) {
    var hit = M[key(u)];
    if (!hit) return Promise.resolve(json({ error: 'Not in the Duet snapshot (' + u.pathname + ')' }, 503));
    return load(hit.f).then(function (t) { return json(hit.k ? JSON.parse(t)[hit.k] : t); });
  }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var u;
    try { u = new URL(url, location.href); } catch (e) { return orig(input, init); }
    if (GEO[u.href]) return load(GEO[u.href]).then(function (t) { return json(t); });
    if (u.origin === location.origin && u.pathname.indexOf('/api/') === 0) {
      if (method !== 'GET') return Promise.resolve(json({ error: 'This needs the dashboard\'s own server, which the Duet version does not have.' }, 503));
      var p = u.pathname === '/api/fred' ? fred(u) : route(u);
      return p.catch(function (e) { return json({ error: e.message }, 500); });
    }
    // the page cannot reach other hosts; answer at once instead of timing out
    if (u.origin !== location.origin) return Promise.resolve(json({ error: 'Live data from ' + u.hostname + ' is not reachable from the Duet version.' }, 503));
    return orig(input, init);
  };
  // the dashboard links to /ideas and the Ideas page links back to /
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '/ideas' || href.indexOf('/ideas?') === 0) { e.preventDefault(); location.href = rel('ideas.html'); }
    else if (SNAP.page === 'ideas' && (href === '/' || href.indexOf('/?') === 0)) { e.preventDefault(); history.back(); }
  }, true);
  // a small note that this is a saved copy; a tap hides it
  function note() {
    var d = document.createElement('button');
    d.type = 'button';
    d.className = 'duet-snap';
    d.textContent = SNAP.label;
    d.title = 'A saved copy, not live. Tap to hide.';
    d.onclick = function () { d.remove(); };
    var s = document.createElement('style');
    s.textContent = '.duet-snap{position:fixed;z-index:99999;left:calc(10px + env(safe-area-inset-left,0px));bottom:calc(10px + env(safe-area-inset-bottom,0px));font:500 11px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:rgba(20,22,28,.82);color:#e9ecf2;cursor:pointer;max-width:calc(100vw - 20px)}.duet-snap:focus-visible{outline:2px solid #7aa7ff}';
    document.head.appendChild(s);
    document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', note); else note();
})();
