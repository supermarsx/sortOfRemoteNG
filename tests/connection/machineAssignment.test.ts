import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { normalizeMachineAssignment } from "../../src/types/connection/machineAssignment";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  buildFullDatabaseArchive,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { collection, fullData, trust } from "../fixtures/fullDatabaseArchive";
import {
  prepareConnectionForClone,
  prepareConnectionForExport,
  serializeConnectionsToNativeXml,
  serializeDatasetsToNativeCsv,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import {
  importFromCSV,
  importFromJSON,
  importFromXML,
} from "../../src/components/ImportExport/utils";

const connection: Connection = {
  id: "notes-fixture",
  name: "Control panel",
  protocol: "https",
  hostname: "panel.example",
  port: 443,
  isGroup: false,
  description: "Keep this existing note",
  username: "user",
  password: "fixture-password",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  machineAssignment: {
    version: 1,
    type: "vm",
    name: "Billing & reports",
    resourceId: "104",
    host: "PVE-01",
    connectionRef: { databaseId: "fixture-db", connectionId: "machine-target" },
  },
};

describe("connection notes machine assignment", () => {
  it("retains machine notes in the full database archive without external dependencies", async () => {
    const data = await fullData();
    data.connections[2].machineAssignment = connection.machineAssignment;
    const archive = await buildFullDatabaseArchive(collection, data, trust);
    const restored = await normalizeFullDatabaseArchive(
      JSON.parse(JSON.stringify(archive)),
    );
    expect(restored.connections[2].machineAssignment).toEqual(
      connection.machineAssignment,
    );
  });

  it.each(["server", "container", "vm"] as const)(
    "persists %s metadata without changing the endpoint or notes",
    (type) => {
      const source = {
        ...connection,
        machineAssignment: { ...connection.machineAssignment!, type },
      };
      const normalized = normalizeAdvancedProtocolConnection(source);
      expect(normalized).toMatchObject(source);
      expect(normalizeAdvancedProtocolConnection(normalized)).toEqual(
        normalized,
      );
    },
  );

  it("copies only bounded descriptive fields and no reference or credential material", () => {
    expect(
      normalizeMachineAssignment({
        version: 1,
        type: "container",
        name: "  App\nservice  ",
        resourceId: " x ",
        host: "a".repeat(300),
        password: "fixture-secret",
        connectionId: "other-connection",
        databaseId: "other-database",
      }),
    ).toEqual({
      version: 1,
      type: "container",
      name: "App service",
      resourceId: "x",
      host: "a".repeat(256),
    });
  });

  it.each([
    null,
    [],
    "vm",
    { version: 2, type: "vm", name: "x" },
    { version: 1, type: "unknown", name: "x" },
    { version: 1, type: "server", name: {} },
  ])(
    "ignores invalid optional metadata without changing the connection",
    (machineAssignment) => {
      expect(normalizeMachineAssignment(machineAssignment)).toBeUndefined();
      const source = {
        ...connection,
        machineAssignment,
      } as unknown as Connection;
      expect(normalizeAdvancedProtocolConnection(source)).toMatchObject({
        id: connection.id,
        description: connection.description,
        hostname: connection.hostname,
        password: connection.password,
        machineAssignment: undefined,
      });
    },
  );

  it("does not introduce an assignment into legacy connections", () => {
    const { machineAssignment: _, ...legacy } = connection;
    expect(normalizeAdvancedProtocolConnection(legacy)).not.toHaveProperty(
      "machineAssignment",
    );
  });

  it("keeps only the exact database/connection reference and drops nested secrets", () => {
    const assignment = normalizeMachineAssignment({
      ...connection.machineAssignment,
      connectionRef: {
        databaseId: "db-a",
        connectionId: "machine-target",
        password: "fixture-secret",
        hostname: "ignored",
      },
    });
    expect(assignment?.connectionRef).toEqual({
      databaseId: "db-a",
      connectionId: "machine-target",
    });
  });

  it.each([
    null,
    [],
    {},
    { databaseId: "db-a" },
    { databaseId: "", connectionId: "x" },
    { databaseId: "db-a", connectionId: " x " },
    { databaseId: "db-a", connectionId: "x\n" },
    { databaseId: "db-a", connectionId: "x".repeat(257) },
  ])(
    "does not repair malformed identities into a link: %j",
    (connectionRef) => {
      const assignment = normalizeMachineAssignment({
        ...connection.machineAssignment,
        connectionRef,
      });
      expect(assignment?.connectionRef).toBeUndefined();
      expect(assignment?.name).toBe(connection.machineAssignment?.name);
    },
  );

  it.each(["json", "xml", "csv"])(
    "round-trips machine notes through native %s export/import",
    async (format) => {
      const safe = prepareConnectionForExport(connection, false);
      const result =
        format === "xml"
          ? await importFromXML(serializeConnectionsToNativeXml([safe]))
          : format === "csv"
            ? await importFromCSV(
                serializeDatasetsToNativeCsv([
                  {
                    databaseId: "fixture-db",
                    databaseName: "Fixture",
                    connections: [safe],
                  },
                ]),
              )
            : await importFromJSON(JSON.stringify([safe]));
      expect(result[0]).toMatchObject({
        name: connection.name,
        hostname: connection.hostname,
        description: connection.description,
        machineAssignment: connection.machineAssignment,
      });
      expect(result[0].password).not.toBe(connection.password);
    },
  );

  it("retains independent descriptive metadata when cloning without credentials", () => {
    const clone = prepareConnectionForClone(connection, false);
    expect(clone.machineAssignment).toEqual(connection.machineAssignment);
    expect(clone.machineAssignment).not.toBe(connection.machineAssignment);
    expect(clone.password).toBeUndefined();
  });
});
