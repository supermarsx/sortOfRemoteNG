import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { ThemeManager } from '../themeManager';

// ensure a clean JSDOM document for each test
let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  // Assign global document and window for ThemeManager to use
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
});

describe('ThemeManager.applyTheme', () => {
  it('applies classes and CSS variables for dark + blue scheme', () => {
    const manager = ThemeManager.getInstance();
    manager.applyTheme('dark', 'blue');

    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(document.body.classList.contains('scheme-blue')).toBe(true);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-background')).toBe('#111827');
    expect(root.style.getPropertyValue('--color-primary')).toBe('#3b82f6');
  });
});
