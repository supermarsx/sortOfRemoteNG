import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Options } from '@wdio/types';
import TauriDriverService from './helpers/tauri-service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const windowsTarget = process.env.CARGO_BUILD_TARGET ?? 'x86_64-pc-windows-gnu';

const tauriBinaryCandidates = [
  path.resolve(__dirname, '../src-tauri/target/release/app.exe'),
  path.resolve(__dirname, `../src-tauri/target/${windowsTarget}/release/app.exe`),
  path.resolve(__dirname, '../src-tauri/target/debug/app.exe'),
  path.resolve(__dirname, `../src-tauri/target/${windowsTarget}/debug/app.exe`),
  path.resolve(__dirname, '../src-tauri/target/release/sortOfRemoteNG.exe'),
  path.resolve(
    __dirname,
    `../src-tauri/target/${windowsTarget}/release/sortOfRemoteNG.exe`,
  ),
  path.resolve(__dirname, '../src-tauri/target/debug/sortOfRemoteNG.exe'),
  path.resolve(
    __dirname,
    `../src-tauri/target/${windowsTarget}/debug/sortOfRemoteNG.exe`,
  ),
];

const tauriBinaryPath =
  tauriBinaryCandidates.find((candidate) => fs.existsSync(candidate)) ??
  tauriBinaryCandidates[1];

export const config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  autoCompileOpts: {
    tsNodeOpts: {
      project: path.resolve(__dirname, './tsconfig.json'),
    },
  },

  specs: ['./specs/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      'tauri:options': {
        application: tauriBinaryPath,
      },
    } as never,
  ],

  services: [[TauriDriverService]],

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },

  reporters: ['spec'],

  waitforTimeout: 15_000,
  connectionRetryTimeout: 30_000,
  connectionRetryCount: 3,

  async before() {
    const { waitForAppReady } = await import('./helpers/app');
    await waitForAppReady();
  },

  async afterTest(
    _test: unknown,
    _context: unknown,
    result: { passed: boolean },
  ) {
    if (!result.passed) {
      const timestamp = Date.now();
      const screenshotDir = path.resolve(__dirname, './screenshots');
      const fs = await import('fs');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      await browser.saveScreenshot(
        path.join(screenshotDir, `failure-${timestamp}.png`),
      );
    }
  },
};

export default config;
