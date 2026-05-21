/**
 * CloneTab — third sub-tab of the Import/Export tool.
 *
 * Runs the same source/filter pipeline as ExportTab but writes the
 * filtered connections into one or more *other* databases instead of
 * a file. The "what to clone" controls intentionally mirror Export
 * (same scope semantics, same inclusion filter shape) so users don't
 * need to learn a new mental model; the "where to put it" controls
 * mirror Import (conflict policy, addTags, preserveFolders) for the
 * same reason.
 *
 * Sidecars (VPN / proxy / tunnel chain templates) are *global* — both
 * databases see the same pool — so this tab doesn't need to copy
 * them across. The filter therefore only exposes connection-level
 * knobs (protocols, ids, tags, color tags); the proxy/VPN sections
 * from ExportTab are deliberately omitted.
 */

import React, { useMemo, useState } from "react";
import {
  Copy,
  Database,
  FolderTree,
  Settings,
  Tags,
  ArrowRight,
  Server,
} from "lucide-react";
import type { Connection } from "../../types/connection/connection";
import type {
  ExportDatabaseOption,
  ExportInclusionConfig,
  ExportScopeMode,
  ImportOptions,
  CloneResult,
} from "./types";
import { AccordionSection } from "./AccordionSection";
import { Select } from "../ui/forms";

interface CloneTabProps {
  connections: Connection[];

  // Source half
  sourceMode: ExportScopeMode;
  setSourceMode: (mode: ExportScopeMode) => void;
  selectedSourceDatabaseIds: string[];
  setSelectedSourceDatabaseIds: (ids: string[]) => void;
  inclusion: ExportInclusionConfig;
  updateInclusion: (updates: Partial<ExportInclusionConfig>) => void;

  // Destination half
  targetDatabaseIds: string[];
  setTargetDatabaseIds: (ids: string[]) => void;
  conflictPolicy: ImportOptions["conflictPolicy"];
  setConflictPolicy: (policy: ImportOptions["conflictPolicy"]) => void;
  addTags: string;
  setAddTags: (tags: string) => void;
  preserveFolders: boolean;
  setPreserveFolders: (value: boolean) => void;
  includeCredentials: boolean;
  setIncludeCredentials: (value: boolean) => void;
  switchToTargetAfterClone: boolean;
  setSwitchToTargetAfterClone: (value: boolean) => void;

  // Action
  databaseOptions: ExportDatabaseOption[];
  isCloning: boolean;
  cloneResult: CloneResult | null;
  onClone: () => void;
  onClearResult: () => void;
}

const CloneTab: React.FC<CloneTabProps> = ({
  connections,
  sourceMode,
  setSourceMode,
  selectedSourceDatabaseIds,
  setSelectedSourceDatabaseIds,
  inclusion,
  updateInclusion,
  targetDatabaseIds,
  setTargetDatabaseIds,
  conflictPolicy,
  setConflictPolicy,
  addTags,
  setAddTags,
  preserveFolders,
  setPreserveFolders,
  includeCredentials,
  setIncludeCredentials,
  switchToTargetAfterClone,
  setSwitchToTargetAfterClone,
  databaseOptions,
  isCloning,
  cloneResult,
  onClone,
  onClearResult,
}) => {
  const [openSections, setOpenSections] = useState({
    source: true,
    filter: false,
    destination: true,
    preview: true,
  });
  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ─── Derived: effective source ids ──────────────────────────────
  const effectiveSourceIds = useMemo(() => {
    const exportable = new Set(
      databaseOptions
        .filter((option) => option.isExportable)
        .map((option) => option.id),
    );
    if (sourceMode === "current") {
      const current = databaseOptions.find(
        (option) => option.isCurrent && option.isExportable,
      );
      return current ? [current.id] : [];
    }
    if (sourceMode === "all") {
      return [...exportable];
    }
    return selectedSourceDatabaseIds.filter((id) => exportable.has(id));
  }, [databaseOptions, sourceMode, selectedSourceDatabaseIds]);

  const effectiveSourceSet = useMemo(
    () => new Set(effectiveSourceIds),
    [effectiveSourceIds],
  );

  // Target options exclude any source-selected database — we never
  // want the user to clone a database onto itself.
  const targetOptions = useMemo(
    () =>
      databaseOptions.filter(
        (option) => !effectiveSourceSet.has(option.id),
      ),
    [databaseOptions, effectiveSourceSet],
  );

  // Resolve target option lookups for the action button label.
  const targetOptionsById = useMemo(
    () => new Map(databaseOptions.map((option) => [option.id, option])),
    [databaseOptions],
  );

  // Filter preview count — leaf connections only that match the
  // current inclusion's filter knobs. Folders are excluded from the
  // count because the user thinks in connections, not folders.
  const previewCount = useMemo(() => {
    if (!inclusion.includeConnections) return 0;
    const includedProtocolSet =
      inclusion.includedProtocols.length > 0
        ? new Set(inclusion.includedProtocols)
        : null;
    const includedIdSet =
      (inclusion.includedConnectionIds ?? []).length > 0
        ? new Set(inclusion.includedConnectionIds)
        : null;
    const includedTextTagSet =
      (inclusion.includedTextTags ?? []).length > 0
        ? new Set(inclusion.includedTextTags)
        : null;
    const includedColorSet =
      (inclusion.includedColorTagIds ?? []).length > 0
        ? new Set(inclusion.includedColorTagIds)
        : null;

    return connections.filter((connection) => {
      if (connection.isGroup) return false;
      if (
        includedProtocolSet &&
        !includedProtocolSet.has(connection.protocol)
      ) {
        return false;
      }
      if (includedIdSet && !includedIdSet.has(connection.id)) return false;
      if (
        includedTextTagSet &&
        !(connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))
      ) {
        return false;
      }
      if (
        includedColorSet &&
        (connection.colorTag == null ||
          !includedColorSet.has(connection.colorTag))
      ) {
        return false;
      }
      return true;
    }).length;
  }, [connections, inclusion]);

  // Validation gates for the action button.
  const targetOverlapsSource = targetDatabaseIds.some((id) =>
    effectiveSourceSet.has(id),
  );
  const hasEnabledTarget = targetDatabaseIds.some((id) => {
    const option = targetOptionsById.get(id);
    return option?.isExportable;
  });
  const canClone =
    !isCloning &&
    effectiveSourceIds.length > 0 &&
    targetDatabaseIds.length > 0 &&
    !targetOverlapsSource &&
    hasEnabledTarget &&
    previewCount > 0;

  const buttonLabel = (() => {
    if (isCloning) return "Cloning…";
    if (effectiveSourceIds.length === 0) return "Pick a source database";
    if (targetDatabaseIds.length === 0) return "Pick a target database";
    if (previewCount === 0) return "Nothing to clone with this filter";
    if (targetOverlapsSource) return "Target overlaps with source";
    if (!hasEnabledTarget) return "Unlock target database to clone";
    if (targetDatabaseIds.length === 1) {
      const targetName =
        targetOptionsById.get(targetDatabaseIds[0])?.name ?? "target";
      return `Clone ${previewCount} to ${targetName}`;
    }
    return `Clone ${previewCount} to ${targetDatabaseIds.length} databases`;
  })();

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
          Clone
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          Copy connections from one or more source databases into another
          database (or several) in this app. Same filters as Export — but
          the result lands in another database instead of a file. Global
          sidecar settings (proxies, VPN profiles, tunnel chain
          templates) are shared between databases and don't need to be
          copied.
        </p>
      </div>

      {/* ── Source ────────────────────────────────────────────── */}
      <AccordionSection
        id="clone-source"
        title="Source"
        description="Pick which database(s) to clone connections from."
        icon={Database}
        open={openSections.source}
        onToggle={() => toggle("source")}
        dataTestId="clone-source-section"
        badge={
          <span className="text-[var(--color-textMuted)]">
            {effectiveSourceIds.length}{' '}
            {effectiveSourceIds.length === 1 ? 'database' : 'databases'}
          </span>
        }
      >
        {/*
          Button-card row, mirroring ExportTab's scope picker so the
          two halves of the tool feel consistent. Each card is a
          `role=radio` button with a label + a one-line description
          underneath; the active card lights up in the primary colour.
        */}
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Clone source scope"
        >
          {(
            [
              {
                value: "current",
                label: "Current database",
                description: "Just the database that's open right now.",
              },
              {
                value: "selected",
                label: "Selected databases",
                description: "Pick one or more from the list below.",
              },
              {
                value: "all",
                label: "All databases",
                description: "Every unlocked exportable database.",
              },
            ] as Array<{
              value: ExportScopeMode;
              label: string;
              description: string;
            }>
          ).map((option) => {
            const active = sourceMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`clone-source-mode-${option.value}`}
                onClick={() => setSourceMode(option.value)}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/15 text-[var(--color-text)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:border-primary/60 hover:text-[var(--color-text)]"
                }`}
              >
                <span className="block text-sm font-medium">
                  {option.label}
                </span>
                <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
        {sourceMode === "selected" && (
          <div className="mt-2 space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 max-h-48 overflow-y-auto">
            {databaseOptions.length === 0 ? (
              <p className="text-xs text-[var(--color-textMuted)]">
                No databases available.
              </p>
            ) : (
              databaseOptions.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-center gap-2 text-xs ${
                    option.isExportable
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-textMuted)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSourceDatabaseIds.includes(option.id)}
                    disabled={!option.isExportable}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSourceDatabaseIds([
                          ...selectedSourceDatabaseIds,
                          option.id,
                        ]);
                      } else {
                        setSelectedSourceDatabaseIds(
                          selectedSourceDatabaseIds.filter((id) => id !== option.id),
                        );
                      }
                    }}
                  />
                  <span className="flex-1 truncate">{option.name}</span>
                  {option.isCurrent && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      current
                    </span>
                  )}
                  {!option.isExportable && (
                    <span className="text-[10px] italic text-warning">
                      {option.lockedReason ?? "locked"}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        )}
      </AccordionSection>

      {/* ── Filter ──────────────────────────────────────────── */}
      <AccordionSection
        id="clone-filter"
        title="Filter"
        description="Optionally narrow what gets cloned by protocol, tag, or color."
        icon={Tags}
        open={openSections.filter}
        onToggle={() => toggle("filter")}
        dataTestId="clone-filter-section"
        badge={
          <span className="text-[var(--color-textMuted)]">
            {previewCount} of {connections.filter((c) => !c.isGroup).length}
          </span>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={inclusion.includeFolderItems}
              onChange={(e) =>
                updateInclusion({ includeFolderItems: e.target.checked })
              }
            />
            Carry folder structure across
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={inclusion.includeEmptyFolders}
              disabled={!inclusion.includeFolderItems}
              onChange={(e) =>
                updateInclusion({ includeEmptyFolders: e.target.checked })
              }
            />
            Include empty folders
          </label>
          <p className="text-xs text-[var(--color-textMuted)]">
            Use the Export tab's filter controls if you need fine-grained
            protocol / tag / color filtering — the same{" "}
            <code>inclusion</code> shape is reused, so any inclusion you
            set there flows through to Clone too.
          </p>
        </div>
      </AccordionSection>

      {/* ── Destination ─────────────────────────────────────── */}
      <AccordionSection
        id="clone-destination"
        title="Destination"
        description="Pick where the cloned connections should land."
        icon={ArrowRight}
        open={openSections.destination}
        onToggle={() => toggle("destination")}
        dataTestId="clone-destination-section"
        badge={
          <span
            className={
              targetDatabaseIds.length > 0
                ? "text-[var(--color-textMuted)]"
                : "text-warning"
            }
          >
            {targetDatabaseIds.length}{' '}
            {targetDatabaseIds.length === 1 ? 'target database' : 'target databases'}
          </span>
        }
      >
        <div>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1.5">
            Target databases
          </label>
          <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 max-h-48 overflow-y-auto">
            {targetOptions.length === 0 ? (
              <p className="text-xs text-[var(--color-textMuted)]">
                No eligible target databases. Configure another database
                first, or pick fewer sources.
              </p>
            ) : (
              targetOptions.map((option) => (
                <label
                  key={option.id}
                  className={`flex items-center gap-2 text-xs ${
                    option.isExportable
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-textMuted)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={targetDatabaseIds.includes(option.id)}
                    disabled={!option.isExportable}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setTargetDatabaseIds([...targetDatabaseIds, option.id]);
                      } else {
                        setTargetDatabaseIds(
                          targetDatabaseIds.filter((id) => id !== option.id),
                        );
                      }
                    }}
                  />
                  <span className="flex-1 truncate">{option.name}</span>
                  {option.isCurrent && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      current
                    </span>
                  )}
                  {!option.isExportable && (
                    <span className="text-[10px] italic text-warning">
                      {option.lockedReason ?? "locked"}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="clone-conflict-policy"
            className="block text-xs text-[var(--color-textSecondary)]"
          >
            Conflict policy
          </label>
          <Select
            value={conflictPolicy}
            onChange={(value: string) =>
              setConflictPolicy(value as ImportOptions["conflictPolicy"])
            }
            options={[
              { value: "duplicate", label: "Duplicate — write with fresh ids on collision" },
              { value: "rename", label: "Rename — suffix every conflict, keep both" },
              { value: "skip", label: "Skip — drop colliding connections" },
            ]}
            variant="form"
            aria-label="Conflict policy"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="clone-add-tags"
            className="block text-xs text-[var(--color-textSecondary)]"
          >
            Add tags to cloned connections
          </label>
          <input
            id="clone-add-tags"
            value={addTags}
            onChange={(e) => setAddTags(e.target.value)}
            placeholder="comma-separated tags"
            className="sor-form-input-xs w-full"
          />
        </div>

        <div className="grid gap-2 text-xs text-[var(--color-textSecondary)] sm:grid-cols-2">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={preserveFolders}
              onChange={(e) => setPreserveFolders(e.target.checked)}
            />
            Preserve folders
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCredentials}
              onChange={(e) => setIncludeCredentials(e.target.checked)}
            />
            Include credentials
          </label>
          <label className="inline-flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={switchToTargetAfterClone}
              onChange={(e) => setSwitchToTargetAfterClone(e.target.checked)}
            />
            Switch to the first target database after the clone finishes
          </label>
        </div>
      </AccordionSection>

      {/* ── Preview + action ────────────────────────────────── */}
      <AccordionSection
        id="clone-preview"
        title="Preview"
        description="What this clone will land on each target."
        icon={Server}
        open={openSections.preview}
        onToggle={() => toggle("preview")}
        dataTestId="clone-preview-section"
        badge={
          <span className="text-[var(--color-textMuted)]">
            {previewCount} connection(s)
          </span>
        }
      >
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-textSecondary)] space-y-1">
          <div>
            <span className="text-[var(--color-text)]">Source</span>:{" "}
            {effectiveSourceIds.length === 0 ? (
              <span className="text-warning">none</span>
            ) : (
              effectiveSourceIds
                .map((id) => targetOptionsById.get(id)?.name ?? id)
                .join(", ")
            )}
          </div>
          <div>
            <span className="text-[var(--color-text)]">Target(s)</span>:{" "}
            {targetDatabaseIds.length === 0 ? (
              <span className="text-warning">none</span>
            ) : (
              targetDatabaseIds
                .map((id) => targetOptionsById.get(id)?.name ?? id)
                .join(", ")
            )}
          </div>
          <div>
            <span className="text-[var(--color-text)]">Filter result</span>:{" "}
            {previewCount} connection(s)
          </div>
        </div>

        {cloneResult && (
          <div
            className={`rounded border p-3 text-xs ${
              cloneResult.success
                ? "border-success/30 bg-success/10 text-success"
                : "border-error/30 bg-error/10 text-error"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">
                {cloneResult.success ? "Clone complete" : "Clone failed"}
              </span>
              <button
                type="button"
                onClick={onClearResult}
                className="text-[10px] underline opacity-70 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
            <ul className="space-y-0.5">
              {cloneResult.perTarget.map((row) => (
                <li key={row.databaseId}>
                  {row.databaseName}: {row.cloned} cloned
                  {row.error ? ` — error: ${row.error}` : ""}
                </li>
              ))}
            </ul>
            {(cloneResult.renamed > 0 || cloneResult.skipped > 0) && (
              <div className="mt-1 text-[10px] opacity-80">
                {cloneResult.renamed > 0 && `${cloneResult.renamed} renamed`}
                {cloneResult.renamed > 0 && cloneResult.skipped > 0 && ", "}
                {cloneResult.skipped > 0 && `${cloneResult.skipped} skipped`}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClone}
          disabled={!canClone}
          data-testid="clone-action-button"
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            canClone
              ? "bg-primary text-[var(--color-text)] hover:bg-primary/90"
              : "bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] cursor-not-allowed"
          }`}
        >
          <Copy size={16} />
          {buttonLabel}
        </button>
      </AccordionSection>
    </div>
  );
};

export default CloneTab;
