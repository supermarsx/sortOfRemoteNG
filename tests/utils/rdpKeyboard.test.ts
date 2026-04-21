import { describe, it, expect } from "vitest";
import { mouseButtonCode, keyToScancode } from "../../src/utils/rdp/rdpKeyboard";

describe("rdpKeyboard", () => {
  describe("mouseButtonCode", () => {
    it("maps left button (0) correctly", () => {
      expect(mouseButtonCode(0)).toBe(0);
    });

    it("maps middle button (1) correctly", () => {
      expect(mouseButtonCode(1)).toBe(1);
    });

    it("maps right button (2) correctly", () => {
      expect(mouseButtonCode(2)).toBe(2);
    });

    it("maps X1/X2 buttons", () => {
      expect(mouseButtonCode(3)).toBe(3);
      expect(mouseButtonCode(4)).toBe(4);
    });

    it("falls back to 0 for unknown buttons", () => {
      expect(mouseButtonCode(99)).toBe(0);
    });
  });

  describe("keyToScancode", () => {
    it("maps Escape to scancode 0x01", () => {
      const result = keyToScancode({ code: "Escape" } as KeyboardEvent);
      expect(result).toEqual({ scancode: 0x01, extended: false });
    });

    it("maps Enter to scancode 0x1C (non-extended)", () => {
      const result = keyToScancode({ code: "Enter" } as KeyboardEvent);
      expect(result).toEqual({ scancode: 0x1C, extended: false });
    });

    it("maps NumpadEnter to scancode 0x1C (extended)", () => {
      const result = keyToScancode({ code: "NumpadEnter" } as KeyboardEvent);
      expect(result).toEqual({ scancode: 0x1C, extended: true });
    });

    it("maps arrow keys as extended", () => {
      const up = keyToScancode({ code: "ArrowUp" } as KeyboardEvent);
      expect(up).toEqual({ scancode: 0x48, extended: true });

      const left = keyToScancode({ code: "ArrowLeft" } as KeyboardEvent);
      expect(left).toEqual({ scancode: 0x4B, extended: true });
    });

    it("maps letter keys", () => {
      const a = keyToScancode({ code: "KeyA" } as KeyboardEvent);
      expect(a).toEqual({ scancode: 0x1E, extended: false });

      const z = keyToScancode({ code: "KeyZ" } as KeyboardEvent);
      expect(z).toEqual({ scancode: 0x2C, extended: false });
    });

    it("returns null for unmapped keys", () => {
      expect(keyToScancode({ code: "UnknownKey" } as KeyboardEvent)).toBeNull();
    });
  });
});
