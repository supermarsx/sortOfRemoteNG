import React, { useRef, useState } from "react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import BackupCodesSection from "../../connectionEditor/BackupCodesSection";
import ARDOptions from "../../connectionEditor/ARDOptions";
import CloudProviderOptions from "../../connectionEditor/CloudProviderOptions";
import HTTPOptions from "../../connectionEditor/HTTPOptions";
import RDPOptions from "../../connectionEditor/RDPOptions";
import RloginOptions from "../../connectionEditor/RloginOptions";
import SavedProtocolOptions from "../../connectionEditor/SavedProtocolOptions";
import RawSocketOptions from "../../connectionEditor/rawSocket/RawSocketOptions";
import { PowerShellRemotingEditor } from "../../connectionEditor/powerShellRemoting/PowerShellRemotingEditor";
import RecoveryInfoSection from "../../connectionEditor/RecoveryInfoSection";
import SecurityQuestionsSection from "../../connectionEditor/SecurityQuestionsSection";
import SSHOptions from "../../connectionEditor/SSHOptions";
import TOTPOptions from "../../connectionEditor/TOTPOptions";
import WinRMOptions from "../../connectionEditor/WinRMOptions";
import { normalizeRawSocketSettings } from "../../../types/protocols/rawSocket";
import { normalizeRloginSettings } from "../../../utils/rlogin/rloginSettings";
import { normalizePowerShellRemotingSettings } from "../../../utils/powershell/normalizePowerShellRemoting";
import NetworkPathSection from "./NetworkPathSection";
import {
  getProtocolSubtabs,
  isCloudProtocol,
  type ProtocolSubtabId,
} from "./protocolSubtabs";

interface ProtocolSectionsProps {
  mgr: ConnectionEditorMgr;
  activeSubtabId?: ProtocolSubtabId;
  onActiveSubtabChange?: (subtabId: ProtocolSubtabId) => void;
}

const RecoverySections: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div className="space-y-3">
    <TOTPOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    <BackupCodesSection formData={mgr.formData} setFormData={mgr.setFormData} />
    <SecurityQuestionsSection
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
    <RecoveryInfoSection
      formData={mgr.formData}
      setFormData={mgr.setFormData}
    />
  </div>
);

const ProtocolSubtabContent: React.FC<{
  mgr: ConnectionEditorMgr;
  subtabId: ProtocolSubtabId;
}> = ({ mgr, subtabId }) => {
  const protocol = mgr.formData.protocol ?? "";

  if (subtabId === "recovery") return <RecoverySections mgr={mgr} />;

  if (protocol === "ard") {
    const section =
      subtabId === "authentication"
        ? "authentication"
        : subtabId === "display-input"
          ? "display-input"
          : "connection";
    return (
      <ARDOptions
        formData={mgr.formData}
        setFormData={mgr.setFormData}
        sections={[section]}
      />
    );
  }

  if (["telnet", "sftp", "mysql", "smb", "rustdesk"].includes(protocol)) {
    return (
      <SavedProtocolOptions
        formData={mgr.formData}
        setFormData={mgr.setFormData}
        section={
          subtabId === "authentication" ? "authentication" : "connection"
        }
      />
    );
  }

  if (
    subtabId === "network-path" &&
    ["ssh", "rdp", "raw", "rlogin", "winrm"].includes(protocol)
  ) {
    return (
      <NetworkPathSection
        formData={mgr.formData}
        setFormData={mgr.setFormData}
      />
    );
  }

  if (protocol === "raw") {
    const section =
      subtabId === "connection"
        ? "connection"
        : subtabId === "terminal"
          ? "data"
          : subtabId === "security"
            ? "tls"
            : "advanced";
    return (
      <RawSocketOptions
        value={normalizeRawSocketSettings(mgr.formData.rawSocketSettings)}
        onChange={(rawSocketSettings) =>
          mgr.setFormData((previous) => ({
            ...previous,
            rawSocketSettings,
          }))
        }
        sections={[section]}
        targetHost={mgr.formData.hostname}
        targetPort={mgr.formData.port}
      />
    );
  }

  if (protocol === "rlogin") {
    return (
      <RloginOptions
        settings={normalizeRloginSettings(mgr.formData.rloginSettings)}
        port={mgr.formData.port ?? 513}
        onSettingsChange={(rloginSettings) =>
          mgr.setFormData((previous) => ({ ...previous, rloginSettings }))
        }
        onPortChange={(port) =>
          mgr.setFormData((previous) => ({ ...previous, port }))
        }
        section={
          subtabId as "connection" | "terminal" | "security" | "advanced"
        }
      />
    );
  }

  if (protocol === "winrm") {
    const sections =
      subtabId === "connection"
        ? (["endpoint"] as const)
        : subtabId === "authentication"
          ? (["authentication"] as const)
          : subtabId === "security"
            ? (["security"] as const)
            : (["ssh", "session", "windows-tools"] as const);
    return (
      <PowerShellRemotingEditor
        targetHost={mgr.formData.hostname ?? ""}
        value={
          normalizePowerShellRemotingSettings(mgr.formData.powerShellRemoting)
            .settings
        }
        onChange={(powerShellRemoting) =>
          mgr.setFormData((previous) => ({
            ...previous,
            powerShellRemoting,
            username: powerShellRemoting.credential.username,
            domain: powerShellRemoting.credential.domain ?? undefined,
          }))
        }
        sections={sections}
      />
    );
  }

  if (protocol === "rdp") {
    if (subtabId === "connection") {
      return (
        <>
          <RDPOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["connection"]}
          />
          <WinRMOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["connection"]}
          />
        </>
      );
    }
    if (subtabId === "authentication") {
      return (
        <>
          <SSHOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sshSecretManager={mgr.sshSecrets}
            sections={["authentication"]}
          />
          <WinRMOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["authentication"]}
          />
        </>
      );
    }
    if (subtabId === "display-input") {
      return (
        <RDPOptions
          formData={mgr.formData}
          setFormData={mgr.setFormData}
          sections={["display", "audio", "input"]}
        />
      );
    }
    if (subtabId === "resources") {
      return (
        <RDPOptions
          formData={mgr.formData}
          setFormData={mgr.setFormData}
          sections={["devices", "performance"]}
        />
      );
    }
    if (subtabId === "security") {
      return (
        <>
          <RDPOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["security"]}
          />
          <WinRMOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["security"]}
          />
        </>
      );
    }
    if (subtabId === "network") {
      return (
        <>
          <RDPOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["gateway", "tcp"]}
          />
          <WinRMOptions
            formData={mgr.formData}
            setFormData={mgr.setFormData}
            sections={["transport"]}
          />
        </>
      );
    }
    return (
      <>
        <RDPOptions
          formData={mgr.formData}
          setFormData={mgr.setFormData}
          sections={["hyperv", "negotiation", "advanced"]}
        />
        <WinRMOptions
          formData={mgr.formData}
          setFormData={mgr.setFormData}
          sections={["advanced"]}
        />
      </>
    );
  }

  if (protocol === "ssh") {
    const sections =
      subtabId === "authentication"
        ? (["authentication"] as const)
        : subtabId === "terminal"
          ? (["terminal"] as const)
          : (["connection"] as const);
    return (
      <>
        <SSHOptions
          formData={mgr.formData}
          setFormData={mgr.setFormData}
          sshSecretManager={mgr.sshSecrets}
          sections={sections}
        />
        {subtabId === "network" && mgr.formData.osType === "windows" && (
          <WinRMOptions formData={mgr.formData} setFormData={mgr.setFormData} />
        )}
      </>
    );
  }

  if (protocol === "http" || protocol === "https") {
    if (subtabId === "network") {
      return (
        <WinRMOptions formData={mgr.formData} setFormData={mgr.setFormData} />
      );
    }
    return (
      <HTTPOptions
        formData={mgr.formData}
        setFormData={mgr.setFormData}
        sections={[subtabId as "authentication" | "security" | "advanced"]}
      />
    );
  }

  if (isCloudProtocol(protocol) && subtabId === "provider") {
    return (
      <CloudProviderOptions
        formData={mgr.formData}
        setFormData={mgr.setFormData}
      />
    );
  }

  if (subtabId === "network") {
    return (
      <WinRMOptions formData={mgr.formData} setFormData={mgr.setFormData} />
    );
  }

  return (
    <SavedProtocolOptions
      formData={mgr.formData}
      setFormData={mgr.setFormData}
      section="authentication"
    />
  );
};

export const ProtocolSections: React.FC<ProtocolSectionsProps> = ({
  mgr,
  activeSubtabId,
  onActiveSubtabChange,
}) => {
  const protocolKey = mgr.formData.protocol ?? "";
  const subtabs = getProtocolSubtabs(mgr.formData);
  const [activeByProtocol, setActiveByProtocol] = useState<
    Partial<Record<string, ProtocolSubtabId>>
  >({});
  const tabRefs = useRef<Partial<Record<ProtocolSubtabId, HTMLButtonElement>>>(
    {},
  );
  const requestedSubtab = activeSubtabId ?? activeByProtocol[protocolKey];
  const activeSubtab =
    subtabs.find((subtab) => subtab.id === requestedSubtab) ?? subtabs[0];

  const selectSubtab = (subtabId: ProtocolSubtabId, moveFocus = false) => {
    if (!subtabs.some((subtab) => subtab.id === subtabId)) return;
    setActiveByProtocol((previous) => ({
      ...previous,
      [protocolKey]: subtabId,
    }));
    onActiveSubtabChange?.(subtabId);
    if (moveFocus) {
      requestAnimationFrame(() => tabRefs.current[subtabId]?.focus());
    }
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % subtabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + subtabs.length) % subtabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = subtabs.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectSubtab(subtabs[nextIndex].id, true);
  };

  const ActiveIcon = activeSubtab.icon;

  return (
    <div
      data-editor-search-section="protocol-options"
      data-editor-search-field="protocol-options"
      className="space-y-3"
    >
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          role="tablist"
          aria-label="Protocol settings sections"
          aria-orientation="horizontal"
          className="flex min-w-max items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/35 p-1"
        >
          {subtabs.map((subtab, index) => {
            const Icon = subtab.icon;
            const isActive = subtab.id === activeSubtab.id;
            return (
              <button
                key={subtab.id}
                ref={(element) => {
                  if (element) tabRefs.current[subtab.id] = element;
                  else delete tabRefs.current[subtab.id];
                }}
                type="button"
                role="tab"
                id={`connection-editor-protocol-subtab-${subtab.id}`}
                aria-controls={`connection-editor-protocol-subtab-panel-${subtab.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                data-testid={`connection-editor-protocol-subtab-${subtab.id}`}
                onClick={() => selectSubtab(subtab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isActive
                    ? "bg-primary/15 text-primary shadow-sm"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {subtab.label}
              </button>
            );
          })}
        </div>
      </div>

      <section
        role="tabpanel"
        id={`connection-editor-protocol-subtab-panel-${activeSubtab.id}`}
        aria-labelledby={`connection-editor-protocol-subtab-${activeSubtab.id}`}
        data-testid={`connection-editor-protocol-subtab-panel-${activeSubtab.id}`}
        data-protocol-subtab={activeSubtab.id}
        tabIndex={0}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/20 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <header className="mb-4 flex items-start gap-2 border-b border-[var(--color-border)] pb-3">
          <ActiveIcon
            size={16}
            className="mt-0.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {activeSubtab.label}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--color-textMuted)]">
              {activeSubtab.description}
            </p>
          </div>
        </header>
        <div className="space-y-3">
          <ProtocolSubtabContent mgr={mgr} subtabId={activeSubtab.id} />
        </div>
      </section>
    </div>
  );
};
