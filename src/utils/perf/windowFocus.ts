/**
 * Shared window focus store (background lane only). Defaults to "focused" so
 * environments that never emit focus/blur (tests, SSR) behave as before.
 */
let focused = true;
const subs = new Set<() => void>();
let wired = false;

function set(next: boolean) {
  if (next === focused) return;
  focused = next;
  for (const cb of [...subs]) cb();
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("focus", () => set(true));
  window.addEventListener("blur", () => set(false));
}

export function isWindowFocused(): boolean {
  return focused;
}

export function subscribeWindowFocus(cb: () => void): () => void {
  wire();
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
