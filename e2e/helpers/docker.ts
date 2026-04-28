import { execSync } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

export const SSH_PORT = 2222;
export const RDP_PORT = 13389;
export const VNC_PORT = 15900;
export const HTTP_PORT = 8443;
export const MYSQL_PORT = 13306;
export const FTP_PORT = 2121;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.resolve(__dirname, '../docker-compose.yml');

function formatServices(services?: string[]): string {
  if (!services || services.length === 0) {
    return '';
  }

  return ` ${services.map((service) => `"${service}"`).join(' ')}`;
}

export function startContainers(services?: string[]): void {
  execSync(`docker compose -f "${COMPOSE_FILE}" up -d${formatServices(services)}`, {
    stdio: 'inherit',
  });
}

export function stopContainers(services?: string[]): void {
  const command = services && services.length > 0
    ? `docker compose -f "${COMPOSE_FILE}" rm -sf${formatServices(services)}`
    : `docker compose -f "${COMPOSE_FILE}" down`;

  execSync(command, {
    stdio: 'inherit',
  });
}

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function waitForContainer(
  name: string,
  port: number,
  timeout: number,
): Promise<void> {
  const start = Date.now();

  return new Promise<void>((resolve, reject) => {
    function tryConnect() {
      if (Date.now() - start > timeout) {
        reject(
          new Error(
            `Timed out waiting for container "${name}" on port ${port} after ${timeout}ms`,
          ),
        );
        return;
      }

      const socket = new net.Socket();

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        setTimeout(tryConnect, 500);
      });

      socket.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}
