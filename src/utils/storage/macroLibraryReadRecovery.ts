import type { TauriInvoke } from "../tauri/invoke";

/** A caller-owned, monotonic access receipt; abort also cancels the backoff. */
export interface MacroLibraryReadAccess {
  signal: AbortSignal;
  assertCurrent: () => void;
}

// RecordingService::capture_storage_guard returns this before policy/file reads.
// Do not broaden this to generic I/O errors or errors from a write command.
const PRE_READ_BUSY =
  "Storage error: encryption storage transition in progress; retry after it completes";
const RETRY_DELAYS_MS = [100, 250, 500] as const;

export const isMacroLibraryReadBusy = (error: unknown): boolean =>
  (error instanceof Error ? error.message : error) === PRE_READ_BUSY;

export function assertMacroLibraryReadAccess(access?: MacroLibraryReadAccess) {
  if (access?.signal.aborted)
    throw new Error("Library access changed. Reload before continuing.");
  access?.assertCurrent();
}

function pause(ms: number, access: MacroLibraryReadAccess): Promise<void> {
  assertMacroLibraryReadAccess(access);
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      access.signal.removeEventListener("abort", aborted);
      reject(new Error("Library access changed. Reload before continuing."));
    };
    const timer = setTimeout(() => {
      access.signal.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    access.signal.addEventListener("abort", aborted, { once: true });
  });
}

/** Retry only the initial native read, never a load, migration or CAS write. */
export async function readMacroLibraryWhenReady(
  invoke: TauriInvoke,
  key: string,
  access: MacroLibraryReadAccess,
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    assertMacroLibraryReadAccess(access);
    try {
      const raw = await invoke<string | null>("read_macro_library", { key });
      assertMacroLibraryReadAccess(access);
      return raw;
    } catch (error) {
      assertMacroLibraryReadAccess(access);
      if (!isMacroLibraryReadBusy(error) || attempt >= RETRY_DELAYS_MS.length)
        throw error;
    }
    await pause(RETRY_DELAYS_MS[attempt], access);
  }
}
