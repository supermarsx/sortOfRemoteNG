import { describe, expect, it } from "vitest";
import { fingerprintService } from "../../src/utils/discovery/serviceFingerprint";

describe("evidence-based service fingerprinting", () => {
  it.each([
    [443, "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3", "https", "ssh", "OpenSSH"],
    [5900, "SSH-2.0-dropbear_2022.83", "vnc", "ssh", "Dropbear"],
    [22, "RFB 003.008\r\n", "ssh", "vnc", undefined],
    [3389, "HTTP/1.1 200 OK\r\nServer: nginx/1.24.0", "rdp", "http", "nginx"],
    [443, "220 (vsFTPd 3.0.5)", "https", "ftp", "vsftpd"],
    [22, "220 ProFTPD 1.3.8 Server ready", "ssh", "ftp", "ProFTPD"],
    [22, "220 Pure-FTPd ready", "ssh", "ftp", "Pure-FTPd"],
    [22, "220 FileZilla Server 1.8.0", "ssh", "ftp", "FileZilla Server"],
  ])(
    "port %i: %s overrides preset %s",
    (port, banner, hint, protocol, product) => {
      const result = fingerprintService(port, banner, hint);
      expect(result).toMatchObject({ port, protocol, detection: "identified" });
      expect(result.product).toBe(product);
      expect(result.evidence).toBeTruthy();
    },
  );

  it.each(["sftp", "scp"])("SSH does not confirm %s", (hint) => {
    expect(fingerprintService(22, "SSH-2.0-OpenSSH_9.6", hint)).toMatchObject({
      protocol: "ssh",
      service: "ssh",
      product: "OpenSSH",
    });
    expect(fingerprintService(2222, undefined, hint)).toMatchObject({
      protocol: "ssh",
      detection: "port-hint",
    });
  });

  it.each([22, 21, 443, 8006, 2083, 5001, 9443, 3389])(
    "never infers a product from port %i",
    (port) => {
      expect(fingerprintService(port).product).toBeUndefined();
      expect(fingerprintService(port).detection).not.toBe("identified");
    },
  );

  it.each([
    undefined,
    "hello",
    "RFB 3.8",
    "OpenSSH_9.6",
    "220 ready",
    "220 mail ESMTP",
    "\x16\x03\x03",
  ])("unknown port with %s stays unknown", (banner) => {
    expect(fingerprintService(65000, banner)).toMatchObject({
      protocol: "raw",
      service: "unknown",
      detection: "unknown",
    });
    expect(fingerprintService(65000, banner).product).toBeUndefined();
  });

  it.each([
    ["Synology DSM", "Synology DSM"],
    ["nas - Synology DiskStation", "Synology DSM"],
    ["cPanel Login", "cPanel"],
    ["WHM Login", "WHM"],
    ["pfSense - Login", "pfSense"],
    ["Portainer", "Portainer"],
    ["Tactical RMM", "Tactical RMM"],
    ["node - Proxmox Virtual Environment", "Proxmox VE"],
    ["HPE iLO 5", "HPE iLO"],
    ["iLO 4", "HPE iLO"],
    ["Dell iDRAC9", "Dell iDRAC"],
    ["iDRAC 8", "Dell iDRAC"],
    ["Welcome to nginx!", "nginx"],
    ["Apache2 Debian Default Page: It works", "Apache"],
    ["IIS Windows Server", "IIS"],
    ["OPNsense - Login", "OPNsense"],
    ["Lenovo XClarity Controller", "Lenovo XClarity"],
    ["Supermicro IPMI", "Supermicro"],
  ])("recognizes branded HTTP title %s", (title, product) => {
    expect(
      fingerprintService(65000, undefined, undefined, {
        http_status: 200,
        http_title: title,
        httpScheme: "https",
      }),
    ).toMatchObject({ protocol: "https", product, detection: "identified" });
  });

  it.each([
    ["nginx/1.24.0", "nginx"],
    ["Apache/2.4.57 (Debian)", "Apache"],
    ["Microsoft-IIS/10.0", "IIS"],
  ])("recognizes exact Server identifier %s", (server, product) => {
    expect(
      fingerprintService(50000, undefined, undefined, { http_server: server })
        .product,
    ).toBe(product);
  });

  it.each([
    "Login",
    "Synology",
    "DSM",
    "Guide to Synology DSM",
    "Proxmox VE documentation",
    "Dell iDRAC support",
    "pfSense alternatives",
    "nginx troubleshooting",
    "Portainerish",
    "my cPanel guide",
    "OPNsense alternatives",
    "Lenovo XClarity documentation",
    "Supermicro fan control guide",
  ])("does not identify a product from title %s", (title) => {
    expect(
      fingerprintService(443, undefined, undefined, {
        http_title: title,
        http_status: 200,
      }).product,
    ).toBeUndefined();
  });

  it.each([
    "not-nginx/1.24.0",
    "MyApache/2",
    "nginxish",
    "application mentions nginx",
  ])("does not identify arbitrary Server text %s", (server) => {
    expect(
      fingerprintService(443, undefined, undefined, { http_server: server })
        .product,
    ).toBeUndefined();
  });

  it("does not interpret HTTP body text as an SSH banner", () => {
    expect(
      fingerprintService(443, "HTTP/1.1 200 OK\r\n\r\nSSH-2.0-OpenSSH_9.6"),
    ).toMatchObject({ protocol: "https", detection: "identified" });
  });

  it("prefers application branding to its web server", () => {
    const result = fingerprintService(8006, undefined, undefined, {
      http_title: "Proxmox Virtual Environment",
      http_server: "nginx/1.24.0",
      http_status: 200,
    });
    expect(result.product).toBe("Proxmox VE");
    expect(result.version).toBeUndefined();
    expect(result.evidence).toContain("Server: nginx/1.24.0");
    expect(result.evidence).toContain("Title: Proxmox Virtual Environment");
  });

  it("retains HTTP identification errors without inventing product evidence", () => {
    expect(
      fingerprintService(443, undefined, undefined, {
        identification_error: "TLS certificate rejected",
      }),
    ).toMatchObject({
      protocol: "https",
      detection: "port-hint",
      identificationError: "TLS certificate rejected",
    });
    expect(
      fingerprintService(65000, undefined, undefined, {
        identification_error: "Timeout",
      }),
    ).toMatchObject({
      protocol: "raw",
      detection: "unknown",
      identificationError: "Timeout",
    });
    expect(
      fingerprintService(443, undefined, undefined, {
        http_status: 403,
        identification_error: "Title unavailable",
      }),
    ).toMatchObject({
      detection: "identified",
      evidence: "HTTP status: 403",
      identificationError: "Title unavailable",
    });
  });
});
