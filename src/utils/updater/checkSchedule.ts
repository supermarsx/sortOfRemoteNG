export const MIN_CUSTOM_CHECK_INTERVAL_HOURS = 1;
export const MAX_CUSTOM_CHECK_INTERVAL_HOURS = 24 * 30;
export const WEEKLY_CHECK_INTERVAL_HOURS = 24 * 7;
export const MONTHLY_CHECK_INTERVAL_HOURS = MAX_CUSTOM_CHECK_INTERVAL_HOURS;
export const ANNUAL_CHECK_INTERVAL_HOURS = 24 * 365;

export const HOUR_MS = 60 * 60 * 1000;
export const MAX_BROWSER_TIMER_DELAY_MS = 2_147_483_647;

export type UpdaterCheckSchedule = "custom" | "weekly" | "monthly" | "annually";

export function checkScheduleForHours(hours: number): UpdaterCheckSchedule {
  switch (hours) {
    case WEEKLY_CHECK_INTERVAL_HOURS:
      return "weekly";
    case MONTHLY_CHECK_INTERVAL_HOURS:
      return "monthly";
    case ANNUAL_CHECK_INTERVAL_HOURS:
      return "annually";
    default:
      return "custom";
  }
}

export function clampCustomCheckIntervalHours(hours: number): number {
  if (!Number.isFinite(hours)) return 24;
  return Math.max(
    MIN_CUSTOM_CHECK_INTERVAL_HOURS,
    Math.min(MAX_CUSTOM_CHECK_INTERVAL_HOURS, Math.round(hours)),
  );
}

export function hoursForCheckSchedule(
  schedule: UpdaterCheckSchedule,
  customHours: number,
): number {
  switch (schedule) {
    case "weekly":
      return WEEKLY_CHECK_INTERVAL_HOURS;
    case "monthly":
      return MONTHLY_CHECK_INTERVAL_HOURS;
    case "annually":
      return ANNUAL_CHECK_INTERVAL_HOURS;
    case "custom":
    default:
      return clampCustomCheckIntervalHours(customHours);
  }
}

export function checkIntervalMilliseconds(
  hours: number,
  minimumMilliseconds: number,
): number {
  const configured = Math.max(1, hours) * HOUR_MS;
  return Math.max(0, minimumMilliseconds, configured);
}

export function millisecondsUntilNextCheck(
  intervalMilliseconds: number,
  lastCheckedAt: string | null | undefined,
  nowMilliseconds = Date.now(),
): number {
  if (!lastCheckedAt) return 0;
  const parsed = Date.parse(lastCheckedAt);
  if (!Number.isFinite(parsed)) return 0;
  const elapsed = Math.max(0, nowMilliseconds - parsed);
  return Math.max(0, intervalMilliseconds - elapsed);
}

export function boundedUpdaterTimerDelay(delayMilliseconds: number): number {
  if (!Number.isFinite(delayMilliseconds)) return MAX_BROWSER_TIMER_DELAY_MS;
  return Math.max(
    0,
    Math.min(Math.round(delayMilliseconds), MAX_BROWSER_TIMER_DELAY_MS),
  );
}
