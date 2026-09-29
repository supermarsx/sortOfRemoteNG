import type { TauriInvoke } from "../tauri/invoke";

/** A caller-owned, monotonic access receipt; abort also cancels the backoff. */
export interface MacroLibraryReadAccess {
  signal: AbortSignal;
  assertCurrent: () => void;
}

// Compatibility for native builds that reject coordinator contention before
// policy/file reads. Updated IPC handlers queue instead. Do not broaden these
// exact matches to generic I/O errors or errors from a write command.
const PRE_READ_BUSY =
  "Storage error: encryption storage transition in progress; retry after it completes";
// Storage.load_data's coordinator guard is before app-data policy/file reads.
const APP_DATA_PRE_READ_BUSY =
  "encryption storage transition in progress; retry after it completes";
const ROUTINE_WRITE_BUSY =
  "storage write in progress; retry after it completes";
const MACRO_ROUTINE_WRITE_BUSY = `Storage error: ${ROUTINE_WRITE_BUSY}`;
const RETRY_DELAYS_MS = [100, 250, 500] as const;

const reason = (error: unknown): unknown =>
  error instanceof Error ? error.message : error;

export const isMacroLibraryReadBusy = (error: unknown): boolean =>
  reason(error) === PRE_READ_BUSY || reason(error) === MACRO_ROUTINE_WRITE_BUSY;
export const isAppDataReadBusy = (error: unknown): boolean =>
  reason(error) === APP_DATA_PRE_READ_BUSY ||
  reason(error) === ROUTINE_WRITE_BUSY;
export const isLibraryStorageWriteBusy = (error: unknown): boolean =>
  reason(error) === ROUTINE_WRITE_BUSY ||
  reason(error) === MACRO_ROUTINE_WRITE_BUSY;

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
async function readWhenReady(
  invoke: TauriInvoke,
  key: string,
  access: MacroLibraryReadAccess,
  command: "read_macro_library" | "read_app_data",
  isPreReadBusy: (error: unknown) => boolean,
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    assertMacroLibraryReadAccess(access);
    try {
      const raw = await invoke<string | null>(command, { key });
      assertMacroLibraryReadAccess(access);
      return raw;
    } catch (error) {
      assertMacroLibraryReadAccess(access);
      if (!isPreReadBusy(error) || attempt >= RETRY_DELAYS_MS.length)
        throw error;
    }
    await pause(RETRY_DELAYS_MS[attempt], access);
  }
}

export const readMacroLibraryWhenReady = (
  invoke: TauriInvoke,
  key: string,
  access: MacroLibraryReadAccess,
) =>
  readWhenReady(
    invoke,
    key,
    access,
    "read_macro_library",
    isMacroLibraryReadBusy,
  );

export const readAppDataWhenReady = (
  invoke: TauriInvoke,
  key: string,
  access: MacroLibraryReadAccess,
) => readWhenReady(invoke, key, access, "read_app_data", isAppDataReadBusy);
