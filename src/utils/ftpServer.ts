import { Client } from "basic-ftp";
import { WebSocketServer } from "ws";
import type { Server } from "http";

interface FTPServerConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  secure?: boolean;
}

/**
 * Minimal FTP proxy server using basic-ftp. Clients connect via WebSocket and
 * send JSON messages. The first message must be `auth` with connection
 * parameters. Supported commands: `list` to retrieve directory listings.
 */
export function createFTPProxyServer(server: Server, path = "/ftp"): void {
  const wss = new WebSocketServer({ server, path });

  wss.on("connection", (ws) => {
    const client = new Client();
    let connected = false;

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        switch (data.type) {
          case "auth": {
            const cfg: FTPServerConfig = data;
            await client.access({
              host: cfg.host,
              port: cfg.port,
              user: cfg.user,
              password: cfg.password,
              secure: cfg.secure,
            });
            connected = true;
            ws.send(JSON.stringify({ type: "auth_success" }));
            break;
          }
          case "list": {
            if (!connected) break;
            const items = await client.list(data.path || "/");
            ws.send(JSON.stringify({ type: "list", items }));
            break;
          }
          default:
            ws.send(
              JSON.stringify({ type: "error", message: "Unsupported command" }),
            );
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: (err as Error).message || "FTP error",
          }),
        );
      }
    });

    ws.on("close", () => {
      client.close();
    });
  });
}
