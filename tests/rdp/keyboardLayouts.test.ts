import { describe, expect, it } from 'vitest';
import { keyToScancode } from '../../src/utils/rdp/rdpKeyboard';

function keyboardEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: '',
    key: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('RDP keyboard scancode mapping', () => {
  it('maps AltGraph via the physical right-alt key', () => {
    const scan = keyToScancode(
      keyboardEvent({
        code: 'AltRight',
        key: 'AltGraph',
      }),
    );

    expect(scan).toEqual({ scancode: 0x38, extended: true });
  });

  it('maps dead keys by physical code rather than composed key text', () => {
    const scan = keyToScancode(
      keyboardEvent({
        code: 'Quote',
        key: 'Dead',
      }),
    );

    expect(scan).toEqual({ scancode: 0x28, extended: false });
  });

  it('maps the ISO 102nd key used by many non-US layouts', () => {
    const scan = keyToScancode(
      keyboardEvent({
        code: 'IntlBackslash',
        key: '<',
      }),
    );

    expect(scan).toEqual({ scancode: 0x56, extended: false });
  });
});