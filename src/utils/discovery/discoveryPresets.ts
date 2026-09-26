/** Scan targets, not fingerprints: selecting a preset never proves a product. */
export interface DiscoveryServicePreset {
  id: string;
  label: string;
  group: string;
  protocol: string;
  ports: readonly number[];
  httpScheme?: "http" | "https";
  note?: string;
}

export const DISCOVERY_SERVICE_PRESETS: readonly DiscoveryServicePreset[] = [
  {
    id: "ssh",
    label: "SSH / SFTP / SCP",
    group: "Remote access",
    protocol: "ssh",
    ports: [22],
    note: "SSH banners identify the server; SFTP/SCP availability requires authentication.",
  },
  {
    id: "rdp",
    label: "Remote Desktop (RDP)",
    group: "Remote access",
    protocol: "rdp",
    ports: [3389],
  },
  {
    id: "vnc",
    label: "VNC / RFB",
    group: "Remote access",
    protocol: "vnc",
    ports: [5900, 5901, 5902],
  },
  {
    id: "ard",
    label: "Apple Remote Desktop",
    group: "Remote access",
    protocol: "ard",
    ports: [3283, 5900],
  },
  {
    id: "spice",
    label: "SPICE",
    group: "Remote access",
    protocol: "spice",
    ports: [5900, 5901],
  },
  {
    id: "nx",
    label: "NoMachine / NX",
    group: "Remote access",
    protocol: "nx",
    ports: [4000],
  },
  {
    id: "x2go",
    label: "X2Go (SSH transport)",
    group: "Remote access",
    protocol: "ssh",
    ports: [22],
  },
  {
    id: "rustdesk",
    label: "RustDesk server",
    group: "Remote access",
    protocol: "rustdesk",
    ports: [21115, 21116, 21117],
  },
  {
    id: "telnet",
    label: "Telnet",
    group: "Remote access",
    protocol: "telnet",
    ports: [23],
  },
  {
    id: "rlogin",
    label: "Rlogin",
    group: "Remote access",
    protocol: "rlogin",
    ports: [513],
  },
  {
    id: "winrm",
    label: "WinRM",
    group: "Remote access",
    protocol: "winrm",
    ports: [5985],
    httpScheme: "http",
  },
  {
    id: "winrm-tls",
    label: "WinRM over TLS",
    group: "Remote access",
    protocol: "winrm",
    ports: [5986],
    httpScheme: "https",
  },
  {
    id: "http",
    label: "HTTP websites",
    group: "Web services",
    protocol: "http",
    ports: [80, 8080, 8000, 8081, 8888],
    httpScheme: "http",
  },
  {
    id: "https",
    label: "HTTPS websites",
    group: "Web services",
    protocol: "https",
    ports: [443, 8443, 9443],
    httpScheme: "https",
  },
  {
    id: "cpanel",
    label: "cPanel / WHM (HTTPS)",
    group: "Web services",
    protocol: "https",
    ports: [2083, 2087],
    httpScheme: "https",
  },
  {
    id: "cpanel-http",
    label: "cPanel / WHM (HTTP)",
    group: "Web services",
    protocol: "http",
    ports: [2082, 2086],
    httpScheme: "http",
  },
  {
    id: "pfsense",
    label: "pfSense / OPNsense",
    group: "Web services",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "portainer",
    label: "Portainer (HTTPS)",
    group: "Web services",
    protocol: "https",
    ports: [9443],
    httpScheme: "https",
  },
  {
    id: "portainer-http",
    label: "Portainer (HTTP)",
    group: "Web services",
    protocol: "http",
    ports: [9000],
    httpScheme: "http",
  },
  {
    id: "tactical-rmm",
    label: "Tactical RMM",
    group: "Web services",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "proxmox",
    label: "Proxmox VE",
    group: "Web services",
    protocol: "https",
    ports: [8006],
    httpScheme: "https",
  },
  {
    id: "ilo",
    label: "HPE iLO",
    group: "Management & storage",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "idrac",
    label: "Dell iDRAC",
    group: "Management & storage",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "lenovo",
    label: "Lenovo XClarity",
    group: "Management & storage",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "supermicro",
    label: "Supermicro BMC",
    group: "Management & storage",
    protocol: "https",
    ports: [443],
    httpScheme: "https",
  },
  {
    id: "synology",
    label: "Synology DSM (HTTPS)",
    group: "Management & storage",
    protocol: "https",
    ports: [5001],
    httpScheme: "https",
  },
  {
    id: "synology-http",
    label: "Synology DSM (HTTP)",
    group: "Management & storage",
    protocol: "http",
    ports: [5000],
    httpScheme: "http",
  },
  {
    id: "smb",
    label: "SMB file sharing",
    group: "Management & storage",
    protocol: "smb",
    ports: [445],
  },
  {
    id: "ftp",
    label: "FTP",
    group: "Management & storage",
    protocol: "ftp",
    ports: [21],
  },
  {
    id: "voip-phone",
    label: "VoIP phone web administration",
    group: "Management & storage",
    protocol: "http",
    ports: [80],
    httpScheme: "http",
  },
  {
    id: "mysql",
    label: "MySQL / MariaDB",
    group: "Databases",
    protocol: "mysql",
    ports: [3306],
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    group: "Databases",
    protocol: "postgresql",
    ports: [5432],
  },
  {
    id: "mssql",
    label: "Microsoft SQL Server",
    group: "Databases",
    protocol: "integration:mssql",
    ports: [1433],
  },
];

export const DEFAULT_DISCOVERY_PROTOCOLS = [
  "ssh",
  "http",
  "https",
  "rdp",
  "vnc",
];

export function defaultDiscoveryPorts(): Record<string, number[]> {
  return Object.fromEntries(
    DISCOVERY_SERVICE_PRESETS.map((preset) => [preset.id, [...preset.ports]]),
  );
}

export function configuredDiscoveryPorts(config: {
  protocols: string[];
  customPorts: Record<string, number[]>;
  portRanges: string[];
}): number[] {
  const ports = new Set<number>();
  for (const id of config.protocols) {
    for (const port of config.customPorts[id] ?? [])
      if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port);
  }
  for (const range of config.portRanges) {
    if (!/^\d+(?:-\d+)?$/.test(range)) continue;
    const [start, end = start] = range.split("-").map(Number);
    if (start < 1 || end > 65535 || end < start || end - start >= 1024)
      continue;
    for (let port = start; port <= end; port++) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
