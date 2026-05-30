/**
 * Tauri-2-aware `invoke()` accessor.
 *
 * In Tauri 1.x and in Tauri 2.x with `app.withGlobalTauri: true`, the
 * runtime injects `window.__TAURI__.core.invoke` and synchronous lookups
 * work. In a default Tauri 2 build (which this app uses) that global is
 * **not** injected and code must import `@tauri-apps/api/core`
 * dynamically.
 *
 * This helper memoises the resolved `invoke` across both worlds so
 * call sites can stay agnostic:
 *
 * ```ts
 * const invoke = await getInvoke();
 * if (invoke) await invoke('my_command', { foo: 1 });
 * ```
 *
 * Returns `null` outside Tauri (jsdom tests, plain browser dev server)
 * so callers can fall through to their browser-side fallback (typically
 * IndexedDB).
 */

export type TauriInvoke = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

let cached: Promise<TauriInvoke | null> | null = null;

export function getInvoke(): Promise<TauriInvoke | null> {
  if (!cached) {
    cached = resolveInvoke();
  }
  return cached;
}

async function resolveInvoke(): Promise<TauriInvoke | null> {
  // 1) Legacy global path (Tauri 1.x, or Tauri 2 with withGlobalTauri:true).
  const legacy = (
    globalThis as { __TAURI__?: { core?: { invoke?: unknown } } }
  ).__TAURI__?.core?.invoke;
  if (typeof legacy === 'function') {
    return legacy as TauriInvoke;
  }
  // 2) ESM import — the Tauri 2 native path. The import resolves
  //    everywhere the package is installed (production webview, jsdom
  //    tests, plain `npm run dev` browser), so we additionally call
  //    `isTauri()` to distinguish "real Tauri shell with a working IPC
  //    channel" from "module loaded in a jsdom/browser context where
  //    invoke would fail". Returning `null` for the latter lets
  //    callers fall through to their non-Tauri persistence path
  //    instead of attempting an IPC that will always fail.
  try {
    const mod = await import('@tauri-apps/api/core');
    const inside = typeof mod.isTauri === 'function' ? mod.isTauri() : false;
    if (!inside) return null;
    return mod.invoke as unknown as TauriInvoke;
  } catch {
    return null;
  }
}

/**
 * Reset the memo. Test-only escape hatch — production code should never
 * call this.
 */
export function _resetInvokeCache(): void {
  cached = null;
}
