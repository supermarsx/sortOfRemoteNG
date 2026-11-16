import { useEffect, useState } from "react";

/**
 * Counts down the seconds left until the secure clipboard clears. `copy` is
 * the last successful copy (a new object per copy restarts the timer); the
 * hook returns 0 when nothing is pending. It only mirrors the clear time the
 * clipboard bridge was asked for; it holds no copied value.
 */
export function useCopyCountdown(
  copy: { seconds: number; at: number } | null,
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!copy) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= copy.at + copy.seconds * 1000) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [copy]);
  if (!copy) return 0;
  return Math.max(0, Math.ceil((copy.at + copy.seconds * 1000 - now) / 1000));
}
