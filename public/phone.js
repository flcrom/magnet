// Phone side: read magnetometer (uT, device frame) + gyro-based relative orientation, stream to the Mac page.
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const saved = (qs.get("c") || localStorage.getItem("magnet-room-phone") || "").toUpperCase();
  $("code").value = saved;
  const msg = (t) => { $("msg").textContent = t; };
  let m = null, q = null, magSrc = "none", oriSrc = "none", ws, sent = 0, lastRate = performance.now(), wake;

  const eulerToQ = (a, b, g) => { // deviceorientation alpha,beta,gamma (deg) -> quaternion [x,y,z,w] (W3C Z-X'-Y'' order)
    const r = Math.PI / 180, x = b * r / 2, y = g * r / 2, z = a * r / 2;
    const cX = Math.cos(x), sX = Math.sin(x), cY = Math.cos(y), sY = Math.sin(y), cZ = Math.cos(z), sZ = Math.sin(z);
    return [sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ, cX * cY * cZ - sX * sY * sZ];
  };

  async function startSensors() {
    // permission prompts (Chrome grants these silently; Safari-style APIs ask)
    for (const n of ["magnetometer", "gyroscope", "accelerometer"]) { try { await navigator.permissions.query({ name: n }); } catch {} }
    try {
      if (typeof Magnetometer === "function") {
        const s = new Magnetometer({ frequency: 30, referenceFrame: "device" });
        s.addEventListener("reading", () => { m = [s.x, s.y, s.z]; magSrc = "Magnetometer API"; });
        s.addEventListener("error", (e) => { magSrc = "error: " + e.error.name; });
        s.start();
      } else if (typeof UncalibratedMagnetometer === "function") {
        const s = new UncalibratedMagnetometer({ frequency: 30 });
        s.addEventListener("reading", () => { m = [s.x - (s.xBias || 0), s.y - (s.yBias || 0), s.z - (s.zBias || 0)]; magSrc = "UncalibratedMagnetometer"; });
        s.start();
      } else magSrc = "not available";
    } catch (e) { magSrc = "blocked: " + e.name; }
    try {
      if (typeof RelativeOrientationSensor === "function") {
        const s = new RelativeOrientationSensor({ frequency: 30, referenceFrame: "device" });
        s.addEventListener("reading", () => { q = s.quaternion; oriSrc = "gyro (relative)"; });
        s.addEventListener("error", () => { oriSrc = "error"; });
        s.start();
      }
    } catch (e) {}
    if (oriSrc === "none") { // fallback: deviceorientation (non-absolute)
      try { if (typeof DeviceOrientationEvent.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch {}
      addEventListener("deviceorientation", (e) => { if (e.alpha == null) return; q = eulerToQ(e.alpha, e.beta, e.gamma); oriSrc = "deviceorientation"; });
    }
  }

  function connect(room) {
    ws = new WebSocket("wss://" + location.host + "/ws?role=phone&room=" + room);
    ws.onopen = () => { $("link").textContent = "connected"; };
    ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === "presence") $("link").textContent = d.mac ? "mac connected" : "waiting for mac"; } catch {} };
    ws.onclose = () => { $("link").textContent = "reconnecting"; setTimeout(() => connect(room), 1000); };
  }

  $("go").onclick = async () => {
    const room = $("code").value.trim().toUpperCase();
    if (room.length < 4) return msg("enter the code from the Mac page");
    localStorage.setItem("magnet-room-phone", room);
    $("go").disabled = true; $("stats").style.display = "block";
    try { wake = await navigator.wakeLock.request("screen"); } catch {}
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible") { try { wake = await navigator.wakeLock.request("screen"); } catch {} } });
    await startSensors(); connect(room);
    setInterval(() => {
      $("magsrc").textContent = magSrc; $("orisrc").textContent = oriSrc;
      $("field").textContent = m ? Math.hypot(...m).toFixed(1) + " uT" : "-";
      const now = performance.now(); $("rate").textContent = (sent / ((now - lastRate) / 1000)).toFixed(0) + " /s"; sent = 0; lastRate = now;
      if (magSrc === "not available") msg("This browser does not expose the magnetometer. In Chrome open chrome://flags/#enable-generic-sensor-extra-classes, set Enabled, relaunch, and reload this page.");
      else if (m && !q) msg("Magnetometer works, but no orientation sensor. Keep the phone flat and still.");
      else if (m) msg("Streaming. Keep the phone flat on the desk, top edge pointing away from you, then press Zero on the Mac.");
    }, 1000);
    setInterval(() => { if (m && ws && ws.readyState === 1) { ws.send(JSON.stringify({ type: "s", m, q: q || [0, 0, 0, 1], t: Date.now() })); sent++; } }, 33);
  };
})();
