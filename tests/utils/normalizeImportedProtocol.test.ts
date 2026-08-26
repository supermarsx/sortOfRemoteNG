/**
 * Table-driven tests for the evidence-based protocol normaliser (t71 D1).
 * The one invariant that matters most: RDP is never chosen without evidence.
 */
import { describe, it, expect } from "vitest";
import {
  FALLBACK_PROTOCOL,
  PROTOCOL_ALIASES,
  WEB_PORTS,
  normalizeImportedProtocol,
  protocolFromPort,
  protocolFromUrlScheme,
  suspectMisclassifiedConnection,
} from "../../src/utils/connection/normalizeImportedProtocol";
import { DEFAULT_PORTS } from "../../src/utils/discovery/defaultPorts";

describe("normalizeImportedProtocol — alias table", () => {
  const cases: Array<[string, string]> = [
    ["http", "http"],
    ["HTTP", "http"],
    ["https", "https"],
    ["HTTPS", "https"],
    ["Web", "https"],
    ["WWW", "https"],
    ["web browser", "https"],
    ["Browser", "https"],
    ["URL", "https"],
    ["website", "https"],
    ["WebUI", "https"],
    ["web ui", "https"],
    ["HTTP/S", "https"],
    ["https/http", "https"],
    ["http-basic", "http"],
    ["ssl", "https"],
    ["tls", "https"],
    ["https-web", "https"],
    ["RoyalWebConnection", "https"],
    ["IntApp", "https"],
    ["winbox", "http"],
    ["ica", "rdp"],
    ["RDP", "rdp"],
    ["rdcman", "rdp"],
    ["xdmcp", "xdmcp"],
    ["serial", "serial"],
    ["mosh", "ssh"],
    ["wsl", "ssh"],
    ["SSH2", "ssh"],
    ["sftp", "sftp"],
    ["scp", "scp"],
    ["ftp", "ftp"],
    ["powershell", "winrm"],
    ["PowerShell Remoting", "winrm"],
    ["winrm", "winrm"],
    ["psremoting", "winrm"],
    ["raw", "raw"],
    ["raw-udp", "raw"],
    ["rlogin", "rlogin"],
    ["telnet", "telnet"],
    ["vnc", "vnc"],
    ["ard", "ard"],
    ["smb", "smb"],
    ["cifs", "smb"],
    ["mysql", "mysql"],
    ["postgres", "postgresql"],
    ["postgresql", "postgresql"],
    ["spice", "spice"],
    ["x2go", "x2go"],
    ["nx", "nx"],
    ["rustdesk", "rustdesk"],
    ["anydesk", "anydesk"],
  ];

  it.each(cases)("raw %j → %s", (raw, expected) => {
    const r = normalizeImportedProtocol({ raw });
    expect(r.protocol).toBe(expected);
    expect(r.source).toBe("alias");
    expect(r.defaultPort).toBe(DEFAULT_PORTS[expected] ?? DEFAULT_PORTS.raw);
  });

  it("treats case-only normalisation of a valid protocol as not reclassified", () => {
    const r = normalizeImportedProtocol({ raw: "HTTP" });
    expect(r).toMatchObject({
      protocol: "http",
      reclassified: false,
      source: "alias",
    });
    expect(r.note).toBeUndefined();
  });

  it("marks alias hits as reclassified with a note", () => {
    const r = normalizeImportedProtocol({ raw: "Web", port: 443 });
    expect(r.protocol).toBe("https");
    expect(r.reclassified).toBe(true);
    expect(r.note).toContain('"Web"');
    expect(r.note).toContain("443");
  });

  it("resolves generic web aliases by port", () => {
    expect(normalizeImportedProtocol({ raw: "Web", port: 80 }).protocol).toBe(
      "http",
    );
    expect(
      normalizeImportedProtocol({ raw: "Web", port: "8080" }).protocol,
    ).toBe("http");
    expect(normalizeImportedProtocol({ raw: "Web", port: 8443 }).protocol).toBe(
      "https",
    );
    expect(normalizeImportedProtocol({ raw: "Web" }).protocol).toBe("https");
    // Non-web port on a generic web alias: https is the safe default.
    expect(normalizeImportedProtocol({ raw: "WWW", port: 9999 }).protocol).toBe(
      "https",
    );
  });

  it("passes integration:* protocols through verbatim", () => {
    const r = normalizeImportedProtocol({
      raw: "integration:proxmox",
      port: 8006,
    });
    expect(r).toMatchObject({
      protocol: "integration:proxmox",
      source: "alias",
      reclassified: false,
    });
  });

  it("alias step wins over port and url evidence", () => {
    const r = normalizeImportedProtocol({
      raw: "ssh",
      port: 443,
      url: "https://x",
    });
    expect(r.protocol).toBe("ssh");
    expect(r.source).toBe("alias");
  });

  it("exposes the public alias table with web sentinels resolved to https", () => {
    expect(PROTOCOL_ALIASES.web).toBe("https");
    expect(PROTOCOL_ALIASES.ica).toBe("rdp");
    expect(PROTOCOL_ALIASES.xdmcp).toBe("xdmcp");
    expect(Object.values(PROTOCOL_ALIASES)).not.toContain("web");
  });
});

describe("normalizeImportedProtocol — URL scheme", () => {
  const cases: Array<[string, string]> = [
    ["http://host/x", "http"],
    ["HTTPS://X:8443/p", "https"],
    ["ssh://box", "ssh"],
    ["sftp://box", "sftp"],
    ["scp://box", "scp"],
    ["ftp://box", "ftp"],
    ["telnet://box", "telnet"],
    ["rdp://box", "rdp"],
    ["vnc://box", "vnc"],
    ["smb://box", "smb"],
    ["mysql://db", "mysql"],
    ["postgres://db", "postgresql"],
    ["postgresql://db", "postgresql"],
    ["ws://host", "http"],
    ["wss://host", "https"],
  ];

  it.each(cases)("url %j → %s", (url, expected) => {
    const r = normalizeImportedProtocol({ raw: "", url });
    expect(r.protocol).toBe(expected);
    expect(r.source).toBe("url");
    expect(protocolFromUrlScheme(url)).toBe(expected);
  });

  it("uses the URL scheme when raw is unknown garbage", () => {
    const r = normalizeImportedProtocol({
      raw: "Frobnicate",
      url: "https://portal/x",
    });
    expect(r.protocol).toBe("https");
    expect(r.source).toBe("url");
    expect(r.reclassified).toBe(true);
    expect(r.note).toContain("Frobnicate");
  });

  it("uses raw itself when it looks like a URL", () => {
    const r = normalizeImportedProtocol({
      raw: "https://portal.example:8443/admin",
    });
    expect(r.protocol).toBe("https");
    expect(r.source).toBe("url");
  });

  it("URL scheme wins over port", () => {
    const r = normalizeImportedProtocol({ url: "http://host", port: 443 });
    expect(r.protocol).toBe("http");
    expect(r.source).toBe("url");
  });

  it("returns undefined for a bare hostname", () => {
    expect(protocolFromUrlScheme("example.com")).toBeUndefined();
    expect(protocolFromUrlScheme("")).toBeUndefined();
    expect(protocolFromUrlScheme(null)).toBeUndefined();
  });
});

describe("normalizeImportedProtocol — port table", () => {
  const cases: Array<[number | string, string]> = [
    [80, "http"],
    [81, "http"],
    [8000, "http"],
    [8008, "http"],
    [8080, "http"],
    [8081, "http"],
    [8888, "http"],
    [9000, "http"],
    [10000, "http"],
    [443, "https"],
    [4443, "https"],
    [8006, "https"],
    [8043, "https"],
    [8443, "https"],
    [8834, "https"],
    [9090, "https"],
    [9443, "https"],
    [10443, "https"],
    [22, "ssh"],
    [23, "telnet"],
    [3389, "rdp"],
    [5900, "vnc"],
    [5906, "vnc"],
    [5985, "winrm"],
    [5986, "winrm"],
    [445, "smb"],
    [3306, "mysql"],
    [5432, "postgresql"],
    [21, "ftp"],
    [513, "rlogin"],
    [177, "xdmcp"],
    ["8443", "https"],
  ];

  it.each(cases)("port %j → %s", (port, expected) => {
    const r = normalizeImportedProtocol({ raw: "", port });
    expect(r.protocol).toBe(expected);
    expect(r.source).toBe("port");
    expect(protocolFromPort(port)).toBe(expected);
  });

  it("WEB_PORTS and PORT table agree", () => {
    for (const [port, proto] of Object.entries(WEB_PORTS)) {
      expect(protocolFromPort(Number(port))).toBe(proto);
    }
  });

  it("returns undefined for unknown / invalid ports", () => {
    expect(protocolFromPort(9999)).toBeUndefined();
    expect(protocolFromPort(0)).toBeUndefined();
    expect(protocolFromPort(70000)).toBeUndefined();
    expect(protocolFromPort("abc")).toBeUndefined();
    expect(protocolFromPort(null)).toBeUndefined();
  });

  it("unknown raw + web port resolves by port with a note", () => {
    const r = normalizeImportedProtocol({ raw: "Frobnicate", port: 8443 });
    expect(r.protocol).toBe("https");
    expect(r.source).toBe("port");
    expect(r.reclassified).toBe(true);
    expect(r.note).toMatch(/Frobnicate.*8443/);
  });
});

describe("normalizeImportedProtocol — fallback (never RDP without evidence)", () => {
  it("empty raw + no port → raw with a note", () => {
    const r = normalizeImportedProtocol({ raw: "", port: undefined });
    expect(r.protocol).toBe(FALLBACK_PROTOCOL);
    expect(r.protocol).toBe("raw");
    expect(r.source).toBe("fallback");
    expect(r.reclassified).toBe(false);
    expect(r.note).toBeTruthy();
    expect(r.defaultPort).toBe(DEFAULT_PORTS.raw);
    expect(r.defaultPort).not.toBe(3389);
  });

  it.each([undefined, null, "   ", 42, {}])(
    "no-evidence raw %j → raw",
    (raw) => {
      const r = normalizeImportedProtocol({ raw });
      expect(r.protocol).not.toBe("rdp");
      expect(r.source).toBe("fallback");
    },
  );

  it("unknown raw + unknown port → raw, reclassified, note names the string", () => {
    const r = normalizeImportedProtocol({ raw: "Frobnicate", port: 9999 });
    expect(r.protocol).toBe("raw");
    expect(r.source).toBe("fallback");
    expect(r.reclassified).toBe(true);
    expect(r.note).toContain('"Frobnicate"');
    expect(r.note).toContain("9999");
  });

  it("defaultPort is never 3389 unless protocol is rdp", () => {
    const samples = [
      { raw: "" },
      { raw: "Web" },
      { raw: "x", port: 9999 },
      { raw: "https" },
      { raw: "ssh" },
      { url: "http://h" },
    ];
    for (const s of samples) {
      const r = normalizeImportedProtocol(s);
      if (r.protocol !== "rdp") expect(r.defaultPort).not.toBe(3389);
    }
    expect(normalizeImportedProtocol({ raw: "rdp" }).defaultPort).toBe(3389);
  });
});

describe("suspectMisclassifiedConnection", () => {
  const base = { id: "c1", name: "Box", hostname: "10.0.0.1", isGroup: false };

  it("rdp + 443 → https", () => {
    const s = suspectMisclassifiedConnection({
      ...base,
      protocol: "rdp",
      port: 443,
    });
    expect(s?.suggested).toBe("https");
    expect(s?.reason).toMatch(/443/);
  });

  it("rdp + 8080 → http", () => {
    expect(
      suspectMisclassifiedConnection({ ...base, protocol: "rdp", port: 8080 })
        ?.suggested,
    ).toBe("http");
  });

  it("rdp + http://host → http (scheme beats port)", () => {
    const s = suspectMisclassifiedConnection({
      ...base,
      protocol: "rdp",
      hostname: "http://host",
      port: 3389,
    });
    expect(s?.suggested).toBe("http");
    expect(s?.reason).toMatch(/http:\/\//);
  });

  it("rdp + HTTPS://host and wss:// → https", () => {
    expect(
      suspectMisclassifiedConnection({
        ...base,
        protocol: "rdp",
        hostname: "HTTPS://portal",
        port: 3389,
      })?.suggested,
    ).toBe("https");
    expect(
      suspectMisclassifiedConnection({
        ...base,
        protocol: "rdp",
        hostname: "wss://portal",
        port: 3389,
      })?.suggested,
    ).toBe("https");
  });

  it("rdp + 3389 plain → null", () => {
    expect(
      suspectMisclassifiedConnection({ ...base, protocol: "rdp", port: 3389 }),
    ).toBeNull();
  });

  it("rdp + 3389 with 'portal' in the name → null (port is authoritative)", () => {
    expect(
      suspectMisclassifiedConnection({
        ...base,
        name: "Admin portal",
        protocol: "rdp",
        port: 3389,
      }),
    ).toBeNull();
  });

  it("rdp + non-3389 + web-ish name → https", () => {
    const s = suspectMisclassifiedConnection({
      ...base,
      name: "Admin portal",
      protocol: "rdp",
      port: 3390,
    });
    expect(s?.suggested).toBe("https");
    expect(s?.reason).toMatch(/portal/);
  });

  it("rdp + non-3389 + 'http' in description → http", () => {
    expect(
      suspectMisclassifiedConnection({
        ...base,
        description: "plain http admin page",
        protocol: "rdp",
        port: 8082,
      })?.suggested,
    ).toBe("http");
  });

  it("group → null even with web evidence", () => {
    expect(
      suspectMisclassifiedConnection({
        ...base,
        isGroup: true,
        protocol: "rdp",
        port: 443,
        hostname: "https://x",
      }),
    ).toBeNull();
  });

  it("non-rdp valid protocol → null", () => {
    expect(
      suspectMisclassifiedConnection({ ...base, protocol: "ssh", port: 443 }),
    ).toBeNull();
    expect(
      suspectMisclassifiedConnection({
        ...base,
        protocol: "integration:proxmox",
        port: 8006,
      }),
    ).toBeNull();
  });

  it("flags protocol strings outside the union with the alias-resolved suggestion", () => {
    const upper = suspectMisclassifiedConnection({
      ...base,
      protocol: "HTTP" as never,
      port: 80,
    });
    expect(upper?.suggested).toBe("http");
    expect(upper?.reason).toMatch(/not a recognised protocol/);

    const web = suspectMisclassifiedConnection({
      ...base,
      protocol: "web" as never,
      port: 443,
    });
    expect(web?.suggested).toBe("https");

    const garbage = suspectMisclassifiedConnection({
      ...base,
      protocol: "Frobnicate" as never,
      port: 9999,
    });
    expect(garbage?.suggested).toBe("raw");
  });
});
