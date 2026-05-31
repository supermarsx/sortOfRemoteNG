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

/**
 * Cached result of the ESM import branch. Not used for the legacy
 * global lookup because (a) reading `globalThis.__TAURI__` is free and
 * (b) tests rely on mutating that global between assertions to swap in
 * a mock invoke.
 */
let esmInvokeCache: Promise<TauriInvoke | null> | null = null;

export async function getInvoke(): Promise<TauriInvoke | null> {
  // 1) Legacy global path (Tauri 1.x, Tauri 2 with withGlobalTauri:true,
  //    or test fixtures that stub the global). Cheap, never cached.
  const legacy = (
    globalThis as { __TAURI__?: { core?: { invoke?: unknown } } }
  ).__TAURI__?.core?.invoke;
  if (typeof legacy === 'function') {
    return legacy as TauriInvoke;
  }
  // 2) ESM import — the Tauri 2 native path. Cached because the import
  //    is expensive and the answer ("are we inside a Tauri shell?")
  //    doesn't change across the app's lifetime.
  if (!esmInvokeCache) {
    esmInvokeCache = resolveInvokeViaEsm();
  }
  return esmInvokeCache;
}

async function resolveInvokeViaEsm(): Promise<TauriInvoke | null> {
  try {
    const mod = await import('@tauri-apps/api/core');
    // `isTauri()` checks `window.__TAURI_INTERNALS__`, which the Tauri 2
    // runtime always injects. Outside a real shell (jsdom tests, plain
    // browser) it returns `false` so we return `null` instead of an
    // invoke that would always fail.
    const inside = typeof mod.isTauri === 'function' ? mod.isTauri() : false;
    if (!inside) return null;
    return mod.invoke as unknown as TauriInvoke;
  } catch {
    return null;
  }
}

/**
 * Reset the ESM-branch memo. Test-only escape hatch — production code
 * should never call this.
 */
export function _resetInvokeCache(): void {
  esmInvokeCache = null;
}
