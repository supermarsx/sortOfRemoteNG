import { describe, expect, it } from "vitest";
import {
  discoveryCertificateWarning,
  discoveryIdentificationFailure,
  fingerprintService,
} from "../../src/utils/discovery/serviceFingerprint";
import { normalizeDiscoveryScan } from "../../src/utils/discovery/scanHistory";

describe("evidence-based service fingerprinting", () => {
  it("identifies the final page and preserves its certificate warning through history serialization", () => {
    const service = fingerprintService(80, undefined, "http", {
      httpScheme: "http",
      http_status: 200,
      http_server: "nginx",
      http_title: "Proxmox Virtual Environment",
      http_redirects: 2,
      http_final_origin: "https://192.0.2.25:8006",
      identification_error: "certificate_validation_bypassed",
    });
    expect(service).toMatchObject({
      port: 80,
      protocol: "http",
      detection: "identified",
      product: "Proxmox VE",
      identificationError: "certificate_validation_bypassed",
    });
    expect(service.evidence).toContain("Title: Proxmox Virtual Environment");
    expect(service.evidence).toContain(
      "TLS warning: certificate validation failed",
    );
    const saved = normalizeDiscoveryScan(
      JSON.parse(
        JSON.stringify({
          id: "tls-warning",
          startedAt: 1,
          elapsedMs: 100,
          outcome: "complete",
          config: {
            enabled: true,
            ipRange: "192.0.2.25",
            portRanges: [],
            protocols: ["http"],
            timeout: 1000,
            maxConcurrent: 1,
            maxPortConcurrent: 1,
            customPorts: {},
            probeStrategies: {},
            cacheTTL: 0,
            hostnameTtl: 0,
            macTtl: 0,
          },
          hosts: [
            {
              ip: "192.0.2.25",
              openPorts: [80],
              services: [service],
              responseTime: 1,
            },
          ],
        }),
      ),
    );
    expect(saved.hosts[0].services[0]).toEqual(service);
    expect(
      discoveryCertificateWarning(
        saved.hosts[0].services[0].identificationError,
      ),
    ).toBe(true);
    expect(
      discoveryIdentificationFailure(service.identificationError),
    ).toBeUndefined();
  });

  it("retains later failures separately from the certificate warning", () => {
    const error = "certificate_validation_bypassed;redirect_loop";
    expect(discoveryCertificateWarning(error)).toBe(true);
    expect(discoveryIdentificationFailure(error)).toBe("redirect_loop");
    for (const failure of [
      "certificate_or_tls_failure",
      "tls_or_connection_failure",
      "timeout",
    ]) {
      expect(discoveryCertificateWarning(failure)).toBe(false);
      expect(discoveryIdentificationFailure(failure)).toBe(failure);
    }
  });

  it.each(["smb", "rdp", "postgresql"])(
    "keeps unconfirmed %s ports as hints and upgrades only validated protocol evidence",
    (protocol) => {
      expect(fingerprintService(12345, undefined, protocol).detection).toBe(
        "port-hint",
      );
      expect(
        fingerprintService(12345, undefined, protocol, {
          protocol_confirmed: protocol,
        }).detection,
      ).toBe("port-hint");
      expect(
        fingerprintService(12345, undefined, protocol, {
          protocol_confirmed: protocol,
          protocol_evidence: "Validated negotiation response",
          protocol_version: "3.0",
        }),
      ).toMatchObject({
        port: 12345,
        protocol,
        detection: "identified",
        version: "3.0",
      });
    },
  );

  it("identifies Tomcat from actual branding without inventing its version from the connector", () => {
    expect(
      fingerprintService(8080, undefined, "http", {
        http_status: 200,
        http_title: "Apache Tomcat/10.1.50",
      }),
    ).toMatchObject({
      product: "Apache Tomcat",
      version: "10.1.50",
      protocol: "http",
    });
    const connector = fingerprintService(8080, undefined, "http", {
      http_server: "Apache-Coyote/1.1",
    });
    expect(connector.product).toBe("Apache Tomcat / Coyote");
    expect(connector.version).toBeUndefined();
    expect(fingerprintService(8080).product).toBeUndefined();
    expect(
      fingerprintService(8080, undefined, "http", {
        http_title: "How to deploy Apache Tomcat",
      }).product,
    ).toBeUndefined();
  });

  it("records redirects while preserving the original endpoint protocol and port", () => {
    const result = fingerprintService(80, undefined, "http", {
      httpScheme: "http",
      http_status: 200,
      http_title: "Portainer",
      http_redirects: 2,
      http_final_origin: "https://192.0.2.1:9443",
    });
    expect(result).toMatchObject({
      protocol: "http",
      port: 80,
      product: "Portainer",
    });
    expect(result.evidence).toContain(
      "Followed 2 redirects to https://192.0.2.1:9443; original TCP endpoint retained",
    );
  });
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

  it.each(["SSH-2.0-dropbear", "SSH-2.0-dropbear router firmware 2026.09"])(
    "identifies versionless Dropbear without inventing a version: %s",
    (banner) => {
      const result = fingerprintService(65000, banner);
      expect(result).toMatchObject({
        banner,
        protocol: "ssh",
        service: "ssh",
        detection: "identified",
        product: "Dropbear",
        evidence: `SSH banner: ${banner}`,
      });
      expect(result).not.toHaveProperty("version");
    },
  );

  it.each([
    ["dropbear_2022.83", "Dropbear", "2022.83"],
    ["dropbear-2022.83", "Dropbear", "2022.83"],
    ["OpenSSH_9.6p1", "OpenSSH", "9.6p1"],
    ["OpenSSH-9.6p1", "OpenSSH", "9.6p1"],
  ])(
    "preserves the product and version of %s with a comment",
    (software, product, version) => {
      const banner = `SSH-2.0-${software} vendor build 123`;
      expect(fingerprintService(65000, banner)).toMatchObject({
        banner,
        protocol: "ssh",
        detection: "identified",
        product,
        version,
        evidence: `SSH banner: ${banner}`,
      });
    },
  );

  it.each([
    "dropbearm`>Tcurve25519-sha256,curve25519-sha256@libssh.o",
    "dropbearm",
    "dropbear_",
    "dropbear_fake",
    "dropbear\x00garbage",
    "dropbear\x7fgarbage",
    "other Dropbear server",
  ])(
    "does not label corrupted or lookalike SSH software as Dropbear: %s",
    (software) => {
      const result = fingerprintService(65000, `SSH-2.0-${software}`);
      expect(result).toMatchObject({
        protocol: "ssh",
        detection: "identified",
      });
      expect(result).not.toHaveProperty("product");
      expect(result).not.toHaveProperty("version");
    },
  );

  it.each(["\r\n", "\n"])(
    "keeps SSH evidence within its existing line boundary %j",
    (newline) => {
      const line = "SSH-2.0-dropbear router firmware";
      const banner = `${line}${newline}\x00curve25519-sha256`;
      const result = fingerprintService(65000, banner);
      expect(result).toMatchObject({
        banner,
        protocol: "ssh",
        product: "Dropbear",
        evidence: `SSH banner: ${line}`,
      });
      expect(result).not.toHaveProperty("version");
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
    ["FreshTomato", "FreshTomato"],
    ["FreshTomato - router", "FreshTomato"],
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
    "FreshTomato setup guide",
    "NotFreshTomato",
    'Login "+top.location.hostname+"',
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

  it.each(["http", "https"] as const)(
    "recognizes a FreshTomato Basic-auth challenge over %s without requiring a login page",
    (httpScheme) => {
      const service = fingerprintService(65000, undefined, undefined, {
        httpScheme,
        http_status: 401,
        http_server: "httpd",
        http_title: "Error",
        http_basic_realm: "FreshTomato",
        identification_error: "certificate_validation_bypassed",
      });
      expect(service).toMatchObject({
        protocol: httpScheme,
        product: "FreshTomato",
        detection: "identified",
        identificationError: "certificate_validation_bypassed",
      });
      expect(service.version).toBeUndefined();
      expect(service.evidence).toContain("HTTP Basic realm: FreshTomato");
      expect(service.evidence).toContain("authentication realm (configurable)");
      expect(service.evidence).toContain("TLS warning:");
    },
  );

  it.each([
    undefined,
    "unknown",
    "office-router",
    "Hades",
    "Tomato",
    "DD-WRT",
    "NotFreshTomato",
    "FreshTomatoGuide",
    "Fresh<Tomato>",
    "Fresh\u200bTomato",
  ])(
    "does not guess FreshTomato from generic 401/httpd/Error with realm %s",
    (http_basic_realm) => {
      const service = fingerprintService(443, undefined, undefined, {
        http_status: 401,
        http_server: "httpd",
        http_title: "Error",
        http_basic_realm,
      });
      expect(service.product).toBeUndefined();
      expect(service.detection).toBe("identified"); // HTTP, not a product.
      if (http_basic_realm) {
        expect(service.evidence).toContain(
          `HTTP Basic realm: ${http_basic_realm}`,
        );
      }
    },
  );

  it("does not assign the generic web server version to realm-identified FreshTomato", () => {
    const service = fingerprintService(443, undefined, undefined, {
      http_status: 401,
      http_server: "nginx/1.24.0",
      http_basic_realm: "FreshTomato",
    });
    expect(service.product).toBe("FreshTomato");
    expect(service.version).toBeUndefined();
  });

  it.each(["httpd", "nginx/1.24.0"])(
    "identifies Hades from native TLS branding with server %s",
    (http_server) => {
      const service = fingerprintService(443, undefined, undefined, {
        http_status: 401,
        http_server,
        http_title: "Error",
        http_basic_realm: "Hades",
        http_tls_fingerprint: "freshtomato",
        identification_error: "certificate_validation_bypassed",
      });
      expect(service).toMatchObject({
        port: 443,
        protocol: "https",
        product: "FreshTomato",
        detection: "identified",
        identificationError: "certificate_validation_bypassed",
      });
      expect(service.version).toBeUndefined();
      expect(service.evidence).toContain("HTTP Basic realm: Hades");
      expect(service.evidence).toContain(
        "TLS certificate subject FreshTomato / FreshTomato Team; self-reported branding, not identity verification",
      );
      expect(service.evidence).toContain("TLS warning:");
    },
  );

  it.each([undefined, "unknown", "FreshTomato", "freshtomato-extra"])(
    "ignores unsupported TLS fingerprint %s",
    (http_tls_fingerprint) => {
      const service = fingerprintService(443, undefined, undefined, {
        http_status: 401,
        http_server: "httpd",
        http_title: "Error",
        http_basic_realm: "Hades",
        http_tls_fingerprint,
      });
      expect(service.product).toBeUndefined();
      expect(service.evidence).not.toContain("TLS certificate subject");
    },
  );

  it("prefers explicit page branding over TLS certificate branding", () => {
    const service = fingerprintService(443, undefined, undefined, {
      http_status: 200,
      http_title: "Proxmox Virtual Environment",
      http_tls_fingerprint: "freshtomato",
    });
    expect(service.product).toBe("Proxmox VE");
    expect(service.evidence).toContain("Title: Proxmox Virtual Environment");
    expect(service.evidence).toContain(
      "self-reported branding, not identity verification",
    );
  });

  it("does not treat an authentication realm on a successful page as a product challenge", () => {
    expect(
      fingerprintService(443, undefined, undefined, {
        http_status: 200,
        http_title: 'Login "+top.location.hostname+"',
        http_server: "httpd",
        http_basic_realm: "FreshTomato",
      }).product,
    ).toBeUndefined();
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
