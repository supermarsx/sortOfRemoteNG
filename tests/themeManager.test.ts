import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ThemeManager } from '../src/utils/themeManager';
import { IndexedDbService } from '../src/utils/indexedDbService';

vi.mock('../src/utils/indexedDbService', () => ({
  IndexedDbService: {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(undefined),
  },
}));

let dom: JSDOM;

beforeEach(() => {
  ThemeManager.resetInstance();
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window as any;
  global.document = dom.window.document;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.clearAllMocks();
});

describe('ThemeManager', () => {
  it('applies theme and persists selection', () => {
    const manager = ThemeManager.getInstance();
    manager.applyTheme('dark', 'blue');

    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(document.body.classList.contains('scheme-blue')).toBe(true);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-background')).toBe('#111827');

    expect(IndexedDbService.setItem).toHaveBeenCalledWith('mremote-theme', 'dark');
    expect(IndexedDbService.setItem).toHaveBeenCalledWith(
      'mremote-color-scheme',
      'blue',
    );
  });

  it('loads saved theme from storage', async () => {
    (IndexedDbService.getItem as any).mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        'mremote-theme': 'light',
        'mremote-color-scheme': 'green',
      };
      return map[key];
    });

    const manager = ThemeManager.getInstance();
    await manager.loadSavedTheme();

    expect(document.body.classList.contains('theme-light')).toBe(true);
    expect(document.body.classList.contains('scheme-green')).toBe(true);
  });

  it('detects system theme and responds to changes in auto mode', () => {
    let listener: (e: any) => void = () => {};
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: (_: string, cb: (e: any) => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    }));

    const manager = ThemeManager.getInstance();
    expect(manager.detectSystemTheme()).toBe('dark');

    manager.applyTheme('auto', 'blue');
    expect(document.body.classList.contains('theme-dark')).toBe(true);

    listener({ matches: false });
    expect(document.body.classList.contains('theme-light')).toBe(true);
  });
});

