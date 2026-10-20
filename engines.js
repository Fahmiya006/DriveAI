/* DriveAI engines — adaptive junction + dashcam driver-assist.
   Ported from the console demo; the trip (app.js) drives these. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function setTxt(sel, v) { var e = $(sel); if (e) e.textContent = v; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowStr() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  /* ====================================================================
     JUNCTION — bird's-eye 4-way adaptive intersection
     ==================================================================== */
  var Junction = (function () {
    var jc = document.createElement('canvas'); jc.width = 600; jc.height = 600; var jx = jc.getContext('2d');
    var hud = document.createElement('div'); hud.className = 'feedhud';
    hud.innerHTML = '<div class="tl"><span class="rec"></span> JUNCTION-07</div>' +
      '<div class="phasepill" id="jPill">N–S GREEN</div>' +
      '<div class="tr">YOLOv8n · 24 FPS<br>4 approaches</div>' +
      '<div class="bl" id="jBl">vehicles: 0 · cleared 0</div>' +
      '<div class="egotag" id="jEgo">MY VEHICLE</div>' +
      '<div class="emgpill" id="jEmg">🚑 EMERGENCY PREEMPTION · GREEN CORRIDOR</div>';
    var JW = 600, JH = 600, CX = 300, CY = 300, ROADW = 66, EDGE = 40, night = false, jframe = 0, timer = null;
    var ARMS = ['N', 'S', 'E', 'W'], NAMES = { N: 'North', S: 'South', E: 'East', W: 'West' };
    var phase = 'NS', phaseT = 0, trans = null, MING = 4, MAXG = 11, YEL = 1.4, ALLRED = 0.6;
    var throughput = 0, thruWindow = [], waitSamples = [], decisions = [], jveh = [], ego = null, egoCd = 0, emv = null;
    var surge = { arm: null, t: 0 };

    function laneOff(l) { return l === 0 ? 12 : 33; }
    function isNS(a) { return a === 'N' || a === 'S'; }
    function lightColor(a) {
      if (trans) {
        var endingNS = (trans.from === 'NS'), ending = (endingNS && isNS(a)) || (!endingNS && !isNS(a));
        if (ending && trans.t < YEL) return 'yellow'; return 'red';
      }
      return ((phase === 'NS' && isNS(a)) || (phase === 'EW' && !isNS(a))) ? 'green' : 'red';
    }
    function greenFor(a) { return lightColor(a) === 'green'; }
    function demand() { var d = { N: 0, S: 0, E: 0, W: 0 }; jveh.forEach(function (v) { if (v.s < v.path.stopS - 2) d[v.path.arm]++; }); return d; }
    function logDecision(t) { decisions.unshift({ t: t, ts: nowStr() }); if (decisions.length > 5) decisions.pop(); }
    function startTrans() { trans = { from: phase, to: phase === 'NS' ? 'EW' : 'NS', t: 0 }; }
    function stepPhase(dt) {
      if (emv && !emv.entered) {
        var want = isNS(emv.path.arm) ? 'NS' : 'EW';
        if (trans) { trans.t += dt; if (trans.t >= YEL + ALLRED) { phase = trans.to; phaseT = 0; trans = null; } }
        else if (phase !== want) startTrans(); else phaseT = 0;
        return;
      }
      if (trans) { trans.t += dt; if (trans.t >= YEL + ALLRED) { phase = trans.to; phaseT = 0; trans = null; } return; }
      phaseT += dt;
      var d = demand(), cur = phase === 'NS' ? d.N + d.S : d.E + d.W, oth = phase === 'NS' ? d.E + d.W : d.N + d.S;
      if (phaseT >= MING) {
        if (phaseT >= MAXG) { logDecision('Max green reached · switching to ' + (phase === 'NS' ? 'E–W' : 'N–S')); startTrans(); }
        else if (oth > cur + 2) { logDecision('Demand shift → ' + (phase === 'NS' ? 'E–W' : 'N–S') + ' (' + oth + ' vs ' + cur + ' waiting)'); startTrans(); }
      }
    }
    var CLS = [
      { n: 'car', len: 26, w: 14, col: '#aab8c9', pr: .5 }, { n: 'car', len: 26, w: 14, col: '#9db4c9', pr: .5 },
      { n: 'auto', len: 19, w: 13, col: '#f6c445', pr: .2 }, { n: 'bike', len: 13, w: 7, col: '#d69a6a', pr: .15 },
      { n: 'bus', len: 46, w: 17, col: '#6fb3d6', pr: .08 }, { n: 'truck', len: 40, w: 16, col: '#8fa0b3', pr: .07 }
    ];
    function pickCls() { var r = Math.random(), a = 0; for (var i = 0; i < CLS.length; i++) { a += CLS[i].pr; if (r <= a) return CLS[i]; } return CLS[0]; }
    function buildPath(arm, lane, turn) {
      var o = laneOff(lane), S, SL, vertIn, OE, EX, x, y;
      if (arm === 'N') { x = CX + o; S = { x: x, y: -EDGE }; SL = { x: x, y: CY - ROADW }; vertIn = true; }
      else if (arm === 'S') { x = CX - o; S = { x: x, y: JH + EDGE }; SL = { x: x, y: CY + ROADW }; vertIn = true; }
      else if (arm === 'E') { y = CY - o; S = { x: JW + EDGE, y: y }; SL = { x: CX + ROADW, y: y }; vertIn = false; }
      else { y = CY + o; S = { x: -EDGE, y: y }; SL = { x: CX - ROADW, y: y }; vertIn = false; }
      if (turn === 'straight') {
        if (arm === 'N') { OE = { x: CX + o, y: CY + ROADW }; EX = { x: CX + o, y: JH + EDGE }; }
        else if (arm === 'S') { OE = { x: CX - o, y: CY - ROADW }; EX = { x: CX - o, y: -EDGE }; }
        else if (arm === 'E') { OE = { x: CX - ROADW, y: CY - o }; EX = { x: -EDGE, y: CY - o }; }
        else { OE = { x: CX + ROADW, y: CY + o }; EX = { x: JW + EDGE, y: CY + o }; }
      } else {
        if (arm === 'N') { OE = { x: CX + ROADW, y: CY + o }; EX = { x: JW + EDGE, y: CY + o }; }
        else if (arm === 'S') { OE = { x: CX - ROADW, y: CY - o }; EX = { x: -EDGE, y: CY - o }; }
        else if (arm === 'E') { OE = { x: CX + o, y: CY + ROADW }; EX = { x: CX + o, y: JH + EDGE }; }
        else { OE = { x: CX - o, y: CY - ROADW }; EX = { x: CX - o, y: -EDGE }; }
      }
      var pts = [S, SL];
      if (turn === 'straight') pts.push(OE);
      else { var ctrl = vertIn ? { x: SL.x, y: OE.y } : { x: OE.x, y: SL.y }; for (var i = 1; i <= 8; i++) { var t = i / 8; pts.push({ x: (1 - t) * (1 - t) * SL.x + 2 * (1 - t) * t * ctrl.x + t * t * OE.x, y: (1 - t) * (1 - t) * SL.y + 2 * (1 - t) * t * ctrl.y + t * t * OE.y }); } }
      pts.push(EX);
      var cum = [0]; for (var j = 1; j < pts.length; j++) cum[j] = cum[j - 1] + Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
      return { pts: pts, cum: cum, total: cum[cum.length - 1], stopS: cum[1], arm: arm, lane: lane, turn: turn };
    }
    function posAt(path, s) {
      var cum = path.cum, pts = path.pts;
      if (s <= 0) return { x: pts[0].x, y: pts[0].y, h: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) };
      for (var i = 1; i < pts.length; i++) {
        if (s <= cum[i]) { var seg = cum[i] - cum[i - 1] || 1, f = (s - cum[i - 1]) / seg; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f, h: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) }; }
      }
      var n = pts.length - 1; return { x: pts[n].x, y: pts[n].y, h: Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x) };
    }
    function spawnJ(arm) {
      var lane = Math.random() < 0.5 ? 0 : 1, turn = Math.random() < 0.72 ? 'straight' : 'left';
      for (var i = 0; i < jveh.length; i++) { var v = jveh[i]; if (v.path.arm === arm && v.path.lane === lane && v.s < 46) return; }
      jveh.push({ path: buildPath(arm, lane, turn), s: 0, speed: 40 + Math.random() * 20, vmax: 74 + Math.random() * 34, cls: pickCls(), conf: .85 + Math.random() * .13, entered: false, waited: 0 });
    }
    function spawnEmergency() {
      if (emv) return;
      var arm = ARMS[Math.floor(Math.random() * 4)], lane = Math.random() < 0.5 ? 0 : 1;
      emv = { path: buildPath(arm, lane, 'straight'), s: 0, speed: 60, vmax: 118, cls: { n: 'ambulance', len: 34, w: 15, col: '#f4f8ff' }, conf: .99, entered: false, waited: 0, emv: true };
      jveh.push(emv);
      logDecision('🚑 EMERGENCY PREEMPTION · green corridor for ' + NAMES[arm] + ' approach');
    }
    function spawnEgo() {
      var arm, lane, turn, ok = false;
      for (var tries = 0; tries < 10 && !ok; tries++) {
        arm = ARMS[Math.floor(Math.random() * 4)]; lane = Math.random() < 0.5 ? 0 : 1; ok = true;
        for (var i = 0; i < jveh.length; i++) { var v = jveh[i]; if (v.path.arm === arm && v.path.lane === lane && v.s < 60) { ok = false; break; } }
      }
      turn = Math.random() < 0.7 ? 'straight' : 'left';
      ego = { path: buildPath(arm, lane, turn), s: 0, speed: 44, vmax: 82, cls: { n: 'car', len: 27, w: 14, col: '#e9f2ff' }, conf: .97, entered: false, waited: 0, ego: true, shift: 0, shiftT: 0, shiftAxis: 'x', changing: false, braking: false };
      jveh.push(ego);
    }
    function leaderOf(v) {
      var best = null;
      for (var i = 0; i < jveh.length; i++) { var u = jveh[i]; if (u === v) continue; if (u.path.arm === v.path.arm && u.path.lane === v.path.lane && u.s > v.s && u.s - v.s < 70) { if (!best || u.s < best.s) best = u; } }
      return best;
    }
    function laneFreeJ(arm, lane, nearS) {
      for (var i = 0; i < jveh.length; i++) { var u = jveh[i]; if (u.path.arm === arm && u.path.lane === lane && Math.abs(u.s - nearS) < 40) return false; }
      return true;
    }
    function tryEgoLaneChange(v, ld) {
      if (v.entered || v.s > v.path.stopS - 12 || v.shiftT > 0) return;
      if (!ld || (ld.s - v.s) > 54 || ld.speed > v.vmax * 0.62) return;
      var arm = v.path.arm, other = v.path.lane === 0 ? 1 : 0;
      if (!laneFreeJ(arm, other, v.s)) return;
      var before = posAt(v.path, v.s); v.path = buildPath(arm, other, v.path.turn); var after = posAt(v.path, v.s);
      if (arm === 'N' || arm === 'S') { v.shiftAxis = 'x'; v.shift = before.x - after.x; } else { v.shiftAxis = 'y'; v.shift = before.y - after.y; }
      v.shiftT = 1.4; v.changing = true;
    }
    function stepJunction(dt) {
      stepPhase(dt);
      var speedScale = night ? 0.9 : 1;
      for (var i = jveh.length - 1; i >= 0; i--) {
        var v = jveh[i], p = v.path, lim = p.total;
        var redStop = (!v.entered && p.stopS > v.s && !greenFor(p.arm));
        if (redStop) lim = Math.min(lim, p.stopS - 2);
        var ld = leaderOf(v);
        if (v.ego) tryEgoLaneChange(v, ld);
        ld = leaderOf(v); p = v.path;
        var leaderLim = ld ? ld.s - (ld.cls.len * 0.5 + v.cls.len * 0.5 + 6) : Infinity;
        if (ld) lim = Math.min(lim, leaderLim);
        var newS = v.s + v.speed * dt * speedScale;
        if (newS > lim) { newS = Math.max(v.s, lim); v.speed *= 0.55; if (!v.entered && v.s < p.stopS - 1) v.waited += dt; if (v.ego) v.braking = (leaderLim <= v.s + 1 && !redStop); }
        else { v.speed += (v.vmax - v.speed) * 0.07; if (v.ego) v.braking = false; }
        if (v.ego) { if (v.shiftT > 0) v.shiftT -= dt; if (v.shift) v.shift *= 0.82; if (Math.abs(v.shift) < 0.4) { v.shift = 0; v.changing = false; } }
        v.s = newS; if (v.s >= p.stopS - 1) v.entered = true;
        if (v.s >= p.total - 1) {
          throughput++; thruWindow.push(performance.now());
          if (v.waited > 0.2) waitSamples.push(v.waited); if (waitSamples.length > 40) waitSamples.shift();
          if (v.ego) { ego = null; egoCd = 3; }
          if (v.emv) { emv = null; logDecision('Emergency cleared · resuming adaptive control'); }
          jveh.splice(i, 1);
        }
      }
      var cut = performance.now() - 60000; while (thruWindow.length && thruWindow[0] < cut) thruWindow.shift();
    }
    function tickSpawn() {
      ARMS.forEach(function (a) { var pr = surge.arm === a ? 0.95 : 0.55; if (Math.random() < pr && jveh.length < 28) spawnJ(a); });
      if (surge.arm) { surge.t--; if (surge.t <= 0) surge.arm = null; }
      if (!ego) { if (egoCd > 0) egoCd--; else spawnEgo(); }
    }
    function doSurge() { var a = ARMS[Math.floor(Math.random() * 4)]; surge = { arm: a, t: 14 }; logDecision('Surge injected on ' + NAMES[a] + ' approach'); }

    function drawSig(px, py, arm) {
      var c = lightColor(arm), col = { green: '#3ed99a', yellow: '#f6b846', red: '#fb5a72' }[c];
      jx.fillStyle = '#0b0e12'; jx.strokeStyle = '#2a323d'; jx.lineWidth = 1; jx.fillRect(px - 7, py - 16, 14, 32); jx.strokeRect(px - 7, py - 16, 14, 32);
      ['red', 'yellow', 'green'].forEach(function (s, i) {
        var cy = py - 16 + 8 + i * 9; jx.beginPath(); jx.arc(px, cy, 3.4, 0, 7); jx.fillStyle = (s === c) ? col : '#20242b'; jx.fill();
        if (s === c) { jx.shadowColor = col; jx.shadowBlur = 8; jx.fill(); jx.shadowBlur = 0; }
      });
      jx.font = '600 9px "IBM Plex Mono",monospace'; jx.fillStyle = col; jx.fillText(arm, px - 3, py + 27);
    }
    function drawCorridor() {
      var pts = emv.path.pts; jx.save(); jx.strokeStyle = 'rgba(62,217,154,.22)'; jx.lineWidth = laneOff(1) * 2.1; jx.lineCap = 'round'; jx.lineJoin = 'round';
      var pp = posAt(emv.path, emv.s);
      jx.beginPath(); jx.moveTo(pp.x, pp.y); for (var i = 0; i < pts.length; i++) { if (emv.path.cum[i] < emv.s) continue; jx.lineTo(pts[i].x, pts[i].y); } jx.stroke();
      jx.strokeStyle = 'rgba(62,217,154,.6)'; jx.lineWidth = 2; jx.setLineDash([9, 8]); jx.lineDashOffset = -(jframe * 0.9);
      jx.beginPath(); jx.moveTo(pp.x, pp.y); for (var j = 0; j < pts.length; j++) { if (emv.path.cum[j] < emv.s) continue; jx.lineTo(pts[j].x, pts[j].y); } jx.stroke(); jx.setLineDash([]); jx.restore();
    }
    function drawEgoPath() {
      var pts = ego.path.pts, cum = ego.path.cum; jx.save(); jx.strokeStyle = 'rgba(183,148,246,.55)'; jx.lineWidth = 3; jx.setLineDash([7, 7]); jx.lineDashOffset = -(jframe * 0.6);
      jx.beginPath(); var started = false;
      for (var i = 0; i < pts.length; i++) { if (cum[i] < ego.s - 4) continue; if (!started) { var pp = posAt(ego.path, ego.s); jx.moveTo(pp.x, pp.y); started = true; } jx.lineTo(pts[i].x, pts[i].y); }
      jx.stroke(); jx.setLineDash([]); jx.restore();
    }
    function drawVeh(v) {
      var p = posAt(v.path, v.s), len = v.cls.len, w = v.cls.w;
      if (v.ego && v.shift) { if (v.shiftAxis === 'x') p.x += v.shift; else p.y += v.shift; }
      if (v.emv) { var bl = Math.floor(jframe / 6) % 2; jx.beginPath(); jx.arc(p.x, p.y, len * 0.95, 0, 7); jx.fillStyle = bl ? 'rgba(255,77,106,.18)' : 'rgba(77,155,255,.18)'; jx.fill(); }
      if (v.ego) { var pr = (Math.sin(jframe * 0.12) * 0.5 + 0.5), rad = len * 0.9 + pr * 4; jx.beginPath(); jx.arc(p.x, p.y, rad, 0, 7); jx.fillStyle = 'rgba(183,148,246,' + (0.12 + pr * 0.12) + ')'; jx.fill(); jx.beginPath(); jx.arc(p.x, p.y, rad, 0, 7); jx.strokeStyle = 'rgba(183,148,246,' + (0.5 + pr * 0.4) + ')'; jx.lineWidth = 2; jx.stroke(); }
      jx.save(); jx.translate(p.x, p.y); jx.rotate(p.h);
      jx.fillStyle = v.cls.col; jx.fillRect(-len / 2, -w / 2, len, w);
      if (v.emv) {
        jx.fillStyle = '#e23b4e'; jx.fillRect(-len / 2, -w / 2, len * 0.16, w); jx.fillRect(-2.5, -w * 0.3, 5, w * 0.6); jx.fillRect(-w * 0.3, -2.5, w * 0.6, 5);
        var fb = Math.floor(jframe / 6) % 2; jx.fillStyle = fb ? '#ff4d6a' : '#4d9bff'; jx.shadowColor = jx.fillStyle; jx.shadowBlur = 8; jx.fillRect(len * 0.18, -w / 2 - 2, 4, w); jx.shadowBlur = 0;
      }
      if (v.ego) { jx.strokeStyle = '#b794f6'; jx.lineWidth = 2; jx.strokeRect(-len / 2, -w / 2, len, w); }
      jx.fillStyle = v.ego ? 'rgba(80,40,120,.55)' : v.emv ? 'rgba(30,60,120,.4)' : 'rgba(10,16,22,.5)'; jx.fillRect(len / 2 - len * 0.28, -w / 2 + 1.5, len * 0.16, w - 3);
      if (v.ego && v.braking) { jx.fillStyle = '#ff5566'; jx.shadowColor = '#ff2244'; jx.shadowBlur = 6; jx.fillRect(-len / 2, -w / 2 + 1, 2.5, 3); jx.fillRect(-len / 2, w / 2 - 4, 2.5, 3); jx.shadowBlur = 0; }
      if (night) { jx.fillStyle = 'rgba(255,240,180,.85)'; jx.fillRect(len / 2 - 1, -w / 2 + 1, 2, 2.5); jx.fillRect(len / 2 - 1, w / 2 - 3.5, 2, 2.5); }
      jx.restore();
      var hx = Math.abs(Math.cos(p.h)) * len / 2 + Math.abs(Math.sin(p.h)) * w / 2, hy = Math.abs(Math.sin(p.h)) * len / 2 + Math.abs(Math.cos(p.h)) * w / 2;
      var risk = (!v.entered && v.s > v.path.stopS - 2 && v.speed < 8), bc = v.emv ? '#ff5570' : v.ego ? '#b794f6' : (risk ? '#f6b846' : '#22d3ee');
      jx.strokeStyle = bc; jx.lineWidth = (v.ego || v.emv) ? 1.8 : 1.3; jx.strokeRect(p.x - hx - 2, p.y - hy - 2, (hx + 2) * 2, (hy + 2) * 2);
      jx.font = '600 9px "IBM Plex Mono",monospace';
      var lbl = v.emv ? 'AMBULANCE ' + v.conf.toFixed(2) : v.ego ? 'MY VEHICLE' : v.cls.n + ' ' + v.conf.toFixed(2), tw = jx.measureText(lbl).width + 6;
      jx.fillStyle = bc; jx.fillRect(p.x - hx - 2, p.y - hy - 14, tw, 12); jx.fillStyle = v.ego ? '#160c22' : (v.emv ? '#2a0a10' : '#06090d'); jx.fillText(lbl, p.x - hx + 1, p.y - hy - 4.5);
      if (v.emv) { jx.font = '700 8px "Space Grotesk",sans-serif'; jx.fillStyle = '#ff7088'; jx.fillText('◈ PRIORITY', p.x - hx - 2, p.y + hy + 13); }
      else if (v.ego) { jx.font = '700 8px "Space Grotesk",sans-serif'; jx.fillStyle = v.braking ? '#ff5566' : '#b794f6'; jx.fillText(v.changing ? '⇆ LANE CHANGE' : v.braking ? '▐ BRAKING' : '● TRACKED', p.x - hx - 2, p.y + hy + 13); }
    }
    function drawJunction() {
      var x = jx;
      x.fillStyle = night ? '#0a0d12' : '#0f151b'; x.fillRect(0, 0, JW, JH);
      x.fillStyle = night ? '#151a20' : '#1b222b'; x.fillRect(CX - ROADW, 0, ROADW * 2, JH); x.fillRect(0, CY - ROADW, JW, ROADW * 2);
      x.strokeStyle = 'rgba(90,160,255,.045)'; x.lineWidth = 1;
      for (var g = 0; g < JW; g += 40) { x.beginPath(); x.moveTo(g, 0); x.lineTo(g, JH); x.stroke(); x.beginPath(); x.moveTo(0, g); x.lineTo(JW, g); x.stroke(); }
      x.strokeStyle = 'rgba(240,200,90,.55)'; x.lineWidth = 2; x.setLineDash([12, 10]);
      x.beginPath(); x.moveTo(CX, 0); x.lineTo(CX, CY - ROADW); x.moveTo(CX, CY + ROADW); x.lineTo(CX, JH); x.moveTo(0, CY); x.lineTo(CX - ROADW, CY); x.moveTo(CX + ROADW, CY); x.lineTo(JW, CY); x.stroke();
      x.strokeStyle = 'rgba(230,238,245,.35)'; x.lineWidth = 1.4; x.setLineDash([10, 12]);
      [CX - 22, CX + 22].forEach(function (px) { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, CY - ROADW); x.moveTo(px, CY + ROADW); x.lineTo(px, JH); x.stroke(); });
      [CY - 22, CY + 22].forEach(function (py) { x.beginPath(); x.moveTo(0, py); x.lineTo(CX - ROADW, py); x.moveTo(CX + ROADW, py); x.lineTo(JW, py); x.stroke(); });
      x.setLineDash([]);
      x.fillStyle = 'rgba(230,238,245,.8)';
      x.fillRect(CX, CY - ROADW - 4, ROADW, 4); x.fillRect(CX - ROADW, CY + ROADW, ROADW, 4); x.fillRect(CX + ROADW, CY - ROADW, 4, ROADW); x.fillRect(CX - ROADW - 4, CY, 4, ROADW);
      x.fillStyle = 'rgba(230,238,245,.5)';
      for (var z = 0; z < ROADW; z += 10) { x.fillRect(CX + z, CY - ROADW - 16, 6, 10); x.fillRect(CX - ROADW + z, CY + ROADW + 6, 6, 10); }
      for (var z2 = 0; z2 < ROADW; z2 += 10) { x.fillRect(CX + ROADW + 6, CY - ROADW + z2, 10, 6); x.fillRect(CX - ROADW - 16, CY + z2, 10, 6); }
      drawSig(CX + ROADW + 16, CY - ROADW - 16, 'N'); drawSig(CX - ROADW - 16, CY + ROADW + 16, 'S'); drawSig(CX + ROADW + 16, CY + ROADW + 16, 'E'); drawSig(CX - ROADW - 16, CY - ROADW - 16, 'W');
      if (ego) drawEgoPath();
      if (emv && !emv.entered) drawCorridor();
      jveh.slice().sort(function (a, b) { return (a.emv ? 2 : a.ego ? 1 : 0) - (b.emv ? 2 : b.ego ? 1 : 0) || a.s - b.s; }).forEach(drawVeh);
      jframe++;
      var st = '—';
      if (ego) { if (ego.changing) st = 'CHANGING LANE'; else if (ego.braking) st = 'BRAKING'; else if (ego.s >= ego.path.stopS - 1) st = 'CROSSING'; else if (ego.speed < 8 && ego.s > ego.path.stopS - 40) st = 'WAITING AT SIGNAL'; else st = 'APPROACHING'; st += ' · from ' + NAMES[ego.path.arm]; }
      setTxt('#jEgo', 'MY VEHICLE · ' + st);
      var ep = $('#jEmg'); if (ep) ep.className = 'emgpill' + (emv && !emv.entered ? ' show' : '');
    }
    function renderPanel(el) {
      var d = demand(), maxq = Math.max(6, d.N, d.S, d.E, d.W), h = '<div class="approaches">';
      ['N', 'S', 'E', 'W'].forEach(function (a) {
        var lc = lightColor(a), col = { green: '#3ed99a', yellow: '#f6b846', red: '#fb5a72' }[lc];
        h += '<div class="appr' + (lc === 'green' ? ' green' : '') + '"><div class="at"><span><span class="adot" style="background:' + col + '"></span>' + NAMES[a] + '</span><span class="chip" style="color:' + col + ';border:1px solid ' + col + '44;background:' + col + '18">' + lc.toUpperCase() + '</span></div><div class="aq">' + d[a] + ' <span style="font-size:11px;color:var(--muted)">waiting</span></div><div class="aqb"><i style="width:' + Math.min(100, d[a] / maxq * 100) + '%;background:' + col + '"></i></div></div>';
      });
      h += '</div>';
      var aw = waitSamples.length ? waitSamples.reduce(function (x, y) { return x + y; }, 0) / waitSamples.length : 0;
      h += '<div class="jstats"><span>Cleared <b>' + throughput + '</b></span><span>Avg wait <b>' + aw.toFixed(1) + 's</b></span><span>Mode <b style="color:var(--ok)">ADAPTIVE</b></span></div><div class="declog">';
      decisions.forEach(function (x) { h += '<div class="decrow"><b>' + x.ts + '</b> · ' + x.t + '</div>'; });
      h += '</div>';
      el.innerHTML = h;
      var phaseName = trans ? 'SWITCHING' : (phase === 'NS' ? 'N–S GREEN' : 'E–W GREEN');
      var jp = $('#jPill'); if (jp) { jp.textContent = phaseName; jp.style.color = trans ? '#f6b846' : '#3ed99a'; jp.style.borderColor = (trans ? '#f6b846' : '#3ed99a') + '66'; jp.style.background = (trans ? '#f6b846' : '#3ed99a') + '18'; }
      setTxt('#jBl', 'vehicles: ' + jveh.length + ' · cleared ' + throughput);
    }
    function start() { if (timer) return; if (!jveh.length) { ARMS.forEach(function (a) { spawnJ(a); }); spawnEgo(); } timer = setInterval(tickSpawn, 700); }
    function stop() { clearInterval(timer); timer = null; }
    return {
      mount: function (el) { el.appendChild(jc); el.appendChild(hud); }, start: start, stop: stop, step: stepJunction, draw: drawJunction,
      setNight: function (b) { night = b; }, surge: doSurge, emergency: spawnEmergency, panel: renderPanel
    };
  })();

  /* ====================================================================
     DASHCAM — forward-facing driver assist (lane change, FCW, signals)
     ==================================================================== */
  var Dash = (function () {
    var cbEvent = function () {};
    var dc = document.createElement('canvas'); dc.width = 780; dc.height = 440; var dx = dc.getContext('2d');
    var hud = document.createElement('div'); hud.className = 'feedhud';
    hud.innerHTML = '<div class="tl"><span class="rec"></span> CAM-01</div><div class="tr">YOLOv8n · 24 FPS<br>conf ≥ 0.45</div><div class="bl" id="dBl">objects: 0 · lane 2</div><div class="br"><b id="dSpd">0</b> km/h</div><div class="banner" id="banner"><span id="bTitle">FORWARD COLLISION</span><small id="bSub">BRAKE</small></div>';
    var DW = 780, DH = 440, DVX = 390, DHZ = 150, DLANES = 3;
    var night = false, ext = 1, timer = null;
    var egoLane = 1, egoTarget = 1, egoState = 'cruise', laneCd = 0, dflow = 1, dflowT = 1, dvehs = [], dsignal = null, dped = null, ddash = 0, dframe = 0, fcwOn = false;
    function dLaneSp(t) { return 5 + t * 140; }
    function dYAt(t) { return DHZ + (DH - DHZ) * Math.pow(t, 1.7); }
    function dSX(t, L) { return DVX + (L - egoLane) * dLaneSp(t); }
    var DCLS = [{ n: 'car', w: .9 }, { n: 'car', w: .9 }, { n: 'truck', w: 1.3 }, { n: 'auto', w: .72 }, { n: 'bike', w: .5 }];
    function dspawn(lane, slow, t0, spd) {
      var c = DCLS[Math.floor(Math.random() * DCLS.length)];
      dvehs.push({ lane: lane, t: t0 || 0.02, cls: c, conf: .86 + Math.random() * .12, speed: spd || ((slow ? 0.0011 : 0.0018) + Math.random() * 0.0009) });
    }
    function dLaneFree(L, nt) { if (L < 0 || L >= DLANES) return false; for (var i = 0; i < dvehs.length; i++) { if (dvehs[i].lane === L && Math.abs(dvehs[i].t - nt) < 0.24) return false; } return true; }
    function dFindLead() { var ei = Math.round(egoLane), ld = null; for (var i = 0; i < dvehs.length; i++) { var v = dvehs[i]; if (v.lane === ei && v.t > 0.15 && v.t < 0.97) { if (!ld || v.t > ld.t) ld = v; } } return ld; }
    function showBanner(cls, t, s) { var b = $('#banner'); if (!b) return; b.className = 'banner show ' + cls; setTxt('#bTitle', t); setTxt('#bSub', s); }
    function hideBanner(cls) { var b = $('#banner'); if (b && (!cls || b.classList.contains(cls))) b.className = 'banner'; }
    function updateEgo(dt) {
      laneCd -= dt; egoLane += (egoTarget - egoLane) * 0.06;
      if (Math.abs(egoTarget - egoLane) < 0.02) { egoLane = egoTarget; if (egoState === 'changing') { egoState = 'cruise'; setTxt('#sfLane', 'LANE ' + (egoTarget + 1)); } }
      var ei = Math.round(egoLane), ld = dFindLead();
      if (egoState === 'cruise' && laneCd <= 0) {
        if (ld && ld.t > 0.52) {
          var cands = [ei - 1, ei + 1].filter(function (L) { return L >= 0 && L < DLANES && dLaneFree(L, ld.t); });
          if (cands.length) {
            egoTarget = cands[0]; egoState = 'changing'; laneCd = 2.6; dflowT = 1; fcwOn = false;
            cbEvent('lane', 'Overtaking slow vehicle → lane ' + (egoTarget + 1));
            showBanner('change', 'LANE CHANGE', 'OVERTAKING SLOW VEHICLE'); setTimeout(function () { hideBanner('change'); }, 1600);
          } else if (ld.t > 0.8) {
            ld._risk = true; dflowT = 0.15;
            var m = Math.max(1.2, (1 - ld.t) * 38 + 2).toFixed(1);
            if (!fcwOn) { fcwOn = true; cbEvent('fcw', m + ' m · no free lane · emergency braking'); }
            showBanner('fcw', 'FORWARD COLLISION', m + ' m · BRAKE');
          }
        } else {
          if (fcwOn) { fcwOn = false; hideBanner('fcw'); }
          if (ei !== 1 && laneCd <= 0 && dLaneFree(1, 0.6)) { egoTarget = 1; egoState = 'changing'; laneCd = 2.4; cbEvent('return', 'Overtake complete · settling into lane 2'); }
          if (dflowT < 1) dflowT = 1;
        }
      }
      if (ld) ld._risk = ld.lane === ei && ld.t > 0.8 && dflowT < 0.5;
      dflow += (dflowT - dflow) * 0.08;
    }
    function drawRoad() {
      var g = dx.createLinearGradient(0, 0, 0, DH);
      if (night) { g.addColorStop(0, '#080b12'); g.addColorStop(.34, '#0a0e16'); g.addColorStop(1, '#0e131c'); } else { g.addColorStop(0, '#1b2735'); g.addColorStop(.34, '#141b26'); g.addColorStop(1, '#0d1219'); }
      dx.fillStyle = g; dx.fillRect(0, 0, DW, DH);
      dx.beginPath(); dx.moveTo(dSX(0, -0.6), DHZ); dx.lineTo(dSX(0, DLANES - 0.4), DHZ); dx.lineTo(dSX(1, DLANES - 0.4), DH); dx.lineTo(dSX(1, -0.6), DH); dx.closePath(); dx.fillStyle = night ? '#0c0f14' : '#171c24'; dx.fill();
      dx.strokeStyle = night ? 'rgba(167,139,250,.5)' : 'rgba(167,139,250,.72)'; dx.lineWidth = 2;
      [-0.5, DLANES - 0.5].forEach(function (L) { dx.beginPath(); dx.moveTo(dSX(0, L), DHZ); dx.lineTo(dSX(1, L), DH); dx.stroke(); });
      for (var L = 0.5; L < DLANES - 0.5; L++) {
        for (var k = 0; k < 10; k++) {
          var t1 = ((k / 10) + ddash) % 1, t2 = Math.min(t1 + 0.05, 1), w = 2 + t1 * 8, y1 = dYAt(t1), y2 = dYAt(t2), x1 = dSX(t1, L), x2 = dSX(t2, L);
          dx.fillStyle = 'rgba(230,238,245,' + (0.22 + t1 * 0.5) + ')'; dx.beginPath(); dx.moveTo(x1 - w / 2, y1); dx.lineTo(x1 + w / 2, y1); dx.lineTo(x2 + w * 0.7 / 2, y2); dx.lineTo(x2 - w * 0.7 / 2, y2); dx.fill();
        }
      }
    }
    function dBox(x, y, w, h, color, label, conf, extra) {
      dx.strokeStyle = color; dx.lineWidth = 1.6; dx.strokeRect(x - w / 2, y - h, w, h);
      var c = Math.min(8, w / 3); dx.lineWidth = 2.4; dx.beginPath(); dx.moveTo(x - w / 2, y - h + c); dx.lineTo(x - w / 2, y - h); dx.lineTo(x - w / 2 + c, y - h); dx.moveTo(x + w / 2 - c, y - h); dx.lineTo(x + w / 2, y - h); dx.lineTo(x + w / 2, y - h + c); dx.stroke();
      if (w > 24) { var txt = label + ' ' + conf.toFixed(2) + (extra || ''); dx.font = '600 10px "IBM Plex Mono",monospace'; var tw = dx.measureText(txt).width + 8; dx.fillStyle = color; dx.fillRect(x - w / 2, y - h - 13, tw, 13); dx.fillStyle = '#06090d'; dx.fillText(txt, x - w / 2 + 4, y - h - 3.5); }
    }
    function drawSignal() {
      if (!dsignal) return;
      var t = dsignal.t, x = dSX(t, 1), poleY = dYAt(t), size = 8 + t * 40, boxY = poleY - size * 2.6;
      dx.strokeStyle = night ? '#3a4350' : '#4a5563'; dx.lineWidth = Math.max(1, size * 0.12); dx.beginPath(); dx.moveTo(x, poleY); dx.lineTo(x, boxY); dx.stroke();
      var hw = size * 0.5, hh = size * 1.5; dx.fillStyle = '#0c0f13'; dx.fillRect(x - hw / 2, boxY - hh, hw, hh);
      var cols = { red: '#fb5a72', yellow: '#f6b846', green: '#3ed99a' };
      ['red', 'yellow', 'green'].forEach(function (s, i) {
        var cy = boxY - hh + hh * (i + 0.5) / 3, r = hw * 0.32; dx.beginPath(); dx.arc(x, cy, r, 0, 7); dx.fillStyle = (s === dsignal.state) ? cols[s] : '#20242b'; dx.fill();
        if (s === dsignal.state) { dx.shadowColor = cols[s]; dx.shadowBlur = size * 0.4; dx.fill(); dx.shadowBlur = 0; }
      });
      if (size > 16) dBox(x, boxY, hw * 1.5, hh * 1.15, '#3ed99a', 'traffic light', dsignal.conf, ' · ' + dsignal.state.toUpperCase());
    }
    function drawVeh(v) {
      var t = v.t, y = dYAt(t), x = dSX(t, v.lane), base = dLaneSp(t) * 0.72 * v.cls.w, w = Math.max(5, base), h = w * 0.82, risk = v._risk, col = risk ? '#fb5a72' : '#22d3ee';
      dx.fillStyle = risk ? 'rgba(251,90,114,.2)' : 'rgba(34,211,238,.14)'; dx.fillRect(x - w / 2, y - h, w, h);
      if (night) { dx.fillStyle = 'rgba(255,240,180,.9)'; dx.beginPath(); dx.arc(x - w * 0.28, y - h * 0.32, Math.max(1, w * 0.06), 0, 7); dx.arc(x + w * 0.28, y - h * 0.32, Math.max(1, w * 0.06), 0, 7); dx.fill(); }
      var ex = (v.lane === Math.round(egoLane) && t > 0.45 && w > 26) ? ' · ' + ((1 - t) * 38 + 2).toFixed(0) + 'm' : '';
      dBox(x, y, w, h, col, v.cls.n, v.conf, ex);
    }
    function drawPed() { if (!dped) return; var t = dped.t, y = dYAt(t), x = dSX(t, -0.4) + dped.px, w = 10 + t * 22, h = w * 2.3; dx.fillStyle = 'rgba(246,184,70,.18)'; dx.fillRect(x - w / 2, y - h, w, h); dBox(x, y, w, h, '#f6b846', 'person', dped.conf); }
    function step(dt) {
      updateEgo(dt);
      var flow = dflow * ext;
      ddash = (ddash + 0.012 * flow) % 1;
      dvehs.forEach(function (v) { v.t += v.speed * 1.15 * flow; });
      dvehs = dvehs.filter(function (v) { return v.t < 1.06; });
      if (dped) { dped.px += 0.9 * Math.max(0.2, flow); if (dped.px > dLaneSp(dped.t) * 3.2 + 40) dped = null; }
      dvehs.sort(function (a, b) { return a.t - b.t; });
    }
    function draw() {
      drawRoad(); if (dsignal && dsignal.t < 0.5) drawSignal(); dvehs.forEach(drawVeh); if (dsignal && dsignal.t >= 0.5) drawSignal(); if (dped) drawPed();
      setTxt('#dBl', 'objects: ' + (dvehs.length + (dped ? 1 : 0) + (dsignal ? 1 : 0)) + ' · lane ' + (Math.round(egoLane) + 1) + (night ? ' · IR' : ''));
      dframe++;
    }
    function start() {
      if (timer) return;
      if (!dvehs.length) { dspawn(0); dspawn(2); dspawn(1, true); }
      timer = setInterval(function () { if (dvehs.length < 6) dspawn([0, 1, 2][Math.floor(Math.random() * 3)], Math.random() < 0.4); }, 1800);
    }
    function stop() { clearInterval(timer); timer = null; }
    function reset() { dvehs = []; dsignal = null; dped = null; egoLane = egoTarget = 1; egoState = 'cruise'; laneCd = 0; dflow = dflowT = 1; fcwOn = false; hideBanner(); }
    return {
      mount: function (el) { el.appendChild(dc); el.appendChild(hud); }, start: start, stop: stop, step: step, draw: draw, reset: reset,
      setNight: function (b) { night = b; }, setExt: function (f) { ext = f; },
      setSignal: function (state, t) { if (state == null) { dsignal = null; return; } dsignal = { t: t, state: state, conf: .95 }; },
      pedestrian: function () { if (!dped) dped = { t: 0.36 + Math.random() * 0.08, px: 0, conf: .8 + Math.random() * .14 }; },
      slowLead: function () { dspawn(Math.round(egoLane), true, 0.2, 0.0007); },
      fcw: function () { return fcwOn && dflowT < 0.5; },
      banner: showBanner, hideBanner: hideBanner, setSpeed: function (k) { setTxt('#dSpd', k); },
      onEvent: function (f) { cbEvent = f; }
    };
  })();

  window.Junction = Junction;
  window.Dash = Dash;
})();
