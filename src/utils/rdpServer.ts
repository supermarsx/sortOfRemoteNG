import { WebSocketServer } from "ws";
import type { Server } from "http";

/**
 * Placeholder RDP proxy server. A real implementation would leverage a library
 * such as Guacamole or node-rdpjs to connect to the remote desktop and stream
 * graphics over the WebSocket connection. Currently this just informs clients
 * that RDP support is not implemented.
 */
export function createRDPProxyServer(server: Server, path = "/rdp"): void {
  const wss = new WebSocketServer({ server, path });

  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "RDP proxy not implemented",
      }),
    );
    ws.close();
  });
}
