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
  category: "infra",
  icon: Boxes,
  importPanel: () => import("./lxd/LxdPanel"),
};

export const pfsenseDescriptor: IntegrationDescriptor = {
  key: "pfsense",
  label: "pfSense",
  category: "infra",
  icon: ShieldCheck,
  importPanel: () => import("./pfsense/PfsensePanel"),
};

export const vmwareDesktopDescriptor: IntegrationDescriptor = {
  key: "vmwareDesktop",
  label: "VMware Workstation",
  category: "infra",
  icon: MonitorPlay,
  importPanel: () => import("./vmwareDesktop/VmwareDesktopPanel"),
};

export const vmwareDescriptor: IntegrationDescriptor = {
  key: "vmware",
  label: "VMware vSphere",
  category: "infra",
  icon: Server,
  importPanel: () => import("./VmwarePanel"),
};

export const nginxDescriptor: IntegrationDescriptor = {
  key: "nginx",
  label: "Nginx",
  category: "web",
  icon: Server,
  importPanel: () => import("./NginxPanel"),
};

export const haproxyDescriptor: IntegrationDescriptor = {
  key: "haproxy",
  label: "HAProxy",
  category: "web",
  icon: Network,
  importPanel: () => import("./HaproxyPanel"),
};

export const caddyDescriptor: IntegrationDescriptor = {
  key: "caddy",
  label: "Caddy",
  category: "web",
  icon: Boxes,
  importPanel: () => import("./CaddyPanel"),
};

export const traefikDescriptor: IntegrationDescriptor = {
  key: "traefik",
  label: "Traefik",
  category: "web",
  icon: Waypoints,
  importPanel: () => import("./TraefikPanel"),
};

export const mssqlDescriptor: IntegrationDescriptor = {
  key: "mssql",
  label: "SQL Server",
  category: "database",
  icon: Database,
  importPanel: () => import("./MssqlPanel"),
};

export const prometheusDescriptor: IntegrationDescriptor = {
  key: "prometheus",
  label: "Prometheus",
  category: "app-service",
  icon: Activity,
  importPanel: () => import("./PrometheusPanel"),
};

export const gdriveDescriptor: IntegrationDescriptor = {
  key: "gdrive",
  label: "Google Drive",
  category: "app-service",
  icon: HardDrive,
  importPanel: () => import("./GdrivePanel"),
};

export const grafanaDescriptor: IntegrationDescriptor = {
  key: "grafana",
  label: "Grafana",
  category: "app-service",
  icon: BarChart3,
  importPanel: () => import("./GrafanaPanel"),
};

export const budibaseDescriptor: IntegrationDescriptor = {
  key: "budibase",
  label: "Budibase",
  category: "app-service",
  icon: Boxes,
  importPanel: () => import("./BudibasePanel"),
};

export const keepassDescriptor: IntegrationDescriptor = {
  key: "keepass",
  label: "KeePass",
  category: "vault",
  icon: KeyRound,
  importPanel: () => import("./keepass/KeepassPanel"),
};
