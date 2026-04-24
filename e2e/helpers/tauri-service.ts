import type { ChildProcess } from 'child_process';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

const DRIVER_PORT = 4444;
const DRIVER_START_TIMEOUT_MS = 30_000;
const DRIVER_INSTALL_HINT =
  'cargo install tauri-driver --version 2.0.5 --locked';
const NATIVE_DRIVER_ENV_VARS = ['TAURI_NATIVE_DRIVER_PATH', 'EDGE_DRIVER_PATH'] as const;

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
    let driverCommand: string;
    let driverArgs: string[];

    try {
      ({ driverCommand, driverArgs } = this.resolveDriverLaunchConfig());
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
      return;
    }

    const startupOutput: string[] = [];

    this.process = spawn(driverCommand, driverArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.captureOutput(startupOutput, data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      this.captureOutput(startupOutput, data);
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('[tauri-driver]', msg.trim());
      }
    });

    const startupFailure = this.monitorStartup(
      this.formatCommand(driverCommand, driverArgs),
      startupOutput,
    );

    try {
      await Promise.race([
        this.waitForPort(DRIVER_PORT, DRIVER_START_TIMEOUT_MS, startupOutput).then(
          () => {
            startupFailure.markReady();
          },
        ),
        startupFailure.failed,
      ]);
    } catch (error) {
      await this.onComplete();
      console.error(
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  }

  async onComplete(): Promise<void> {
    if (this.process) {
      if (!this.process.killed) {
        this.process.kill();
      }
      this.process = null;
    }
  }

  private resolveDriverCommand(): string {
    const override = process.env.TAURI_DRIVER_PATH?.trim();
    return override && override.length > 0 ? override : 'tauri-driver';
  }

  private resolveDriverLaunchConfig(): {
    driverCommand: string;
    driverArgs: string[];
  } {
    const driverCommand = this.resolveDriverCommand();
    const driverArgs: string[] = [];

    const nativeDriverPath = this.resolveNativeDriverPath();
    if (nativeDriverPath) {
      driverArgs.push('--native-driver', nativeDriverPath);
    }

    return { driverCommand, driverArgs };
  }

  private resolveNativeDriverPath(): string | null {
    if (process.platform !== 'win32') {
      return null;
    }

    const override = this.resolveNativeDriverOverride();
    if (override) {
      return override;
    }

    const fromPath = this.findNativeDriverOnPath();
    if (fromPath) {
      return fromPath;
    }

    return this.findNativeDriverInWinGetCache();
  }

  private resolveNativeDriverOverride(): string | null {
    for (const envVar of NATIVE_DRIVER_ENV_VARS) {
      const value = process.env[envVar]?.trim();
      if (!value) {
        continue;
      }

      if (!fs.existsSync(value)) {
        throw new Error(
          `${envVar} is set but does not point to an existing file: ${value}`,
        );
      }

      return value;
    }

    return null;
  }

  private findNativeDriverOnPath(): string | null {
    try {
      const output = execFileSync('where', ['msedgedriver'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const match = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && fs.existsSync(line));

      return match ?? null;
    } catch {
      return null;
    }
  }

  private findNativeDriverInWinGetCache(): string | null {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (!localAppData) {
      return null;
    }

    const packagesDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (!fs.existsSync(packagesDir)) {
      return null;
    }

    return this.findFileRecursive(packagesDir, 'msedgedriver.exe');
  }

  private findFileRecursive(rootDir: string, fileName: string): string | null {
    const pendingDirs = [rootDir];

    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
          return fullPath;
        }

        if (entry.isDirectory()) {
          pendingDirs.push(fullPath);
        }
      }
    }

    return null;
  }

  private captureOutput(startupOutput: string[], data: Buffer): void {
    const text = data.toString().trim();
    if (!text) {
      return;
    }

    startupOutput.push(text);
    if (startupOutput.length > 10) {
      startupOutput.shift();
    }
  }

  private monitorStartup(
    driverCommand: string,
    startupOutput: string[],
  ): {
    failed: Promise<never>;
    markReady: () => void;
  } {
    let ready = false;

    const failed = new Promise<never>((_, reject) => {
      this.process?.once('error', (error: NodeJS.ErrnoException) => {
        if (ready) {
          return;
        }

        reject(this.createSpawnError(driverCommand, startupOutput, error));
      });

      this.process?.once('exit', (code, signal) => {
        if (ready) {
          return;
        }

        reject(
          new Error(
            [
              'tauri-driver exited before the WebDriver server was ready.',
              `Command: ${driverCommand}`,
              `Exit code: ${code ?? 'unknown'}`,
              `Signal: ${signal ?? 'none'}`,
              this.formatCapturedOutput(startupOutput),
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        );
      });
    });

    return {
      failed,
      markReady: () => {
        ready = true;
      },
    };
  }

  private waitForPort(
    port: number,
    timeout: number,
    startupOutput: string[],
  ): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        if (Date.now() - start > timeout) {
          reject(
            new Error(
              [
                `tauri-driver did not start on port ${port} within ${timeout}ms.`,
                this.formatCapturedOutput(startupOutput),
              ]
                .filter(Boolean)
                .join('\n'),
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

  private createSpawnError(
    driverCommand: string,
    startupOutput: string[],
    error: NodeJS.ErrnoException,
  ): Error {
    if (error.code === 'ENOENT') {
      const details = process.env.TAURI_DRIVER_PATH?.trim()
        ? 'The TAURI_DRIVER_PATH override does not point to a runnable tauri-driver binary.'
        : 'The tauri-driver binary was not found on PATH.';

      return new Error(
        [
          `Unable to start tauri-driver using "${driverCommand}".`,
          details,
          `Install it with: ${DRIVER_INSTALL_HINT}`,
          'Or set TAURI_DRIVER_PATH to the full path of the installed executable.',
          this.formatCapturedOutput(startupOutput),
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    return new Error(
      [
        `Failed to start tauri-driver using "${driverCommand}": ${error.message}`,
        this.formatCapturedOutput(startupOutput),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  private formatCapturedOutput(startupOutput: string[]): string {
    if (startupOutput.length === 0) {
      return '';
    }

    return `Driver output:\n${startupOutput.join('\n')}`;
  }

  private formatCommand(command: string, args: string[]): string {
    if (args.length === 0) {
      return command;
    }

    return [command, ...args].join(' ');
  }
}
