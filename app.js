/* DriveAI — app logic: login · maps · live trip · analytics */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function setTxt(sel, v) { var e = $(sel); if (e && e.textContent !== String(v)) e.textContent = v; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ask(title, msg, okTxt, fn) {
    var o = document.createElement('div'); o.className = 'modal';
    o.innerHTML = '<div class="mbox"><b>' + esc(title) + '</b><p>' + esc(msg) + '</p><div class="mbtns"><button type="button" class="mno">Cancel</button><button type="button" class="myes">' + esc(okTxt) + '</button></div></div>';
    (document.getElementById('app') || document.body).appendChild(o);
    o.querySelector('.mno').onclick = function () { o.remove(); };
    o.querySelector('.myes').onclick = function () { o.remove(); fn(); };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  var MEM = {};
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); if (v == null) v = MEM[k]; return v == null ? d : JSON.parse(v); } catch (e) { return MEM[k] == null ? d : JSON.parse(MEM[k]); } },
    set: function (k, v) { var s = JSON.stringify(v); MEM[k] = s; try { localStorage.setItem(k, s); } catch (e) {} },
    del: function (k) { delete MEM[k]; try { localStorage.removeItem(k); } catch (e) {} }
  };
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function pickW(rr, list) { var tot = 0, i; for (i = 0; i < list.length; i++) tot += list[i][1]; var x = rr() * tot; for (i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; } return list[0][0]; }
  function hav(a, b) { var R = 6371000, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r, x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) * Math.sin(dg / 2); return 2 * R * Math.asin(Math.sqrt(x)); }
  function brg(a, b) { var r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r), x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function fmtDist(m) { return m < 1000 ? (Math.max(0, Math.round(m / 10) * 10)) + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function fmtDur(s) { var m = Math.round(s / 60); if (m < 60) return Math.max(1, m) + ' min'; return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' m'; }
  function fmtClock(ms) { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.className = 'show'; clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, ms || 2600); }

  var SEG = 400, DEMO = { email: 'demo@driveai.app', pass: 'demo123', name: 'Demo Driver' };
  var S = { user: null, prof: null, from: null, to: null, routes: [], sel: 0, loading: false, err: '', pick: null, trips: [], planMap: null, pm: {}, rl: null };
  var T = null, tripMap = null, tl = null, lastSpeak = { t: 0, m: '' };

  /* =============================== AUTH =============================== */
  function hashPw(p) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode('driveai:' + p)).then(function (b) { return [].map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
    }
    return Promise.resolve('x' + btoa(unescape(encodeURIComponent(p))));
  }
  function users() { return store.get('dai_users', {}); }
  function seedDemo() { var u = users(); if (u[DEMO.email]) return Promise.resolve(); return hashPw(DEMO.pass).then(function (h) { u[DEMO.email] = { name: DEMO.name, hash: h }; store.set('dai_users', u); }); }
  var authMode = 'in';
  function setAuthMode(m) {
    authMode = m; $$('#authTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
    $('#auName').hidden = m !== 'up'; $('#authBtn').textContent = m === 'up' ? 'Create account' : 'Sign in'; $('#authErr').textContent = '';
  }
  function doAuth(e) {
    e.preventDefault();
    var em = $('#auEmail').value.trim().toLowerCase(), pw = $('#auPass').value, nm = $('#auName').value.trim(), err = $('#authErr'), u = users();
    err.textContent = '';
    if (!/^\S+@\S+\.\S+$/.test(em)) { err.textContent = 'Enter a valid email address'; return; }
    if (pw.length < 4) { err.textContent = 'Password must be at least 4 characters'; return; }
    if (authMode === 'up') {
      if (!nm) nm = em.split('@')[0];
      if (u[em]) { err.textContent = 'Account already exists — sign in instead'; return; }
      hashPw(pw).then(function (h) { u[em] = { name: nm, hash: h }; store.set('dai_users', u); loginAs(em, nm); });
    } else {
      hashPw(pw).then(function (h) { if (!u[em]) { var n2 = em.split('@')[0]; u[em] = { name: n2, hash: h }; store.set('dai_users', u); loginAs(em, n2); return; } if (u[em].hash !== h) { err.textContent = 'Incorrect password for this email'; return; } loginAs(em, u[em].name); });
    }
  }
  function loginAs(email, name, guest) { S.user = { email: email, name: name, guest: !!guest }; store.set('dai_session', S.user); loadProfile(); enterApp(); }
  function uid() { return S.user.guest ? 'guest' : S.user.email; }
  function loadProfile() {
    var p = store.get('dai_prof_' + uid(), null) || {};
    S.prof = Object.assign({ vehicle: { type: 'car', name: 'My car', plate: '' }, mult: 8, voice: true, gps: false, map: 'voyager' }, p); if (S.prof.mapv !== 3) { S.prof.map = 'voyager'; S.prof.mapv = 3; }
    S.trips = store.get('dai_trips_' + uid(), []);
  }
  function saveProf() { store.set('dai_prof_' + uid(), S.prof); }
  function logout() { store.del('dai_session'); S.user = null; resetPlan(); $('#auPass').value = ''; show('sLogin'); }

  /* =============================== NAV =============================== */
  var sumBack = 'plan';
  function isWide() { return !!(window.matchMedia && window.matchMedia('(min-width:900px)').matches); }
  function wideNow() { return document.body.classList.contains('tripwide'); }
  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    document.body.classList.toggle('tripwide', id === 'sTrip' && isWide());
    var tab = ['sPlan', 'sHistory', 'sProfile'].indexOf(id) >= 0; $('#tabbar').style.display = tab ? 'flex' : 'none';
    $$('#tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === id); });
    if (id === 'sPlan' && S.planMap) setTimeout(function () { S.planMap.invalidateSize(); }, 60);
    if (id === 'sHistory') renderHistory();
    if (id === 'sProfile') renderProfile();
  }
  function enterApp() { $('#hiName').textContent = (S.user.name || 'driver').split(' ')[0]; show('sPlan'); ensurePlanMap(); renderSheet(); }

  /* =============================== MAPS =============================== */
  var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  var TILES = {
    voyager: { url: ESRI, att: 'Tiles © Esri — Esri, HERE, Garmin, OpenStreetMap contributors' },
    light: { url: ESRI, att: 'Tiles © Esri' },
    dark: { url: ESRI, att: 'Tiles © Esri', cls: 'darktiles' }
  };
  function setTiles(m) { if (m._tl) m.removeLayer(m._tl); var t = TILES[S.prof.map] || TILES.voyager; m._tl = L.tileLayer(t.url, { maxZoom: 19, attribution: t.att, className: t.cls || '' }).addTo(m); }
  function makeMap(el) { var m = L.map(el, { zoomControl: false }).setView([20.59, 78.96], 5); setTiles(m); return m; }
  function congColor(c) { return c < 0.35 ? '#3ed99a' : c < 0.6 ? '#f6b846' : '#fb5a72'; }
  function congLabel(c) { return c < 0.35 ? 'CLEAR' : c < 0.6 ? 'BUSY' : 'HEAVY'; }

  function fetchJSON(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null, to = ctl ? setTimeout(function () { ctl.abort(); }, ms || 9000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function normRoute(r) {
    var steps = []; (r.legs || []).forEach(function (l) { (l.steps || []).forEach(function (st) { steps.push({ name: st.name || '', type: st.maneuver && st.maneuver.type, mod: st.maneuver && st.maneuver.modifier, dist: st.distance || 0, loc: st.maneuver && st.maneuver.location }); }); });
    return { dist: r.distance, dur: r.duration, coords: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), steps: steps };
  }
  function fetchRoutes(a, b, alts) {
    var tail = '/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson&steps=true&alternatives=' + (alts ? 'true' : 'false');
    var hosts = ['https://router.project-osrm.org/route/v1/driving', 'https://routing.openstreetmap.de/routed-car/route/v1/driving'];
    function go(i) {
      return fetchJSON(hosts[i] + tail, 12000).then(function (j) { if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code || 'no route'); return j.routes.map(normRoute); })
        .catch(function (e) { if (i + 1 < hosts.length) return go(i + 1); throw e; });
    }
    return go(0);
  }
  function fallbackRoutes(a, b) {
    var out = [];
    for (var i = 0; i < 3; i++) {
      var pts = [], N = 70, off = (i - 1) * 0.1, dl = b.lat - a.lat, dg = b.lng - a.lng;
      for (var k = 0; k <= N; k++) { var t = k / N, bend = Math.sin(Math.PI * t) * off; pts.push([a.lat + dl * t - dg * bend, a.lng + dg * t + dl * bend]); }
      var d = 0; for (var j = 1; j < pts.length; j++) d += hav(pts[j - 1], pts[j]);
      out.push({ dist: d, dur: d / (8.5 + i * 0.7), coords: pts, steps: [{ name: 'demo route', type: 'depart', mod: '', dist: d * 0.98 }, { name: '', type: 'arrive', mod: '', dist: d * 0.02 }] });
    }
    return out;
  }
  function annotate(r, i) {
    r.cum = [0]; for (var k = 1; k < r.coords.length; k++) r.cum[k] = r.cum[k - 1] + hav(r.coords[k - 1], r.coords[k]);
    r.dist = r.cum[r.cum.length - 1] || r.dist || 1;
    var rr = rng(Math.round(r.dist) + i * 977 + 7);
    r.cong = clamp(0.12 + rr() * 0.5 + (i === 0 ? 0.1 : 0), 0.08, 0.85);
    r.ai = r.dur * (1 + r.cong * 0.9);
    var n = Math.ceil(r.dist / SEG) + 3, c = r.cong; r.segCong = [];
    for (k = 0; k < n; k++) { c = clamp(c + (rr() - 0.5) * 0.35, 0.05, 0.95); r.segCong.push(0.5 * c + 0.5 * r.cong); }
    var best = '', bd = 0; r.steps.forEach(function (s) { if (s.name && s.dist > bd) { bd = s.dist; best = s.name; } });
    r.via = best || 'main road';
    return r;
  }
  function routeSegments(r) {
    var segs = [], cur = [r.coords[0]], k = 0, next = SEG;
    for (var i = 1; i < r.coords.length; i++) { cur.push(r.coords[i]); if (r.cum[i] >= next) { segs.push({ pts: cur, c: r.segCong[k] || 0 }); cur = [r.coords[i]]; k++; next += SEG; } }
    if (cur.length > 1) segs.push({ pts: cur, c: r.segCong[k] || 0 });
    return segs;
  }
  function posAt(r, s) {
    var c = r.cum, n = c.length, co = r.coords;
    if (s <= 0 || n < 2) return { lat: co[0][0], lng: co[0][1], h: n > 1 ? brg(co[0], co[1]) : 0, i: 0 };
    if (s >= c[n - 1]) return { lat: co[n - 1][0], lng: co[n - 1][1], h: brg(co[n - 2], co[n - 1]), i: n - 2 };
    var lo = 0, hi = n - 1; while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
    var f = clamp((s - c[lo]) / ((c[hi] - c[lo]) || 1), 0, 1), a = co[lo], b = co[hi];
    return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, h: brg(a, b), i: lo };
  }
  function gmapsUrl(a, b) { return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat + ',' + a.lng + '&destination=' + b.lat + ',' + b.lng + '&travelmode=driving'; }

  /* =============================== PLAN =============================== */
  function ensurePlanMap() {
    if (S.planMap) { setTiles(S.planMap); return; }
    S.planMap = makeMap($('#planMap')); S.rl = L.layerGroup().addTo(S.planMap);
    S.planMap.on('click', function (e) {
      if (!S.pick) return; var f = S.pick; S.pick = null; $('#planMap').classList.remove('picking');
      var lat = e.latlng.lat, lng = e.latlng.lng; setPlace(f, { lat: lat, lng: lng, name: 'Pinned location' });
      reverse(lat, lng).then(function (n) { if (n && S[f] && S[f].lat === lat) { S[f].name = n; $(f === 'from' ? '#inFrom' : '#inTo').value = n; } });
    });
  }
  function pinIcon(c) { return L.divIcon({ className: 'pinwrap', html: '<div class="mpin ' + c + '"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }); }
  function resetPlan() {
    S.from = S.to = null; S.routes = []; S.loading = false; S.err = '';
    ['from', 'to'].forEach(function (f) { if (S.pm[f]) { S.pm[f].remove(); S.pm[f] = null; } });
    if (S.rl) S.rl.clearLayers(); $('#inFrom').value = ''; $('#inTo').value = ''; hideSugg(); renderSheet();
  }
  function setPlace(f, p) {
    S[f] = p; $(f === 'from' ? '#inFrom' : '#inTo').value = p.name;
    if (S.pm[f]) S.pm[f].setLatLng([p.lat, p.lng]); else S.pm[f] = L.marker([p.lat, p.lng], { icon: pinIcon(f === 'from' ? 'a' : 'b') }).addTo(S.planMap);
    hideSugg();
    if (S.from && S.to) loadRoutes(); else { S.routes = []; S.rl.clearLayers(); S.planMap.setView([p.lat, p.lng], 14); renderSheet(); }
  }
  function reverse(lat, lng) {
    return fetchJSON('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=' + lat + '&lon=' + lng, 7000).then(function (j) { return j && j.display_name ? j.display_name.split(',').slice(0, 2).join(',').trim() : null; }).catch(function () { return null; });
  }
  var geoT = null, geoReq = 0;
  function geocode(q) {
    var m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return Promise.resolve([{ lat: m[1], lon: m[2], name: m[1] + ', ' + m[2], display_name: m[1] + ', ' + m[2] + ', coordinates' }]);
    function photon() {
      return fetchJSON('https://photon.komoot.io/api/?limit=7&q=' + encodeURIComponent(q), 8000).then(function (j) {
        var r = (j.features || []).map(function (f) { var p = f.properties || {}, nm = p.name || p.street || p.city || '', rest = [p.street && p.name ? p.street : '', p.district, p.city || p.county, p.state, p.country].filter(Boolean);
          return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: nm, display_name: [nm].concat(rest).join(', ') }; });
        if (!r.length) throw new Error('none'); return r; });
    }
    function nomi() { return fetchJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(q), 8000); }
    return photon().catch(function () { return nomi(); });
  }
  function suggest(q, f) {
    clearTimeout(geoT); if (q.trim().length < 3) { hideSugg(); return; }
    geoT = setTimeout(function () {
      var id = ++geoReq;
      geocode(q).then(function (res) { if (id === geoReq) showSugg(res, f); }).catch(function () { if (id === geoReq) showSugg(null, f); });
    }, 450);
  }
  function showSugg(res, f) {
    var el = $('#sugg');
    if (!res) el.innerHTML = '<div class="sitem dim">Search unavailable — check your connection or tap 📌 to pick on map</div>';
    else if (!res.length) el.innerHTML = '<div class="sitem dim">No places found</div>';
    else el.innerHTML = res.map(function (p, i) { var parts = (p.display_name || '').split(','); return '<div class="sitem" data-i="' + i + '"><b>' + esc(p.name || parts[0]) + '</b><span>' + esc(parts.slice(1, 4).join(',')) + '</span></div>'; }).join('');
    el.style.display = 'block'; el._res = res; el._f = f;
  }
  function hideSugg() { var el = $('#sugg'); el.style.display = 'none'; el.innerHTML = ''; el._res = null; }
  function locate() {
    if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
    toast('Getting your location…');
    navigator.geolocation.getCurrentPosition(function (p) { setPlace('from', { lat: p.coords.latitude, lng: p.coords.longitude, name: 'My location' }); }, function () { toast('Could not get location — type your starting point'); }, { enableHighAccuracy: true, timeout: 10000 });
  }
  function loadRoutes() {
    S.loading = true; S.err = ''; S.routes = []; renderSheet(); var a = S.from, b = S.to;
    fetchRoutes(a, b, true).catch(function () { S.err = 'Routing service unreachable — showing demo routes (straight-line). Check your connection for real roads.'; return fallbackRoutes(a, b); }).then(function (rs) {
      if (a !== S.from || b !== S.to) return;
      rs.slice(0, 3).forEach(function (r, i) { annotate(r, i); }); S.routes = rs.slice(0, 3);
      var bi = 0; S.routes.forEach(function (r, i) { if (r.ai < S.routes[bi].ai) bi = i; }); S.sel = bi; S.aiPick = bi;
      S.loading = false; renderSheet(); drawPlanRoutes();
    });
  }
  function drawPlanRoutes() {
    S.rl.clearLayers(); var bounds = [];
    S.routes.forEach(function (r, i) { if (i === S.sel) return; var pl = L.polyline(r.coords, { color: '#8aa4c8', weight: 6, opacity: 0.9, lineCap: 'round' }).addTo(S.rl); pl.on('click', function () { S.sel = i; renderSheet(); drawPlanRoutes(); }); });
    var r = S.routes[S.sel]; if (!r) return;
    L.polyline(r.coords, { color: '#fff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(S.rl);
    routeSegments(r).forEach(function (sg) { L.polyline(sg.pts, { color: tripColor(sg.c), weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(S.rl); });
    var pst = buildSteps(r); stepMarkers(S.rl, pst, []); roadLabels(S.rl, r, pst); destLabel(S.rl, r.coords[r.coords.length - 1], S.to && S.to.name);
    S.routes.forEach(function (x) { bounds = bounds.concat(x.coords.filter(function (_, k) { return k % 10 === 0; })); });
    if (bounds.length) S.planMap.fitBounds(bounds, { paddingTopLeft: [30, 170], paddingBottomRight: [30, 340] });
  }
  function dens(h) { h = ((h % 24) + 24) % 24; return clamp(Math.round(22 + 52 * Math.exp(-Math.pow(h - 9, 2) / 5) + 62 * Math.exp(-Math.pow(h - 18, 2) / 7) + 14 * Math.exp(-Math.pow(h - 13, 2) / 6)), 8, 96); }
  function forecastHTML() {
    var h0 = new Date().getHours(), W = 340, H = 120, pl = 26, pb = 18, pt = 8, pr = 8, N = 8, nowI = 2, vals = [], i;
    for (i = 0; i < N; i++) vals.push(dens(h0 - 2 + i));
    function X(k) { return pl + k * ((W - pl - pr) / (N - 1)); } function Y(v) { return pt + (1 - v / 100) * (H - pt - pb); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">';
    for (i = 0; i <= 2; i++) { var yy = pt + i * ((H - pt - pb) / 2); s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#1d2836"/><text x="' + (pl - 5) + '" y="' + (yy + 3) + '" fill="#5d6b7b" font-size="8" text-anchor="end" font-family="monospace">' + (100 - i * 50) + '</text>'; }
    for (i = 0; i < N; i++) s += '<text x="' + X(i) + '" y="' + (H - 5) + '" fill="#5d6b7b" font-size="8" text-anchor="middle" font-family="monospace">' + pad(((h0 - 2 + i) % 24 + 24) % 24) + '</text>';
    var po = '', pf = '';
    for (i = 0; i <= nowI; i++) po += (i ? 'L' : 'M') + X(i) + ' ' + Y(vals[i]) + ' ';
    for (i = nowI; i < N; i++) pf += (i > nowI ? 'L' : 'M') + X(i) + ' ' + Y(vals[i]) + ' ';
    s += '<line x1="' + X(nowI) + '" y1="' + pt + '" x2="' + X(nowI) + '" y2="' + (H - pb) + '" stroke="#5d6b7b" stroke-dasharray="3 3"/><text x="' + X(nowI) + '" y="' + (pt + 7) + '" fill="#8b99a9" font-size="8" text-anchor="middle" font-family="monospace">NOW</text>';
    s += '<path d="' + po + '" fill="none" stroke="#5aa0ff" stroke-width="2.4"/><path d="' + pf + '" fill="none" stroke="#f6b846" stroke-width="2.4" stroke-dasharray="5 4"/></svg>';
    var mi = nowI; for (i = nowI; i < N; i++) if (vals[i] < vals[mi]) mi = i;
    var msg = vals[nowI] <= vals[mi] + 6 ? 'Traffic is near its lowest — good time to leave now.' : 'Lowest congestion around <b>' + pad(((h0 - 2 + mi) % 24 + 24) % 24) + ':00</b> (~' + vals[mi] + '%). Leaving now: ~' + vals[nowI] + '%.';
    return '<div class="chartbox">' + s + '</div><div class="note">' + msg + '</div>';
  }
  function vehPills() {
    return '<div class="sechead">Vehicle</div><div class="pills">' + [['car', '🚗 Car'], ['bike', '🏍️ Bike'], ['auto', '🛺 Auto']].map(function (v) { return '<button data-act="veh" data-v="' + v[0] + '" class="' + (S.prof.vehicle.type === v[0] ? 'on' : '') + '">' + v[1] + '</button>'; }).join('') + '</div>';
  }
  function routeCard(r, i) {
    var col = congColor(r.cong), fast = true; S.routes.forEach(function (x) { if (x.dur < r.dur) fast = false; });
    return '<div class="rcard' + (i === S.sel ? ' on' : '') + '" data-act="sel" data-i="' + i + '"><div class="rtop"><b>via ' + esc(r.via) + '</b><span class="tags">' + (i === S.aiPick ? '<em class="ai">AI PICK</em>' : '') + (fast ? '<em>FASTEST</em>' : '') + '</span></div>' +
      '<div class="rmeta"><span><b>' + fmtDur(r.ai) + '</b> AI ETA</span><span>' + (r.dist / 1000).toFixed(1) + ' km</span><span style="color:' + col + '">' + congLabel(r.cong) + ' · ' + Math.round(r.cong * 100) + '%</span></div>' +
      '<div class="rbar"><i style="width:' + Math.round(r.cong * 100) + '%;background:' + col + '"></i></div></div>';
  }
  function dirsHTML(r) {
    return '<div class="dirs">' + buildSteps(r).map(function (st) { return '<div class="dir"><span class="dico">' + stepIcon(st) + '</span><div><b>' + esc(instr(st)) + '</b>' + (st.dist > 0 && st.type !== 'arrive' ? '<small>' + fmtDist(st.dist) + '</small>' : '') + '</div></div>'; }).join('') + '</div>';
  }
  function renderSheet() {
    var sh = $('#routeSheet'), h = '<div class="grab"></div>';
    if (!S.from || !S.to) h += '<div class="hint"><b>Plan your drive</b><p>Choose a start point and destination. DriveAI ranks the routes by traffic-adjusted ETA, then monitors the whole trip — lane changes, collision warnings, signals, speed limits and violations.</p></div>' + vehPills();
    else if (S.loading) h += '<div class="loadrow"><span class="spinner"></span>Finding the best routes…</div>';
    else {
      if (S.err) h += '<div class="note warn">' + esc(S.err) + '</div>';
      h += '<div class="routes">' + S.routes.map(routeCard).join('') + '</div>' + vehPills() + '<div class="sechead">Directions · via ' + esc(S.routes[S.sel].via) + '</div>' + dirsHTML(S.routes[S.sel]) + '<div class="sechead">Best time to leave <span class="chip info">NEXT 6 HRS</span></div>' + forecastHTML();
      h += '<div class="btnrow sticky"><button class="btn primary" data-act="start">▶ Start trip</button><a class="btn ghost" target="_blank" rel="noopener" href="' + gmapsUrl(S.from, S.to) + '">Google Maps ↗</a></div>';
    }
    sh.innerHTML = h;
  }

  /* =============================== TRIP: world =============================== */
  function buildSteps(r) {
    var steps = r.steps.length ? r.steps : [{ name: '', type: 'depart', dist: r.dist }, { name: '', type: 'arrive', dist: 0 }];
    var tot = 0; steps.forEach(function (s) { tot += s.dist || 0; }); var k = tot > 0 ? r.dist / tot : 1, acc = 0;
    return steps.map(function (s) { var o = { name: s.name, type: s.type, mod: s.mod, loc: s.loc, dist: (s.dist || 0) * k, startS: acc }; acc += o.dist; return o; });
  }
  function newTrip(r) {
    var rr = rng(Math.round(r.dist * 3) + 101), avg = r.dist / Math.max(1, r.dur) * 3.6;
    var limits = avg < 35 ? [30, 40, 50] : avg < 55 ? [40, 50, 60] : [60, 80, 100];
    var cover = r.dist * 1.6 + 4000, zones = [], p = 0, signals = [], q, events = [], e, sc = Math.max(1, r.dist / 15000);
    while (p < cover) { var len = 500 + rr() * 900; zones.push({ a: p, b: p + len, limit: limits[Math.floor(rr() * limits.length)], vio: 0 }); p += len; }
    var gapA = avg < 55 ? 650 : 3500, gapB = avg < 55 ? 700 : 3000; q = 350 + rr() * 300;
    while (q < cover) { var g = 22 + rr() * 12, rd = 20 + rr() * 12; signals.push({ s: q, g: g, y: 3, r: rd, off: rr() * (g + 3 + rd), passed: false, wait: 0, adapted: false, jump: rr() < 0.05, disc: false }); q += (gapA + rr() * gapB) * Math.max(1, r.dist / 30000); }
    var W = [['ped', .2], ['slow', .22], ['bump', .12], ['drift', .12], ['over', .14], ['harsh', .06], ['distract', .08], ['none', .06]];
    e = 700 + rr() * 400;
    while (e < r.dist - 300) {
      var t = pickW(rr, W);
      if (t !== 'none') { var ev = { s: e, type: t, len: 1, lead: 0, st: 0 }; if (t === 'ped') { ev.len = 30; ev.lead = 90; } if (t === 'slow') { ev.len = 350; ev.lead = 60; } if (t === 'bump') { ev.len = 15; ev.lead = 60; } if (t === 'over') ev.len = 420; events.push(ev); }
      e += (800 + rr() * 1100) * sc;
    }
    if (events.length < 2 && r.dist > 500) { events.push({ s: r.dist * 0.3, type: 'ped', len: 30, lead: 90, st: 0 }, { s: r.dist * 0.6, type: 'slow', len: 350, lead: 60, st: 0 }); }
    if (r.dist > 2200 && rr() < 0.85) { var js = r.dist * (0.3 + rr() * 0.15); events = events.filter(function (x) { return Math.abs(x.s - js) > 500; }); events.push({ s: js, type: 'jam', len: 700, lead: 0, st: 0 }); for (var k = Math.floor(js / SEG); k <= Math.floor((js + 700) / SEG); k++) r.segCong[k] = 0.98; }
    if (r.dist > 3000 && rr() < 0.5) { var es = r.dist * 0.65; events = events.filter(function (x) { return Math.abs(x.s - es) > 300; }); events.push({ s: es, type: 'emg', len: 200, lead: 0, st: 0 }); }
    events.sort(function (a, b) { return a.s - b.s; });
    return {
      route: r, route0: r, from: S.from, to: S.to, base: 0, s: 0, D: 0, v: 0, tSim: 0, t0: Date.now(), mult: S.prof.mult || 8, zones: zones, zi: 0, zone: null, limit: zones[0].limit, signals: signals, si: 0, events: events, ei: 0, steps: buildSteps(r),
      stats: { harshAccel: 0, harshBrake: 0, fcw: 0, drift: 0, laneChanges: 0, speeding: 0, jumps: 0, distract: 0, pedYield: 0, emgYield: 0, slowLeads: 0, jams: 0, reroutes: 0, rerouteSaved: 0, overT: 0, movingT: 0, idle: 0, stops: 0, signals: 0, maxV: 0, savedWait: 0, waitTotal: 0, vio: 0 },
      alerts: [], vios: [], samples: [], lastSample: -9, decisions: [], overRun: 0, follow: true, ended: false, last: performance.now(), hdg: 0, tab: 'Map', pip: { cam: true, junc: true, big: null }, evOpen: false, night: false, gps: false, spoken: {}, rerouting: false, lastHud: 0, lastTrav: 0, lastLog: 0, logDirty: true, sg: null, sgDist: 1e9, jamEv: null
    };
  }
  function sigState(sg, t) { var cyc = sg.g + sg.y + sg.r, ph = (((t + sg.off) % cyc) + cyc) % cyc; if (ph < sg.g) return { s: 'green', rem: sg.g - ph }; if (ph < sg.g + sg.y) return { s: 'yellow', rem: sg.g + sg.y - ph }; return { s: 'red', rem: cyc - ph }; }
  function nextSig() { while (T.si < T.signals.length && T.signals[T.si].passed) T.si++; return T.signals[T.si] || null; }
  function clockNow() { return fmtClock(T.t0 + T.tSim * 1000); }
  function curStep() { var st = T.steps; for (var i = st.length - 1; i >= 0; i--) if (st[i].startS <= T.s + 1) return st[i]; return null; }
  function nextStep() { for (var i = 1; i < T.steps.length; i++) if (T.steps[i].startS > T.s + 3) return T.steps[i]; return null; }
  function speak(m) {
    if (!m || !S.prof.voice || !window.speechSynthesis) return; var n = Date.now(); if (m === lastSpeak.m && n - lastSpeak.t < 6000) return; lastSpeak = { t: n, m: m };
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(m); u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
  }
  function pushAlert(sev, title, detail, say) {
    if (!T) return; var a = { sev: sev, title: title, detail: detail, ts: clockNow() };
    T.alerts.unshift(a); if (T.alerts.length > 80) T.alerts.pop(); T.logDirty = true;
    var tt = $('#tripToast'); tt.className = 'ttoast show ' + sev; tt.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(detail) + '</span>'; clearTimeout(T.ttT); T.ttT = setTimeout(function () { tt.className = 'ttoast'; }, 3400);
    if ((sev === 'hazard' || sev === 'bad') && navigator.vibrate) { try { navigator.vibrate(160); } catch (e) {} }
    if (say) speak(say);
  }
  function addViolation(type, detail) {
    var st = curStep(); T.vios.unshift({ ts: clockNow(), type: type, detail: detail, loc: (st && st.name) || 'Unnamed road', sec: T.tSim }); T.stats.vio++;
    pushAlert('bad', type + ' logged', detail + ' · ' + ((st && st.name) || 'road'), type === 'Speeding' ? 'Speed limit exceeded' : 'Red light violation');
  }
  function decide(txt) { T.decisions.unshift({ ts: clockNow(), t: txt }); pushAlert('info', 'Adaptive signal', txt); }
  function adaptSig(sg, ss, dist) {
    var cyc = sg.g + sg.y + sg.r;
    if (ss.s === 'red' && ss.rem > 10) { var nr = 3 + Math.random() * 4, ph = cyc - nr; sg.off = ph - (T.tSim % cyc); var gain = ss.rem - nr; sg.adapted = true; T.stats.savedWait += gain; decide('Queue detected on approach → green advanced by ' + Math.round(gain) + 's'); }
    else if (ss.s === 'green' && ss.rem < 4 && dist < 110) { sg.off -= 6; sg.adapted = true; T.stats.savedWait += sg.r * 0.7; decide('Approaching vehicle → green extended +6s'); }
  }
  function evStart(e) {
    var st = T.stats;
    switch (e.type) {
      case 'ped': Dash.pedestrian(); st.pedYield++; pushAlert('warn', 'Pedestrian near crossing', 'Detected ahead · slowing to yield', 'Pedestrian ahead'); break;
      case 'slow': Dash.slowLead(); st.slowLeads++; pushAlert('info', 'Slow vehicle ahead', 'Assessing overtake · checking adjacent lane'); break;
      case 'bump': pushAlert('warn', 'Speed-breaker ahead', (T.night ? 'Unmarked · ' : '') + '40 m · slowing', 'Speed breaker ahead'); break;
      case 'drift': st.drift++; pushAlert('lane', 'Lane departure', 'Minor drift detected · corrected'); break;
      case 'over': if (Math.random() < 0.6) { st.harshAccel++; pushAlert('warn', 'Aggressive acceleration', 'Rapid speed increase logged'); } break;
      case 'harsh': T.v *= 0.45; st.harshBrake++; pushAlert('warn', 'Sharp braking', 'Harsh deceleration logged', 'Sharp braking detected'); break;
      case 'distract': st.distract++; pushAlert('warn', 'Driver distraction', 'Eyes off road detected · attention alert', 'Please keep your eyes on the road'); break;
      case 'jam': st.jams++; T.jamEv = e; pushAlert('bad', 'Heavy congestion ahead', 'Jam detected · searching for a faster route', 'Heavy traffic ahead. Looking for a faster route'); doReroute(true); break;
      case 'emg': st.emgYield++; Junction.emergency(); pushAlert('hazard', 'Emergency vehicle', 'Ambulance behind · pulling over · green corridor requested', 'Ambulance approaching. Please give way'); break;
    }
  }
  function evApply(e, m) {
    switch (e.type) {
      case 'ped': m.cap = Math.min(m.cap, T.D >= e.s - 5 ? 8 : 22); break;
      case 'slow': m.factor *= 0.72; break;
      case 'bump': m.cap = Math.min(m.cap, T.D >= e.s - 10 ? 12 : 25); break;
      case 'over': m.over = true; break;
      case 'emg': m.cap = Math.min(m.cap, 8); break;
      case 'jam': m.cap = Math.min(m.cap, 16); break;
    }
  }
  function simStep(h) {
    if (T.gps) { gpsStep(h); return; }
    var r = T.route, st = T.stats, i, e;
    T.tSim += h;
    while (T.zi < T.zones.length - 1 && T.D >= T.zones[T.zi].b) T.zi++;
    var zone = T.zones[T.zi];
    if (zone !== T.zone) { var first = !T.zone; T.zone = zone; T.limit = zone.limit; if (!first) pushAlert('ok', 'Speed limit ' + zone.limit, 'Road sign detected · ' + zone.limit + ' km/h zone'); }
    var cong = r.segCong[Math.min(r.segCong.length - 1, Math.floor(T.s / SEG))] || 0;
    var tk = zone.limit * 0.9 + Math.sin(T.tSim / 9) * 3, m = { cap: 1e9, factor: 1 - 0.4 * cong, over: false };
    while (T.ei < T.events.length && T.events[T.ei].st === 2) T.ei++;
    for (i = T.ei; i < T.events.length; i++) {
      e = T.events[i]; if (e.st === 2) continue; if (e.s - 120 > T.D) break;
      if (e.st === 0 && T.D >= e.s - e.lead) { e.st = 1; evStart(e); }
      if (e.st === 1) { if (T.D >= e.s + e.len) { e.st = 2; continue; } evApply(e, m); }
    }
    var sg = nextSig(), dist = 1e9, wantStop = false;
    T.sg = sg;
    if (sg) {
      dist = sg.s - T.D - 3.5; T.sgDist = dist;
      var ss = sigState(sg, T.tSim);
      if (dist < 170 && dist > 0 && !sg.adapted) { adaptSig(sg, ss, dist); ss = sigState(sg, T.tSim); }
      if (dist < 170) {
        var stopD = T.v * T.v / (2 * 3.4) + 8;
        if (ss.s === 'red' || (ss.s === 'yellow' && dist > stopD)) {
          if (sg.jump && ss.s === 'red') { if (dist < 14 && !sg.disc) { sg.disc = true; addViolation('Signal jump', 'Crossed on red'); st.jumps++; } }
          else wantStop = true;
        }
      }
    }
    if (wantStop) m.cap = Math.min(m.cap, Math.sqrt(2 * 3 * Math.max(0, dist)) * 3.6);
    var tgt = Math.min(tk * m.factor, m.cap); if (m.over) tgt = Math.min(zone.limit + 12, m.cap);
    tgt /= 3.6; if (Dash.fcw()) tgt = Math.min(tgt, 3);
    T.v += clamp(tgt - T.v, -3.6 * h, 1.8 * h);
    if (wantStop) { var vc = Math.sqrt(2 * 3 * Math.max(0, dist)); if (T.v > vc) T.v = vc; }
    if (T.v < 0.02) T.v = 0;
    var ds = T.v * h;
    if (wantStop && T.D + ds > sg.s - 3) { ds = Math.max(0, sg.s - 3 - T.D); T.v = 0; }
    T.s += ds; T.D += ds;
    if (wantStop && T.v < 0.3 && dist < 1.5) { sg.wait += h; st.idle += h; }
    if (sg && T.D >= sg.s && !sg.passed) { sg.passed = true; st.signals++; if (sg.wait > 0.5) { st.stops++; st.waitTotal += sg.wait; } }
    var vk = T.v * 3.6; if (vk > 0.5) st.movingT += h; if (vk > st.maxV) st.maxV = vk;
    if (vk > zone.limit + 3) { st.overT += h; T.overRun += h; if (T.overRun > 5 && !zone.vio) { zone.vio = 1; st.speeding++; addViolation('Speeding', Math.round(vk) + ' in ' + zone.limit + ' zone'); } } else T.overRun = 0;
    if (T.tSim - T.lastSample >= 3) { T.lastSample = T.tSim; T.samples.push({ t: T.tSim, v: vk, l: zone.limit }); }
  }
  function gpsStep(h) {
    T.tSim += h; var g = T.gpsPos, st = T.stats, r = T.route; if (!g) return;
    var best = T.gi || 0, bd = 1e12, lim = Math.min(r.coords.length - 1, best + 400);
    for (var i = Math.max(0, best - 5); i <= lim; i++) { var d = hav([g.lat, g.lng], r.coords[i]); if (d < bd) { bd = d; best = i; } }
    T.gi = best; var ns = r.cum[best]; if (ns > T.s) { T.D += ns - T.s; T.s = ns; }
    if (bd > 80) { T.offT = (T.offT || 0) + h; if (T.offT > 10 && !T.rerouting) { T.offT = 0; doReroute(false); } } else T.offT = 0;
    T.v = g.sp != null && g.sp >= 0 ? g.sp : T.v; var vk = T.v * 3.6;
    if (vk > 0.5) st.movingT += h; else st.idle += h; if (vk > st.maxV) st.maxV = vk;
    if (T.tSim - T.lastSample >= 3) { T.lastSample = T.tSim; T.samples.push({ t: T.tSim, v: vk, l: null }); }
  }
  function startWatch() {
    T.gps = true; T.mult = 1; T.limit = null;
    T.watch = navigator.geolocation.watchPosition(function (p) {
      var sp = p.coords.speed, st = T.stats; if (!T || T.ended) return;
      if (T.lastFix && sp != null) { var dt = (p.timestamp - T.lastFix.ts) / 1000, a = (sp - T.lastFix.sp) / dt; if (dt > 0.5 && dt < 6) { if (a < -4) { st.harshBrake++; pushAlert('warn', 'Sharp braking', 'Harsh deceleration logged'); } else if (a > 3.2) { st.harshAccel++; pushAlert('warn', 'Aggressive acceleration', 'Rapid speed increase logged'); } } }
      T.lastFix = { ts: p.timestamp, sp: sp || 0 }; T.gpsPos = { lat: p.coords.latitude, lng: p.coords.longitude, sp: sp };
    }, function () { toast('GPS unavailable — switching to simulation'); T.gps = false; T.mult = S.prof.mult || 8; }, { enableHighAccuracy: true, maximumAge: 1000 });
  }
  function stopWatch() { if (T && T.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(T.watch); }

  /* =============================== TRIP: reroute =============================== */
  function doReroute(auto) {
    if (T.rerouting) return; T.rerouting = true; if (!auto) toast('Searching for a faster route…');
    var pos = posAt(T.route, T.s), cur = T.route, remAi = (cur.dist - T.s) * (cur.ai / cur.dist);
    fetchRoutes({ lat: pos.lat, lng: pos.lng }, T.to, true).then(function (rs) {
      if (!T || T.ended) return;
      rs.forEach(function (r, i) { annotate(r, i + 3); });
      var cand = null, saved = 0;
      if (auto) { if (rs.length > 1) { cand = rs.slice(1).sort(function (a, b) { return a.ai - b.ai; })[0]; saved = 120 + Math.random() * 120; } }
      else { cand = rs.slice().sort(function (a, b) { return a.ai - b.ai; })[0]; if (cand.ai > remAi * 0.93) cand = null; else saved = remAi - cand.ai; }
      if (cand) applyRoute(cand, saved);
      else { T.rerouting = false; pushAlert('info', auto ? 'No better route' : 'Already optimal', auto ? 'No faster alternate available · staying on route' : 'You are on the fastest route', auto ? '' : 'You are on the fastest route'); }
    }).catch(function () { if (!T) return; T.rerouting = false; pushAlert('info', 'Reroute unavailable', 'Routing service unreachable · staying on route'); });
  }
  function applyRoute(c, savedS) {
    T.base += T.s; T.s = 0; T.route = c; T.steps = buildSteps(c); T.spoken = {}; T.gi = 0; T.rerouting = false; T.stats.reroutes++; T.stats.rerouteSaved += savedS;
    if (T.jamEv) { T.jamEv.st = 2; T.jamEv = null; }
    drawTripRoute();
    pushAlert('ok', 'Rerouted', 'Faster route via ' + c.via + ' · saves ~' + Math.max(1, Math.round(savedS / 60)) + ' min', 'Rerouting. Faster route found');
  }

  /* =============================== TRIP: UI =============================== */
  function vehIcon() { return L.divIcon({ className: 'veh', html: '<div class="vehdot"><div class="vehar"></div></div>', iconSize: [36, 36], iconAnchor: [18, 18] }); }
  function tripColor(c) { return c < 0.35 ? '#1a73e8' : c < 0.6 ? '#f9ab00' : '#d93025'; }
  function bubble(ll, html, cls) { return L.marker(ll, { icon: L.divIcon({ className: 'tbubwrap', html: '<div class="tbub ' + cls + '">' + html + '</div>', iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, zIndexOffset: 300 }).addTo(tl); }
  function turnIcon(st, cls) { var big = cls === 'next'; return L.divIcon({ className: 'turnpin', html: '<div class="tp ' + cls + '">' + stepIcon(st) + '</div>', iconSize: big ? [40, 40] : [28, 28], iconAnchor: big ? [20, 20] : [14, 14] }); }
  function stepMarkers(layer, steps, store) {
    steps.forEach(function (st, i) { if (i === 0 || !st.loc || st.type === 'depart') return; var m = L.marker([st.loc[1], st.loc[0]], { icon: turnIcon(st, ''), zIndexOffset: 500, interactive: false }).addTo(layer); store.push({ m: m, st: st, cls: '' }); });
  }
  function roadLabels(layer, r, steps) {
    var last = '';
    steps.forEach(function (st) {
      if (!st.name || st.dist < 180 || st.name === last) return; last = st.name;
      var p = posAt(r, st.startS + st.dist / 2);
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'rdlabwrap', html: '<div class="rdlab">' + esc(st.name) + '</div>', iconSize: [0, 0] }), interactive: false, zIndexOffset: 200 }).addTo(layer);
    });
  }
  function destLabel(layer, pt, name) {
    L.marker(pt, { icon: L.divIcon({ className: 'destwrap', html: '<div class="destflag">🏁</div><div class="destlab">' + esc((name || 'Destination').split(',')[0]) + '</div>', iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, zIndexOffset: 900 }).addTo(layer);
  }
  function drawTripRoute() {
    tl.clearLayers(); var r = T.route;
    if (T.base === 0 && S.routes) S.routes.forEach(function (x) {
      if (x === r) return;
      L.polyline(x.coords, { color: '#fff', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(tl);
      L.polyline(x.coords, { color: '#9fb7d9', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(tl);
      bubble(x.coords[Math.floor(x.coords.length * 0.55)], fmtDur(x.ai), 'alt');
    });
    L.polyline(r.coords, { color: '#fff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(tl);
    routeSegments(r).forEach(function (sg) { L.polyline(sg.pts, { color: tripColor(sg.c), weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(tl); });
    T.trav = L.polyline([], { color: '#9aa7b8', weight: 6, opacity: 0.9 }).addTo(tl);
    bubble(r.coords[Math.floor(r.coords.length * 0.3)], fmtDur(r.ai), 'main');
    if (T.base === 0) T.events.forEach(function (ev) { if (ev.type === 'jam' && ev.st !== 2) { var jp = posAt(r, ev.s); bubble([jp.lat, jp.lng], '⚠ +3 min', 'inc'); } });
    T.marks = []; stepMarkers(tl, T.steps, T.marks);
    roadLabels(tl, r, T.steps);
    var end = r.coords[r.coords.length - 1]; L.marker(end, { icon: pinIcon('b') }).addTo(tl); destLabel(tl, end, T.to && T.to.name);
    var p = posAt(r, T.s); T.veh = L.marker([p.lat, p.lng], { icon: vehIcon(), zIndexOffset: 1000 }).addTo(tl);
  }
  var ICON = { left: '↰', right: '↱', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↲', 'sharp right': '↳', uturn: '⮌', straight: '↑' };
  function instr(st) {
    var m = st.mod || '', t = st.type, nm = st.name ? ' onto ' + st.name : '', dir = m.indexOf('left') >= 0 ? 'left' : m.indexOf('right') >= 0 ? 'right' : '';
    if (t === 'arrive') return 'Arrive at destination'; if (t === 'depart') return 'Head out' + (st.name ? ' on ' + st.name : '');
    if (t === 'roundabout' || t === 'rotary' || t === 'exit roundabout') return 'Take the roundabout' + (st.name ? ' to ' + st.name : '');
    if (m === 'uturn') return 'Make a U-turn'; if (t === 'merge') return 'Merge' + nm; if (t === 'on ramp') return 'Take the ramp' + nm; if (t === 'off ramp') return 'Take the exit' + nm;
    if (t === 'fork') return 'Keep ' + (dir || 'straight') + nm; if (t === 'end of road') return 'Turn ' + (dir || 'ahead') + nm;
    if (t === 'continue' || t === 'new name' || m === 'straight' || !dir) return 'Continue' + (st.name ? ' on ' + st.name : '');
    return (m.indexOf('slight') >= 0 ? 'Bear ' : m.indexOf('sharp') >= 0 ? 'Sharp ' : 'Turn ') + dir + nm;
  }
  function stepIcon(st) { if (st.type === 'arrive') return '⚑'; if (st.type === 'roundabout' || st.type === 'rotary') return '⟳'; return ICON[st.mod || 'straight'] || '↑'; }
  function setLights(state) {
    var c = { red: '#fb5a72', yellow: '#f6b846', green: '#3ed99a' };
    [['#hR', 'red'], ['#hY', 'yellow'], ['#hG', 'green']].forEach(function (x) { var el = $(x[0]), on = x[1] === state; el.style.background = on ? c[x[1]] : '#20242b'; el.style.boxShadow = on ? '0 0 12px ' + c[x[1]] : 'none'; });
  }
  function updateHUD() {
    var r = T.route, vk = Math.round(T.v * 3.6), over = !T.gps && T.limit && vk > T.limit + 3;
    setTxt('#hSpeed', vk); $('#hSpeed').style.color = over ? 'var(--bad)' : ''; setTxt('#hLimit', T.gps ? '—' : T.limit); Dash.setSpeed(vk);
    var sg = T.sg;
    if (!T.gps && sg && T.sgDist < 250 && T.sgDist > -8) { var ss = sigState(sg, T.tSim); setLights(ss.s); setTxt('#hSigT', ss.s.toUpperCase() + ' · ' + Math.ceil(ss.rem) + 's'); setTxt('#hSigD', Math.max(0, Math.round(T.sgDist)) + ' m ahead'); }
    else { setLights(null); setTxt('#hSigT', 'No signal'); setTxt('#hSigD', '—'); }
    var sc = scoreOf(metricsOf(T.stats), T.stats); setTxt('#hScore', sc); $('#hScore').style.color = sc >= 85 ? 'var(--ok)' : sc >= 70 ? 'var(--warn)' : 'var(--bad)';
    var tot = T.base + r.dist; $('#hProg').style.width = clamp((T.base + T.s) / tot * 100, 0, 100) + '%';
    var rem = (r.dist - T.s) * (r.ai / r.dist); setTxt('#hRem', ((r.dist - T.s) / 1000).toFixed(1)); setTxt('#hEta', Math.max(1, Math.round(rem / 60))); setTxt('#hClock', fmtClock(T.t0 + (T.tSim + rem) * 1000));
    var cg = r.segCong[Math.min(r.segCong.length - 1, Math.floor(T.s / SEG))] || 0, md = $('#hMode'); md.textContent = cg < 0.35 ? 'CLEAR' : cg < 0.6 ? 'BUSY' : 'JAM'; md.className = 'chip ' + (cg < 0.35 ? 'ok' : cg < 0.6 ? 'warn' : 'bad'); var ee = $('#hEta'); if (ee && ee.parentNode) ee.parentNode.style.color = cg < 0.35 ? '#188038' : cg < 0.6 ? '#b06000' : '#c5221f'; setTxt('#evBadge', T.stats.vio ? T.stats.vio : '');
    var nx = nextStep(), nn = null;
    if (nx) { var ix = T.steps.indexOf(nx); nn = T.steps[ix + 1] || null; }
    setTxt('#navThen', nn ? stepIcon(nn) : ''); var tbx = $('#navThenBox'); if (tbx) tbx.style.display = nn ? 'flex' : 'none';
    (T.marks || []).forEach(function (mk) { var c = mk.st === nx ? 'next' : (mk.st.startS <= T.s ? 'done' : ''); if (c !== mk.cls) { mk.cls = c; mk.m.setIcon(turnIcon(mk.st, c)); } });
    if (nx) {
      var dd = nx.startS - T.s; setTxt('#navDist', fmtDist(dd)); setTxt('#navTxt', instr(nx)); setTxt('#navIco', stepIcon(nx));
      var key = T.steps.indexOf(nx) + '_' + T.base; if (dd < 220 && !T.spoken[key]) { T.spoken[key] = 1; speak('In ' + fmtDist(dd) + ', ' + instr(nx)); }
    }
    setTxt('#vCount', T.stats.vio + (T.stats.vio === 1 ? ' violation' : ' violations'));
  }
  function renderLog() {
    var h = '';
    T.vios.forEach(function (v) { h += '<div class="alert vio"><div class="bar" style="background:#fb5a72"></div><div class="body"><div class="t">' + esc(v.type) + ' <span class="chip bad">VIOLATION</span></div><div class="d">' + esc(v.detail) + ' · ' + esc(v.loc) + '</div></div><div class="ts">' + esc(v.ts) + '</div></div>'; });
    var C = { hazard: '#fb5a72', bad: '#fb5a72', warn: '#f6b846', ok: '#3ed99a', info: '#5aa0ff', lane: '#a78bfa' };
    T.alerts.forEach(function (a) { h += '<div class="alert"><div class="bar" style="background:' + (C[a.sev] || '#5aa0ff') + '"></div><div class="body"><div class="t">' + esc(a.title) + '</div><div class="d">' + esc(a.detail) + '</div></div><div class="ts">' + esc(a.ts) + '</div></div>'; });
    $('#tripAlerts').innerHTML = h || '<div class="note">Events will appear here as you drive.</div>';
  }
  function setPips() {
    var c = $('#pipCam'), j = $('#pipJunc'); c.style.display = T.pip.cam ? '' : 'none'; j.style.display = T.pip.junc ? '' : 'none';
    c.classList.toggle('big', T.pip.big === 'cam'); j.classList.toggle('big', T.pip.big === 'junc'); $('#pips').classList.toggle('hasbig', !!T.pip.big);
    $('#cCam').classList.toggle('on', T.pip.cam); $('#cJunc').classList.toggle('on', T.pip.junc);
  }
  function render(now) {
    var pos = posAt(T.route, T.s), dh = ((pos.h - T.hdg + 540) % 360) - 180; T.hdg = (T.hdg + dh * 0.15 + 360) % 360;
    if (T.veh) { T.veh.setLatLng([pos.lat, pos.lng]); var el = T.veh.getElement(); if (el && el.firstChild) el.firstChild.style.transform = 'rotate(' + T.hdg.toFixed(0) + 'deg)'; }
    if (T.follow && tripMap) tripMap.setView([pos.lat, pos.lng], tripMap.getZoom(), { animate: false });
    if (now - T.lastTrav > 400 && T.trav) { T.lastTrav = now; T.trav.setLatLngs(T.route.coords.slice(0, pos.i + 1).concat([[pos.lat, pos.lng]])); }
    Dash.setExt(clamp(T.v / 13.9, 0, 1.3));
    var sg = T.sg;
    if (!T.gps && sg && T.sgDist < 160 && T.sgDist > -6) {
      var ss = sigState(sg, T.tSim); Dash.setSignal(ss.s, clamp(0.05 + (1 - T.sgDist / 160) * 0.85, 0.05, 0.95));
      if (T.sgDist < 90 && ss.s === 'red' && T.v < 4) Dash.banner('stop', 'SIGNAL · RED', 'HOLDING AT STOP LINE'); else Dash.hideBanner('stop');
    } else { Dash.setSignal(null); Dash.hideBanner('stop'); }
    if (T.pip.cam) Dash.draw();
    if (T.pip.junc) Junction.draw();
    if (now - T.lastHud > 120) { T.lastHud = now; updateHUD(); }
    if (now - T.lastLog > 500) { T.lastLog = now; if (T.pip.junc) Junction.panel($('#juncPanel')); if (T.evOpen && T.logDirty) { T.logDirty = false; renderLog(); } }
  }
  function tick(now) {
    if (!T || T.ended) return;
    var dt = Math.min(0.05, (now - T.last) / 1000); T.last = now;
    var dtSim = dt * T.mult, n = Math.max(1, Math.ceil(dtSim / 0.25)), h = dtSim / n;
    for (var i = 0; i < n; i++) simStep(h);
    Dash.step(dt); Junction.step(dt);
    if (T.s >= T.route.dist - 6) { arrive(false); return; }
    render(now);
    T.raf = requestAnimationFrame(tick);
  }
  function startTrip() {
    var r = S.routes[S.sel]; if (!r) return;
    if (T && !T.ended) { try { cancelAnimationFrame(T.raf); } catch (e) {} }
    T = newTrip(r); show('sTrip');
    if (!tripMap) { tripMap = makeMap($('#tripMap')); tl = L.layerGroup().addTo(tripMap); tripMap.on('dragstart', function () { if (T) T.follow = false; $('#btnRecenter').classList.add('show'); }); }
    else setTiles(tripMap);
    tripMap.invalidateSize(); drawTripRoute(); var p = posAt(r, 0); tripMap.setView([p.lat, p.lng], 17, { animate: false });
    $('#btnRecenter').classList.remove('show'); $('#tripToast').className = 'ttoast';
    Dash.reset(); Dash.setNight(false); Junction.setNight(false); Dash.start(); Junction.start();
    $('#cNight').textContent = '🌙'; $('#cVoice').textContent = S.prof.voice ? '🔊' : '🔇'; $('#cSpeed').textContent = T.mult + '×';
    setPips(); $('#evSheet').classList.remove('open'); $('#navTxt').textContent = 'Starting trip…'; $('#navDist').textContent = '—';
    if (S.prof.gps && navigator.geolocation) { startWatch(); $('#cSpeed').textContent = 'GPS'; toast('Live GPS navigation (beta) — scenario events are off'); }
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { if (T) T.wake = l; }).catch(function () {}); } catch (e) {}
    pushAlert('ok', 'Trip started', S.from.name + ' → ' + S.to.name, 'Trip started. Drive safe');
    T.last = performance.now(); T.raf = requestAnimationFrame(tick);
  }

  /* =============================== ANALYTICS =============================== */
  function metricsOf(st) {
    var mv = Math.max(60, st.movingT);
    return {
      smooth: clamp(Math.round(100 - 5 * st.harshAccel - 5 * st.harshBrake), 35, 100), braking: clamp(Math.round(100 - 9 * st.harshBrake - 9 * st.fcw), 30, 100),
      lane: clamp(Math.round(100 - 4 * st.drift - 2 * Math.max(0, st.laneChanges - 2)), 40, 100), speed: clamp(Math.round(100 - 300 * (st.overT / mv) - 4 * st.speeding), 25, 100), focus: clamp(Math.round(100 - 9 * st.distract), 40, 100)
    };
  }
  function scoreOf(m, st) { return clamp(Math.round(.2 * m.smooth + .2 * m.braking + .18 * m.lane + .27 * m.speed + .15 * m.focus - 7 * st.jumps), 20, 100); }
  function gradeOf(sc) { return sc >= 85 ? ['A', '#3ed99a'] : sc >= 72 ? ['B', '#5aa0ff'] : sc >= 58 ? ['C', '#f6b846'] : ['D', '#fb5a72']; }
  var LP100 = { car: 7.2, bike: 2.6, auto: 5.0 }, IDLE = { car: 0.8, bike: 0.3, auto: 0.5 };
  function buildRecord(partial) {
    var st = T.stats, distM = T.base + T.s, dur = Math.max(1, T.tSim), m = metricsOf(st), score = scoreOf(m, st), veh = S.prof.vehicle, vt = veh.type || 'car';
    var avgK = distM / dur * 3.6, movK = distM / Math.max(1, st.movingT) * 3.6;
    var baseF = distM / 1000 * (LP100[vt] || 7) / 100, harsh = st.harshAccel + st.harshBrake + st.fcw, ff = 1 + 0.035 * harsh + 0.5 * (st.overT / Math.max(60, dur));
    var fuel = baseF * ff + (st.idle / 3600) * (IDLE[vt] || 0.8), eco = clamp(Math.round(100 - (ff - 1) * 220 - (st.idle / dur) * 40), 40, 100);
    var hr = rng(Math.round(distM) + st.stops * 13 + 5), tyres = [0, 1, 2, 3].map(function () { return +(31 + hr() * 3 - 0.8).toFixed(1); });
    if (hr() < 0.25) tyres[Math.floor(hr() * 4)] = +(27 + hr() * 1.5).toFixed(1);
    var saved = st.savedWait + st.rerouteSaved * 0, fuelSaved = (st.savedWait * 0.00022) + (st.rerouteSaved * 0.00012);
    var sm = T.samples, step = Math.max(1, Math.ceil(sm.length / 100)), ds = sm.filter(function (_, i) { return i % step === 0; });
    return {
      id: Date.now(), ts: Date.now(), partial: !!partial, from: { name: T.from.name, lat: T.from.lat, lng: T.from.lng }, to: { name: T.to.name, lat: T.to.lat, lng: T.to.lng }, vehicle: { type: vt, name: veh.name, plate: veh.plate },
      dist: distM, dur: dur, planned: T.route0.ai, avgK: avgK, movK: movK, maxK: st.maxV * 3.6 / 3.6, idleS: st.idle, stops: st.stops, signals: st.signals, score: score, metrics: m, rating: +(score / 20).toFixed(1), pax: null,
      counts: { harshBrake: st.harshBrake, harshAccel: st.harshAccel, fcw: st.fcw, drift: st.drift, laneChanges: st.laneChanges, speeding: st.speeding, jumps: st.jumps, distract: st.distract, pedYield: st.pedYield, emgYield: st.emgYield, reroutes: st.reroutes, jams: st.jams },
      fuel: fuel, econ: distM / 1000 / Math.max(0.01, fuel), co2: fuel * 2.31, cost: fuel * 105, eco: eco,
      health: { temp: Math.round(clamp(82 + avgK * 0.18 + hr() * 4, 80, 104)), batt: +(13.6 + hr() * 0.7).toFixed(1), tyres: tyres, brake: +(0.02 * (st.stops + st.harshBrake * 3 + 1) * (distM / 5000 + 0.3)).toFixed(2) },
      vios: T.vios.slice(0, 20), samples: ds, impact: { waitActual: st.waitTotal, saved: saved, reroute: st.rerouteSaved, fuel: fuelSaved, co2: fuelSaved * 2.31, signals: st.signals, stops: st.stops }
    };
  }
  function arrive(partial) {
    if (!T || T.ended) return; T.ended = true; cancelAnimationFrame(T.raf); Dash.stop(); Junction.stop(); stopWatch();
    try { if (T.wake) T.wake.release(); } catch (e) {}
    if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    if (partial && T.base + T.s < 100) { toast('Trip too short to analyse — discarded'); T = null; show('sPlan'); return; }
    var rec = buildRecord(partial); S.trips.unshift(rec); S.trips = S.trips.slice(0, 30); store.set('dai_trips_' + uid(), S.trips);
    setTimeout(function () { speak(partial ? 'Trip ended' : 'You have arrived at your destination'); }, 250);
    renderSummary(rec, 'plan'); show('sSummary');
  }
  function starSvg(fill) { var id = 'g' + Math.random().toString(36).slice(2, 7), stop = fill === 'full' ? '100%' : fill === 'half' ? '50%' : '0%'; return '<svg viewBox="0 0 24 24"><defs><linearGradient id="' + id + '"><stop offset="' + stop + '" stop-color="#f6b846"/><stop offset="' + stop + '" stop-color="#3a4756"/></linearGradient></defs><path fill="url(#' + id + ')" stroke="#f6b846" stroke-width="0.6" d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9l6.6-.9z"/></svg>'; }
  function starsHTML(v) { var s = ''; for (var i = 1; i <= 5; i++) { var d = v - i; s += starSvg(d >= -0.15 ? 'full' : d >= -0.65 ? 'half' : 'empty'); } return '<div class="stars">' + s + '</div>'; }
  function speedChart(sm, vios) {
    if (!sm || sm.length < 2) return '<div class="note">Not enough data for a speed profile.</div>';
    var W = 340, H = 150, pl = 28, pb = 18, pt = 10, pr = 8, tmax = sm[sm.length - 1].t || 1, vmax = 20; sm.forEach(function (p) { vmax = Math.max(vmax, p.v, p.l || 0); }); vmax = Math.ceil((vmax + 5) / 20) * 20;
    function X(t) { return pl + t / tmax * (W - pl - pr); } function Y(v) { return pt + (1 - v / vmax) * (H - pt - pb); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">', i;
    for (i = 0; i <= 4; i++) { var yy = pt + i * ((H - pt - pb) / 4); s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#1d2836"/><text x="' + (pl - 5) + '" y="' + (yy + 3) + '" fill="#5d6b7b" font-size="8" text-anchor="end" font-family="monospace">' + Math.round(vmax - i * vmax / 4) + '</text>'; }
    s += '<text x="' + pl + '" y="' + (H - 4) + '" fill="#5d6b7b" font-size="8" font-family="monospace">0</text><text x="' + (W - pr) + '" y="' + (H - 4) + '" fill="#5d6b7b" font-size="8" text-anchor="end" font-family="monospace">' + fmtDur(tmax) + '</text>';
    var area = 'M' + X(sm[0].t) + ' ' + Y(0), line = '', lim = '';
    sm.forEach(function (p, k) { area += 'L' + X(p.t) + ' ' + Y(p.v); line += (k ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' '; if (p.l) lim += (lim ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.l).toFixed(1) + ' '; });
    area += 'L' + X(sm[sm.length - 1].t) + ' ' + Y(0) + 'Z';
    s += '<path d="' + area + '" fill="rgba(34,211,238,.13)"/><path d="' + line + '" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linejoin="round"/>' + (lim ? '<path d="' + lim + '" fill="none" stroke="#f6b846" stroke-width="1.5" stroke-dasharray="4 3"/>' : '');
    (vios || []).forEach(function (v) { if (v.sec != null && v.sec <= tmax) { var k = 0; while (k < sm.length - 1 && sm[k].t < v.sec) k++; s += '<circle cx="' + X(v.sec) + '" cy="' + Y(sm[k].v) + '" r="3.5" fill="#fb5a72"/>'; } });
    return s + '</svg>';
  }
  function mrow(n, v) { var c = v >= 85 ? '#3ed99a' : v >= 70 ? '#f6b846' : '#fb5a72'; return '<div class="metric"><div class="top"><span>' + n + '</span><b style="color:' + c + '">' + v + '</b></div><div class="track"><i class="mfill" data-w="' + v + '" style="width:0;background:' + c + '"></i></div></div>'; }
  function tile(l, v, e, c) { return '<div class="istat"><div class="il">' + l + '</div><div class="iv" style="color:' + (c || 'var(--text)') + '">' + v + '</div>' + (e ? '<div class="ie">' + e + '</div>' : '') + '</div>'; }
  var curRec = null;
  function renderSummary(rec, back) {
    curRec = rec; sumBack = back || 'plan';
    var g = gradeOf(rec.score), m = rec.metrics, c = rec.counts, hl = rec.health, im = rec.impact, d = new Date(rec.ts);
    var delta = rec.dur - rec.planned, deltaTxt = Math.abs(delta) < 60 ? 'on time' : fmtDur(Math.abs(delta)) + (delta < 0 ? ' faster than planned' : ' slower than planned');
    var base = im.waitActual + im.saved, pct = base > 1 ? Math.round(im.saved / base * 100) : 0, maxW = Math.max(base, 10);
    var gmaps = gmapsUrl(rec.from, rec.to);
    var h = '<div class="sumhead"><div class="check">' + (rec.partial ? '■' : '✓') + '</div><h2>' + (rec.partial ? 'Trip ended' : "You've arrived") + '</h2><p>' + esc(rec.from.name) + ' → ' + esc(rec.to.name) + '</p><div class="sumtags"><span class="chip info">' + (rec.dist / 1000).toFixed(1) + ' km</span><span class="chip info">' + fmtDur(rec.dur) + '</span><span class="chip ' + (delta <= 60 ? 'ok' : 'warn') + '">' + deltaTxt + '</span><span class="chip info">' + d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + fmtClock(rec.ts) + '</span></div></div>';
    h += '<div class="seg sticky" id="sumTabs"><button class="on" data-t="drv">Driver</button><button data-t="veh">Vehicle</button><button data-t="ai">AI impact</button></div>';
    // driver
    h += '<div class="sumpane active" data-t="drv"><div class="card"><h3>Driver safety score</h3><div class="sub">Weighted composite of this trip</div><div class="gaugewrap"><div class="gauge"><svg viewBox="0 0 170 170" width="150" height="150"><circle cx="85" cy="85" r="72" fill="none" stroke="#1d2836" stroke-width="13"/><circle id="gaugeArc" cx="85" cy="85" r="72" fill="none" stroke="' + g[1] + '" stroke-width="13" stroke-linecap="round" stroke-dasharray="452" stroke-dashoffset="452" transform="rotate(-90 85 85)"/></svg><div class="val"><b id="scoreNum">0</b><span>/ 100</span></div></div>' +
      '<div class="gradebox"><div class="grade" style="color:' + g[1] + ';background:' + g[1] + '22;border:1px solid ' + g[1] + '55">' + g[0] + '</div>' + starsHTML(rec.rating) + '<div class="ratenum">' + rec.rating.toFixed(1) + ' / 5</div></div></div>' +
      '<div class="metrics">' + mrow('Smooth acceleration', m.smooth) + mrow('Braking discipline', m.braking) + mrow('Lane keeping', m.lane) + mrow('Speed compliance', m.speed) + mrow('Focus / no distraction', m.focus) + '</div></div>';
    h += '<div class="card"><h3>Driving events</h3><div class="sub">Detected by the AI during the trip</div><div class="istats3">' + tile('Pedestrians yielded', c.pedYield, '', 'var(--ped)') + tile('Collision warnings', c.fcw, '', c.fcw ? 'var(--bad)' : 'var(--ok)') + tile('Lane changes', c.laneChanges, 'overtakes', 'var(--lane)') + tile('Speeding', c.speeding, 'zones', c.speeding ? 'var(--bad)' : 'var(--ok)') + tile('Signal jumps', c.jumps, '', c.jumps ? 'var(--bad)' : 'var(--ok)') + tile('Distractions', c.distract, 'alerts', c.distract ? 'var(--warn)' : 'var(--ok)') + '</div></div>';
    h += '<div class="card"><h3>Rate this trip</h3><div class="sub">Passenger feedback is added to the driver profile</div><div class="ratebtns" id="rateBtns">';
    for (var i = 1; i <= 5; i++) h += '<button data-act="rate" data-n="' + i + '" class="' + (rec.pax && i <= rec.pax ? 'on' : '') + '" aria-label="' + i + ' star"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.5 9l6.6-.9z"/></svg></button>';
    h += '</div><div class="ratelbl" id="paxTxt">' + (rec.pax ? 'You rated this trip ' + rec.pax + ' ★' : 'Tap a star to rate') + '</div></div>';
    h += '<div class="card"><h3>Violations <span class="chip ' + (rec.vios.length ? 'bad' : 'ok') + '">' + rec.vios.length + '</span></h3><div class="sub">Timestamped &amp; geo-tagged</div>';
    if (rec.vios.length) { h += '<table class="log"><thead><tr><th>Time</th><th>Type</th><th>Detail</th></tr></thead><tbody>'; rec.vios.forEach(function (v) { h += '<tr><td>' + esc(v.ts) + '</td><td class="sev" style="color:#fb5a72">' + esc(v.type) + '</td><td>' + esc(v.detail) + '<br><span style="color:var(--muted)">' + esc(v.loc) + '</span></td></tr>'; }); h += '</tbody></table>'; }
    else h += '<div class="note">No violations — clean trip 👏</div>';
    h += '</div></div>';
    // vehicle
    h += '<div class="sumpane" data-t="veh"><div class="card"><h3>' + esc(rec.vehicle.name || 'Vehicle') + (rec.vehicle.plate ? ' <span class="chip info">' + esc(rec.vehicle.plate) + '</span>' : '') + '</h3><div class="sub">Trip performance</div><div class="istats3">' +
      tile('Distance', (rec.dist / 1000).toFixed(1) + ' km', '', 'var(--car)') + tile('Duration', fmtDur(rec.dur), 'planned ' + fmtDur(rec.planned)) + tile('Avg speed', Math.round(rec.avgK) + ' km/h', 'moving ' + Math.round(rec.movK)) + tile('Top speed', Math.round(rec.maxK) + ' km/h', '', rec.maxK > 80 ? 'var(--warn)' : '') + tile('Idle time', fmtDur(rec.idleS), rec.stops + ' stops') + tile('Signals', rec.signals, 'crossed') + '</div></div>';
    h += '<div class="card"><h3>Fuel &amp; emissions</h3><div class="sub">Estimated from distance, idling and driving style</div><div class="istats3">' + tile('Fuel used', rec.fuel.toFixed(2) + ' L', '', 'var(--warn)') + tile('Economy', rec.econ.toFixed(1) + ' km/L', '', 'var(--ok)') + tile('CO₂', rec.co2.toFixed(1) + ' kg', '', 'var(--sign)') + tile('Fuel cost', '₹' + Math.round(rec.cost), 'at ~₹105/L') + tile('Eco score', rec.eco, 'out of 100', rec.eco >= 80 ? 'var(--ok)' : 'var(--warn)') + tile('Harsh events', c.harshBrake + c.harshAccel + c.fcw, 'brake / accel') + '</div></div>';
    h += '<div class="card"><h3>Speed profile</h3><div class="sub">Speed (cyan) vs detected limit (dashed) · red dots = violations</div><div class="chartbox">' + speedChart(rec.samples, rec.vios) + '</div></div>';
    h += '<div class="card"><h3>Vehicle health <span class="chip warn">SIMULATED OBD</span></h3><div class="sub">Plug in an OBD-II adapter to replace these with live readings</div><div class="istats3">' + tile('Engine temp', hl.temp + '°C', '', hl.temp > 98 ? 'var(--warn)' : 'var(--ok)') + tile('Battery', hl.batt + ' V', '', 'var(--ok)') + tile('Brake wear', hl.brake + '%', 'this trip') + '</div><div class="tyres">' +
      ['FL', 'FR', 'RL', 'RR'].map(function (n, k) { var p = hl.tyres[k], low = p < 29; return '<div class="tyre ' + (low ? 'low' : '') + '"><b>' + p + '</b><span>psi ' + n + '</span></div>'; }).join('') + '</div>' + (hl.tyres.some(function (p) { return p < 29; }) ? '<div class="note warn">⚠ One tyre is below the recommended pressure — check before your next trip.</div>' : '') + '</div></div>';
    // AI impact
    h += '<div class="sumpane" data-t="ai"><div class="card"><h3>Adaptive control vs fixed-time signals</h3><div class="sub">Time spent waiting at signals on this trip</div>' +
      '<div class="vbar"><div class="vt"><span>🤖 AI adaptive</span><b style="color:var(--ok)">' + Math.round(im.waitActual) + 's</b></div><div class="vtrack"><i class="vfill" data-w="' + (im.waitActual / maxW * 100) + '" style="width:0;background:linear-gradient(90deg,#2fb37a,#3ed99a)"></i></div></div>' +
      '<div class="vbar"><div class="vt"><span>🕒 Fixed-time (modelled)</span><b style="color:var(--bad)">' + Math.round(base) + 's</b></div><div class="vtrack"><i class="vfill" data-w="' + (base / maxW * 100) + '" style="width:0;background:linear-gradient(90deg,#c0405a,#fb5a72)"></i></div></div>' +
      '<div class="impbadge"><div class="big">' + pct + '%</div><div class="lb">less waiting at signals</div></div></div>';
    h += '<div class="card"><h3>This trip’s savings</h3><div class="sub">Estimates — signal timing and reroutes</div><div class="istats3">' + tile('Wait saved', Math.round(im.saved) + 's', 'at signals', 'var(--ok)') + tile('Reroutes', c.reroutes, c.jams + ' jams hit', 'var(--intel)') + tile('Time saved', fmtDur(im.reroute + im.saved), 'est. total', 'var(--ok)') + tile('Fuel saved', im.fuel.toFixed(2) + ' L', '', 'var(--warn)') + tile('CO₂ avoided', im.co2.toFixed(2) + ' kg', '', 'var(--sign)') + tile('Emergency yields', c.emgYield, 'ambulance', 'var(--hazard)') + '</div></div></div>';
    h += '<div class="btnrow"><a class="btn ghost" target="_blank" rel="noopener" href="' + gmaps + '">Route in Google Maps ↗</a><button class="btn primary" data-act="done">' + (sumBack === 'hist' ? 'Back to trips' : 'Done') + '</button></div>';
    var body = $('#sumBody'); body.innerHTML = h; body.scrollTop = 0;
    setTimeout(function () {
      var arc = $('#gaugeArc'); if (arc) arc.setAttribute('stroke-dashoffset', 452 * (1 - rec.score / 100));
      var n = 0, el = $('#scoreNum'), iv = setInterval(function () { n += 2; if (n >= rec.score) { n = rec.score; clearInterval(iv); } if (el) el.textContent = n; }, 18);
      $$('.mfill').forEach(function (e) { e.style.width = e.dataset.w + '%'; }); $$('.vfill').forEach(function (e) { e.style.width = clamp(+e.dataset.w, 2, 100) + '%'; });
    }, 80);
  }

  /* =============================== HISTORY / PROFILE =============================== */
  function renderHistory() {
    var t = S.trips, el = $('#histBody');
    if (!t.length) { el.innerHTML = '<div class="empty"><div class="eico">🧭</div><b>No trips yet</b><p>Plan a drive to see your driver &amp; vehicle analytics here.</p></div>'; return; }
    var avg = Math.round(t.reduce(function (a, r) { return a + r.score; }, 0) / t.length), km = t.reduce(function (a, r) { return a + r.dist; }, 0) / 1000, vio = t.reduce(function (a, r) { return a + r.vios.length; }, 0), g = gradeOf(avg);
    var h = '<div class="istats3 pad">' + tile('Avg score', avg, 'grade ' + g[0], g[1]) + tile('Distance', km.toFixed(1) + ' km', t.length + ' trips', 'var(--car)') + tile('Violations', vio, '', vio ? 'var(--bad)' : 'var(--ok)') + '</div><div class="hlist">';
    t.forEach(function (r, i) { var gg = gradeOf(r.score); h += '<div class="hitem" data-i="' + i + '"><div class="grade sm" style="color:' + gg[1] + ';background:' + gg[1] + '22;border:1px solid ' + gg[1] + '55">' + r.score + '</div><div class="hmid"><b>' + esc(r.from.name) + ' → ' + esc(r.to.name) + '</b><span>' + new Date(r.ts).toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' · ' + (r.dist / 1000).toFixed(1) + ' km · ' + fmtDur(r.dur) + '</span></div><div class="hr">›</div></div>'; });
    el.innerHTML = h + '</div>';
  }
  function renderProfile() {
    var p = S.prof, v = p.vehicle, u = S.user; $('#profSub').textContent = u.guest ? 'Guest session — data stays on this device' : u.email;
    $('#profBody').innerHTML = '<div class="card"><h3>' + esc(u.name) + '</h3><div class="sub">' + (u.guest ? 'Guest account' : esc(u.email)) + '</div></div>' +
      '<div class="card"><h3>My vehicle</h3><div class="pills" style="margin:10px 0">' + [['car', '🚗 Car'], ['bike', '🏍️ Bike'], ['auto', '🛺 Auto']].map(function (x) { return '<button data-act="pveh" data-v="' + x[0] + '" class="' + (v.type === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div><input class="inp" data-k="vname" placeholder="Vehicle name" value="' + esc(v.name) + '" style="margin-bottom:8px"><input class="inp" data-k="vplate" placeholder="Registration number" value="' + esc(v.plate) + '"></div>' +
      '<div class="card"><h3>Trip settings</h3><div class="setrow"><span>Demo speed<small>How fast the simulated trip runs</small></span><select class="inp sm" data-k="mult">' + [1, 4, 8, 16].map(function (x) { return '<option value="' + x + '"' + (p.mult === x ? ' selected' : '') + '>' + x + '×</option>'; }).join('') + '</select></div>' +
      '<div class="setrow"><span>Voice guidance<small>Turn-by-turn &amp; hazard alerts</small></span><input type="checkbox" class="sw2" data-k="voice"' + (p.voice ? ' checked' : '') + '></div>' +
      '<div class="setrow"><span>Live GPS navigation (beta)<small>Use real position &amp; speed instead of the simulation. Scenario events are off.</small></span><input type="checkbox" class="sw2" data-k="gps"' + (p.gps ? ' checked' : '') + '></div>' +
      '<div class="setrow"><span>Map style</span><select class="inp sm" data-k="map"><option value="voyager"' + (p.map === 'voyager' ? ' selected' : '') + '>Maps (default)</option><option value="dark"' + (p.map === 'dark' ? ' selected' : '') + '>Dark</option><option value="light"' + (p.map === 'light' ? ' selected' : '') + '>Standard</option></select></div></div>' +
      '<div class="card"><h3>About</h3><div class="sub">Maps &amp; routing: OpenStreetMap, OSRM, Nominatim. Camera detections, signals, speed limits and vehicle health are simulated for this demo; the full pipeline (camera → YOLOv8 → Node API → MongoDB) plugs in behind the same screens.</div></div>' +
      '<div class="btnrow"><button class="btn ghost" data-act="clear">Clear trip history</button><button class="btn danger" data-act="logout">Sign out</button></div>';
  }

  /* =============================== EVENTS =============================== */
  function bind() {
    $$('#authTabs button').forEach(function (b) { b.onclick = function () { setAuthMode(b.dataset.m); }; });
    $('#authForm').addEventListener('submit', doAuth);
    $('#demoLogin').onclick = function () { loginAs(DEMO.email, DEMO.name); };
    $('#guestLogin').onclick = function () { loginAs('guest', 'Guest', true); };
    $$('#tabbar button').forEach(function (b) { b.onclick = function () { show(b.dataset.s); }; });
    ['from', 'to'].forEach(function (f) {
      var el = $(f === 'from' ? '#inFrom' : '#inTo');
      el.addEventListener('input', function () { S[f] = null; S.routes = []; if (S.rl) S.rl.clearLayers(); renderSheet(); suggest(el.value, f); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideSugg(); else if (e.key === 'Enter') { e.preventDefault(); var sg = $('#sugg'); if (sg._res && sg._res.length) { var it = sg.querySelector('.sitem'); if (it) it.click(); } } });
    });
    $('#btnLoc').onclick = locate;
    $('#btnSwap').onclick = function () { var a = S.from, b = S.to; if (!a && !b) return; resetPlanKeep(); if (b) setPlace('from', b); if (a) setPlace('to', a); };
    function pick(f) { S.pick = f; $('#planMap').classList.add('picking'); toast('Tap the map to set the ' + (f === 'from' ? 'start' : 'destination'), 3000); }
    $('#btnPickFrom').onclick = function () { pick('from'); }; $('#btnPickTo').onclick = function () { pick('to'); };
    $('#sugg').addEventListener('click', function (e) { var it = e.target.closest('.sitem'); var el = $('#sugg'); if (!it || !el._res || it.dataset.i == null) return; var p = el._res[+it.dataset.i], f = el._f; setPlace(f, { lat: +p.lat, lng: +p.lon, name: (p.name || p.display_name.split(',')[0]) }); });
    $('#routeSheet').addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return; var a = t.dataset.act;
      if (a === 'sel') { S.sel = +t.dataset.i; renderSheet(); drawPlanRoutes(); }
      else if (a === 'veh') { S.prof.vehicle.type = t.dataset.v; saveProf(); renderSheet(); }
      else if (a === 'start') startTrip();
    });
    $('#cCam').onclick = function () { if (!T) return; T.pip.cam = !T.pip.cam; if (!T.pip.cam && T.pip.big === 'cam') T.pip.big = null; setPips(); };
    $('#cJunc').onclick = function () { if (!T) return; T.pip.junc = !T.pip.junc; if (!T.pip.junc && T.pip.big === 'junc') T.pip.big = null; setPips(); };
    $('#cEvents').onclick = function () { if (!T) return; T.evOpen = !T.evOpen; $('#evSheet').classList.toggle('open', T.evOpen); if (T.evOpen) renderLog(); };
    $('#evClose').onclick = function () { if (T) T.evOpen = false; $('#evSheet').classList.remove('open'); };
    $$('.pip').forEach(function (p) { p.addEventListener('click', function (e) { if (!T || e.target.closest('.mini')) return; var k = p.id === 'pipCam' ? 'cam' : 'junc'; T.pip.big = T.pip.big === k ? null : k; setPips(); }); });
    $('#cVoice').onclick = function () { S.prof.voice = !S.prof.voice; saveProf(); this.textContent = S.prof.voice ? '🔊' : '🔇'; if (!S.prof.voice && window.speechSynthesis) speechSynthesis.cancel(); };
    $('#cSpeed').onclick = function () { if (!T || T.gps) return; var o = [1, 4, 8, 16], i = (o.indexOf(T.mult) + 1) % o.length; T.mult = o[i]; S.prof.mult = T.mult; saveProf(); this.textContent = T.mult + '×'; };
    $('#cEmg').onclick = function () { if (!T || T.gps) return; T.events.push({ s: T.D + 20, type: 'emg', len: 200, lead: 0, st: 0 }); T.events.sort(function (a, b) { return a.s - b.s; }); T.ei = 0; };
    $('#cNight').onclick = function () { if (!T) return; T.night = !T.night; Dash.setNight(T.night); Junction.setNight(T.night); this.textContent = T.night ? '☀' : '🌙'; pushAlert('info', T.night ? 'Night mode engaged' : 'Day mode', 'Detection profile updated across all cameras'); };
    $('#cReroute').onclick = function () { if (T) doReroute(false); };
    $('#cEnd').onclick = function () { if (T) ask('End this trip?', 'Your analytics so far will be saved.', 'End trip', function () { arrive(true); }); };
    $('#cDest').onclick = function () { if (!T || !tripMap) return; T.follow = false; $('#btnRecenter').classList.add('show'); var pp = posAt(T.route, T.s), pts = T.route.coords.filter(function (_, k) { return k % 6 === 0; }).concat([[pp.lat, pp.lng], T.route.coords[T.route.coords.length - 1]]); tripMap.fitBounds(pts, { paddingTopLeft: [30, 150], paddingBottomRight: [70, 130] }); toast('Whole route to destination'); };
    $('#btnRecenter').onclick = function () { if (T) { T.follow = true; this.classList.remove('show'); } };
    $('#btnSurge').onclick = function () { Junction.surge(); }; $('#btnJEmg').onclick = function () { Junction.emergency(); };
    $('#sumBody').addEventListener('click', function (e) {
      var tb = e.target.closest('#sumTabs button');
      if (tb) { $$('#sumTabs button').forEach(function (b) { b.classList.toggle('on', b === tb); }); $$('.sumpane').forEach(function (p) { p.classList.toggle('active', p.dataset.t === tb.dataset.t); }); $('#sumBody').scrollTop = 0; $$('.mfill').forEach(function (x) { x.style.width = x.dataset.w + '%'; }); $$('.vfill').forEach(function (x) { x.style.width = clamp(+x.dataset.w, 2, 100) + '%'; }); return; }
      var t = e.target.closest('[data-act]'); if (!t) return;
      if (t.dataset.act === 'rate' && curRec) {
        var n = +t.dataset.n; curRec.pax = n; var i = S.trips.findIndex(function (r) { return r.id === curRec.id; }); if (i >= 0) { S.trips[i].pax = n; store.set('dai_trips_' + uid(), S.trips); }
        $$('#rateBtns button').forEach(function (b, k) { b.classList.toggle('on', k < n); }); setTxt('#paxTxt', 'You rated this trip ' + n + ' ★'); toast('Thanks — rating saved');
      } else if (t.dataset.act === 'done') { if (sumBack === 'hist') show('sHistory'); else { T = null; resetPlan(); show('sPlan'); } }
    });
    $('#histBody').addEventListener('click', function (e) { var it = e.target.closest('.hitem'); if (!it) return; renderSummary(S.trips[+it.dataset.i], 'hist'); show('sSummary'); });
    $('#profBody').addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]'); if (!t) return;
      if (t.dataset.act === 'pveh') { S.prof.vehicle.type = t.dataset.v; saveProf(); renderProfile(); }
      else if (t.dataset.act === 'logout') logout();
      else if (t.dataset.act === 'clear') { ask('Delete all trips?', 'This clears saved trips on this device.', 'Delete', function () { S.trips = []; store.set('dai_trips_' + uid(), []); toast('Trip history cleared'); }); }
    });
    $('#profBody').addEventListener('change', function (e) {
      var k = e.target.dataset.k; if (!k) return; var p = S.prof;
      if (k === 'vname') p.vehicle.name = e.target.value.trim() || 'My car'; else if (k === 'vplate') p.vehicle.plate = e.target.value.trim().toUpperCase();
      else if (k === 'mult') p.mult = +e.target.value; else if (k === 'voice') p.voice = e.target.checked; else if (k === 'gps') { p.gps = e.target.checked; if (p.gps && !navigator.geolocation) { p.gps = false; e.target.checked = false; toast('GPS not available on this device'); } }
      else if (k === 'map') { p.map = e.target.value; if (S.planMap) setTiles(S.planMap); if (tripMap) setTiles(tripMap); }
      saveProf();
    });
    window.addEventListener('resize', function () { var tr = $('#sTrip'); if (tr && tr.classList.contains('active')) { document.body.classList.toggle('tripwide', isWide()); if (tripMap) setTimeout(function () { tripMap.invalidateSize(); }, 60); } });
    Dash.onEvent(function (type, msg) {
      if (!T || T.ended) return;
      if (type === 'lane') { T.stats.laneChanges++; pushAlert('lane', 'Lane change · overtaking', msg, 'Changing lane to overtake'); }
      else if (type === 'fcw') { T.stats.fcw++; pushAlert('hazard', 'Forward collision warning', msg, 'Collision warning. Brake'); }
      else if (type === 'return') pushAlert('info', 'Returning to lane', msg);
    });
  }
  function resetPlanKeep() { ['from', 'to'].forEach(function (f) { if (S.pm[f]) { S.pm[f].remove(); S.pm[f] = null; } }); S.from = S.to = null; S.routes = []; if (S.rl) S.rl.clearLayers(); }

  function init() {
    Dash.mount($('#camWrap')); Junction.mount($('#juncWrap'));
    bind(); setAuthMode('in');
    var go = function () { var ses = store.get('dai_session', null); if (ses && ses.email) { S.user = ses; loadProfile(); enterApp(); } else show('sLogin'); };
    seedDemo().then(go, go);
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  if (typeof L === 'undefined') { document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;display:grid;place-items:center;padding:30px;text-align:center;background:#0b0f14;color:#e8eef5;z-index:999">The map library could not load. Check your internet connection and reload.</div>'); }
  else init();
})();
