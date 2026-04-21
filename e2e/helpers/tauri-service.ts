import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import net from 'net';

const DRIVER_PORT = 4444;

/**
 * Custom WDIO service that starts and stops `tauri-driver`
 * before/after the test suite.
 *
 * `tauri-driver` exposes a WebDriver-compatible server
 * so that WebdriverIO can drive the Tauri WRY webview.
 */
export default class TauriDriverService {
  private process: ChildProcess | null = null;

  async onPrepare(): Promise<void> {
    this.process = spawn('npx', ['tauri-driver'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('[tauri-driver]', msg.trim());
      }
    });

    // Wait until the WebDriver port is accepting connections
    await this.waitForPort(DRIVER_PORT, 30_000);
  }

  async onComplete(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private waitForPort(port: number, timeout: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        if (Date.now() - start > timeout) {
          reject(
            new Error(
              `tauri-driver did not start on port ${port} within ${timeout}ms`,
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
          setTimeout(tryConnect, 250);
        });
        socket.connect(port, '127.0.0.1');
      };
      tryConnect();
    });
  }
}
