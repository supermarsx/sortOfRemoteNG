import '@testing-library/jest-dom';
// Provide a browser-like IndexedDB implementation for tests
import 'fake-indexeddb/auto';

// Mock Tauri API
import { vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
