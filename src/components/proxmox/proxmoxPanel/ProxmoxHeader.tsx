import React from "react";
import { useTranslation } from "react-i18next";
import { Server, ExternalLink, Globe, Unplug } from "lucide-react";
import DialogHeader from "../../ui/overlays/DialogHeader";
import type { SubPropsWithClose } from "./types";

const iconBtn =
  "inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-50";

const ProxmoxHeader: React.FC<SubPropsWithClose> = ({
  mgr,
  onClose,
  embedded,
  title,
  onOpenWebUi,
  onOpenWebUiExternal,
}) => {
  const { t } = useTranslation();
  const connected = mgr.connectionState === "connected";
  const subtitle = connected
    ? `${mgr.version?.version ?? ""} — ${mgr.nodes.length} node(s)`
    : t("proxmox.disconnected", "Not connected");

  if (!embedded) {
    return (
      <DialogHeader
        icon={Server}
        iconColor="text-warning"
        iconBg="bg-warning/20"
        title={t("proxmox.title", "Proxmox VE Manager")}
        subtitle={subtitle}
        onClose={onClose}
        className="shrink-0"
      />
    );
  }

  // Embedded (session tab): instance name, no close X, web-UI + disconnect actions.
  const endpoint = mgr.host.trim()
    ? `${mgr.host.trim()}:${mgr.port}`
    : undefined;
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2"
      data-testid="proxmox-embedded-header"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/20">
        <Server className="h-4 w-4 text-warning" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--color-text)]">
          {title?.trim() || t("proxmox.title", "Proxmox VE Manager")}
        </div>
        <div className="truncate text-[11px] text-[var(--color-textSecondary)]">
          {endpoint ? `${endpoint} · ${subtitle}` : subtitle}
        </div>
      </div>
      {onOpenWebUi && (
        <button
          type="button"
          className={iconBtn}
          onClick={onOpenWebUi}
          disabled={!mgr.host.trim()}
          data-testid="proxmox-open-web-ui"
          title={t(
            "proxmox.openWebUiHint",
            "Open the Proxmox web interface in an in-app tab (auto-login in password mode)",
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          {t("proxmox.openWebUi", "Open web UI")}
        </button>
      )}
      {onOpenWebUiExternal && (
        <button
          type="button"
          className={iconBtn}
          onClick={onOpenWebUiExternal}
          disabled={!mgr.host.trim()}
          data-testid="proxmox-open-web-ui-external"
          title={t(
            "proxmox.openWebUiExternalHint",
            "Open the Proxmox web interface in your default browser",
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("proxmox.openWebUiExternal", "External browser")}
        </button>
      )}
      {connected && (
        <button
          type="button"
          className={iconBtn}
          onClick={() => void mgr.disconnect()}
          data-testid="proxmox-header-disconnect-btn"
          title={t("proxmox.disconnect", "Disconnect")}
        >
          <Unplug className="h-3.5 w-3.5" />
          {t("proxmox.disconnect", "Disconnect")}
        </button>
      )}
    </div>
  );
};

export default ProxmoxHeader;
