import { describe, it, expect } from "vitest";
import { formatBytes, formatUptime } from "../../src/utils/rdp/rdpFormatters";

describe("rdpFormatters", () => {
  describe("formatBytes", () => {
    it("formats bytes under 1 KB", () => {
      expect(formatBytes(100)).toBe("100 B");
    });

    it("formats kilobytes", () => {
      expect(formatBytes(2048)).toBe("2.0 KB");
    });

    it("formats megabytes", () => {
      expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    });

    it("formats gigabytes", () => {
      expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
    });
  });

  describe("formatUptime", () => {
    it("formats seconds only", () => {
      expect(formatUptime(45)).toBe("45s");
    });

    it("formats minutes and seconds", () => {
      expect(formatUptime(125)).toBe("2m 5s");
    });

    it("formats hours, minutes, and seconds", () => {
      expect(formatUptime(3661)).toBe("1h 1m 1s");
    });
  });
});
