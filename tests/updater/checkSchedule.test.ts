import { describe, expect, it } from "vitest";
import {
  ANNUAL_CHECK_INTERVAL_HOURS,
  HOUR_MS,
  MAX_BROWSER_TIMER_DELAY_MS,
  MAX_CUSTOM_CHECK_INTERVAL_HOURS,
  MONTHLY_CHECK_INTERVAL_HOURS,
  WEEKLY_CHECK_INTERVAL_HOURS,
  boundedUpdaterTimerDelay,
  checkIntervalMilliseconds,
  checkScheduleForHours,
  clampCustomCheckIntervalHours,
  hoursForCheckSchedule,
  millisecondsUntilNextCheck,
} from "../../src/utils/updater/checkSchedule";

describe("updater check schedules", () => {
  it("maps the named schedules to their exact persisted hour values", () => {
    expect(hoursForCheckSchedule("weekly", 12)).toBe(168);
    expect(hoursForCheckSchedule("monthly", 12)).toBe(720);
    expect(hoursForCheckSchedule("annually", 12)).toBe(8760);
    expect(checkScheduleForHours(WEEKLY_CHECK_INTERVAL_HOURS)).toBe("weekly");
    expect(checkScheduleForHours(MONTHLY_CHECK_INTERVAL_HOURS)).toBe("monthly");
    expect(checkScheduleForHours(ANNUAL_CHECK_INTERVAL_HOURS)).toBe("annually");
  });

  it("keeps custom schedules within 1 to 720 hours", () => {
    expect(clampCustomCheckIntervalHours(0)).toBe(1);
    expect(clampCustomCheckIntervalHours(37.6)).toBe(38);
    expect(clampCustomCheckIntervalHours(721)).toBe(
      MAX_CUSTOM_CHECK_INTERVAL_HOURS,
    );
    expect(hoursForCheckSchedule("custom", Number.NaN)).toBe(24);
    expect(checkScheduleForHours(24)).toBe("custom");
  });

  it.each([
    ["weekly", WEEKLY_CHECK_INTERVAL_HOURS],
    ["monthly", MONTHLY_CHECK_INTERVAL_HOURS],
    ["annually", ANNUAL_CHECK_INTERVAL_HOURS],
  ] as const)(
    "becomes due at the exact %s boundary",
    (_schedule, intervalHours) => {
      const now = Date.parse("2026-08-31T12:00:00Z");
      const lastCheckedOneHourBeforeBoundary = new Date(
        now - (intervalHours - 1) * HOUR_MS,
      ).toISOString();
      const lastCheckedAtBoundary = new Date(
        now - intervalHours * HOUR_MS,
      ).toISOString();
      const intervalMs = checkIntervalMilliseconds(intervalHours, 0);

      expect(
        millisecondsUntilNextCheck(
          intervalMs,
          lastCheckedOneHourBeforeBoundary,
          now,
        ),
      ).toBe(HOUR_MS);
      expect(
        millisecondsUntilNextCheck(intervalMs, lastCheckedAtBoundary, now),
      ).toBe(0);
    },
  );

  it("caps long native timers instead of overflowing the browser timer range", () => {
    const monthlyMs = checkIntervalMilliseconds(
      MONTHLY_CHECK_INTERVAL_HOURS,
      0,
    );
    const annualMs = checkIntervalMilliseconds(ANNUAL_CHECK_INTERVAL_HOURS, 0);

    expect(monthlyMs).toBeGreaterThan(MAX_BROWSER_TIMER_DELAY_MS);
    expect(annualMs).toBeGreaterThan(MAX_BROWSER_TIMER_DELAY_MS);
    expect(boundedUpdaterTimerDelay(monthlyMs)).toBe(
      MAX_BROWSER_TIMER_DELAY_MS,
    );
    expect(boundedUpdaterTimerDelay(annualMs)).toBe(MAX_BROWSER_TIMER_DELAY_MS);
  });
});
