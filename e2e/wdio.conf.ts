import path from 'path';
import type { Options } from '@wdio/types';
import TauriDriverService from './helpers/tauri-service';

export const config = {
  runner: 'local',
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
      browserName: 'wry',
      'tauri:options': {
        application: path.resolve(
          __dirname,
          '../src-tauri/target/release/sortOfRemoteNG.exe',
        ),
      },
    } as never,
  ],

  services: [[TauriDriverService, {}]],

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
