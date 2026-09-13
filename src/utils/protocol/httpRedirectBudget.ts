/** Runtime-only limits. A larger budget is not destination or login consent. */
export interface HttpRedirectBudget {
  profile: "synology";
  assertCurrent: () => void;
}

export function httpRedirectHandoffLimit(budget?: HttpRedirectBudget): number {
  budget?.assertCurrent();
  return budget?.profile === "synology" ? 20 : 5;
}

export function assertHttpRedirectDepth(depth: number, limit: number): void {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth >= limit)
    throw new Error("Redirect handoff budget exhausted or invalid.");
}
