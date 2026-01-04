import '@testing-library/jest-dom';
// Provide a browser-like IndexedDB implementation for tests
import 'fake-indexeddb/auto';

// Mock Tauri API
import { vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock Tauri plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

// Mock Tauri plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock Tauri path API
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/app/data'),
  join: vi.fn((...args: string[]) => args.join('/')),
}));
