// Mac side: receives phone magnetometer + orientation, estimates which side the magnet field comes from, draws a chrome blob.
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  let room = (qs.get("c") || localStorage.getItem("magnet-room") || "").toUpperCase();
  if (room.length < 4) room = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[x % 31]).join("");
  localStorage.setItem("magnet-room", room);
  $("code").textContent = room;

  // ---------- math ----------
  const rot = (q, v) => { // rotate v by quaternion [x,y,z,w]
    const [x, y, z, w] = q, [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
  };
  const len = (v) => Math.hypot(v[0], v[1], v[2]);

  // ---------- state ----------
  const S = { v: null, b0: [0, 0, 0], yaw0: 0, hasZero: false, res: [0, 0, 0], flip: 1,
    dir: [0, 0], lean: 0, sdir: [0, 0], slean: 0, protos: null, last: 0, buf: [], phone: 0, mouse: null };

  const aligned = (q, m) => { // reference-frame vector, yaw-aligned so phone top edge at Zero = screen up
    const w = rot(q || [0, 0, 0, 1], m), c = Math.cos(S.yaw0), s = Math.sin(S.yaw0);
    return [w[0] * c - w[1] * s, w[0] * s + w[1] * c, w[2]];
  };

  function onSample(d) {
    S.last = performance.now();
    S.q = d.q; S.raw = d.m;
    S.v = aligned(d.q, d.m);
    S.buf.push([S.last, S.v.slice()]); while (S.buf.length && S.last - S.buf[0][0] > 2000) S.buf.shift();
    if (!S.hasZero) return;
    S.res = [S.v[0] - S.b0[0], S.v[1] - S.b0[1], S.v[2] - S.b0[2]];
  }
  const avgRecent = (ms) => { const now = performance.now(), a = S.buf.filter((e) => now - e[0] < ms); if (a.length < 5) return null;
    return [0, 1, 2].map((i) => a.reduce((s, e) => s + e[1][i], 0) / a.length); };

  function estimate() {
    const r = S.res, s = len(r);
    const sens = 0.5 + parseFloat($("sens").value) / 50; // 0.5..2.5 x
    const lo = Math.log(2.5 / sens), hi = Math.log(250 / sens);
    const lean = Math.min(1, Math.max(0, (Math.log(Math.max(s, 1e-3)) - lo) / (hi - lo)));
    let dx = r[0], dy = r[1];
    if (S.protos) { // fingerprint: blend taught side directions by similarity to the live residual
      let sx = 0, sy = 0;
      for (const p of S.protos) {
        const c = (r[0] * p.v[0] + r[1] * p.v[1] + r[2] * p.v[2]) / (s * len(p.v) + 1e-6);
        const w = Math.pow(Math.max(0, c), 3); sx += w * p.d[0]; sy += w * p.d[1];
      }
      dx = sx; dy = sy;
    } else { dx *= S.flip; dy *= S.flip; }
    const m = Math.hypot(dx, dy);
    return { dir: m > 1e-6 ? [dx / m, dy / m] : [0, 0], lean, s };
  }

  // ---------- teach sides ----------
  const SIDES = [["left", [-1, 0]], ["right", [1, 0]], ["above the screen (behind the laptop)", [0, 1]], ["in front of the keyboard", [0, -1]]];
  let teaching = null;
  $("teachBtn").onclick = () => {
    if (!S.hasZero) return say("press Zero first");
    teaching = { i: 0, got: [] }; S.protos = null; stepTeach();
  };
  function stepTeach() {
    const t = $("teach"), step = teaching.i;
    if (step >= SIDES.length) { S.protos = teaching.got; teaching = null; t.style.display = "none"; say("taught " + S.protos.length + " sides"); return; }
    t.style.display = "block";
    t.innerHTML = 'hold the phone <b>' + SIDES[step][0] + '</b> of the magnet, ~15 cm away, still &nbsp;<button id="ok">record</button>';
    $("ok").onclick = () => { const a = avgRecent(1000); if (!a) return say("no phone data");
      const v = [a[0] - S.b0[0], a[1] - S.b0[1], a[2] - S.b0[2]];
      teaching.got.push({ v, d: SIDES[step][1] }); teaching.i++; stepTeach(); };
  }

  $("zero").onclick = () => {
    if (!S.q) return say("no phone data yet");
    const a = avgRecent(1000); if (!a) return say("hold still a second, then retry");
    // re-reference the yaw alignment: current phone top edge = screen up
    { const t = rot(S.q, [0, 1, 0]); S.yaw0 = Math.PI / 2 - Math.atan2(t[1], t[0]); }
    S.hasZero = true; S.protos = null;
    const b = aligned(S.q, S.raw); S.b0 = b; S.buf = [];
    say("zeroed. phone top edge = screen up");
  };
  $("flip").onclick = () => { S.flip *= -1; say(S.flip > 0 ? "leans toward field" : "leans away from field"); };
  let sayT; function say(m) { $("hint").textContent = m; clearTimeout(sayT); sayT = setTimeout(() => $("hint").textContent = "drag the mouse to test without a phone", 4000); }

  // ---------- network ----------
  let ws, backoff = 500;
  function connect() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws?role=mac&room=" + room);
    ws.onopen = () => { backoff = 500; };
    ws.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type === "presence") { S.phone = d.phone; }
      else if (d.type === "s" && Array.isArray(d.b)) { for (const f of d.b) onSample({ m: f[0], q: f[1], t: f[2] }); }
      else if (d.type === "s" && Array.isArray(d.m)) onSample(d); };
    ws.onclose = () => { S.phone = 0; setTimeout(connect, backoff = Math.min(backoff * 2, 5000)); };
  }
  connect();

  if (qs.get('demo')) { const [a,b]=qs.get('demo').split(',').map(Number); S.mouse=[innerWidth/2+a*innerWidth/2, innerHeight/2-b*innerHeight/2]; }
  // mouse demo: drag to push the blob
  addEventListener("pointerdown", (e) => { if (e.target.closest("button,input")) return; S.mouse = [e.clientX, e.clientY]; });
  addEventListener("pointermove", (e) => { if (S.mouse) S.mouse = [e.clientX, e.clientY]; });
  addEventListener("pointerup", () => { S.mouse = null; });

  // ---------- render ----------
  const cv = $("c"), gl = cv.getContext("webgl2", { antialias: true });
  if (!gl) { document.body.insertAdjacentHTML("beforeend", '<p style="padding:90px 16px">WebGL2 is not available in this browser.</p>'); return; }
  const vs = "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0,1);}";
  const fs = `#version 300 es
precision highp float;
uniform vec2 res; uniform float t; uniform vec2 dir; uniform float lean;
out vec4 o;
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}
float sdf(vec2 p){
  float R=.27;
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
  const uRes = U("res"), uT = U("t"), uDir = U("dir"), uLean = U("lean");

  function size() { const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; gl.viewport(0, 0, cv.width, cv.height); }
  addEventListener("resize", size); size();

  let tprev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - tprev) / 1000); tprev = now;
    const live = now - S.last < 1500 && S.phone > 0;
    let tgt = { dir: [0, 0], lean: 0, s: 0 };
    if (S.mouse) {
      const cx = innerWidth / 2, cy = innerHeight / 2, dx = S.mouse[0] - cx, dy = cy - S.mouse[1], m = Math.hypot(dx, dy) || 1;
      tgt = { dir: [dx / m, dy / m], lean: Math.min(1, m / (Math.min(innerWidth, innerHeight) * .5)), s: 0 };
    } else if (live && S.hasZero) tgt = estimate();
    // smooth direction as a vector so it does not snap around when lean is ~0
    const k = 1 - Math.exp(-dt * 8);
    S.sdir[0] += (tgt.dir[0] * tgt.lean - S.sdir[0]) * k; S.sdir[1] += (tgt.dir[1] * tgt.lean - S.sdir[1]) * k;
    S.slean += (tgt.lean - S.slean) * k;
    const m = Math.hypot(S.sdir[0], S.sdir[1]);
    const dir = m > 1e-4 ? [S.sdir[0] / m, S.sdir[1] / m] : [0, 0];
    gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uT, now / 1000); gl.uniform2f(uDir, dir[0], dir[1]); gl.uniform1f(uLean, Math.min(1, m));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const st = $("status");
    st.textContent = S.phone > 0 ? (live ? "phone live" : "phone connected, no data") : "waiting for phone"; st.className = live ? "on" : "off";
    $("read").textContent = live ? "field " + (S.raw ? len(S.raw).toFixed(0) : "-") + " uT   residual " + len(S.res).toFixed(1) + " uT   lean " + (m * 100).toFixed(0) + "%   " + (S.hasZero ? (S.protos ? "taught" : "simple") : "not zeroed") : "\u00a0";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
