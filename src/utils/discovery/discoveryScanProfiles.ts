import type { NetworkDiscoveryConfig } from "../../types/settings/settings";
import {
  DEFAULT_DISCOVERY_PROTOCOLS,
  DISCOVERY_SERVICE_PRESETS,
} from "./discoveryPresets";

export interface DiscoveryScanProfile {
  id: string;
  label: string;
  description: string;
  serviceIds: string[];
}

/** Service bundles only: applying a profile never starts a scan or changes its limits. */
export const DISCOVERY_SCAN_PROFILES: readonly DiscoveryScanProfile[] = [
  {
    id: "common",
    label: "Common services",
    description: "Common SSH, web, RDP and VNC ports.",
    serviceIds: [...DEFAULT_DISCOVERY_PROTOCOLS],
  },
  {
    id: "all",
    label: "All services",
    description:
      "Every supported service at its catalog TCP ports. This is not a scan of all 65,535 ports.",
    serviceIds: DISCOVERY_SERVICE_PRESETS.map(({ id }) => id),
  },
  {
    id: "remote-access",
    label: "Remote access",
    description:
      "All supported remote desktop, shell and administration services over TCP.",
    serviceIds: DISCOVERY_SERVICE_PRESETS.filter(
      ({ group }) => group === "Remote access",
    ).map(({ id }) => id),
  },
  {
    id: "windows",
    label: "Windows networks",
    description:
      "RDP, SMB, WinRM, web administration and Microsoft SQL Server.",
    serviceIds: ["rdp", "smb", "winrm", "winrm-tls", "http", "https", "mssql"],
  },
  {
    id: "linux",
    label: "Linux / Unix",
    description:
      "SSH, web services, file sharing and common Linux database ports.",
    serviceIds: ["ssh", "http", "https", "smb", "ftp", "mysql", "postgresql"],
  },
  {
    id: "databases",
    label: "Databases",
    description:
      "MySQL / MariaDB, PostgreSQL and Microsoft SQL Server over TCP.",
    serviceIds: DISCOVERY_SERVICE_PRESETS.filter(
      ({ group }) => group === "Databases",
    ).map(({ id }) => id),
  },
  {
    id: "virtualization",
    label: "Virtualization / containers",
    description:
      "Proxmox, Portainer, SSH, web management and VNC / SPICE console ports.",
    serviceIds: [
      "proxmox",
      "portainer",
      "portainer-http",
      "ssh",
      "http",
      "https",
      "vnc",
      "spice",
    ],
  },
  {
    id: "hosting",
    label: "Hosting panels",
    description:
      "cPanel / WHM, Tomcat, websites, SSH, FTP and hosting database ports.",
    serviceIds: [
      "cpanel",
      "cpanel-http",
      "tomcat",
      "tomcat-tls",
      "http",
      "https",
      "ssh",
      "ftp",
      "mysql",
      "postgresql",
    ],
  },
  {
    id: "management",
    label: "iLO / management",
    description:
      "HTTPS and SSH management ports for BMCs, firewalls and hypervisors.",
    serviceIds: [
      "ilo",
      "idrac",
      "lenovo",
      "supermicro",
      "ssh",
      "https",
      "proxmox",
      "pfsense",
    ],
  },
  {
    id: "iot",
    label: "IoT / devices",
    description:
      "Device and phone web administration, SSH and Telnet over TCP.",
    serviceIds: ["http", "https", "ssh", "telnet", "voip-phone"],
  },
  {
    id: "servers",
    label: "Servers",
    description:
      "Remote administration, web services, SMB and SQL database ports.",
    serviceIds: [
      "ssh",
      "rdp",
      "winrm",
      "winrm-tls",
      "http",
      "https",
      "tomcat",
      "tomcat-tls",
      "smb",
      "mysql",
      "postgresql",
      "mssql",
    ],
  },
  {
    id: "cloud",
    label: "Cloud subnets",
    description:
      "TCP services on reachable VPC subnets and private endpoints; does not inventory cloud accounts.",
    serviceIds: [
      "ssh",
      "rdp",
      "http",
      "https",
      "winrm-tls",
      "mysql",
      "postgresql",
      "mssql",
    ],
  },
  {
    id: "nas",
    label: "NAS / storage",
    description:
      "NAS web administration, Synology DSM, SMB, FTP and SSH ports.",
    serviceIds: [
      "synology",
      "synology-http",
      "smb",
      "ftp",
      "ssh",
      "http",
      "https",
    ],
  },
  {
    id: "webapps",
    label: "Web apps",
    description:
      "HTTP/HTTPS ports for websites, hosting panels, Portainer, Tactical RMM and Proxmox.",
    serviceIds: [
      "http",
      "https",
      "tomcat",
      "tomcat-tls",
      "cpanel",
      "cpanel-http",
      "portainer",
      "portainer-http",
      "tactical-rmm",
      "proxmox",
    ],
  },
];

/** Replace selected services and additional ranges; preserve targets and all tuning. */
export function applyDiscoveryScanProfile(
  config: NetworkDiscoveryConfig,
  id: string,
): NetworkDiscoveryConfig {
  const profile = DISCOVERY_SCAN_PROFILES.find(
    (candidate) => candidate.id === id,
  );
  if (!profile) throw new Error(`Unknown discovery scan profile: ${id}`);

  const protocols = [...new Set(profile.serviceIds)];
  const customPorts = Object.fromEntries(
    Object.entries(config.customPorts).map(([serviceId, ports]) => [
      serviceId,
      [...ports],
    ]),
  );
  for (const serviceId of protocols) {
    const service = DISCOVERY_SERVICE_PRESETS.find(
      (candidate) => candidate.id === serviceId,
    );
    if (!service)
      throw new Error(
        `Unknown discovery service in profile ${id}: ${serviceId}`,
      );
    customPorts[serviceId] = [...service.ports];
  }
  return { ...config, protocols, customPorts, portRanges: [] };
}
