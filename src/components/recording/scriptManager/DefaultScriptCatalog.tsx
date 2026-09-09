import React, { useEffect, useMemo, useState } from "react";
import { defaultScriptCatalog } from "../../../data/defaultScriptCatalog";
import { defaultScripts } from "../../../data/defaultScripts";
import {
  managedScriptsStore,
  type PersistedManagedScripts,
} from "../../../utils/recording/managedScriptPersistence";
import { applyDefaultScriptSelection } from "../../../utils/recording/defaultScriptCatalog";
import { Modal } from "../../ui/overlays/Modal";
import HighlightedCode from "../../ui/display/HighlightedCode";

export function DefaultScriptCatalog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: (value: PersistedManagedScripts) => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    value: PersistedManagedScripts | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(defaultScriptCatalog[0]);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void managedScriptsStore
      .load()
      .then((result) => {
        if (live) setSnapshot({ value: result.value });
      })
      .catch(() => {
        if (live)
          setError(
            "The existing script library could not be read. Close and reopen this catalog after unlocking storage; nothing has been imported.",
          );
      });
    return () => {
      live = false;
    };
  }, []);
  const filtered = useMemo(
    () =>
      defaultScriptCatalog.filter(
        (item) =>
          (!platform || item.osTags.includes(platform as never)) &&
          (!category || item.category === category) &&
          `${item.name} ${item.description}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [search, platform, category],
  );
  const replacements = selected.filter((id) =>
    snapshot?.value?.modifiedDefaults.some((item) => item.id === id),
  );
  const toggle = (id: string) => {
    setOverwrite(false);
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((key) => key !== id)
        : [...previous, id],
    );
  };
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      ariaLabel="Default script catalog"
      panelClassName="w-[min(64rem,calc(100vw-2rem))] max-h-[85vh] overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
        <h2 className="font-semibold">
          Default script catalog · {defaultScriptCatalog.length} templates
        </h2>
        <button
          type="button"
          className="sor-icon-btn"
          aria-label="Close default script catalog"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="min-h-0 overflow-auto p-4 space-y-3">
        <p className="text-sm">
          Browse read-only diagnostics by system and package manager. New
          catalog templates are imported as custom copies; restoring an original
          default keeps its ID. Nothing runs during import.
        </p>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="Search default scripts"
            className="sor-form-input min-w-0 flex-1"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search templates"
          />
          <select
            aria-label="Default script category"
            className="sor-form-input max-w-full"
            style={{ width: "auto" }}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {Array.from(
              new Set(defaultScriptCatalog.map((item) => item.category)),
            )
              .sort()
              .map((value) => (
                <option key={value}>{value}</option>
              ))}
          </select>
          <select
            aria-label="Default script platform"
            className="sor-form-input max-w-full"
            style={{ width: "auto" }}
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option value="">All platforms</option>
            {["linux", "windows", "macos", "agnostic"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div
            className="max-h-80 overflow-auto space-y-1"
            aria-label="Default script choices"
          >
            {filtered.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded border border-[var(--color-border)] p-2"
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${item.name}`}
                  checked={selected.includes(item.id)}
                  disabled={busy}
                  onChange={() => toggle(item.id)}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm"
                  onClick={() => setPreview(item)}
                >
                  <span className="block truncate">{item.name}</span>
                  <span className="text-xs text-[var(--color-textMuted)]">
                    {item.category} ·{" "}
                    {defaultScripts.some((script) => script.id === item.id)
                      ? "Original default"
                      : "Import custom copy"}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{preview.name}</h3>
            <p className="my-2 text-xs">{preview.description}</p>
            <pre className="max-h-64 overflow-auto rounded bg-[var(--color-background)] p-3 text-xs whitespace-pre-wrap break-words">
              <HighlightedCode
                code={preview.script}
                language={preview.language}
              />
            </pre>
          </div>
        </div>
        {replacements.length > 0 && (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            Replace the {replacements.length} selected saved default versions
            with shipped content. Custom scripts and other defaults are
            preserved.
          </label>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)] p-4">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={
            !snapshot ||
            busy ||
            !selected.length ||
            (replacements.length > 0 && !overwrite)
          }
          onClick={async () => {
            if (!snapshot) return;
            setBusy(true);
            setError(null);
            try {
              const result = await applyDefaultScriptSelection(
                selected,
                snapshot.value,
                overwrite,
              );
              onApplied(result.value);
              onClose();
            } catch {
              setError(
                "Import was not applied. The library may have changed or storage is unavailable. Close and reopen to review it again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Importing…" : `Import / restore ${selected.length} selected`}
        </button>
      </div>
    </Modal>
  );
}
