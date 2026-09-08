import type { IntegrationDescriptor } from "../../types/integrations/registry";
import { getConnectionIconDefinition } from "../../utils/icons/connectionIconCatalog";

export const lxdDescriptor: IntegrationDescriptor = {
  key: "lxd",
  label: "LXD / Incus",
  category: "virtualization",
  icon: getConnectionIconDefinition("lxd")!.icon,
  defaultConnectionIconKey: "lxd",
  importPanel: () => import("./lxd/LxdPanel"),
};

export const pfsenseDescriptor: IntegrationDescriptor = {
  key: "pfsense",
  label: "pfSense",
  category: "networking",
  icon: getConnectionIconDefinition("pfsense")!.icon,
  defaultConnectionIconKey: "pfsense",
  importPanel: () => import("./pfsense/PfsensePanel"),
};

export const vmwareDesktopDescriptor: IntegrationDescriptor = {
  key: "vmwareDesktop",
  label: "VMware Workstation",
  category: "virtualization",
  icon: getConnectionIconDefinition("vmware-workstation")!.icon,
  defaultConnectionIconKey: "vmware-workstation",
  importPanel: () => import("./vmwareDesktop/VmwareDesktopPanel"),
};

export const vmwareDescriptor: IntegrationDescriptor = {
  key: "vmware",
  label: "VMware vSphere",
  category: "virtualization",
  icon: getConnectionIconDefinition("vsphere")!.icon,
  defaultConnectionIconKey: "vsphere",
  importPanel: () => import("./VmwarePanel"),
};

export const nginxDescriptor: IntegrationDescriptor = {
  key: "nginx",
  label: "Nginx",
  category: "web-server",
  icon: getConnectionIconDefinition("nginx")!.icon,
  defaultConnectionIconKey: "nginx",
  importPanel: () => import("./NginxPanel"),
};

export const haproxyDescriptor: IntegrationDescriptor = {
  key: "haproxy",
  label: "HAProxy",
  category: "web-server",
  icon: getConnectionIconDefinition("haproxy")!.icon,
  defaultConnectionIconKey: "haproxy",
  importPanel: () => import("./HaproxyPanel"),
};

export const caddyDescriptor: IntegrationDescriptor = {
  key: "caddy",
  label: "Caddy",
  category: "web-server",
  icon: getConnectionIconDefinition("caddy")!.icon,
  defaultConnectionIconKey: "caddy",
  importPanel: () => import("./CaddyPanel"),
};

export const traefikDescriptor: IntegrationDescriptor = {
  key: "traefik",
  label: "Traefik",
  category: "web-server",
  icon: getConnectionIconDefinition("traefikproxy")!.icon,
  defaultConnectionIconKey: "traefikproxy",
  importPanel: () => import("./TraefikPanel"),
};

export const mssqlDescriptor: IntegrationDescriptor = {
  key: "mssql",
  label: "SQL Server",
  category: "database",
  icon: getConnectionIconDefinition("mssql")!.icon,
  defaultConnectionIconKey: "mssql",
  importPanel: () => import("./MssqlPanel"),
};

export const prometheusDescriptor: IntegrationDescriptor = {
  key: "prometheus",
  label: "Prometheus",
  category: "monitoring",
  icon: getConnectionIconDefinition("prometheus")!.icon,
  defaultConnectionIconKey: "prometheus",
  importPanel: () => import("./PrometheusPanel"),
};

export const gdriveDescriptor: IntegrationDescriptor = {
  key: "gdrive",
  label: "Google Drive",
  category: "file-storage",
  icon: getConnectionIconDefinition("google-drive")!.icon,
  defaultConnectionIconKey: "google-drive",
  importPanel: () => import("./GdrivePanel"),
};

export const grafanaDescriptor: IntegrationDescriptor = {
  key: "grafana",
  label: "Grafana",
  category: "monitoring",
  icon: getConnectionIconDefinition("grafana")!.icon,
  defaultConnectionIconKey: "grafana",
  importPanel: () => import("./GrafanaPanel"),
};

export const budibaseDescriptor: IntegrationDescriptor = {
  key: "budibase",
  label: "Budibase",
  category: "business-app",
  icon: getConnectionIconDefinition("budibase")!.icon,
  defaultConnectionIconKey: "budibase",
  importPanel: () => import("./BudibasePanel"),
};

export const keepassDescriptor: IntegrationDescriptor = {
  key: "keepass",
  label: "KeePass",
  category: "vault",
  icon: getConnectionIconDefinition("keepass")!.icon,
  defaultConnectionIconKey: "keepass",
  importPanel: () => import("./keepass/KeepassPanel"),
};

// ── t68: DrayTek Vigor (network appliance; vendor-generic shell) ─────────────
export const draytekDescriptor: IntegrationDescriptor = {
  key: "draytek",
  label: "DrayTek Vigor",
  category: "networking",
  icon: getConnectionIconDefinition("draytek")!.icon,
  defaultConnectionIconKey: "draytek",
  importPanel: () => import("./draytek/DrayTekPanel"),
};
