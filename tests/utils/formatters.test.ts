import { describe, it, expect } from "vitest";
import { formatDuration, formatBytes } from "../../src/utils/core/formatters";

describe("formatDuration", () => {
  it("formats zero milliseconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatDuration(3_661_000)).toBe("1h 1m 1s");
  });

  it("handles large values", () => {
    const result = formatDuration(86_400_000);
    expect(result).toContain("24h");
  });
});

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toContain("0");
  });

  it("formats small byte counts", () => {
    expect(formatBytes(500)).toContain("500");
    expect(formatBytes(500).toLowerCase()).toContain("b");
  });

  it("formats kilobytes", () => {
    const result = formatBytes(2048);
    expect(result).toMatch(/[12].*KB/i);
  });

  it("formats megabytes", () => {
    const result = formatBytes(5_242_880);
    expect(result).toMatch(/5.*MB/i);
  });

  it("formats gigabytes", () => {
    const result = formatBytes(2_147_483_648);
    expect(result).toMatch(/2.*GB/i);
  });
});
