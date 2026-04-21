import React, { useMemo, useState } from "react";
import {
  Cloud,
  Database,
  Folder,
  Globe,
  HardDrive,
  Monitor,
  Server,
  Shield,
  Star,
  Terminal,
} from "lucide-react";
import { Connection } from "../../types/connection/connection";
import { getDefaultPort } from "../../utils/discovery/defaultPorts";
import {
  getConnectionDepth,
  getMaxDescendantDepth,
  MAX_NESTING_DEPTH,
} from "../../utils/window/dragDropManager";
import { Checkbox, NumberInput, Select } from '../ui/forms';
import { useTranslation } from 'react-i18next';

interface GeneralSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  availableGroups: Connection[];
  allConnections?: Connection[];
}

/** Helper to build a path string showing folder hierarchy */
function getFolderPath(groupId: string, connections: Connection[]): string {
  const parts: string[] = [];
  let currentId: string | undefined = groupId;

  while (currentId) {
    const group = connections.find((c) => c.id === currentId);
    if (!group) break;
    parts.unshift(group.name);
    currentId = group.parentId;
  }

  return parts.join(" / ");
}

/** Dropdown for selecting parent folder with depth indication */
const ParentFolderSelect: React.FC<{
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  availableGroups: Connection[];
  allConnections: Connection[];
}> = ({ formData, setFormData, availableGroups, allConnections }) => {
  const { t } = useTranslation();
  // Calculate which groups can be selected based on depth limits
  const selectableGroups = useMemo(() => {
    // If editing an existing group, we need to check descendant depth
    const currentId = formData.id;
    const isGroup = formData.isGroup;
    const descendantDepth =
      currentId && isGroup
        ? getMaxDescendantDepth(currentId, allConnections)
        : 0;

    return availableGroups.map((group) => {
      // Don't allow selecting self or descendants as parent
      if (currentId && group.id === currentId) {
        return {
          group,
          depth: 0,
          disabled: true,
          reason: t('connectionEditor.cannotBeOwnParent', 'Cannot be its own parent'),
        };
      }

      // Check if this group is a descendant of the current item
      if (currentId) {
        let checkId: string | undefined = group.id;
        while (checkId) {
          const parent = allConnections.find((c) => c.id === checkId);
          if (parent?.parentId === currentId) {
            return {
              group,
              depth: 0,
              disabled: true,
              reason: t('connectionEditor.cannotMoveIntoDescendant', 'Cannot move into own descendant'),
            };
          }
          checkId = parent?.parentId;
        }
      }

      const groupDepth = getConnectionDepth(group.id, allConnections) + 1; // +1 because we'd be placing inside this group
      const wouldExceedDepth =
        groupDepth + descendantDepth >= MAX_NESTING_DEPTH;

      return {
        group,
        depth: groupDepth,
        disabled: wouldExceedDepth,
        reason: wouldExceedDepth
          ? t('connectionEditor.maxDepthExceeded', 'Max depth ({{max}}) exceeded', { max: MAX_NESTING_DEPTH })
          : undefined,
      };
    });
  }, [availableGroups, allConnections, formData.id, formData.isGroup, t]);

  return (
    <Select value={formData.parentId || ""} data-testid="editor-parent-folder" onChange={(v: string) =>
        setFormData({ ...formData, parentId: v || undefined })} options={[{ value: '', label: t('connectionEditor.rootNoParent', 'Root (No parent)') }, ...selectableGroups.map(({ group, depth, disabled, reason }) => ({ value: group.id, label: `${"─".repeat(depth)} ${getFolderPath(group.id, allConnections)}
          ${disabled ? ` (${reason})` : ""}`, disabled: disabled, title: reason }))]} className="sor-form-select" />
  );
};

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  formData,
  setFormData,
  availableGroups,
  allConnections = [],
}) => {
  const { t } = useTranslation();
  const [nameError, setNameError] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);

  const iconOptions = [
    { value: "", label: t('connectionEditor.iconDefault', 'Default'), icon: Monitor },
    { value: "terminal", label: t('connectionEditor.iconTerminal', 'Terminal'), icon: Terminal },
    { value: "globe", label: t('connectionEditor.iconWeb', 'Web'), icon: Globe },
    { value: "database", label: t('connectionEditor.iconDatabase', 'Database'), icon: Database },
    { value: "server", label: t('connectionEditor.iconServer', 'Server'), icon: Server },
    { value: "shield", label: t('connectionEditor.iconShield', 'Shield'), icon: Shield },
    { value: "cloud", label: t('connectionEditor.iconCloud', 'Cloud'), icon: Cloud },
    { value: "folder", label: t('connectionEditor.iconFolder', 'Folder'), icon: Folder },
    { value: "star", label: t('connectionEditor.iconStar', 'Star'), icon: Star },
    { value: "drive", label: t('connectionEditor.iconDrive', 'Drive'), icon: HardDrive },
  ];

  const handleProtocolChange = (protocol: string) => {
    setFormData((prev) => ({
      ...prev,
      protocol: protocol as Connection["protocol"],
      port: getDefaultPort(protocol),
      authType: ["http", "https"].includes(protocol) ? "basic" : "password",
      httpVerifySsl: ["http", "https"].includes(protocol)
        ? (prev.httpVerifySsl ?? true)
        : prev.httpVerifySsl,
    }));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center space-x-2">
          <Checkbox checked={!!formData.isGroup} onChange={(v: boolean) => setFormData({ ...formData, isGroup: v })} variant="form" />
          <span className="text-[var(--color-textSecondary)]">
            {t('connectionEditor.createAsGroup', 'Create as folder/group')}
          </span>
        </label>
        {!formData.isGroup && (
          <label className="flex items-center space-x-2">
            <Checkbox checked={!!formData.favorite} onChange={(v: boolean) => setFormData({ ...formData, favorite: v })} variant="form" />
            <span className="text-[var(--color-textSecondary)]">
              {t('connectionEditor.markAsFavorite', 'Mark as favorite')}
            </span>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            {t('connectionEditor.nameLabel', 'Name *')}
          </label>
          <input
            type="text"
            required
            value={formData.name || ""}
            onChange={(e) => {
              setFormData({ ...formData, name: e.target.value });
              if (nameError) setNameError(null);
            }}
            onBlur={() => {
              if (!formData.name?.trim()) setNameError(t('connectionEditor.nameRequired', 'Name is required'));
            }}
            data-testid="editor-name"
            className="sor-form-input"
            placeholder={formData.isGroup ? t('connectionEditor.folderNamePlaceholder', 'Folder name') : t('connectionEditor.connectionNamePlaceholder', 'Connection name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "name-error" : undefined}
          />
          {nameError && (
            <span id="name-error" className="text-sm text-error" role="alert">
              {nameError}
            </span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            {t('connectionEditor.iconLabel', 'Icon')}
          </label>
          <div className="grid grid-cols-5 gap-2">
            {iconOptions.map(({ value, label, icon: Icon }) => {
              const isActive = (formData.icon || "") === value;
              return (
                <button
                  key={value || "default"}
                  type="button"
                  onClick={() =>
                    setFormData({ ...formData, icon: value || undefined })
                  }
                  className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-[var(--color-border)] bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]"
                  }`}
                  title={label}
                >
                  <Icon size={16} />
                  <span className="text-[10px] uppercase tracking-wide">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            {t('connectionEditor.parentFolder', 'Parent Folder')}
          </label>
          <ParentFolderSelect
            formData={formData}
            setFormData={setFormData}
            availableGroups={availableGroups}
            allConnections={allConnections}
          />
        </div>

        {!formData.isGroup && (
          <>
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t('connectionEditor.protocol', 'Protocol')}
              </label>
              <Select value={formData.protocol ?? "rdp"} onChange={(v: string) => handleProtocolChange(v)} data-testid="editor-protocol" options={[{ value: "rdp", label: "RDP (Remote Desktop)" }, { value: "ssh", label: "SSH (Secure Shell)" }, { value: "vnc", label: "VNC (Virtual Network Computing)" }, { value: "anydesk", label: "AnyDesk" }, { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "telnet", label: "Telnet" }, { value: "rlogin", label: "RLogin" }, { value: "gcp", label: "Google Cloud Platform (GCP)" }, { value: "azure", label: "Microsoft Azure" }, { value: "ibm-csp", label: "IBM Cloud" }, { value: "digital-ocean", label: "Digital Ocean" }, { value: "heroku", label: "Heroku" }, { value: "scaleway", label: "Scaleway" }, { value: "linode", label: "Linode" }, { value: "ovhcloud", label: "OVH Cloud" }]} variant="form" />
            </div>

            {formData.protocol === "ssh" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t('connectionEditor.sshImplementation', 'SSH Implementation')}
                </label>
                <div className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)]">
                  {t('connectionEditor.rustSshLibrary', 'Rust SSH Library')}
                </div>
                <p className="text-xs text-[var(--color-textMuted)] mt-1">
                  {t('connectionEditor.rustSshDescription', 'Using secure Rust-based SSH implementation')}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t('connectionEditor.hostnameLabel', 'Hostname/IP *')}
              </label>
              <input
                type="text"
                required
                value={formData.hostname || ""}
                onChange={(e) =>
                  setFormData({ ...formData, hostname: e.target.value })
                }
                data-testid="editor-hostname"
                className="sor-form-input"
                placeholder={t('connectionEditor.hostnamePlaceholder', '192.168.1.100 or server.example.com')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t('connectionEditor.portLabel', 'Port')}
              </label>
              <NumberInput value={formData.port || 0} onChange={(v: number) => {
                    setFormData({ ...formData, port: v });
                    if (portError) setPortError(null);
                  }} onBlur={() => {
                    const p = formData.port ?? 0;
                    if (!Number.isFinite(p) || p < 1 || p > 65535) {
                      setPortError(t('connectionEditor.portError', 'Port must be between 1 and 65535'));
                    }
                  }} variant="form" min={1} max={65535}
                  data-testid="editor-port"
                  aria-invalid={portError ? true : undefined}
                  aria-describedby={portError ? "port-error" : undefined} />
              {portError && (
                <span id="port-error" className="text-sm text-error" role="alert">
                  {portError}
                </span>
              )}
            </div>

            {formData.protocol === "rdp" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  {t('connectionEditor.domainLabel', 'Domain')}
                </label>
                <input
                  type="text"
                  value={formData.domain || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, domain: e.target.value })
                  }
                  className="sor-form-input"
                  placeholder={t('connectionEditor.domainPlaceholder', 'Domain (optional)')}
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default GeneralSection;
