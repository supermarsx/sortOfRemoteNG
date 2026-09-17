// Worker-side half of the e2e profile-isolation guard (t91).
//
// The launcher's driver service proves the binary's identity and publishes the
// verified probe before any worker starts. Each worker then re-checks that
// proof before its session launches the app, and before any spec runs it asks
// the running app (through the Tauri path plugin) where its profile lives and
// checks that WebView2 writes into the per-run folder, not the identifier
// default.
//
// WDIO logs and swallows errors thrown from `beforeSession`/`before` hooks, so a
// thrown assertion alone would let the specs run anyway. The `enforce*`
// functions therefore record the abort for the run and exit the worker process.
import {
  PROFILE_DIRECTORY_KEYS,
  TAURI_PATH_DIRECTORY,
  assertResolvedProfileDirectories,
  assertWebView2Evidence,
  markRunAborted,
  verifyWorkerPreflight,
  type ProfileDirectories,
  type ProfileProbe,
} from "../../scripts/lib/e2e-profile-isolation.mjs";

const RESOLVE_TIMEOUT_MS = 30_000;

/** The verified isolated profile of this run; throws if preflight is unproven. */
export function publishedProfile(): ProfileProbe {
  return verifyWorkerPreflight().probe;
}

/** The isolated app data directory (where `databases/` lives) for this run. */
export function isolatedAppDataDir(): string {
  return publishedProfile().dirs.appData;
}

/** The isolated SSH home (`<appData>/ssh-home`) the app uses instead of `~`. */
export function isolatedSshHome(): string {
  const { sshHome } = publishedProfile();
  if (!sshHome) {
    throw new Error("The verified probe reports no isolated SSH home.");
  }
  return sshHome;
}

type DirectoryRequest = { key: string; directory: number };

type ResolveOutcome = {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
};

async function resolveAppDirectories(): Promise<Record<string, unknown>> {
  const requests: DirectoryRequest[] = PROFILE_DIRECTORY_KEYS.map((key) => ({
    key,
    directory: TAURI_PATH_DIRECTORY[key],
  }));
  const original = await browser.getWindowHandle().catch(() => undefined);
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  let lastError = "no app window answered";

  while (Date.now() < deadline) {
    const handles = await browser
      .getWindowHandles()
      .catch(() => [] as string[]);
    for (const handle of handles) {
      const switched = await browser
        .switchToWindow(handle)
        .then(() => true)
        .catch(() => false);
      if (!switched) {
        continue;
      }
      const outcome = (await browser
        .executeAsync(
          (
            directories: DirectoryRequest[],
            done: (value: ResolveOutcome) => void,
          ) => {
            // The splash window has no IPC access; the main window does.
            const globals = globalThis as {
              __TAURI_INTERNALS__?: {
                invoke?: (c: string, a?: unknown) => Promise<unknown>;
              };
              __TAURI__?: {
                core?: {
                  invoke?: (c: string, a?: unknown) => Promise<unknown>;
                };
              };
            };
            const bridge =
              globals.__TAURI_INTERNALS__?.invoke ??
              globals.__TAURI__?.core?.invoke;
            if (typeof bridge !== "function") {
              done({ ok: false, error: "the Tauri bridge is not available" });
              return;
            }
            Promise.all(
              directories.map(({ key, directory }) =>
                bridge("plugin:path|resolve_directory", { directory }).then(
                  (value) => [key, value] as const,
                ),
              ),
            )
              .then((entries) => {
                const value: Record<string, unknown> = {};
                for (const [key, resolved] of entries) {
                  value[key] = resolved;
                }
                done({ ok: true, value });
              })
              .catch((error: unknown) =>
                done({ ok: false, error: String(error) }),
              );
          },
          requests,
        )
        .catch((error: unknown): ResolveOutcome => ({
          ok: false,
          error: String(error),
        }))) as ResolveOutcome;

      if (outcome.ok && outcome.value) {
        if (original && original !== handle) {
          await browser.switchToWindow(original).catch(() => undefined);
        }
        return outcome.value;
      }
      lastError = outcome.error ?? lastError;
    }
    await browser.pause(250);
  }

  throw new Error(
    `The app's profile directories could not be resolved through the Tauri path plugin within ${RESOLVE_TIMEOUT_MS} ms (${lastError}).`,
  );
}

/**
 * Throws unless the launcher preflight passed for a live run, the running app
 * resolves AppData, AppLocalData, AppConfig, AppCache and AppLog to the
 * verified isolated probe directories, and WebView2 populated the per-run
 * folder while the identifier-default folder stayed absent.
 */
export async function assertWorkerProfileIsolated(): Promise<ProfileDirectories> {
  const { probe, runProfile } = verifyWorkerPreflight();
  const resolved = await resolveAppDirectories();
  const directories = assertResolvedProfileDirectories(probe, resolved);
  await assertWebView2Evidence({ probe, runProfile });
  return directories;
}

function exitWorker(error: unknown, abortRun: boolean): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[e2e-isolation] worker refused: ${message}`);
  if (abortRun) {
    try {
      const { identifier, runId } = verifyWorkerPreflight();
      markRunAborted({ identifier, runId, reason: message });
    } catch {
      // Without a live run there is nothing to mark; exiting is enough.
    }
  }
  process.exit(1);
}

/** `beforeSession`: refuse before this worker's session launches the app. */
export function enforceWorkerPreflight(): void {
  try {
    verifyWorkerPreflight();
  } catch (error) {
    exitWorker(error, false);
  }
}

/** `before`: refuse before any spec runs against an app outside its profile. */
export async function enforceWorkerProfileIsolation(): Promise<void> {
  try {
    await assertWorkerProfileIsolated();
  } catch (error) {
    await browser.deleteSession().catch(() => undefined);
    exitWorker(error, true);
  }
}
