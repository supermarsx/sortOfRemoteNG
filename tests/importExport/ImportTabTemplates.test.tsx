import { describe, expect, it } from "vitest";
import {
  IMPORT_TEMPLATES,
  type TemplateKind,
} from "../../src/components/ImportExport/ImportTab";
import {
  detectImportFormat,
  importConnections,
} from "../../src/components/ImportExport/utils";
import type { Connection } from "../../src/types/connection/connection";

/**
 * Regression for RC1 (t71): the downloadable templates must be written in the
 * shape the importers read. Each template is built exactly as the download
 * button builds it, then fed back through `importConnections` with the same
 * filename the user would upload, and every row must keep its protocol,
 * hostname and port.
 */

interface ExpectedRow {
  name: string;
  protocol: Connection["protocol"];
  hostname: string;
  port: number;
  isGroup?: boolean;
}

const SSH_ROW: ExpectedRow = {
  name: "Web Server 1",
  protocol: "ssh",
  hostname: "192.168.1.10",
  port: 22,
};
const RDP_ROW: ExpectedRow = {
  name: "Database Server",
  protocol: "rdp",
  hostname: "192.168.1.20",
  port: 3389,
};
const HTTPS_ROW: ExpectedRow = {
  name: "Admin Portal",
  protocol: "https",
  hostname: "portal.example.com",
  port: 443,
};
const HTTP_ROW: ExpectedRow = {
  name: "Router Admin",
  protocol: "http",
  hostname: "192.168.1.1",
  port: 80,
};
const VNC_ROW: ExpectedRow = {
  name: "VNC Desktop",
  protocol: "vnc",
  hostname: "192.168.1.30",
  port: 5900,
};
const DEV_SERVER_ROW: ExpectedRow = {
  name: "Dev Server 1",
  protocol: "ssh",
  hostname: "10.0.0.5",
  port: 22,
};

const EXPECTED: Record<TemplateKind, { format: string; rows: ExpectedRow[] }> =
  {
    csv: {
      format: "csv",
      rows: [
        SSH_ROW,
        RDP_ROW,
        {
          name: "Dev Folder",
          protocol: "ssh",
          hostname: "",
          port: 22,
          isGroup: true,
        },
        DEV_SERVER_ROW,
        HTTPS_ROW,
        HTTP_ROW,
        VNC_ROW,
      ],
    },
    json: { format: "json", rows: [SSH_ROW, RDP_ROW, HTTPS_ROW] },
    xml: {
      format: "xml",
      rows: [
        SSH_ROW,
        RDP_ROW,
        {
          name: "Dev Folder",
          protocol: "ssh",
          hostname: "",
          port: 22,
          isGroup: true,
        },
        DEV_SERVER_ROW,
        HTTPS_ROW,
        HTTP_ROW,
        VNC_ROW,
      ],
    },
    ini: { format: "ini", rows: [SSH_ROW, RDP_ROW, HTTPS_ROW] },
  };

const templateFor = (kind: TemplateKind) => {
  const spec = IMPORT_TEMPLATES.find((entry) => entry.kind === kind);
  if (!spec) throw new Error(`no ${kind} template`);
  return spec;
};

describe("ImportTab downloadable templates round-trip through the importers", () => {
  it("offers exactly the csv/json/xml/ini templates", () => {
    expect(IMPORT_TEMPLATES.map((entry) => entry.kind)).toEqual([
      "csv",
      "json",
      "xml",
      "ini",
    ]);
  });

  for (const kind of Object.keys(EXPECTED) as TemplateKind[]) {
    const { format, rows } = EXPECTED[kind];

    it(`${kind}: is detected as ${format} by its filename and body`, () => {
      const spec = templateFor(kind);
      expect(detectImportFormat(spec.build(), spec.filename)).toBe(format);
    });

    it(`${kind}: every row keeps its protocol, hostname and port (incl. HTTPS)`, async () => {
      const spec = templateFor(kind);
      const imported = await importConnections(spec.build(), spec.filename);

      expect(imported.map((c) => c.name)).toEqual(rows.map((r) => r.name));
      for (const [index, expected] of rows.entries()) {
        const actual = imported[index];
        expect(
          {
            name: actual.name,
            protocol: actual.protocol,
            hostname: actual.hostname,
            port: actual.port,
            isGroup: actual.isGroup,
          },
          `${kind} row "${expected.name}"`,
        ).toEqual({
          name: expected.name,
          protocol: expected.protocol,
          hostname: expected.hostname,
          port: expected.port,
          isGroup: expected.isGroup ?? false,
        });
      }

      // The regression that motivated this test: nothing silently becomes RDP.
      const rdpRows = imported.filter((c) => c.protocol === "rdp");
      expect(rdpRows.map((c) => c.name)).toEqual(["Database Server"]);
      // No row loses its host (groups aside).
      for (const c of imported.filter((row) => !row.isGroup)) {
        expect(c.hostname, `${kind} "${c.name}" hostname`).not.toBe("");
        expect(c.name).not.toBe("Imported Connection");
      }
    });

    it(`${kind}: includes an HTTPS row that imports as https/443`, async () => {
      const spec = templateFor(kind);
      const imported = await importConnections(spec.build(), spec.filename);
      const https = imported.find((c) => c.name === HTTPS_ROW.name);
      expect(https).toMatchObject({
        protocol: "https",
        hostname: "portal.example.com",
        port: 443,
      });
    });
  }

  it("xml: nests Dev Server 1 under the Dev Folder group", async () => {
    const spec = templateFor("xml");
    const imported = await importConnections(spec.build(), spec.filename);
    const folder = imported.find((c) => c.name === "Dev Folder");
    const child = imported.find((c) => c.name === "Dev Server 1");
    expect(folder?.isGroup).toBe(true);
    expect(child?.parentId).toBe(folder?.id);
  });

  it("xml: is generated by the exporter serializer (exporter attribute shape)", () => {
    const xml = templateFor("xml").build();
    expect(xml).toContain("<sortOfRemoteNG>");
    expect(xml).toMatch(
      /<Connection [^>]*Type="HTTPS"[^>]*Server="portal\.example\.com"[^>]*Port="443"/,
    );
    expect(xml).not.toMatch(/<connection /);
  });
});
