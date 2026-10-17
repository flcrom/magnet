// Phone-only demo v2 (learned classifier): the phone reads its own magnetometer (via the Termux sender on the same phone, through the relay)
// and draws a chrome blob that leans toward the field change, in phone-screen coordinates.
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const room = (qs.get("c") || "PIXEL6A").toUpperCase();
  const rot = (q, v, inv) => { // rotate v by q (or by q's inverse)
    let [x, y, z, w] = q; if (inv) { x = -x; y = -y; z = -z; }
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const S = { m: null, q: [0, 0, 0, 1], t: 0, b0: null, buf: [], res: [0, 0, 0], same: 0, frozen: false,
    flip: parseInt(localStorage.getItem("magnet-m2-flip") || "1", 10), sdir: [0, 0], sang: 0, slean: 0, rs: [0, 0, 0], ssc: 1, auto: true };

  function onSample(d) {
    const now = performance.now();
    if (S.m && d.m[0] === S.m[0] && d.m[1] === S.m[1] && d.m[2] === S.m[2]) S.same++; else S.same = 0;
    S.m = d.m; S.q = d.q || [0, 0, 0, 1]; S.t = now;
    S.buf.push([now, rot(S.q, S.m, false)]); while (S.buf.length && now - S.buf[0][0] > 1500) S.buf.shift();
    if (S.same < 15 && S.b0) { // baseline is kept in the fixed frame, so tilting the phone does not create a residual
      const b = rot(S.q, S.b0, true);
      S.res = [S.m[0] - b[0], S.m[1] - b[1], S.m[2] - b[2]];
    }
  }
  function zero() {
    const now = performance.now(), a = S.buf.filter((e) => now - e[0] < 1000);
    if (a.length < 8 || S.same >= 15) return false;
    S.b0 = [0, 1, 2].map((i) => a.reduce((s, e) => s + e[1][i], 0) / a.length); S.res = [0, 0, 0]; return true;
  }
  const say = (t, ms = 2500) => { $("hint").textContent = t; clearTimeout(say.t); say.t = setTimeout(() => $("hint").textContent = "", ms); };
  $("zero").onclick = () => say(zero() ? "zeroed here" : "no fresh sensor data");
  $("flip").onclick = () => { S.flip *= -1; localStorage.setItem("magnet-m2-flip", S.flip); say(S.flip > 0 ? "pole as taught" : "pole flipped"); };
  $("fs").onclick = () => { const e = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else (e.requestFullscreen || e.webkitRequestFullscreen).call(e); };
  document.addEventListener("fullscreenchange", () => { document.body.classList.toggle("full", !!document.fullscreenElement); });
  (async () => { try { await navigator.wakeLock.request("screen"); } catch {} })();
  document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible") { try { await navigator.wakeLock.request("screen"); } catch {} } });

  // network: connect as the "mac" side of the room, the Termux sender is the "phone" side
  let ws, backoff = 500, connected = false;
  function connect() {
    ws = new WebSocket("wss://" + location.host + "/ws?role=mac&room=" + room);
    ws.onopen = () => { connected = true; backoff = 500; };
    ws.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } if (d.type === "s" && Array.isArray(d.m)) onSample(d); };
    ws.onclose = () => { connected = false; setTimeout(connect, backoff = Math.min(backoff * 2, 5000)); };
  }
  connect();

  // demo without sensor: touch and drag
  let touch = null;
  addEventListener("pointerdown", (e) => { if (e.target.closest("button,input")) return; touch = [e.clientX, e.clientY]; });
  addEventListener("pointermove", (e) => { if (touch) touch = [e.clientX, e.clientY]; });
  addEventListener("pointerup", () => { touch = null; });

  const cv = $("c"), gl = cv.getContext("webgl2", { antialias: true });
  if (!gl) { $("hint").textContent = "WebGL2 not available"; return; }
  const vs = "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0,1);}";
  const fs = `#version 300 es
precision highp float;
uniform vec2 res; uniform float t; uniform vec2 dir; uniform float lean; uniform float sc;
out vec4 o;
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float sdf(vec2 p){
  float R=.27*sc;
  vec2 c0=-dir*lean*.04;
  float a=atan(p.y,p.x);
  float w=.004*sin(a*3.+t*1.1)+.003*sin(a*5.-t*1.7)+lean*.006*sin(a*7.+t*3.);
  float d1=length(p-c0)-R-w;
  float r2=R*(.18+.42*lean);
  vec2 c1=c0+dir*R*(.55+.95*lean);
  float d2=length(p-c1)-r2;
  float k=R*(.25+.5*lean);
  return mix(d1,smin(d1,d2,k),step(.001,length(dir))*smoothstep(0.,.05,lean));
}
float H(vec2 p){
  float d=-sdf(p); if(d<=0.) return 0.;
  float u=clamp(d/.17,0.,1.);
  float rim=.13*sqrt(1.-(1.-u)*(1.-u));
  float bump=.07*exp(-dot(p+dir*lean*.05,p+dir*lean*.05)/.045);
  return rim+bump*smoothstep(0.,.08,d);
}
float env(vec3 r){
  float up=r.y*.5+.5;
  float sky=pow(up,1.6);
  float hor=smoothstep(.0,.03,abs(r.y-.02));
  float soft=smoothstep(.55,.62,sin(r.x*3.4+r.y*1.3+.8))*smoothstep(.15,.5,r.y)*.9;
  float strip=smoothstep(.93,.96,sin(r.x*7.+2.))*.6*step(r.y,.0);
  float v=mix(.05,.95,sky);
  v=mix(.0,v,hor)+soft+strip;
  return clamp(v,0.,1.);
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*res)/min(res.x,res.y);
  float d=sdf(uv);
  float e=1.5/min(res.x,res.y);
  float cov=1.-smoothstep(-e,e,d);
  vec2 q=vec2(.002,0.);
  float hx=H(uv+q.xy)-H(uv-q.xy), hy=H(uv+q.yx)-H(uv-q.yx);
  vec3 n=normalize(vec3(-hx/(2.*q.x)*.9,-hy/(2.*q.x)*.9,1.));
  vec3 r=reflect(vec3(0,0,-1),n);
  float c=env(r);
  float fres=pow(1.-n.z,3.);
  c=clamp(c*(.85+.15*n.z)+fres*.25,0.,1.);
  c=pow(c,.9);
  float glow=0.; // no glow: flat black field
  o=vec4(vec3(c*cov+glow),1.);
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(pr, n);
  const uRes = U("res"), uT = U("t"), uDir = U("dir"), uLean = U("lean"), uSc = U("sc");

  function size() { const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; gl.viewport(0, 0, cv.width, cv.height); }
  size();
  addEventListener("resize", size);


  // ---- learned position classifier ----
  // FP[i] = mean field change (uT, phone axes) measured with the magnet touching the glass at direction i*15 deg (0 = top, clockwise)
  // on a ring of about 2.9 cm around the screen center, averaged over two training passes (24 directions x 2). The sensor sits
  // off-center (upper left), and the fingerprints already include that, so the angle is measured from the screen center.
  const FP = [[254.33, 40.76, -8.41], [100.47, 2.68, -30.56], [66.22, -3.14, -23.75], [50.93, -12.19, -18.65], [41.92, -27.56, -14.11], [36.15, -34.25, -12.54], [28.88, -35.18, -11.69], [20.68, -28.12, -8.5], [14.99, -20.52, -7.15], [8.62, -14.56, -5.27], [5.5, -10.66, -4.17], [5.47, -11.05, -3.92], [3.99, -12.77, -3.34], [2.36, -13.41, -3.44], [2.27, -17.0, -4.7], [7.04, -31.33, -9.09], [10.1, -56.64, -12.27], [17.62, -91.61, -11.12], [2.66, -123.67, -0.87], [75.09, -116.47, 133.31], [-472.72, -259.29, 213.79], [-485.4, 593.56, 67.23], [71.02, 547.29, -1.17], [331.73, 265.65, -8.58]];
  const FPN = FP.map((v) => Math.hypot(v[0], v[1], v[2]));
  const KS = [0.5, 0.6, 0.72, 0.85, 1, 1.18, 1.4, 1.7, 2];
  function classify(r) {
    // returns {ang (deg), conc 0..1, fit (best normalized distance), k (strength vs fingerprint), post[24]}
    const ll = new Array(24).fill(-1e9), kb = new Array(24).fill(1);
    for (let i = 0; i < 24; i++) {
      const sg = 0.2 * FPN[i] + 3;
      for (const k of KS) {
        const dx = r[0] - k * FP[i][0], dy = r[1] - k * FP[i][1], dz = r[2] - k * FP[i][2];
        const l = -(dx * dx + dy * dy + dz * dz) / (2 * k * k * sg * sg) - 3 * Math.log(k * sg) - 0.5 * Math.pow(Math.log(k) / 0.4, 2);
        if (l > ll[i]) { ll[i] = l; kb[i] = k; }
      }
    }
    let mx = -1e9, bi = 0; for (let i = 0; i < 24; i++) if (ll[i] > mx) { mx = ll[i]; bi = i; }
    let sum = 0, c = 0, s = 0; const w = ll.map((l) => Math.exp(l - mx)); for (const x of w) sum += x;
    for (let i = 0; i < 24; i++) { const p = w[i] / sum, a = i * Math.PI / 12; c += p * Math.cos(a); s += p * Math.sin(a); }
    const sg = 0.2 * FPN[bi] + 3, k = kb[bi];
    const d = Math.hypot(r[0] - k * FP[bi][0], r[1] - k * FP[bi][1], r[2] - k * FP[bi][2]) / (k * sg);
    return { ang: (Math.atan2(s, c) * 180 / Math.PI + 360) % 360, conc: Math.hypot(c, s), fit: d, k, best: bi };
  }

  const FLOOR = 3; // uT, below this the blob stays round
  let last = null;
  let tprev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - tprev) / 1000); tprev = now;
    const age = now - S.t;
    S.frozen = !S.m || age > 1500 || S.same >= 15;
    if (S.auto && !S.b0 && !S.frozen && S.buf.length > 20 && now - S.buf[0][0] > 1000) { if (zero()) { S.auto = false; say("auto-zeroed. keep magnets away, then use Zero if needed", 4000); } }
    let dir = [0, 0], lean = 0, sc = 1; last = null;
    if (touch) {
      const dx = touch[0] - innerWidth / 2, dy = innerHeight / 2 - touch[1], m = Math.hypot(dx, dy) || 1;
      dir = [dx / m, dy / m]; lean = Math.min(1, m / (Math.min(innerWidth, innerHeight) * .5));
    } else if (!S.frozen && S.b0) {
      const ka = 1 - Math.exp(-dt / 0.15); for (let i = 0; i < 3; i++) S.rs[i] += (S.res[i] - S.rs[i]) * ka;
      const r = [S.rs[0] * S.flip, S.rs[1] * S.flip, S.rs[2] * S.flip], mag = len(r), sens = 0.5 + parseFloat($("sens").value) / 50;
      if (mag > FLOOR / sens) {
        last = classify(r);
        const th = last.ang * Math.PI / 180;
        dir = [Math.sin(th), Math.cos(th)];                       // 0 deg = top of screen, clockwise
        const confGate = Math.min(1, Math.max(0, (last.conc - 0.4) / 0.4)); // broad posterior (the bottom zone) leans less
        const fitGate = Math.min(1, Math.max(0, (6 - last.fit) / 3));       // field does not look like anything it was taught
        const strength = Math.min(1, Math.max(0.2, 0.6 + 0.4 * Math.log2(last.k)));
        lean = strength * confGate * fitGate;
        sc = 1 + 0.2 * Math.min(1, Math.log(1 + mag) / 6) * (1 - fitGate);  // unknown pattern: swell instead of pointing
      }
    }
    // smoothing: the target (angle, lean) is noisy, the drawn blob follows it slowly
    // residual is low-passed first (tau 0.15 s); angle follows with a slew cap and only moves in proportion to how sure the lean is;
    // lean rises slowly (tau 0.45 s) and falls slower (tau 0.9 s), so a noise burst or a dropout does not snap the blob.
    const tl = lean, hasDir = Math.hypot(dir[0], dir[1]) > 0.1;
    if (hasDir && tl > 0.02) {
      const ta = Math.atan2(dir[0], dir[1]);
      let da = ta - S.sang; da = Math.atan2(Math.sin(da), Math.cos(da));
      const w = Math.min(1, tl / 0.3);
      const step = da * (1 - Math.exp(-dt * w / 0.3));
      const cap = 3.0 * dt; // rad/s, about 170 deg/s
      S.sang += Math.max(-cap, Math.min(cap, step));
    }
    const tau = tl > S.slean ? 0.45 : 0.9;
    let dl = (tl - S.slean) * (1 - Math.exp(-dt / tau));
    const capL = 1.2 * dt; dl = Math.max(-capL, Math.min(capL, dl));
    S.slean += dl;
    S.ssc += (sc - S.ssc) * (1 - Math.exp(-dt / 0.6));
    const d = [Math.sin(S.sang), Math.cos(S.sang)];
    const m = S.slean;
    gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uT, now / 1000); gl.uniform2f(uDir, d[0], d[1]); gl.uniform1f(uLean, Math.min(1, Math.max(0, m))); gl.uniform1f(uSc, S.ssc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const st = $("status");
    st.textContent = touch ? "touch demo" : !connected ? "offline" : !S.m ? "waiting for sensor" : S.frozen ? "sensor frozen, recovering" : S.b0 ? "live" : "zeroing";
    st.className = (!touch && !S.frozen && S.b0) ? "on" : "off";
    $("read").textContent = (!S.frozen && S.b0 ? "residual " + len(S.res).toFixed(0) + " uT" + (last ? "  angle " + last.ang.toFixed(0) + "  conf " + last.conc.toFixed(2) + (last.fit > 4 ? "  unfamiliar" : "") : "") : "");
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
