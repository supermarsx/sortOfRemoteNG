import { describe, it, expect } from "vitest";
import {
  importFromCSV,
  importFromINI,
  importFromJSON,
  importFromMRemoteNG,
  importFromMobaXterm,
  importFromPuTTY,
  importFromRoyalTS,
  importFromSecureCRT,
  importFromXML,
  importConnections,
  detectImportFormat,
  getFormatName,
  getImportFormatCompatibility,
  IMPORT_FORMAT_ORDER,
} from "../../src/components/ImportExport/utils";
import { mapPortableProtocol } from "../../src/components/ImportExport/advancedProtocolPortability";
import type { Connection } from "../../src/types/connection/connection";

// t71: HTTPS/HTTP/"Web" entries must never import as RDP, whatever the
// source format spells them. Every importer routes protocol assignment
// through the evidence-based normaliser (string → URL scheme → port → raw).

const byName = (conns: Connection[], name: string): Connection => {
  const found = conns.find((c) => c.name === name);
  if (!found) throw new Error(`connection "${name}" not imported`);
  return found;
};

const nonGroups = (conns: Connection[]) => conns.filter((c) => !c.isGroup);

// ──────────────────────────────────────────
// mRemoteNG confCons.xml
// ──────────────────────────────────────────
describe("mRemoteNG import classifies web protocols by evidence", () => {
  const confCons = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" Export="false" ConfVersion="2.6">
  <Node Name="Portal" Type="Connection" Protocol="HTTPS" Hostname="portal.example.com" Port="443" />
  <Node Name="Router" Type="Connection" Protocol="HTTP" Hostname="http://router.local/admin" Port="" />
  <Node Name="Web Thing" Type="Connection" Protocol="Web" Hostname="web.example.com" Port="443" />
  <Node Name="Web Plain" Type="Connection" Protocol="Web" Hostname="web80.example.com" Port="80" />
  <Node Name="Empty Proto" Type="Connection" Protocol="" Hostname="appliance.example.com" Port="8443" />
  <Node Name="Slashy" Type="Connection" Protocol="HTTP/S" Hostname="slashy.example.com" Port="443" />
  <Node Name="Web Group" Type="Container" Protocol="HTTPS" Hostname="" Port="443" Expanded="true">
    <Node Name="Inherited Child" Type="Connection" Protocol="RDP" InheritProtocol="true" Hostname="child.example.com" Port="443" />
    <Node Name="Explicit Child" Type="Connection" Protocol="SSH2" InheritProtocol="false" Hostname="ssh.example.com" Port="22" />
  </Node>
  <Node Name="Bogus" Type="Connection" Protocol="Frobnicate" Hostname="bogus.example.com" Port="9999" />
  <Node Name="Real RDP" Type="Connection" Protocol="RDP" Hostname="ts.example.com" Port="3389" />
</Connections>`;

  it("maps HTTPS/HTTP/Web/HTTP/S and inherited protocols, never RDP", async () => {
    const conns = await importFromMRemoteNG(confCons);

    expect(byName(conns, "Portal")).toMatchObject({
      protocol: "https",
      port: 443,
    });

    const router = byName(conns, "Router");
    expect(router.protocol).toBe("http");
    expect(router.hostname).toBe("router.local");
    expect(router.port).toBe(80);

    expect(byName(conns, "Web Thing")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Web Plain")).toMatchObject({
      protocol: "http",
      port: 80,
    });
    expect(byName(conns, "Empty Proto")).toMatchObject({
      protocol: "https",
      port: 8443,
    });
    expect(byName(conns, "Slashy").protocol).toBe("https");

    // RC3: InheritProtocol="true" under an HTTPS container beats the stale
    // Protocol="RDP" default the child carries.
    expect(byName(conns, "Inherited Child")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Explicit Child").protocol).toBe("ssh");

    const bogus = byName(conns, "Bogus");
    expect(bogus.protocol).toBe("raw");
    expect(bogus.port).toBe(9999);

    expect(byName(conns, "Real RDP")).toMatchObject({
      protocol: "rdp",
      port: 3389,
    });

    const webGroup = byName(conns, "Web Group");
    expect(webGroup.isGroup).toBe(true);
  });

  it("classifies a URL hostname even when Protocol is garbage", async () => {
    const conns = await importFromMRemoteNG(`<?xml version="1.0"?>
<Connections ConfVersion="2.6">
  <Node Name="Url Host" Type="Connection" Protocol="???" Hostname="https://nas.local:5001/ui" />
</Connections>`);
    expect(conns[0]).toMatchObject({
      protocol: "https",
      hostname: "nas.local",
      port: 5001,
    });
  });

  it("does not turn anything into RDP without evidence", async () => {
    const conns = await importFromMRemoteNG(confCons);
    const rdp = nonGroups(conns).filter((c) => c.protocol === "rdp");
    expect(rdp.map((c) => c.name)).toEqual(["Real RDP"]);
  });
});

// ──────────────────────────────────────────
// Native CSV
// ──────────────────────────────────────────
describe("CSV import classifies web protocols by evidence", () => {
  it("maps Web, HTTP/S, https and WWW rows", async () => {
    const csv = [
      "Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags",
      "Web Row,Web,web.example.com,443,,,,,false,",
      "Slash Row,HTTP/S,slash.example.com,,,,,,false,",
      "Https Row,https,https.example.com,443,,,,,false,",
      "WWW Row,WWW,www.example.com,8080,,,,,false,",
      "Url Row,,https://portal.example.com:8443/login,,,,,,false,",
      "Bogus Row,Frobnicate,bogus.example.com,9999,,,,,false,",
    ].join("\n");
    const conns = await importFromCSV(csv);

    expect(byName(conns, "Web Row")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Slash Row")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Https Row").protocol).toBe("https");
    expect(byName(conns, "WWW Row")).toMatchObject({
      protocol: "http",
      port: 8080,
    });
    expect(byName(conns, "Url Row")).toMatchObject({
      protocol: "https",
      hostname: "portal.example.com",
      port: 8443,
    });
    expect(byName(conns, "Bogus Row").protocol).toBe("raw");
    expect(conns.some((c) => c.protocol === "rdp")).toBe(false);
  });

  it("still seeds RAW transport from RAW/UDP rows", async () => {
    const csv = [
      "Name,Protocol,Hostname,Port,IsGroup",
      "Udp,RAW/UDP,udp.example.com,7001,false",
    ].join("\n");
    const [udp] = await importFromCSV(csv);
    expect(udp.protocol).toBe("raw");
    expect(udp.rawSocketSettings?.connection.transport).toBe("udp");
  });
});

// ──────────────────────────────────────────
// Native XML — both shapes
// ──────────────────────────────────────────

// Exact copy of the XML_TEMPLATE users download from ImportTab (RC1).
const XML_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<sortOfRemoteNG version="1.0">
  <connections>
    <connection name="Web Server 1" protocol="SSH" hostname="192.168.1.10" port="22" username="admin" description="Web server in datacenter" tags="production;linux" />
    <connection name="Database Server" protocol="RDP" hostname="192.168.1.20" port="3389" username="administrator" domain="DOMAIN" description="SQL Server" tags="production;database" />
    <group name="Dev Folder">
      <connection name="Dev Server 1" protocol="SSH" hostname="10.0.0.5" port="22" username="devuser" description="Dev environment" tags="development;test" />
    </group>
  </connections>
</sortOfRemoteNG>`;

describe("native XML import accepts both the exporter and template shapes", () => {
  it("imports the downloadable XML template with real protocols and hostnames (RC1)", async () => {
    const conns = await importFromXML(XML_TEMPLATE);

    const web = byName(conns, "Web Server 1");
    expect(web).toMatchObject({
      protocol: "ssh",
      hostname: "192.168.1.10",
      port: 22,
      username: "admin",
      isGroup: false,
    });
    expect(web.tags).toEqual(["production", "linux"]);

    expect(byName(conns, "Database Server")).toMatchObject({
      protocol: "rdp",
      hostname: "192.168.1.20",
      port: 3389,
      domain: "DOMAIN",
    });

    const folder = byName(conns, "Dev Folder");
    expect(folder.isGroup).toBe(true);
    const dev = byName(conns, "Dev Server 1");
    expect(dev).toMatchObject({
      protocol: "ssh",
      hostname: "10.0.0.5",
      port: 22,
      parentId: folder.id,
    });
    expect(conns.some((c) => c.name === "Imported Connection")).toBe(false);
  });

  it("imports template-shape HTTPS/HTTP rows as web protocols", async () => {
    const conns = await importFromXML(`<sortOfRemoteNG version="1.0">
  <connections>
    <connection name="Portal" protocol="HTTPS" hostname="portal.example.com" port="443" />
    <connection name="Router" protocol="Web" hostname="http://router.local/admin" />
    <connection name="No Proto" hostname="appliance.local" port="8443" />
  </connections>
</sortOfRemoteNG>`);
    expect(byName(conns, "Portal")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Router")).toMatchObject({
      protocol: "http",
      hostname: "router.local",
      port: 80,
    });
    expect(byName(conns, "No Proto")).toMatchObject({
      protocol: "https",
      port: 8443,
    });
    expect(conns.some((c) => c.protocol === "rdp")).toBe(false);
  });

  it("still imports the exporter shape (Connection/Type/Server) incl. HTTPS", async () => {
    const conns = await importFromXML(`<?xml version="1.0"?>
<sortOfRemoteNG>
  <Connection Id="f1" Name="Folder" Type="rdp" Server="" IsGroup="True" />
  <Connection Id="c1" Name="Portal" Type="HTTPS" Server="portal.example.com" Port="443" ParentId="f1" IsGroup="false" Tags="web,prod" />
  <Connection Id="c2" Name="Box" Type="RDP" Server="box.example.com" Port="3389" IsGroup="false" />
</sortOfRemoteNG>`);
    expect(byName(conns, "Folder").isGroup).toBe(true);
    expect(byName(conns, "Portal")).toMatchObject({
      id: "c1",
      protocol: "https",
      hostname: "portal.example.com",
      port: 443,
      parentId: "f1",
    });
    expect(byName(conns, "Portal").tags).toEqual(["web", "prod"]);
    expect(byName(conns, "Box").protocol).toBe("rdp");
  });

  it("rejects XML without any connection nodes", async () => {
    await expect(
      importFromXML(`<sortOfRemoteNG><connections/></sortOfRemoteNG>`),
    ).rejects.toThrow(/no Connection nodes/);
  });
});

// ──────────────────────────────────────────
// Native INI template
// ──────────────────────────────────────────

// Exact copy of INI_TEMPLATE from ImportTab.
const INI_TEMPLATE = `; sortOfRemoteNG import template (INI)
; One section per connection. Tags are semicolon-separated.

[Web Server 1]
Protocol=SSH
Hostname=192.168.1.10
Port=22
Username=admin
Description=Web server in datacenter
Tags=production;linux

[Database Server]
Protocol=RDP
Hostname=192.168.1.20
Port=3389
Username=administrator
Domain=DOMAIN
Description=SQL Server
Tags=production;database`;

describe("INI import", () => {
  it("is a registered import format", () => {
    expect(IMPORT_FORMAT_ORDER).toContain("ini");
    expect(getFormatName("ini")).toBe("INI");
    expect(getImportFormatCompatibility("ini").group).toBe("native");
  });

  it("detects the template by extension and by body", () => {
    expect(detectImportFormat(INI_TEMPLATE, "connections.ini")).toBe("ini");
    expect(detectImportFormat(INI_TEMPLATE)).toBe("ini");
    // MobaXterm .ini files still route to the MobaXterm parser.
    expect(
      detectImportFormat("[Bookmarks]\nSubRep=\nA=#0#h%22%u", "sessions.ini"),
    ).toBe("mobaxterm");
    expect(detectImportFormat("[Bookmarks]\nSubRep=\nA=#0#h%22%u")).toBe(
      "mobaxterm",
    );
  });

  it("round-trips the template literal with real protocols", async () => {
    const conns = await importFromINI(INI_TEMPLATE);
    expect(conns).toHaveLength(2);
    expect(byName(conns, "Web Server 1")).toMatchObject({
      protocol: "ssh",
      hostname: "192.168.1.10",
      port: 22,
      username: "admin",
    });
    expect(byName(conns, "Web Server 1").tags).toEqual(["production", "linux"]);
    expect(byName(conns, "Database Server")).toMatchObject({
      protocol: "rdp",
      hostname: "192.168.1.20",
      port: 3389,
      domain: "DOMAIN",
    });
  });

  it("classifies HTTPS/Web sections and goes through importConnections", async () => {
    const ini = `[Portal]
Protocol=HTTPS
Hostname=portal.example.com
Port=443

[Router]
Protocol=Web
Hostname=http://router.local/admin

[Mystery]
Hostname=mystery.example.com
Port=8443

[Folder]
IsGroup=true
`;
    const conns = await importConnections(ini, "servers.ini");
    expect(byName(conns, "Portal")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Router")).toMatchObject({
      protocol: "http",
      hostname: "router.local",
      port: 80,
    });
    expect(byName(conns, "Mystery")).toMatchObject({
      protocol: "https",
      port: 8443,
    });
    expect(byName(conns, "Folder").isGroup).toBe(true);
    expect(nonGroups(conns).some((c) => c.protocol === "rdp")).toBe(false);
  });

  it("rejects an INI with no sections", async () => {
    await expect(importFromINI("; nothing here\n")).rejects.toThrow(
      /at least one/,
    );
  });
});

// ──────────────────────────────────────────
// Native JSON
// ──────────────────────────────────────────
describe("JSON import classifies web protocols by evidence", () => {
  it("accepts type/url/address aliases and web strings", async () => {
    const conns = await importFromJSON(
      JSON.stringify([
        { name: "Typed", type: "https", hostname: "typed.example.com" },
        { name: "Urlish", url: "https://urlish.example.com:8443/x" },
        { name: "Addr", address: "addr.example.com", port: 80 },
        { name: "Webby", protocol: "Web", hostname: "webby.example.com" },
        {
          name: "Split",
          hostname: "split.example.com",
          url: "http://split.example.com/ui",
        },
        { name: "Bogus", protocol: "Frobnicate", hostname: "b.example.com" },
        { name: "Folder", isFolder: true },
      ]),
    );
    expect(byName(conns, "Typed")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "Urlish")).toMatchObject({
      protocol: "https",
      hostname: "urlish.example.com",
      port: 8443,
    });
    expect(byName(conns, "Addr")).toMatchObject({
      protocol: "http",
      hostname: "addr.example.com",
      port: 80,
    });
    expect(byName(conns, "Webby").protocol).toBe("https");
    expect(byName(conns, "Split")).toMatchObject({
      protocol: "http",
      hostname: "split.example.com",
    });
    expect(byName(conns, "Bogus").protocol).toBe("raw");
    // Group placeholders keep rdp only because they are groups.
    expect(byName(conns, "Folder").isGroup).toBe(true);
    expect(nonGroups(conns).some((c) => c.protocol === "rdp")).toBe(false);
  });
});

// ──────────────────────────────────────────
// Royal TS
// ──────────────────────────────────────────
describe("Royal TS import", () => {
  it("uses the URI scheme for RoyalWebConnection objects", async () => {
    const conns = await importFromRoyalTS(
      JSON.stringify({
        Objects: [
          {
            Type: "RoyalWebConnection",
            Name: "Portal",
            URI: "https://portal.example.com/x",
          },
          {
            Type: "RoyalWebConnection",
            Name: "Router",
            URI: "http://router.local:8080/admin",
          },
          { Type: "RoyalWebConnection", Name: "Bare", URI: "bare.example.com" },
          { Type: "RoyalRDSConnection", Name: "TS", ComputerName: "ts.local" },
          {
            Type: "RoyalSomethingConnection",
            Name: "Odd",
            URI: "odd.example.com",
            Port: 443,
          },
        ],
      }),
    );
    expect(byName(conns, "Portal")).toMatchObject({
      protocol: "https",
      hostname: "portal.example.com",
      port: 443,
    });
    expect(byName(conns, "Router")).toMatchObject({
      protocol: "http",
      hostname: "router.local",
      port: 8080,
    });
    expect(byName(conns, "Bare")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "TS")).toMatchObject({ protocol: "rdp", port: 3389 });
    expect(byName(conns, "Odd")).toMatchObject({
      protocol: "https",
      port: 443,
    });
  });
});

// ──────────────────────────────────────────
// MobaXterm / PuTTY / SecureCRT
// ──────────────────────────────────────────
describe("MobaXterm import", () => {
  it("maps XDMCP to xdmcp and unknown types by port evidence", async () => {
    const conns = await importFromMobaXterm(`[Bookmarks]
SubRep=
XDM=#3#xdm.example.com%177%user%%-1%%%%%0
WebOdd=#42#web.example.com%443%user%%-1%%%%%0
NoEvidence=#42#plain.example.com%%user%%-1%%%%%0
`);
    expect(byName(conns, "XDM")).toMatchObject({
      protocol: "xdmcp",
      port: 177,
    });
    expect(byName(conns, "WebOdd")).toMatchObject({
      protocol: "https",
      port: 443,
    });
    expect(byName(conns, "NoEvidence").protocol).toBe("ssh");
    expect(conns.some((c) => c.protocol === "rdp")).toBe(false);
  });
});

describe("PuTTY import", () => {
  it("keeps SSH sessions and classifies unknown protocols by evidence", async () => {
    const reg = `Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\ssh-box]
"HostName"="ssh.example.com"
"Protocol"="ssh"
"PortNumber"=dword:00000016

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\web-box]
"HostName"="https://web.example.com"
"Protocol"="custom"
"PortNumber"=dword:000001bb

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\odd-box]
"HostName"="odd.example.com"
"Protocol"="custom"
"PortNumber"=dword:0000270f
`;
    const conns = await importFromPuTTY(reg);
    expect(byName(conns, "ssh-box").protocol).toBe("ssh");
    expect(byName(conns, "web-box").protocol).toBe("https");
    expect(byName(conns, "odd-box").protocol).toBe("ssh");
    expect(conns.some((c) => c.protocol === "rdp")).toBe(false);
  });
});

describe("SecureCRT import", () => {
  it("classifies non-shell protocol names by evidence", async () => {
    const xml = `<VanDyke version="3.0">
<Session Name="Web Admin">
<S:"Hostname">https://web.example.com</S:"Hostname">
<S:"Protocol Name">Custom</S:"Protocol Name">
<D:"Port">443</D:"Port">
</Session>
<Session Name="Shell">
<S:"Hostname">shell.example.com</S:"Hostname">
<S:"Protocol Name">SSH2</S:"Protocol Name">
<D:"[SSH2] Port">22</D:"[SSH2] Port">
</Session>
</VanDyke>`;
    const conns = await importFromSecureCRT(xml);
    expect(byName(conns, "Web Admin").protocol).toBe("https");
    expect(byName(conns, "Shell").protocol).toBe("ssh");
    expect(conns.some((c) => c.protocol === "rdp")).toBe(false);
  });
});

// ──────────────────────────────────────────
// mapPortableProtocol (shared by exporters/portability code)
// ──────────────────────────────────────────
describe("mapPortableProtocol", () => {
  it("delegates unknown strings to the normaliser and never guesses RDP", () => {
    expect(mapPortableProtocol("Web").protocol).toBe("https");
    expect(mapPortableProtocol("HTTP/S").protocol).toBe("https");
    expect(mapPortableProtocol("ICA").protocol).toBe("rdp");
    expect(mapPortableProtocol("XDMCP").protocol).toBe("xdmcp");
    expect(mapPortableProtocol("Frobnicate").protocol).toBe("raw");
    expect(mapPortableProtocol("").protocol).toBe("raw");
    expect(mapPortableProtocol("RAW/UDP")).toEqual({
      protocol: "raw",
      rawTransport: "udp",
    });
  });
});
