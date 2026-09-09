import React from "react";
import { useTranslation } from "react-i18next";
import {
  Wifi,
  Route,
  PlugZap,
  Shield,
  Layers,
  Combine,
  Waypoints,
  Boxes,
} from "lucide-react";
import {
  useProxyChainManager,
  type ProxyTab,
} from "../../hooks/network/useProxyChainManager";
import { useTunnelChainManager } from "../../hooks/network/useTunnelChainManager";
import { ProxyChainMenuProps } from "./proxyChainMenu/types";
import {
  SidebarTabs,
  type SidebarTabDescriptor,
} from "./proxyChainMenu/SidebarTabs";
import ProfilesTab from "./proxyChainMenu/ProfilesTab";
import ChainsTab from "./proxyChainMenu/ChainsTab";
import UnifiedChainsTab from "./proxyChainMenu/UnifiedChainsTab";
import TunnelChainTab from "./proxyChainMenu/TunnelChainTab";
import LayerProfilesTab from "./proxyChainMenu/LayerProfilesTab";
import TunnelsTab from "./proxyChainMenu/TunnelsTab";
import VpnConnectionsTab from "./proxyChainMenu/VpnConnectionsTab";
import AssociationsTab from "./proxyChainMenu/AssociationsTab";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";

const ID_PREFIX = "proxy-chain-menu";

export const ProxyChainMenu: React.FC<ProxyChainMenuProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const { isActive } = useSessionRenderActivity();
  const observationActive = isOpen && isActive;
  const mgr = useProxyChainManager(observationActive, onClose);
  const tunnelMgr = useTunnelChainManager(observationActive);

  if (!isOpen) return null;

  const tabs = [
    {
      id: "profiles",
      label: t("proxyChainMenu.nav.profiles", "Profiles"),
      icon: Wifi,
    },
    {
      id: "chains",
      label: t("proxyChainMenu.nav.chains", "Chains"),
      icon: Layers,
    },
    {
      id: "unifiedChains",
      label: t("proxyChainMenu.nav.unifiedChains", "Unified Chains"),
      icon: Combine,
    },
    {
      id: "tunnelChains",
      label: t("proxyChainMenu.nav.tunnelChains", "Tunnel Chains"),
      icon: Waypoints,
    },
    {
      id: "layerProfiles",
      label: t("proxyChainMenu.nav.layerProfiles", "Layer Profiles"),
      icon: Boxes,
    },
    {
      id: "tunnels",
      label: t("proxyChainMenu.nav.tunnels", "SSH Tunnels"),
      icon: Route,
    },
    {
      id: "vpnConnections",
      label: t("proxyChainMenu.nav.vpnConnections", "VPN Connections"),
      icon: Shield,
    },
    {
      id: "associations",
      label: t("proxyChainMenu.nav.associations", "Associations"),
      icon: PlugZap,
    },
  ] satisfies readonly SidebarTabDescriptor<ProxyTab>[];

  const panelProps = (id: ProxyTab) => ({
    role: "tabpanel",
    id: `${ID_PREFIX}-panel-${id}`,
    "aria-labelledby": `${ID_PREFIX}-tab-${id}`,
  });

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex flex-1 min-h-0">
        <SidebarTabs
          tabs={tabs}
          activeTab={mgr.activeTab}
          onTabChange={mgr.setActiveTab}
          idPrefix={ID_PREFIX}
          ariaLabel={t("proxyChainMenu.nav.ariaLabel", "Proxy chain sections")}
        />

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {mgr.activeTab === "profiles" && (
            <div {...panelProps("profiles")}>
              <ProfilesTab mgr={mgr} />
            </div>
          )}
          {mgr.activeTab === "chains" && (
            <div {...panelProps("chains")}>
              <ChainsTab mgr={mgr} />
            </div>
          )}
          {mgr.activeTab === "unifiedChains" && (
            <div {...panelProps("unifiedChains")}>
              <UnifiedChainsTab
                isOpen={observationActive}
                tunnelMgr={tunnelMgr}
                mgr={mgr}
              />
            </div>
          )}
          {mgr.activeTab === "tunnelChains" && (
            <div {...panelProps("tunnelChains")}>
              <TunnelChainTab
                isOpen={observationActive}
                tunnelMgr={tunnelMgr}
              />
            </div>
          )}
          {mgr.activeTab === "layerProfiles" && (
            <div {...panelProps("layerProfiles")}>
              <LayerProfilesTab tunnelMgr={tunnelMgr} />
            </div>
          )}
          {mgr.activeTab === "tunnels" && (
            <div {...panelProps("tunnels")}>
              <TunnelsTab mgr={mgr} />
            </div>
          )}
          {mgr.activeTab === "vpnConnections" && (
            <div {...panelProps("vpnConnections")}>
              <VpnConnectionsTab isOpen={observationActive} mgr={mgr} />
            </div>
          )}
          {mgr.activeTab === "associations" && (
            <div {...panelProps("associations")}>
              <AssociationsTab mgr={mgr} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProxyChainMenu;
