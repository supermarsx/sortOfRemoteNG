import {
  Activity,
  BarChart3,
  Boxes,
  Database,
  HardDrive,
  KeyRound,
  MonitorPlay,
  Network,
  Server,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import type { IntegrationDescriptor } from "../../types/integrations/registry";

export const lxdDescriptor: IntegrationDescriptor = {
  key: "lxd",
  label: "LXD / Incus",
  category: "virtualization",
  icon: Boxes,
  defaultConnectionIconKey: "boxes",
  importPanel: () => import("./lxd/LxdPanel"),
};

export const pfsenseDescriptor: IntegrationDescriptor = {
  key: "pfsense",
  label: "pfSense",
  category: "networking",
  icon: ShieldCheck,
  defaultConnectionIconKey: "shield-check",
  importPanel: () => import("./pfsense/PfsensePanel"),
};

export const vmwareDesktopDescriptor: IntegrationDescriptor = {
  key: "vmwareDesktop",
  label: "VMware Workstation",
  category: "virtualization",
  icon: MonitorPlay,
  defaultConnectionIconKey: "monitor-play",
  importPanel: () => import("./vmwareDesktop/VmwareDesktopPanel"),
};

export const vmwareDescriptor: IntegrationDescriptor = {
  key: "vmware",
  label: "VMware vSphere",
  category: "virtualization",
  icon: Server,
  defaultConnectionIconKey: "server",
  importPanel: () => import("./VmwarePanel"),
};

export const nginxDescriptor: IntegrationDescriptor = {
  key: "nginx",
  label: "Nginx",
  category: "web-server",
  icon: Server,
  defaultConnectionIconKey: "server",
  importPanel: () => import("./NginxPanel"),
};

export const haproxyDescriptor: IntegrationDescriptor = {
  key: "haproxy",
  label: "HAProxy",
  category: "web-server",
  icon: Network,
  defaultConnectionIconKey: "network",
  importPanel: () => import("./HaproxyPanel"),
};

export const caddyDescriptor: IntegrationDescriptor = {
  key: "caddy",
  label: "Caddy",
  category: "web-server",
  icon: Boxes,
  defaultConnectionIconKey: "boxes",
  importPanel: () => import("./CaddyPanel"),
};

export const traefikDescriptor: IntegrationDescriptor = {
  key: "traefik",
  label: "Traefik",
  category: "web-server",
  icon: Waypoints,
  defaultConnectionIconKey: "waypoints",
  importPanel: () => import("./TraefikPanel"),
};

export const mssqlDescriptor: IntegrationDescriptor = {
  key: "mssql",
  label: "SQL Server",
  category: "database",
  icon: Database,
  defaultConnectionIconKey: "database",
  importPanel: () => import("./MssqlPanel"),
};

export const prometheusDescriptor: IntegrationDescriptor = {
  key: "prometheus",
  label: "Prometheus",
  category: "monitoring",
  icon: Activity,
  defaultConnectionIconKey: "activity",
  importPanel: () => import("./PrometheusPanel"),
};

export const gdriveDescriptor: IntegrationDescriptor = {
  key: "gdrive",
  label: "Google Drive",
  category: "file-storage",
  icon: HardDrive,
  defaultConnectionIconKey: "drive",
  importPanel: () => import("./GdrivePanel"),
};

export const grafanaDescriptor: IntegrationDescriptor = {
  key: "grafana",
  label: "Grafana",
  category: "monitoring",
  icon: BarChart3,
  defaultConnectionIconKey: "bar-chart",
  importPanel: () => import("./GrafanaPanel"),
};

export const budibaseDescriptor: IntegrationDescriptor = {
  key: "budibase",
  label: "Budibase",
  category: "business-app",
  icon: Boxes,
  defaultConnectionIconKey: "boxes",
  importPanel: () => import("./BudibasePanel"),
};

export const keepassDescriptor: IntegrationDescriptor = {
  key: "keepass",
  label: "KeePass",
  category: "vault",
  icon: KeyRound,
  defaultConnectionIconKey: "key-round",
  importPanel: () => import("./keepass/KeepassPanel"),
};
