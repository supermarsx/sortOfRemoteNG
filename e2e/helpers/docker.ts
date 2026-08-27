import { execSync } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

export const SSH_PORT = 2222;
export const RDP_PORT = 13389;
export const VNC_PORT = 15900;
export const HTTP_PORT = 8443;
export const MYSQL_PORT = 13306;
// t69: MariaDB + MongoDB fixtures (compose services test-mariadb / test-mongo).
export const MARIADB_PORT = 13307;
export const MONGO_PORT = 27117;
export const FTP_PORT = 2121;
export const PORTAINER_PORT = 19000;
// t65: Nginx Proxy Manager admin API/UI (compose service test-npm, container 81).
export const NPM_PORT = 18181;

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

/**
 * Reads the compose health state of `service` (e.g. "test-mysql").
 * Returns "healthy" | "unhealthy" | "starting" | "none" (no healthcheck or
 * not a compose service) | null (docker/compose not reachable).
 */
export function getServiceHealth(service: string): string | null {
  try {
    const out = execSync(
      `docker compose -f "${COMPOSE_FILE}" ps --all --format json "${service}"`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    // `ps --format json` prints one JSON object per line (or a JSON array on
    // older compose versions).
    const trimmed = out.trim();
    if (!trimmed) return 'none';
    const entries: Array<{ Health?: string; State?: string }> = trimmed.startsWith('[')
      ? JSON.parse(trimmed)
      : trimmed
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    const entry = entries[0];
    if (!entry) return 'none';
    if (entry.State === 'exited' || entry.State === 'dead') return 'unhealthy';
    const health = (entry.Health ?? '').toLowerCase();
    return health === '' ? 'none' : health;
  } catch {
    return null;
  }
}

/**
 * Waits until the container is usable. `name` is honoured when it is a compose
 * service name with a healthcheck (`test-mysql`, `test-mongo`, ...): we wait
 * for `healthy`, which for the DB fixtures also implies "seeded". When the
 * name is a plain label (legacy callers pass "mysql"/"ftp") or the service has
 * no healthcheck, we fall back to a TCP poll on `port`.
 */
export function waitForContainer(
  name: string,
  port: number,
  timeout: number,
): Promise<void> {
  const start = Date.now();

  return new Promise<void>((resolve, reject) => {
    function fail(reason: string) {
      reject(
        new Error(
          `Timed out waiting for container "${name}" on port ${port} after ${timeout}ms (${reason})`,
        ),
      );
    }

    function tryConnect() {
      if (Date.now() - start > timeout) {
        fail('tcp');
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

    function pollHealth() {
      if (Date.now() - start > timeout) {
        fail('health');
        return;
      }
      const health = getServiceHealth(name);
      if (health === 'healthy' || health === 'none' || health === null) {
        // Health is container-internal (or unavailable); confirm the host
        // port mapping either way.
        tryConnect();
        return;
      }
      setTimeout(pollHealth, 1_000);
    }

    if (name.startsWith('test-')) {
      pollHealth();
    } else {
      tryConnect();
    }
  });
}
