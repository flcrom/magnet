// Training: 24 directions (15 degree steps, 0 = top of screen, clockwise) on a ring of about 3 cm around the screen center.
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const room = (qs.get("c") || "PIXEL6A").toUpperCase();
  const N = 24, REC_MS = 1500;
  const SESSION = qs.get("s") || localStorage.getItem("train-sess") || ("s" + Date.now().toString(36));
  localStorage.setItem("train-sess", SESSION);
  const rot = (q, v) => { const [x, y, z, w] = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]; };
  // steps: 0 = zero (magnet far), 1..24 = directions, 25 = far check at the end
  const STEPS = N + 2;
  const st = { step: 0, m: null, q: [0, 0, 0, 1], t: 0, same: 0, rec: null, done: JSON.parse(localStorage.getItem("train-done-" + SESSION) || "{}") };
  const first = () => { for (let i = 0; i < STEPS; i++) if (!st.done[i]) return i; return STEPS; };
  st.step = first();
  const save = () => localStorage.setItem("train-done-" + SESSION, JSON.stringify(st.done));

  // ---- network (stream from the Termux sender via the relay) ----
  let ws, backoff = 500, conn = false;
  function connect() {
    ws = new WebSocket("wss://" + location.host + "/ws?role=mac&room=" + room);
    ws.onopen = () => { conn = true; backoff = 500; };
    ws.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type !== "s" || !Array.isArray(d.m)) return;
      const now = performance.now();
      if (st.m && d.m[0] === st.m[0] && d.m[1] === st.m[1] && d.m[2] === st.m[2]) st.same++; else st.same = 0;
      st.m = d.m; st.q = d.q || [0, 0, 0, 1]; st.t = now;
      if (st.rec && st.same < 15) st.rec.frames.push([Math.round(now - st.rec.t0), d.m.map((v) => +v.toFixed(3)), st.q.map((v) => +v.toFixed(5))]); };
    ws.onclose = () => { conn = false; setTimeout(connect, backoff = Math.min(backoff * 2, 5000)); };
  }
  connect();
  (async () => { try { await navigator.wakeLock.request("screen"); } catch {} })();
  const frozen = () => !st.m || performance.now() - st.t > 1500 || st.same >= 15;

  // ---- drawing ----
  const cv = $("c"), ctx = cv.getContext("2d");
  function size() { const d = Math.min(devicePixelRatio || 1, 3), r = cv.getBoundingClientRect(); cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
  addEventListener("resize", size); size();
  const ang = (i) => (i - 1) * (360 / N);
  function draw() {
    const r = cv.getBoundingClientRect(), W = r.width, H = r.height; ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.min(W * 0.455, H * 0.38 + 40);
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
    for (let i = 1; i <= N; i++) {
      const a = ang(i) * Math.PI / 180, x = cx + R * Math.sin(a), y = cy - R * Math.cos(a), cur = i === st.step;
      ctx.beginPath(); ctx.arc(x, y, cur ? 20 : st.done[i] ? 5 : 3, 0, 7);
      ctx.fillStyle = cur ? "#fff" : st.done[i] ? "#aaa" : "#444"; ctx.fill();
      if (cur) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.stroke(); }
    }
    if (st.rec) { const p = Math.min(1, (performance.now() - st.rec.t0) / REC_MS); ctx.fillStyle = "#fff"; ctx.fillRect(cx - 60, cy + 40, 120 * p, 3); ctx.strokeStyle = "#555"; ctx.strokeRect(cx - 60, cy + 40, 120, 3); }
    ctx.fillStyle = "#8a8a8a"; ctx.font = "12px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.fillText("top of screen", cx, cy - R - 38);
  }

  // ---- UI state ----
  function ui() {
    const s = st.step, n = Object.keys(st.done).length;
    $("prog").textContent = s >= STEPS ? "done" : s === 0 ? "step 0 / 24 - zero" : s === STEPS - 1 ? "far check" : "direction " + s + " / " + N + " (" + ang(s) + " deg)";
    const stt = $("status"); stt.textContent = !conn ? "offline" : frozen() ? "sensor frozen, waiting" : st.rec ? "recording" : "live"; stt.className = (!frozen() && conn) ? "on" : "off";
    let msg, label;
    if (s >= STEPS) { msg = "All " + n + " recordings saved. You can close this page."; label = "done"; }
    else if (s === 0) { msg = "Keep every magnet away from the phone (at least 50 cm). Lay it still, screen up. Then tap."; label = "Record baseline (magnet away)"; }
    else if (s === STEPS - 1) { msg = "Last one. Move the magnet far away again (50 cm+), phone still, then tap."; label = "Record far check"; }
    else { msg = "Touch the magnet to the glass on the white dot. Same face of the magnet toward the screen every time. Keep the phone flat and still. Then tap."; label = "Magnet is on the dot - record"; }
    if (st.rec) { msg = "Hold still..."; label = "recording"; }
    if (st.msg) msg = st.msg;
    $("msg").textContent = msg; $("ok").textContent = label;
    $("ok").disabled = s >= STEPS || !!st.rec || frozen() || !conn;
    $("back").disabled = !!st.rec || s <= 0; $("redo").disabled = !!st.rec || s >= STEPS || !st.done[s];
  }
  setInterval(ui, 200);
  (function loop() { draw(); requestAnimationFrame(loop); })();

  // ---- recording ----
  $("ok").onclick = () => {
    if (st.rec || frozen()) return;
    const step = st.step; st.msg = ""; st.rec = { step, t0: performance.now(), frames: [] };
    setTimeout(async () => {
      const rec = st.rec; st.rec = null;
      if (rec.frames.length < 20 || frozen()) { st.msg = "The sensor froze during that one (" + rec.frames.length + " frames). Waiting for it, then tap again."; return; }
      const body = { session: SESSION, step, angleDeg: step >= 1 && step <= N ? ang(step) : null, kind: step === 0 ? "baseline" : step === STEPS - 1 ? "far" : "dir", ringCm: +(Math.min(innerWidth * 0.455, 9999) / 64.3).toFixed(1),
        phone: "Pixel 6a", screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, ts: new Date().toISOString(), frames: rec.frames };
      try {
        const r = await fetch("/rec?room=" + room + "&idx=" + (SESSION + "-" + String(step).padStart(2, "0")).slice(-24), { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) throw new Error(r.status);
      } catch (e) { st.msg = "Upload failed (" + e.message + "). Tap again to retry."; return; }
      st.done[step] = true; save(); st.step = first(); st.msg = "";
    }, REC_MS);
  };
  $("back").onclick = () => { if (st.step > 0) { st.step = Math.min(st.step, STEPS) - 1; st.msg = ""; } };
  $("redo").onclick = () => { delete st.done[st.step]; save(); st.msg = ""; };
  $("reset").onclick = () => { if (confirm("Throw away this session and start over?")) { localStorage.removeItem("train-done-" + SESSION); localStorage.removeItem("train-sess"); location.reload(); } };
})();
