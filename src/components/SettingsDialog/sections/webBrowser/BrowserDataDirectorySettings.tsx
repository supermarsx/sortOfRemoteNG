import React, { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, RotateCcw, Save } from "lucide-react";
import { Card } from "../../../ui/settings/SettingsPrimitives";
import { TextInput } from "../../../ui/forms/TextInput";

interface BrowserDataDirectory {
  parentDirectory: string | null;
  effectiveDirectory: string;
  activeDirectory: string | null;
  restartRequired: boolean;
}

export default function BrowserDataDirectorySettings() {
  const id = useId();
  const mounted = useRef(true);
  const [location, setLocation] = useState<BrowserDataDirectory | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void invoke<BrowserDataDirectory>("get_browser_data_directory")
      .then((value) => {
        if (cancelled) return;
        setLocation(value);
        setPath(value.parentDirectory ?? "");
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Browser data location could not be read. Choose a folder or restore the default in the desktop app.",
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(
          typeof cause === "string"
            ? cause
            : "The browser data folder could not be changed. Check the folder permissions.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const save = (parentDirectory: string | null) =>
    perform(async () => {
      const value = await invoke<BrowserDataDirectory>(
        "set_browser_data_directory",
        { parentDirectory },
      );
      if (!mounted.current) return;
      setLocation(value);
      setPath(value.parentDirectory ?? "");
      setNotice(
        "Browser data location saved. Restart the app to use it. Existing folders were not moved or deleted.",
      );
    });

  return (
    <Card>
      <section aria-labelledby={`${id}-heading`} className="space-y-3">
        <h3 id={`${id}-heading`} className="text-sm font-medium">
          Browser working data
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Device-local engine installation and working/cache data. Website
          contexts remain isolated and in memory. Retained sign-in cookies stay
          in the owning encrypted database—not in this folder.
        </p>
        <label htmlFor={`${id}-path`} className="block text-sm">
          Parent folder
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            id={`${id}-path`}
            variant="settings"
            value={path}
            onChange={setPath}
            className="min-w-48 flex-1"
            placeholder="Default application data folder"
            disabled={busy}
            aria-describedby={`${id}-help`}
          />
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const selection = await open({
                  directory: true,
                  multiple: false,
                  title: "Choose browser working-data folder",
                });
                if (mounted.current && typeof selection === "string")
                  setPath(selection);
              })
            }
          >
            <FolderOpen size={14} aria-hidden="true" /> Browse…
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={
              busy || !path.trim() || path === location?.parentDirectory
            }
            onClick={() => void save(path)}
          >
            <Save size={14} aria-hidden="true" /> Save location
          </button>
        </div>
        <p
          id={`${id}-help`}
          className="text-xs text-[var(--color-textSecondary)]"
        >
          Choose an existing folder. The app creates its own profile-specific
          subfolder inside it. This location is not synced. Changes take effect
          after restarting; no files are moved or deleted.
        </p>
        {location && (
          <div className="space-y-1 break-all text-xs text-[var(--color-textSecondary)]">
            <p>
              Configured folder:{" "}
              <span className="select-text">{location.effectiveDirectory}</span>
            </p>
            {location.restartRequired && (
              <p>
                Currently using:{" "}
                <span className="select-text">{location.activeDirectory}</span>
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy || !location}
            onClick={() =>
              void perform(async () => {
                await invoke("open_browser_data_directory");
              })
            }
          >
            <FolderOpen size={14} aria-hidden="true" /> Open folder
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={() => void save(null)}
          >
            <RotateCcw size={14} aria-hidden="true" /> Use default folder
          </button>
        </div>
        {error && (
          <p role="alert" className="sor-alert-error text-sm">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="text-xs text-[var(--color-textSecondary)]"
          >
            {notice}
          </p>
        )}
        {!notice && location?.restartRequired && (
          <p role="status" className="text-xs">
            Restart the app to apply the saved location.
          </p>
        )}
      </section>
    </Card>
  );
}
