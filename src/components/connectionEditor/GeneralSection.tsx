import React, { useMemo } from "react";
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
import { Connection } from "../../types/connection";
import { getDefaultPort } from "../../utils/defaultPorts";
import {
  getConnectionDepth,
  getMaxDescendantDepth,
  MAX_NESTING_DEPTH,
} from "../../utils/dragDropManager";
import { Checkbox, NumberInput, Select } from '../ui/forms';

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
          reason: "Cannot be its own parent",
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
              reason: "Cannot move into own descendant",
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
          ? `Max depth (${MAX_NESTING_DEPTH}) exceeded`
          : undefined,
      };
    });
  }, [availableGroups, allConnections, formData.id, formData.isGroup]);

  return (
    <Select value={formData.parentId || ""} onChange={(v: string) =>
        setFormData({ ...formData, parentId: v || undefined })} options={[{ value: '', label: 'Root (No parent)' }, ...selectableGroups.map(({ group, depth, disabled, reason }) => ({ value: group.id, label: `${"─".repeat(depth)} ${getFolderPath(group.id, allConnections)}
          ${disabled ? ` (${reason})` : ""}`, disabled: disabled, title: reason }))]} className="sor-form-select" />
  );
};

export const GeneralSection: React.FC<GeneralSectionProps> = ({
  formData,
  setFormData,
  availableGroups,
  allConnections = [],
}) => {
  const iconOptions = [
    { value: "", label: "Default", icon: Monitor },
    { value: "terminal", label: "Terminal", icon: Terminal },
    { value: "globe", label: "Web", icon: Globe },
    { value: "database", label: "Database", icon: Database },
    { value: "server", label: "Server", icon: Server },
    { value: "shield", label: "Shield", icon: Shield },
    { value: "cloud", label: "Cloud", icon: Cloud },
    { value: "folder", label: "Folder", icon: Folder },
    { value: "star", label: "Star", icon: Star },
    { value: "drive", label: "Drive", icon: HardDrive },
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
            Create as folder/group
          </span>
        </label>
        {!formData.isGroup && (
          <label className="flex items-center space-x-2">
            <Checkbox checked={!!formData.favorite} onChange={(v: boolean) => setFormData({ ...formData, favorite: v })} variant="form" />
            <span className="text-[var(--color-textSecondary)]">
              Mark as favorite
            </span>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            Name *
          </label>
          <input
            type="text"
            required
            value={formData.name || ""}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="sor-form-input"
            placeholder={formData.isGroup ? "Folder name" : "Connection name"}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
            Icon
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
                      ? "border-blue-500 bg-blue-500/10 text-blue-200"
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
            Parent Folder
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
                Protocol
              </label>
              <Select value={formData.protocol ?? "rdp"} onChange={(v: string) => handleProtocolChange(v)} options={[{ value: "rdp", label: "RDP (Remote Desktop)" }, { value: "ssh", label: "SSH (Secure Shell)" }, { value: "vnc", label: "VNC (Virtual Network Computing)" }, { value: "anydesk", label: "AnyDesk" }, { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "telnet", label: "Telnet" }, { value: "rlogin", label: "RLogin" }, { value: "gcp", label: "Google Cloud Platform (GCP)" }, { value: "azure", label: "Microsoft Azure" }, { value: "ibm-csp", label: "IBM Cloud" }, { value: "digital-ocean", label: "Digital Ocean" }, { value: "heroku", label: "Heroku" }, { value: "scaleway", label: "Scaleway" }, { value: "linode", label: "Linode" }, { value: "ovhcloud", label: "OVH Cloud" }]} variant="form" />
            </div>

            {formData.protocol === "ssh" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  SSH Implementation
                </label>
                <div className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-textSecondary)]">
                  Rust SSH Library
                </div>
                <p className="text-xs text-[var(--color-textMuted)] mt-1">
                  Using secure Rust-based SSH implementation
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Hostname/IP *
              </label>
              <input
                type="text"
                required
                value={formData.hostname || ""}
                onChange={(e) =>
                  setFormData({ ...formData, hostname: e.target.value })
                }
                className="sor-form-input"
                placeholder="192.168.1.100 or server.example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                Port
              </label>
              <NumberInput value={formData.port || 0} onChange={(v: number) => setFormData({
                    ...formData,
                    port: v,
                  })} variant="form" min={1} max={65535} />
            </div>

            {formData.protocol === "rdp" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Domain
                </label>
                <input
                  type="text"
                  value={formData.domain || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, domain: e.target.value })
                  }
                  className="sor-form-input"
                  placeholder="Domain (optional)"
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
