import { describe, expect, it } from "vitest";
import {
  importFromCSV,
  importFromJSON,
} from "../../src/components/ImportExport/utils";

describe("native Google service import addresses", () => {
  it.each(["gcp", "integration:gdrive", "GCP"])(
    "imports %s without inventing an endpoint",
    async (protocol) => {
      const [connection] = await importFromJSON(
        JSON.stringify([{ name: "Google", protocol }]),
      );
      expect(connection).toMatchObject({
        protocol: protocol.toLowerCase(),
        hostname: "",
        port: 0,
      });
    },
  );

  it.each(["gcp", "integration:gdrive"])(
    "preserves stored compatibility addresses for %s",
    async (protocol) => {
      const record = {
        name: "Google",
        protocol,
        hostname: "https://legacy.example:8443/path",
        port: 0,
      };
      const [connection] = await importFromJSON(JSON.stringify([record]));
      expect(connection).toMatchObject(record);
    },
  );

  it.each(["gcp", "integration:gdrive"])(
    "imports endpoint-free CSV for %s",
    async (protocol) => {
      const [connection] = await importFromCSV(
        `Name,Protocol,Hostname,Port\nGoogle,${protocol},,\n`,
      );
      expect(connection).toMatchObject({ protocol, hostname: "", port: 0 });
    },
  );

  it("retains generic HTTPS endpoint inference", async () => {
    const [connection] = await importFromJSON(
      JSON.stringify([
        { name: "Web", protocol: "https", hostname: "https://example.com" },
      ]),
    );
    expect(connection).toMatchObject({
      protocol: "https",
      hostname: "example.com",
      port: 443,
    });
  });

  it("preserves an explicit empty hostname alongside a legacy URL", async () => {
    const record = {
      name: "Drive",
      protocol: "integration:gdrive",
      hostname: "",
      url: "https://legacy.example",
      port: 0,
    };
    const [connection] = await importFromJSON(JSON.stringify([record]));
    expect(connection).toMatchObject(record);
  });
});
