// Relay: phone page -> room -> Mac page. One Durable Object per room code.
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/rec") { // training recordings, stored in this room's Durable Object
      if (req.method === "POST") {
        const body = await req.text();
        if (body.length > 120000) return new Response("too big", { status: 413 });
        const idx = (u.searchParams.get("idx") || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
        if (!idx) return new Response("bad idx", { status: 400 });
        await this.state.storage.put("rec:" + idx, body);
        return Response.json({ ok: true, idx, bytes: body.length });
      }
      const all = await this.state.storage.list({ prefix: "rec:" });
      const out = {}; for (const [k, v] of all) out[k.slice(4)] = JSON.parse(v);
      return Response.json(out, { headers: { "cache-control": "no-store" } });
    }
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const role = new URL(req.url).searchParams.get("role") === "phone" ? "phone" : "mac";
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [role]);
    pair[1].serializeAttachment({ role });
    this.presence();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  peers(role) { return this.state.getWebSockets(role); }
  presence() {
    const msg = JSON.stringify({ type: "presence", phone: this.peers("phone").length, mac: this.peers("mac").length });
    for (const ws of this.state.getWebSockets()) { try { ws.send(msg); } catch {} }
  }
  webSocketMessage(ws, data) {
    const { role } = ws.deserializeAttachment() || {};
    if (typeof data !== "string" || data.length > 2048) return;
    const target = role === "phone" ? "mac" : "phone";
    for (const peer of this.peers(target)) { try { peer.send(data); } catch {} }
  }
  webSocketClose(ws) { try { ws.close(); } catch {} this.presence(); }
  webSocketError() { this.presence(); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== "/ws" && url.pathname !== "/rec") return new Response("not found", { status: 404 });
    const room = (url.searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (room.length < 4) return new Response("bad room", { status: 400 });
    const name = url.pathname === "/rec" ? "rec-" + room : room;
    return env.ROOM.get(env.ROOM.idFromName(name)).fetch(req);
  },
};
