import React, { useState } from "react";
import {
  Bookmark,
  Info,
  Plus,
  Save,
  Trash2,
  Check,
  Pencil,
} from "lucide-react";
import {
  generateProxyPresetId,
  type GlobalSettings,
  type ProxyConfig,
  type ProxyPreset,
} from "../../../../types/settings/settings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

interface Props {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  updateProxy: (updates: Partial<ProxyConfig>) => void;
}

function snapshotCurrentAsConfig(
  proxy: ProxyConfig | undefined,
): Omit<ProxyConfig, "enabled"> {
  const { enabled: _enabled, ...rest } = proxy ?? ({
    type: "http",
    host: "",
    port: 8080,
    enabled: false,
  } as ProxyConfig);
  return rest;
}

function presetSummary(preset: ProxyPreset): string {
  const { type, host, port } = preset.config;
  const where = host ? `${host}:${port}` : "(unset host)";
  return `${type.toUpperCase()} · ${where}`;
}

function isPresetActive(
  preset: ProxyPreset,
  proxy: ProxyConfig | undefined,
): boolean {
  if (!proxy) return false;
  return (
    proxy.type === preset.config.type &&
    proxy.host === preset.config.host &&
    proxy.port === preset.config.port &&
    (proxy.username ?? "") === (preset.config.username ?? "") &&
    (proxy.password ?? "") === (preset.config.password ?? "")
  );
}

const ProxyPresetsSection: React.FC<Props> = ({
  settings,
  updateSettings,
  updateProxy,
}) => {
  const presets = settings.globalProxyPresets ?? [];
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const writePresets = (next: ProxyPreset[]) => {
    updateSettings({ globalProxyPresets: next });
  };

  const handleSaveCurrent = () => {
    const name = newName.trim();
    if (!name) return;
    const preset: ProxyPreset = {
      id: generateProxyPresetId(),
      name,
      config: snapshotCurrentAsConfig(settings.globalProxy),
    };
    writePresets([...presets, preset]);
    setNewName("");
  };

  const handleOverwrite = (id: string) => {
    writePresets(
      presets.map((p) =>
        p.id === id
          ? { ...p, config: snapshotCurrentAsConfig(settings.globalProxy) }
          : p,
      ),
    );
  };

  const handleApply = (preset: ProxyPreset) => {
    updateProxy({ ...preset.config });
  };

  const handleDelete = (id: string) => {
    writePresets(presets.filter((p) => p.id !== id));
  };

  const commitRename = (id: string) => {
    const name = renameDraft.trim();
    if (name) {
      writePresets(presets.map((p) => (p.id === id ? { ...p, name } : p)));
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Bookmark className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-2">
            Proxy Presets
            <InfoTooltip text="Save the current proxy configuration under a name, then apply it later in one click. Useful when switching between work, home, and mobile-tether proxies." />
          </span>
        }
      />

      <Card>
        {presets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surfaceHover)]/20 p-4 text-center">
            <p className="text-sm text-[var(--color-textSecondary)]">
              No presets saved yet.
            </p>
            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              Fill in a proxy configuration above, give it a name below,
              and click Save current.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => {
              const isActive = isPresetActive(preset, settings.globalProxy);
              const isRenaming = renamingId === preset.id;
              return (
                <div
                  key={preset.id}
                  className={`rounded-lg border p-3 ${
                    isActive
                      ? "border-primary/50 bg-primary/10"
                      : "border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isRenaming ? (
                      <input
                        autoFocus
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(preset.id);
                          else if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameDraft("");
                          }
                        }}
                        onBlur={() => commitRename(preset.id)}
                        className="sor-settings-input flex-1 text-sm"
                        aria-label="Rename preset"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(preset.id);
                          setRenameDraft(preset.name);
                        }}
                        className="flex-1 text-left text-sm text-[var(--color-text)] hover:text-primary flex items-center gap-1.5"
                        title="Click to rename"
                      >
                        <span className="font-medium">{preset.name}</span>
                        <Pencil className="w-3 h-3 text-[var(--color-textMuted)]" />
                      </button>
                    )}
                    <span className="text-xs text-[var(--color-textMuted)] font-mono">
                      {presetSummary(preset)}
                    </span>
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/30 text-primary border border-primary/50 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        active
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApply(preset)}
                      disabled={isActive}
                      className="px-2.5 py-1 text-xs rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Apply this preset to the live proxy config"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOverwrite(preset.id)}
                      className="p-1.5 text-[var(--color-textMuted)] hover:text-[var(--color-text)] rounded transition-colors"
                      title="Overwrite this preset with the current proxy config"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(preset.id)}
                      className="p-1.5 text-[var(--color-textMuted)] hover:text-[var(--color-error)] rounded transition-colors"
                      title="Delete preset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveCurrent();
            }}
            placeholder="Preset name"
            className="sor-settings-input text-sm w-48"
            aria-label="New preset name"
          />
          <button
            type="button"
            onClick={handleSaveCurrent}
            disabled={!newName.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded text-xs text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3 h-3" />
            Save current
          </button>
        </div>

        <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1">
          <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Applying a preset copies its values into the live proxy
            config above; the enabled toggle is left as-is so you can
            switch proxies without dropping connections.
          </span>
        </p>
      </Card>
    </div>
  );
};

export default ProxyPresetsSection;
