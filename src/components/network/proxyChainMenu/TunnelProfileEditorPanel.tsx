import React, { useState, useCallback, useEffect } from "react";
import { Save, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import type {
  TunnelType,
  TunnelChainLayer,
} from "../../../types/connection/connection";
import { TUNNEL_TYPE_OPTIONS, getTypeLabel } from "./tunnelChainShared.helpers";
import { LayerConfigForm } from "./tunnelChainShared";
import { useVpnManager } from "../../../hooks/network/useVpnManager";

// Reuse createDefaultLayer from useTunnelChainEditor
function createDefaultLayer(type: TunnelType): TunnelChainLayer {
  const id = crypto.randomUUID();
  const base: TunnelChainLayer = { id, type, enabled: true };

  switch (type) {
    case "proxy":
      return {
        ...base,
        name: "Proxy",
        proxy: { proxyType: "socks5", host: "", port: 1080 },
      };
    case "ssh-tunnel":
      return {
        ...base,
        name: "SSH Tunnel",
        sshTunnel: { forwardType: "local", host: "", port: 22, username: "" },
      };
    case "ssh-jump":
      return {
        ...base,
        name: "SSH Jump Host",
        sshChainingMethod: "proxyjump",
        sshTunnel: { forwardType: "local", host: "", port: 22, username: "" },
      };
    case "ssh-proxycmd":
      return {
        ...base,
        name: "SSH ProxyCommand",
        sshTunnel: { forwardType: "local", proxyCommand: { template: "nc" } },
      };
    case "ssh-stdio":
      return {
        ...base,
        name: "SSH Stdio",
        sshTunnel: { forwardType: "local" },
      };
    case "openvpn":
      return {
        ...base,
        name: "OpenVPN",
        vpn: { configId: "", protocol: "udp" },
      };
    case "wireguard":
      return { ...base, name: "WireGuard", vpn: { configId: "" } };
    case "tailscale":
      return {
        ...base,
        name: "Tailscale",
        vpn: { configId: "" },
        mesh: {},
      };
    case "zerotier":
      return {
        ...base,
        name: "ZeroTier",
        vpn: { configId: "" },
        mesh: {},
      };
    case "pptp":
    case "l2tp":
    case "ikev2":
    case "ipsec":
    case "sstp":
      return {
        ...base,
        name: getTypeLabel(type),
        vpn: { configId: "" },
      };
    case "shadowsocks":
      return {
        ...base,
        name: "Shadowsocks",
        proxy: { proxyType: "socks5", host: "", port: 8388 },
      };
    case "tor":
      return {
        ...base,
        name: "Tor",
        proxy: { proxyType: "socks5", host: "127.0.0.1", port: 9050 },
      };
    default:
      return { ...base, name: type, tunnel: {} };
  }
}

interface TunnelProfileEditorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  editingProfileId?: string;
}

const TunnelProfileEditorPanel: React.FC<TunnelProfileEditorPanelProps> = ({
  isOpen,
  onClose,
  onSave,
  editingProfileId,
}) => {
  const { t } = useTranslation();
  const vpnManager = useVpnManager(isOpen);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedType, setSelectedType] = useState<TunnelType>("proxy");
  const [layerConfig, setLayerConfig] = useState<TunnelChainLayer>(() =>
    createDefaultLayer("proxy"),
  );

  // Load existing profile if editing
  useEffect(() => {
    if (!isOpen) return;
    if (editingProfileId) {
      const profile = proxyCollectionManager.getTunnelProfile(editingProfileId);
      if (profile) {
        setName(profile.name);
        setDescription(profile.description ?? "");
        setTags(profile.tags ?? []);
        setSelectedType(profile.type);
        setLayerConfig(profile.config);
      }
    }
  }, [isOpen, editingProfileId]);

  const handleTypeChange = useCallback((type: TunnelType) => {
    setSelectedType(type);
    setLayerConfig(createDefaultLayer(type));
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;

    if (editingProfileId) {
      await proxyCollectionManager.updateTunnelProfile(editingProfileId, {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        type: selectedType,
        config: layerConfig,
      });
    } else {
      await proxyCollectionManager.createTunnelProfile(
        name.trim(),
        selectedType,
        layerConfig,
        {
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        },
      );
    }
    onSave();
  }, [
    name,
    description,
    tags,
    selectedType,
    layerConfig,
    editingProfileId,
    onSave,
  ]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  if (!isOpen) return null;

  // Group types by category for the selector
  const groupedTypes = TUNNEL_TYPE_OPTIONS.reduce<
    Record<string, typeof TUNNEL_TYPE_OPTIONS>
  >((acc, opt) => {
    (acc[opt.category] ??= []).push(opt);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          {editingProfileId
            ? t(
                "proxyChainMenu.tunnelProfileEditor.editTitle",
                "Edit Tunnel Profile",
              )
            : t(
                "proxyChainMenu.tunnelProfileEditor.newTitle",
                "New Tunnel Profile",
              )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="sor-btn sor-btn-primary sor-btn-sm"
          >
            <Save size={12} />{" "}
            {editingProfileId
              ? t("proxyChainMenu.tunnelProfileEditor.update", "Update")
              : t("proxyChainMenu.common.save", "Save")}
          </button>
          <button
            onClick={onClose}
            aria-label={t("proxyChainMenu.common.close", "Close")}
            className="sor-icon-btn"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Metadata */}
        <div className="space-y-3">
          <div>
            <label className="sor-form-label">
              {t("proxyChainMenu.tunnelProfileEditor.nameLabel", "Name *")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t(
                "proxyChainMenu.tunnelProfileEditor.namePlaceholder",
                "e.g. Office WireGuard, Bastion SSH",
              )}
              className="sor-form-input min-w-0 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="sor-form-label">
              {t(
                "proxyChainMenu.tunnelProfileEditor.descriptionLabel",
                "Description",
              )}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                "proxyChainMenu.tunnelProfileEditor.descriptionPlaceholder",
                "Optional description...",
              )}
              rows={2}
              className="sor-form-textarea text-sm resize-y"
            />
          </div>
          <div>
            <label className="sor-form-label">
              {t("proxyChainMenu.tunnelProfileEditor.tagsLabel", "Tags")}
            </label>
            <div className="flex items-center gap-1 flex-wrap">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="sor-icon-btn-danger"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder={t(
                  "proxyChainMenu.tunnelProfileEditor.tagPlaceholder",
                  "Add tag...",
                )}
                className="sor-form-input-sm w-40 min-w-0"
              />
            </div>
          </div>
        </div>

        {/* Tunnel Type Selector */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <label className="sor-form-label">
            {t(
              "proxyChainMenu.tunnelProfileEditor.tunnelTypeLabel",
              "Tunnel Type",
            )}
          </label>
          <div className="space-y-2">
            {Object.entries(groupedTypes).map(([category, types]) => (
              <div key={category}>
                <div className="text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider mb-1">
                  {category}
                </div>
                <div className="flex flex-wrap gap-1">
                  {types.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleTypeChange(opt.value)}
                      aria-pressed={selectedType === opt.value}
                      className={`sor-btn sor-btn-sm ${
                        selectedType === opt.value
                          ? "sor-btn-primary"
                          : "sor-btn-secondary"
                      }`}
                    >
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Type-specific config */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-2">
            {t(
              "proxyChainMenu.tunnelProfileEditor.configHeading",
              "{{type}} Configuration",
              { type: getTypeLabel(selectedType) },
            )}
          </h3>
          <LayerConfigForm
            layer={layerConfig}
            vpnProfileCatalog={vpnManager.profileCatalog}
            onUpdate={(updates) =>
              setLayerConfig((prev) => ({ ...prev, ...updates }))
            }
          />
        </div>
      </div>
    </div>
  );
};

export default TunnelProfileEditorPanel;
