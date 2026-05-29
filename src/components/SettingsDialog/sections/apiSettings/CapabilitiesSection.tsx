import React, { useMemo } from "react";
import {
  ShieldCheck,
  CircuitBoard,
  Cloud,
  Network,
  Wrench,
  Power,
} from "lucide-react";
import {
  CAPABILITY_GROUP_LABELS,
  CAPABILITY_GROUP_DESCRIPTIONS,
  CAPABILITY_GROUP_ORDER,
  type ApiCapability,
  type ApiCapabilityGroup,
} from "../../../../types/api/capabilities";
import { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import type { Mgr } from "./types";

/** Icon shown next to each group header. Picked once here so the
 *  Rust catalog stays free of UI concerns. */
const GROUP_ICON: Record<ApiCapabilityGroup, React.ReactNode> = {
  "core-api": <ShieldCheck className="w-4 h-4 text-primary" />,
  protocols: <CircuitBoard className="w-4 h-4 text-primary" />,
  cloud: <Cloud className="w-4 h-4 text-primary" />,
  infrastructure: <Wrench className="w-4 h-4 text-primary" />,
  network: <Network className="w-4 h-4 text-primary" />,
};

/** Per-row icon. Same `Power` look as elsewhere — capability rows are
 *  on/off switches at heart. */
const ROW_ICON = <Power size={16} />;

interface Props {
  settings: GlobalSettings;
  mgr: Mgr;
}

export const CapabilitiesSection: React.FC<Props> = ({ settings: _settings, mgr }) => {
  const grouped = useMemo(() => {
    const map = new Map<ApiCapabilityGroup, ApiCapability[]>();
    for (const cap of mgr.capabilities ?? []) {
      const g = cap.group as ApiCapabilityGroup;
      const list = map.get(g) ?? [];
      list.push(cap);
      map.set(g, list);
    }
    return map;
  }, [mgr.capabilities]);

  const totalNonMandatory = useMemo(
    () => (mgr.capabilities ?? []).filter((c) => !c.mandatory).length,
    [mgr.capabilities],
  );

  // Empty state — catalog hasn't loaded yet (or no Tauri backend in
  // tests). Show a hint card rather than a broken layout.
  if (!mgr.capabilitiesLoaded) {
    return (
      <div className="space-y-4">
        <SectionHeader
          icon={<Power className="w-4 h-4 text-primary" />}
          title="Capabilities"
        />
        <Card>
          <p className="text-xs text-[var(--color-textMuted)]">
            Loading capability catalog…
          </p>
        </Card>
      </div>
    );
  }
  if ((mgr.capabilities ?? []).length === 0) {
    return (
      <div className="space-y-4">
        <SectionHeader
          icon={<Power className="w-4 h-4 text-primary" />}
          title="Capabilities"
        />
        <Card>
          <p className="text-xs text-[var(--color-textMuted)]">
            Capability catalog unavailable. The API server may not be
            running in this build.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Section preamble — appears once above the group cards. */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Power className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Capabilities
              <span className="text-xs font-normal text-[var(--color-textMuted)]">
                {totalNonMandatory - mgr.disabledCount} / {totalNonMandatory}{" "}
                enabled
              </span>
            </span>
          }
        />
        <Card>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-[var(--color-textMuted)]">
              Pick which API areas the server exposes. Mandatory rows
              (health, authentication) are always on. Disabling a
              capability stops <em>new</em> requests with a{" "}
              <code className="text-[10px] px-1 rounded bg-[var(--color-surfaceHover)]">
                403 capability_disabled
              </code>{" "}
              response — live sessions opened earlier are not torn down.
            </p>
            {mgr.disabledCount > 0 && (
              <button
                type="button"
                onClick={mgr.enableAllCapabilities}
                className="shrink-0 text-xs text-primary hover:underline"
              >
                Enable all
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* One Card per group. */}
      {CAPABILITY_GROUP_ORDER.map((group) => {
        const caps = grouped.get(group) ?? [];
        if (caps.length === 0) return null;
        const groupFullyOff = mgr.isGroupFullyDisabled(group);
        const groupFullyOn = mgr.isGroupFullyEnabled(group);
        const allMandatory = caps.every((c) => c.mandatory);

        return (
          <div key={group} className="space-y-4">
            <SectionHeader
              icon={GROUP_ICON[group]}
              title={
                <span className="flex items-center gap-2">
                  {CAPABILITY_GROUP_LABELS[group]}
                  <InfoTooltip text={CAPABILITY_GROUP_DESCRIPTIONS[group]} />
                </span>
              }
            />
            <Card>
              {!allMandatory && (
                <div className="flex items-center justify-end gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => mgr.setCapabilityGroup(group, true)}
                    disabled={groupFullyOn}
                    className="text-[var(--color-textSecondary)] hover:text-primary disabled:opacity-40 disabled:hover:text-[var(--color-textSecondary)]"
                  >
                    Enable all
                  </button>
                  <span className="text-[var(--color-textMuted)]">·</span>
                  <button
                    type="button"
                    onClick={() => mgr.setCapabilityGroup(group, false)}
                    disabled={groupFullyOff}
                    className="text-[var(--color-textSecondary)] hover:text-error disabled:opacity-40 disabled:hover:text-[var(--color-textSecondary)]"
                  >
                    Disable all
                  </button>
                </div>
              )}

              {caps.map((cap) => (
                <Toggle
                  key={cap.id}
                  settingKey={`apiCapability.${cap.id}`}
                  icon={ROW_ICON}
                  label={
                    <span className="flex items-center gap-1.5">
                      {cap.label}
                      {cap.mandatory && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          always on
                        </span>
                      )}
                    </span>
                  }
                  description={`${cap.description} (${cap.endpoints.length} endpoint${
                    cap.endpoints.length === 1 ? "" : "s"
                  })`}
                  checked={mgr.isEnabled(cap)}
                  onChange={(v) => mgr.toggleCapability(cap.id, v)}
                  disabled={cap.mandatory}
                  infoTooltip={
                    cap.mandatory
                      ? `Mandatory capability — cannot be disabled. Endpoints: ${cap.endpoints.join(", ")}`
                      : `Path prefix: ${cap.prefix}. Endpoints: ${cap.endpoints.join(", ")}`
                  }
                />
              ))}
            </Card>
          </div>
        );
      })}
    </>
  );
};

export default CapabilitiesSection;
