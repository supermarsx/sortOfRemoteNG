import { useCallback, useEffect, useState } from "react";

/**
 * Hook for reading / writing the **private updater endpoint** runtime
 * setting (see `src-tauri/src/updater_config.rs` + t3-e39).
 *
 * The value is persisted in `<app_data_dir>/settings.json` under
 * `updater.private_endpoint`. On Windows this resolves to
 * `%APPDATA%\com.sortofremote.ng\settings.json` (matches the app identifier
 * in `tauri.conf.json`). The Rust side reads the same key at runtime and
 * augments (never replaces) the public GitHub Releases endpoint baked in
 * at build time.
 *
 * URL validation is intentionally minimal: only `http(s)://` prefixes are
 * accepted. The canonical validation / source of truth lives in Rust —
 * this is a UX guardrail.
 *
 * Safe on pure-web / vitest: if `@tauri-apps/plugin-fs` is unavailable
 * (module load fails), the hook resolves to `{ endpoint: null,
 * available: false }` and the setter is a no-op.
 */
export interface UseUpdaterEndpointResult {
  /** Currently-persisted private endpoint, or `null` if unset. */
  endpoint: string | null;
  /** `true` once the initial read has resolved. */
  loaded: boolean;
  /** `false` when running outside a Tauri shell — setters are no-ops. */
  available: boolean;
  /** Last error from read/write, if any. */
  error: string | null;
  /** Persist (pass `null` to clear). Returns true on success. */
  setEndpoint: (value: string | null) => Promise<boolean>;
}

const SETTINGS_FILE = "settings.json";

function isHttpUrl(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && (t.startsWith("http://") || t.startsWith("https://"));
}

type FsModule = {
  BaseDirectory: { AppData: number };
  readTextFile: (
    p: string,
    o?: { baseDir?: number },
  ) => Promise<string>;
  writeTextFile: (
    p: string,
    data: string,
    o?: { baseDir?: number },
  ) => Promise<void>;
  exists: (p: string, o?: { baseDir?: number }) => Promise<boolean>;
  mkdir?: (p: string, o?: { baseDir?: number; recursive?: boolean }) => Promise<void>;
};

async function loadFs(): Promise<FsModule | null> {
  try {
    const mod = (await import("@tauri-apps/plugin-fs")) as unknown as FsModule;
    return mod;
  } catch {
    return null;
  }
}

function extractPrivateEndpoint(raw: string): string | null {
  try {
    const v = JSON.parse(raw) as { updater?: { private_endpoint?: unknown } };
    const pe = v?.updater?.private_endpoint;
    if (typeof pe === "string" && isHttpUrl(pe)) return pe.trim();
    return null;
  } catch {
    return null;
  }
}

export function useUpdaterEndpoint(): UseUpdaterEndpointResult {
  const [endpoint, setEndpointState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fs = await loadFs();
      if (!fs) {
        if (!cancelled) {
          setAvailable(false);
          setLoaded(true);
        }
        return;
      }
      try {
        const exists = await fs.exists(SETTINGS_FILE, {
          baseDir: fs.BaseDirectory.AppData,
        });
        if (!exists) {
          if (!cancelled) {
            setAvailable(true);
            setLoaded(true);
          }
          return;
        }
        const raw = await fs.readTextFile(SETTINGS_FILE, {
          baseDir: fs.BaseDirectory.AppData,
        });
        if (!cancelled) {
          setEndpointState(extractPrivateEndpoint(raw));
          setAvailable(true);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setAvailable(true);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEndpoint = useCallback(
    async (value: string | null): Promise<boolean> => {
      setError(null);
      if (value !== null && !isHttpUrl(value)) {
        setError("Endpoint must start with http:// or https://");
        return false;
      }
      const fs = await loadFs();
      if (!fs) {
        setError("Tauri fs plugin unavailable");
        return false;
      }
      try {
        let existing: Record<string, unknown> = {};
        try {
          const exists = await fs.exists(SETTINGS_FILE, {
            baseDir: fs.BaseDirectory.AppData,
          });
          if (exists) {
            const raw = await fs.readTextFile(SETTINGS_FILE, {
              baseDir: fs.BaseDirectory.AppData,
            });
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed && typeof parsed === "object") existing = parsed;
          }
        } catch {
          /* fall through to fresh write */
        }

        const updater =
          (existing.updater && typeof existing.updater === "object"
            ? (existing.updater as Record<string, unknown>)
            : {}) ?? {};
        if (value === null) {
          delete updater.private_endpoint;
        } else {
          updater.private_endpoint = value.trim();
        }
        existing.updater = updater;

        if (fs.mkdir) {
          try {
            await fs.mkdir(".", {
              baseDir: fs.BaseDirectory.AppData,
              recursive: true,
            });
          } catch {
            /* directory may already exist */
          }
        }
        await fs.writeTextFile(
          SETTINGS_FILE,
          JSON.stringify(existing, null, 2),
          { baseDir: fs.BaseDirectory.AppData },
        );
        setEndpointState(value);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [],
  );

  return { endpoint, loaded, available, error, setEndpoint };
}

export default useUpdaterEndpoint;
