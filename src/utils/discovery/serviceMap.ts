/**
 * Port -> service/protocol evidence used by network discovery.
 *
 * Protocol values are the app's own `BuiltInConnectionProtocol` ids wherever
 * one exists so a discovered service can be turned into a connection without a
 * second mapping step. Ports that have no built-in protocol (smtp, dns, ...)
 * keep their service name; the discovery hook normalises those to `raw`.
 *
 * Deliberately excluded: additional database ports (MSSQL, MongoDB, ...) —
 * those belong to the database-protocol tasks. Unknown ports are classified
 * by banner/port evidence in `networkScanner.ts`, never defaulted to RDP.
 */
export const serviceMap: Record<number, { service: string; protocol: string }> =
  {
    21: { service: "ftp", protocol: "ftp" },
    22: { service: "ssh", protocol: "ssh" },
    23: { service: "telnet", protocol: "telnet" },
    25: { service: "smtp", protocol: "smtp" },
    53: { service: "dns", protocol: "dns" },
    80: { service: "http", protocol: "http" },
    81: { service: "http", protocol: "http" },
    110: { service: "pop3", protocol: "pop3" },
    143: { service: "imap", protocol: "imap" },
    177: { service: "xdmcp", protocol: "xdmcp" },
    443: { service: "https", protocol: "https" },
    445: { service: "smb", protocol: "smb" },
    513: { service: "rlogin", protocol: "rlogin" },
    993: { service: "imaps", protocol: "imaps" },
    995: { service: "pop3s", protocol: "pop3s" },
    3306: { service: "mysql", protocol: "mysql" },
    3389: { service: "rdp", protocol: "rdp" },
    4443: { service: "https", protocol: "https" },
    5432: { service: "postgresql", protocol: "postgresql" },
    5900: { service: "vnc", protocol: "vnc" },
    5901: { service: "vnc", protocol: "vnc" },
    5902: { service: "vnc", protocol: "vnc" },
    5985: { service: "winrm", protocol: "winrm" },
    5986: { service: "winrm", protocol: "winrm" },
    8000: { service: "http", protocol: "http" },
    8006: { service: "https", protocol: "https" },
    8008: { service: "http", protocol: "http" },
    8043: { service: "https", protocol: "https" },
    8080: { service: "http", protocol: "http" },
    8081: { service: "http", protocol: "http" },
    8443: { service: "https", protocol: "https" },
    8834: { service: "https", protocol: "https" },
    8888: { service: "http", protocol: "http" },
    9000: { service: "http", protocol: "http" },
    9090: { service: "https", protocol: "https" },
    9443: { service: "https", protocol: "https" },
    10000: { service: "http", protocol: "http" },
    10443: { service: "https", protocol: "https" },
  };

export default serviceMap;
