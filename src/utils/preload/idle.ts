/** Run `task` when the browser is idle; falls back to a timer (tests, WebView2 gaps). */
export function scheduleIdle(task: () => void, timeoutMs = 2000): () => void {
  const win = typeof window === "undefined" ? undefined : window;
  if (win && typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(task, { timeout: timeoutMs });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = setTimeout(task, Math.min(timeoutMs, 200));
  return () => clearTimeout(id);
}
