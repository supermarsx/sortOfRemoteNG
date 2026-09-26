import type { DiscoveredService } from "../../types/connection/connection";
import {
  normalizeImportedProtocol,
  protocolFromPort,
} from "../connection/normalizeImportedProtocol";
import serviceMap from "./serviceMap";

/** Optional evidence returned by check_port; an HTTP failure is not a TCP failure. */
export interface ServiceFingerprintEvidence {
  http_server?: string;
  http_title?: string;
  http_status?: number;
  identification_error?: string;
  httpScheme?: "http" | "https";
}

// Match complete software identifiers, not mentions in arbitrary banner text.
const WEB_SERVER = /^(nginx|Apache|Microsoft-IIS)(?:\/([\d.]+))?(?=$|[\s(])/i;
const FTP_SOFTWARE =
  /\b(vsftpd|ProFTPD|Pure-FTPd|FileZilla Server)(?=$|[\s/()])/i;
const WEB_PRODUCTS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "Synology DSM",
    /^(?:[\w.-]+\s*[-–|]\s*)?(?:Synology\s+(?:DSM|DiskStation(?:\s+Manager)?)|DiskStation Manager)(?:\s+\d[\w.-]*)?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i,
  ],
  ["cPanel", /^cPanel(?:\s+(?:Login|Sign In))?(?:\s*[-–|:].*)?$/i],
  [
    "WHM",
    /^(?:WHM|WebHost Manager)(?:\s+(?:Login|Sign In))?(?:\s*[-–|:].*)?$/i,
  ],
  [
    "pfSense",
    /^pfSense(?:®)?(?:\s+(?:Plus|CE))?(?:\s*[-–|:]\s*(?:Login|Sign In|Dashboard))?$/i,
  ],
  [
    "Portainer",
    /^Portainer(?:\s+(?:CE|BE|Community Edition|Business Edition|Login))?(?:\s*[-–|:].*)?$/i,
  ],
  [
    "Tactical RMM",
    /^Tactical\s*RMM(?:\s+(?:Login|Dashboard))?(?:\s*[-–|:].*)?$/i,
  ],
  [
    "Proxmox VE",
    /^(?:[\w.-]+\s*[-–|]\s*)?Proxmox\s+(?:VE|Virtual Environment)(?:\s+\d[\w.-]*)?$/i,
  ],
  [
    "HPE iLO",
    /^(?:(?:HPE?|Hewlett[ -]Packard(?: Enterprise)?)\s+)?(?:Integrated Lights-Out|iLO)(?:\s*\d+)?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i,
  ],
  [
    "Dell iDRAC",
    /^(?:Dell(?: EMC)?\s+)?(?:Integrated Dell Remote Access Controller|iDRAC)(?:\s*\d+)?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i,
  ],
  ["OPNsense", /^OPNsense(?:®)?(?:\s*[-–|:]\s*(?:Login|Sign In|Dashboard))?$/i],
  [
    "Lenovo XClarity",
    /^Lenovo XClarity(?: Controller| Administrator)?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i,
  ],
  [
    "Supermicro",
    /^Supermicro(?:\s+(?:IPMI|BMC|Intelligent Management))?(?:\s*[-–|:]\s*(?:Login|Sign In))?$/i,
  ],
  ["nginx", /^Welcome to nginx!$/i],
  ["Apache", /^Apache2? (?:Ubuntu|Debian)?\s*Default Page(?:: It works)?$/i],
  ["IIS", /^IIS Windows Server$/i],
];

const display = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, 240);

/** Passive protocol evidence wins over every preset and port hint. */
export function fingerprintService(
  port: number,
  banner?: string,
  protocolHint?: string,
  http: ServiceFingerprintEvidence = {},
): DiscoveredService {
  const base = {
    port,
    banner,
    ...(http.identification_error
      ? { identificationError: http.identification_error }
      : {}),
  };
  const identified = (
    protocol: string,
    evidence: string,
    product?: string,
    version?: string,
  ): DiscoveredService => ({
    ...base,
    protocol,
    service: protocol,
    detection: "identified",
    evidence,
    ...(product ? { product } : {}),
    ...(version ? { version } : {}),
  });
  const text = banner?.trim() ?? "";
  const ssh = text.match(/^SSH-(?:2\.0|1\.99|1\.5)-([^\s]+)[^\r\n]*/);
  if (ssh) {
    const software = ssh[1].match(/^(OpenSSH|dropbear)[_\-]([\d][\w.]*)$/i);
    return identified(
      "ssh",
      `SSH banner: ${display(ssh[0])}`,
      software
        ? software[1].toLowerCase() === "openssh"
          ? "OpenSSH"
          : "Dropbear"
        : undefined,
      software?.[2],
    );
  }
  const rfb = text.match(/^RFB (\d{3}\.\d{3})$/);
  if (rfb) return identified("vnc", `RFB banner: ${text}`, undefined, rfb[1]);

  // SMTP also uses 220: the response code alone cannot identify FTP.
  const ftp = text.match(/^220[ -]([^\r\n]*)/);
  if (
    ftp &&
    !/\b(?:E?SMTP)\b/i.test(ftp[1]) &&
    (/\bFTP\b/i.test(ftp[1]) || FTP_SOFTWARE.test(ftp[1]))
  ) {
    const product = ftp[1].match(FTP_SOFTWARE)?.[1];
    const label =
      product &&
      (
        {
          vsftpd: "vsftpd",
          proftpd: "ProFTPD",
          "pure-ftpd": "Pure-FTPd",
          "filezilla server": "FileZilla Server",
        } as Record<string, string>
      )[product.toLowerCase()];
    return identified("ftp", `FTP banner: ${display(ftp[0])}`, label);
  }

  const status =
    Number.isInteger(http.http_status) &&
    http.http_status! >= 100 &&
    http.http_status! <= 599
      ? http.http_status
      : undefined;
  const bannerStatus = text.match(/^HTTP\/\d(?:\.\d)?\s+([1-5]\d\d)\b/i);
  const bannerServer = text.match(/(?:^|\r?\n)Server:\s*([^\r\n]+)/i)?.[1];
  const server =
    http.http_server?.trim() ||
    bannerServer ||
    (WEB_SERVER.test(text) ? text : undefined);
  const title =
    http.http_title?.trim() ||
    text.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1]?.trim();
  const isHttp =
    status !== undefined ||
    !!bannerStatus ||
    !!server ||
    !!http.http_title?.trim() ||
    /^\s*(?:<!doctype html\b|<html\b)/i.test(text);
  if (isHttp) {
    const scheme =
      http.httpScheme ??
      (protocolHint === "http" || protocolHint === "https"
        ? protocolHint
        : undefined) ??
      (protocolFromPort(port) === "https" ? "https" : "http");
    const parts = [
      status !== undefined
        ? `HTTP status: ${status}`
        : bannerStatus
          ? `HTTP status: ${bannerStatus[1]}`
          : undefined,
      server ? `Server: ${display(server)}` : undefined,
      title ? `Title: ${display(title)}` : undefined,
    ].filter(Boolean);
    // Prefer application branding over the generic server hosting it.
    const branded = title
      ? WEB_PRODUCTS.find(([, pattern]) => pattern.test(title))?.[0]
      : undefined;
    const serverBrand = server
      ? WEB_PRODUCTS.find(([, pattern]) => pattern.test(server))?.[0]
      : undefined;
    const software = server?.match(WEB_SERVER);
    const product =
      branded ??
      serverBrand ??
      (software
        ? (
            {
              nginx: "nginx",
              apache: "Apache",
              "microsoft-iis": "IIS",
            } as Record<string, string>
          )[software[1].toLowerCase()]
        : undefined);
    return identified(
      scheme,
      parts.join("; ") || "HTTP HTML banner",
      product,
      branded || serverBrand ? undefined : software?.[2],
    );
  }

  const mapped = serviceMap[port];
  const normalized = normalizeImportedProtocol({ port });
  // A caller's selection is a hint, never proof of a product or capability.
  const hint =
    protocolHint && protocolHint !== "default"
      ? normalizeImportedProtocol({ raw: protocolHint })
      : undefined;
  const protocol =
    normalized.source === "port"
      ? normalized.protocol
      : hint?.source === "alias"
        ? hint.protocol === "sftp" || hint.protocol === "scp"
          ? "ssh"
          : hint.protocol
        : "raw";
  const known =
    !!mapped || normalized.source === "port" || hint?.source === "alias";
  return {
    ...base,
    protocol,
    service: mapped?.service ?? (protocol === "raw" ? "unknown" : protocol),
    detection: known ? "port-hint" : "unknown",
    ...(known
      ? {
          evidence: `Port ${port}${mapped ? ` commonly used for ${mapped.service}` : hint?.source === "alias" ? ` selected for ${protocol}` : ` commonly used for ${protocol}`}; protocol not confirmed`,
        }
      : {}),
  };
}
