import { NodeSSH } from "node-ssh";
import { WebSocketServer } from "ws";
import type { Server } from "http";

interface SSHServerConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Creates a WebSocket based SSH proxy using node-ssh.
 * The client must send an initial `auth` message with connection details.
 * Subsequent `input` messages are written to the shell and `resize` messages
 * adjust the pty size. Data from the remote host is broadcast back to the
 * connected WebSocket client.
 */
export function createSSHProxyServer(server: Server, path = "/ssh"): void {
  const wss = new WebSocketServer({ server, path });

  wss.on("connection", (ws) => {
    const ssh = new NodeSSH();
    let shell: any;

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        switch (data.type) {
          case "auth": {
            const config: SSHServerConfig = data;
            await ssh.connect({
              host: config.host,
              port: config.port,
              username: config.username,
              password: config.password,
              privateKey: config.privateKey,
              passphrase: config.passphrase,
            });
            shell = await ssh.requestShell({
              cols: 80,
              rows: 24,
              term: "xterm-256color",
            });
            shell.on("data", (d: Buffer) => {
              ws.send(JSON.stringify({ type: "data", content: d.toString() }));
            });
            shell.on("close", () => ws.close());
            ws.send(JSON.stringify({ type: "auth_success" }));
            break;
          }
          case "input":
            if (shell) shell.write(data.data);
            break;
          case "resize":
            if (shell) shell.setWindow(data.rows, data.cols);
            break;
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: (err as Error).message || "SSH error",
          }),
        );
      }
    });

    ws.on("close", () => {
      try {
        shell?.end();
        ssh.dispose();
      } catch {
        /* ignore */
      }
    });
  });
}
