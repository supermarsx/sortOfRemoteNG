import { useId, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bookmark,
  CheckCheck,
  Cloud,
  Cpu,
  Database,
  Globe,
  HardDrive,
  ListChecks,
  Pencil,
  Radar,
  Save,
  Server,
  Settings2,
  Shield,
  Trash2,
} from "lucide-react";
import { Checkbox, Select, TextInput } from "../ui/forms";
import type { NetworkDiscoveryConfig } from "../../types/settings/settings";
import { useDiscoveryPresets } from "../../hooks/network/useDiscoveryPresets";
import {
  cloneDiscoveryPresetConfig,
  DISCOVERY_PRESET_NAME_MAX_LENGTH,
} from "../../utils/discovery/savedDiscoveryPresets";
import {
  DISCOVERY_SCAN_PROFILES,
  applyDiscoveryScanProfile,
} from "../../utils/discovery/discoveryScanProfiles";

const profileIcons: Record<string, typeof Radar> = {
  common: Radar,
  all: CheckCheck,
  management: Shield,
  iot: Cpu,
  servers: Server,
  cloud: Cloud,
  nas: HardDrive,
  webapps: Globe,
  databases: Database,
  virtualization: Server,
  hosting: Globe,
};

export function DiscoveryPresetPanel({
  config,
  setConfig,
  disabled,
  onApplied,
}: {
  config: NetworkDiscoveryConfig;
  setConfig: Dispatch<SetStateAction<NetworkDiscoveryConfig>>;
  disabled: boolean;
  onApplied: () => void;
}) {
  const library = useDiscoveryPresets();
  const panelId = useId();
  const [selectedId, setSelectedId] = useState("");
  const [restoreTargets, setRestoreTargets] = useState(false);
  const [managing, setManaging] = useState(false);
  const [managedId, setManagedId] = useState("");
  const [editing, setEditing] = useState<"save" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<"update" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const builtin = DISCOVERY_SCAN_PROFILES.find(
    ({ id }) => `builtin:${id}` === selectedId,
  );
  const saved = library.presets.find(({ id }) => `saved:${id}` === selectedId);
  const managed = library.presets.find(({ id }) => id === managedId);

  const run = (action: () => void) => {
    if (disabled) return;
    setError(null);
    setNotice("");
    try {
      action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update scan presets.",
      );
    }
  };
  const cancelEdit = () => {
    setEditing(null);
    setConfirm(null);
    setError(null);
  };
  const submitName = () =>
    run(() => {
      if (editing === "save") {
        const preset = library.savePreset(name, config);
        setSelectedId(`saved:${preset.id}`);
        setManagedId(preset.id);
        setRestoreTargets(false);
        setNotice(`Saved ${preset.name}.`);
      } else if (editing === "rename" && managed) {
        const preset = library.renamePreset(managed.id, name);
        setNotice(`Renamed preset to ${preset.name}.`);
      } else return;
      setEditing(null);
    });

  return (
    <section
      aria-label="Scan presets"
      className="space-y-3 border-t border-[var(--color-border)] pt-4"
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Radar size={15} aria-hidden="true" /> Scan presets
      </h4>
      <Select
        label="Scan preset"
        variant="form"
        className="w-full"
        placeholder="Choose a scan preset…"
        searchable
        disabled={disabled}
        value={builtin || saved ? selectedId : ""}
        onChange={(id) => {
          setSelectedId(id);
          setRestoreTargets(false);
          setNotice("");
          cancelEdit();
          if (id.startsWith("saved:")) setManagedId(id.slice(6));
        }}
        options={[
          ...DISCOVERY_SCAN_PROFILES.map((item) => ({
            value: `builtin:${item.id}`,
            label: item.label,
            icon: profileIcons[item.id] ?? Radar,
          })),
          ...library.presets.map((item) => ({
            value: `saved:${item.id}`,
            label: item.name,
            icon: Bookmark,
            description: "Saved settings",
          })),
        ]}
      />
      {builtin && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          {builtin.description}
        </p>
      )}
      {saved && (
        <div className="space-y-2 text-xs text-[var(--color-textSecondary)]">
          <p>
            Restores saved services, ports, discovery settings and workload
            limits. Current targets are kept unless selected below.
          </p>
          <label className="flex items-start gap-2">
            <Checkbox
              checked={restoreTargets}
              disabled={disabled}
              onChange={setRestoreTargets}
            />
            Restore saved targets
          </label>
          {restoreTargets && (
            <p className="break-all font-mono">
              {saved.config.ipRange || "No targets saved"}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={disabled || (!builtin && !saved)}
          onClick={() =>
            run(() => {
              if (builtin)
                setConfig((current) =>
                  applyDiscoveryScanProfile(current, builtin.id),
                );
              else if (saved) {
                const snapshot = cloneDiscoveryPresetConfig(saved.config);
                setConfig((current) => ({
                  ...snapshot,
                  ipRange: restoreTargets ? snapshot.ipRange : current.ipRange,
                }));
              } else return;
              onApplied();
              setNotice(
                `Applied ${builtin?.label ?? saved?.name}. Review settings before scanning.`,
              );
            })
          }
        >
          <ListChecks size={14} aria-hidden="true" /> Apply preset
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={disabled}
          onClick={() => {
            setName("");
            cancelEdit();
            setEditing("save");
            setNotice("");
          }}
        >
          <Save size={14} aria-hidden="true" /> Save current settings
        </button>
      </div>
      {!saved && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Built-in presets replace services, their ports and additional port
          ranges. Targets and scan limits stay unchanged.
        </p>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Applying a preset never starts a scan. Saved presets include target
        ranges and are stored on this device, independently of databases.
      </p>
      <button
        type="button"
        className="sor-btn-secondary-sm"
        disabled={disabled}
        aria-expanded={managing}
        aria-controls={`${panelId}-manage`}
        onClick={() => {
          setManaging(!managing);
          cancelEdit();
        }}
      >
        <Settings2 size={14} aria-hidden="true" /> Manage presets (
        {library.presets.length})
      </button>
      {managing && (
        <div
          id={`${panelId}-manage`}
          className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <p className="text-xs text-[var(--color-textSecondary)]">
            Built-in presets are read-only. Apply one, adjust it, then save your
            own copy.
          </p>
          {library.presets.length === 0 ? (
            <p className="text-xs">No saved presets yet.</p>
          ) : (
            <>
              <Select
                label="Manage saved preset"
                variant="form"
                className="w-full"
                placeholder="Choose a saved preset…"
                value={managed ? managedId : ""}
                disabled={disabled}
                onChange={(id) => {
                  setManagedId(id);
                  cancelEdit();
                  setNotice("");
                }}
                options={library.presets.map((item) => ({
                  value: item.id,
                  label: item.name,
                  icon: Bookmark,
                }))}
              />
              {managed && (
                <>
                  <p className="text-xs text-[var(--color-textSecondary)]">
                    Updated {new Date(managed.updatedAt).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={disabled}
                      className="sor-btn-secondary-sm"
                      onClick={() => {
                        cancelEdit();
                        setName(managed.name);
                        setEditing("rename");
                      }}
                    >
                      <Pencil size={13} aria-hidden="true" /> Rename
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      className="sor-btn-secondary-sm"
                      onClick={() => {
                        cancelEdit();
                        setConfirm("update");
                      }}
                    >
                      <Save size={13} aria-hidden="true" /> Replace settings
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      className="sor-btn-secondary-sm"
                      onClick={() => {
                        cancelEdit();
                        setConfirm("delete");
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Delete preset
                    </button>
                  </div>
                  {confirm && (
                    <div className="space-y-2 text-xs">
                      <p>
                        {confirm === "delete"
                          ? `Delete “${managed.name}”? Current scan settings and history will not change.`
                          : `Replace “${managed.name}” with all current settings, including target ranges?`}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={disabled}
                          className="sor-btn-secondary-sm"
                          onClick={() =>
                            run(() => {
                              if (confirm === "delete") {
                                library.deletePreset(managed.id);
                                if (selectedId === `saved:${managed.id}`)
                                  setSelectedId("");
                                setManagedId("");
                                setNotice(`Deleted ${managed.name}.`);
                              } else {
                                library.updatePreset(managed.id, config);
                                setNotice(
                                  `Updated ${managed.name} from current settings.`,
                                );
                              }
                              setConfirm(null);
                            })
                          }
                        >
                          {confirm === "delete"
                            ? "Confirm delete"
                            : "Confirm replace"}
                        </button>
                        <button
                          type="button"
                          className="sor-btn-secondary-sm"
                          disabled={disabled}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      {editing && (editing === "save" || managed) && (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
          <label
            htmlFor={`${panelId}-name`}
            className="block text-xs font-medium"
          >
            Preset name
          </label>
          <TextInput
            key={editing}
            id={`${panelId}-name`}
            value={name}
            onChange={setName}
            disabled={disabled}
            maxLength={DISCOVERY_PRESET_NAME_MAX_LENGTH}
            className="w-full"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitName();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelEdit();
              }
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || !name.trim()}
              className="sor-btn-primary-sm"
              onClick={submitName}
            >
              {editing === "save" ? "Save preset" : "Save name"}
            </button>
            <button
              type="button"
              disabled={disabled}
              className="sor-btn-secondary-sm"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {(error || library.error) && (
        <p role="alert" className="text-xs text-error">
          {error || library.error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      )}
    </section>
  );
}
