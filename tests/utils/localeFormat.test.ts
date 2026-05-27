import { describe, it, expect } from "vitest";
import {
  getEffectiveLocale,
  formatTime,
  formatDateTime,
} from "../../src/utils/i18n/localeFormat";

describe("getEffectiveLocale", () => {
  it("uses the explicit language when auto-detect is off", () => {
    expect(
      getEffectiveLocale({ language: "pt-PT", autoDetectOsLanguage: false }),
    ).toBe("pt-PT");
  });

  it("combines base language with an explicit region", () => {
    expect(
      getEffectiveLocale({
        language: "en-US",
        autoDetectOsLanguage: false,
        region: "GB",
      }),
    ).toBe("en-GB");
  });

  it("ignores region when set to auto", () => {
    expect(
      getEffectiveLocale({
        language: "en-US",
        autoDetectOsLanguage: false,
        region: "auto",
      }),
    ).toBe("en-US");
  });

  it("derives from navigator when auto-detect is on", () => {
    expect(
      getEffectiveLocale(
        { autoDetectOsLanguage: true },
        "fr-CA",
      ),
    ).toBe("fr-FR");
  });
});

describe("formatTime", () => {
  const date = new Date("2026-01-02T13:30:00Z");

  it("renders 24-hour clock when forced", () => {
    const out = formatTime(date, {
      language: "en-US",
      autoDetectOsLanguage: false,
      timeFormat: "24h",
      timeZone: "UTC",
    });
    expect(out).toMatch(/13:30/);
  });

  it("renders 12-hour clock when forced", () => {
    const out = formatTime(date, {
      language: "en-US",
      autoDetectOsLanguage: false,
      timeFormat: "12h",
      timeZone: "UTC",
    });
    expect(out).toMatch(/1:30/);
    expect(out.toLowerCase()).toMatch(/pm/);
  });
});

describe("formatDateTime", () => {
  it("applies an explicit time zone", () => {
    const date = new Date("2026-01-02T23:30:00Z");
    const tokyo = formatDateTime(date, {
      language: "en-US",
      autoDetectOsLanguage: false,
      timeFormat: "24h",
      timeZone: "Asia/Tokyo",
    });
    // 23:30 UTC is 08:30 next day in Tokyo (UTC+9).
    expect(tokyo).toMatch(/08:30/);
  });

  it("never throws on an invalid specialty option", () => {
    expect(() =>
      formatDateTime(new Date(), {
        language: "en-US",
        autoDetectOsLanguage: false,
        timeZone: "Not/AReal_Zone",
      }),
    ).not.toThrow();
  });
});
