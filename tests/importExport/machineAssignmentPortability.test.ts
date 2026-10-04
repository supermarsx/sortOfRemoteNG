import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { ConnectionMachineAssignment } from "../../src/types/connection/machineAssignment";
import {
  buildApplyItems,
  remapConnectionsForApply,
  type ApplyConnectionsOptions,
} from "../../src/components/ImportExport/applyConnections";
import {
  prepareConnectionForClone,
  prepareConnectionForExport,
  stripConnectionCredentials,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import {
  buildFullDatabaseArchive,
  fullDatabaseArchiveData,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { rebindDatabaseQuickActions } from "../../src/utils/connection/rebindDatabaseQuickActions";
import {
  normalizeDatabaseVaultArchive,
  prepareVaultArchiveImport,
} from "../../src/utils/security/vaultArchive";
import {
  collection,
  connection,
  fullData,
  trust,
  NOW,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";

const assignment = (
  databaseId = collection.id,
  connectionId = "host",
): ConnectionMachineAssignment => ({
  version: 1,
  type: "vm",
  name: "Snapshot label",
  host: "Snapshot platform",
  resourceId: "vm-123",
  connectionRef: { databaseId, connectionId },
});
const linked = (
  databaseId = collection.id,
  connectionId = "host",
): Connection => ({
  ...connection("guest"),
  machineAssignment: assignment(databaseId, connectionId),
});
const options: ApplyConnectionsOptions = {
  conflictPolicy: "duplicate",
  addTags: [],
  preserveFolders: true,
  sourceDatabaseId: collection.id,
  destinationDatabaseId: "copy-db",
};

describe("advisory machine assignment portability", () => {
  it("rebinds an included batch target after an ID conflict without changing labels or source", () => {
    const source = [linked(), connection("host")];
    const before = structuredClone(source);
    const result = remapConnectionsForApply(
      buildApplyItems(source, [connection("host")]),
      options,
    );
    expect(result.remapped[1].id).not.toBe("host");
    expect(result.remapped[0].machineAssignment).toEqual({
      ...assignment(),
      connectionRef: {
        databaseId: "copy-db",
        connectionId: result.remapped[1].id,
      },
    });
    expect(source).toEqual(before);
  });

  it.each(["copy-db", collection.id])(
    "handles renamed target IDs in %s",
    (destinationDatabaseId) => {
      const result = remapConnectionsForApply(
        buildApplyItems([linked(), connection("host")], []),
        { ...options, conflictPolicy: "rename", destinationDatabaseId },
      );
      expect(result.remapped[0].machineAssignment?.connectionRef).toEqual({
        databaseId: destinationDatabaseId,
        connectionId: result.remapped[1].id,
      });
    },
  );

  it.each([
    "missing-source",
    "missing-destination",
    "foreign",
    "omitted",
    "skipped",
    "filtered-folder",
    "ambiguous",
  ])(
    "preserves unresolved identity for %s instead of guessing a target",
    (kind) => {
      const guest = linked(kind === "foreign" ? "other-db" : collection.id);
      const source = [
        guest,
        ...(kind === "omitted"
          ? []
          : [{ ...connection("host"), isGroup: kind === "filtered-folder" }]),
      ];
      if (kind === "ambiguous") source.push(connection("host"));
      const result = remapConnectionsForApply(
        buildApplyItems(source, kind === "skipped" ? [connection("host")] : []),
        {
          ...options,
          conflictPolicy: kind === "skipped" ? "skip" : "duplicate",
          preserveFolders: kind !== "filtered-folder",
          sourceDatabaseId:
            kind === "missing-source" ? undefined : collection.id,
          destinationDatabaseId:
            kind === "missing-destination" ? undefined : "copy-db",
        },
      );
      expect(result.remapped[0].machineAssignment).toEqual(
        guest.machineAssignment,
      );
    },
  );

  it("moves the database identity even when the included target keeps its ID", () => {
    const result = remapConnectionsForApply(
      buildApplyItems([linked(), connection("host")], []),
      options,
    );
    expect(result.remapped[0].machineAssignment?.connectionRef).toEqual({
      databaseId: "copy-db",
      connectionId: "host",
    });
  });

  it.each([false, true])(
    "retains Notes links across credential stripping (include=%s)",
    (includeCredentials) => {
      const source = { ...linked(), password: "SECRET" };
      for (const result of [
        prepareConnectionForExport(source, includeCredentials),
        prepareConnectionForClone(source, includeCredentials),
        stripConnectionCredentials(source),
      ])
        expect(result.machineAssignment).toEqual(assignment());
    },
  );

  it.each([false, true])(
    "restores active and recycled local links but leaves dangling and foreign links intact (recycled=%s)",
    async (recycled) => {
      for (const [databaseId, targetId, expectedDatabaseId] of [
        [collection.id, "host", "copy-db"],
        [collection.id, "absent", collection.id],
        ["foreign-db", "host", "foreign-db"],
        ["foreign-db", "absent", "foreign-db"],
      ]) {
        const data = await fullData();
        const row = recycled
          ? data.recycleBin!.entries[0].connection
          : data.connections[2];
        row.machineAssignment = assignment(databaseId, targetId);
        const before = structuredClone(data);
        const archive = await normalizeFullDatabaseArchive(
          await buildFullDatabaseArchive(collection, data, trust),
        );
        const copied = rebindDatabaseQuickActions(
          fullDatabaseArchiveData(archive),
          collection.id,
          "copy-db",
        );
        const copy = recycled
          ? copied.recycleBin!.entries[0].connection
          : copied.connections[2];
        expect(copy.machineAssignment).toEqual({
          ...row.machineAssignment,
          connectionRef: {
            databaseId: expectedDatabaseId,
            connectionId: targetId,
          },
        });
        await expect(
          buildFullDatabaseArchive(
            { ...collection, id: "copy-db" },
            copied,
            trust,
          ),
        ).resolves.toBeDefined();
        expect(data).toEqual(before);
      }
    },
  );

  it("also rebinds targets included only in the recycle bin", async () => {
    const data = await fullData();
    const targetId = data.recycleBin!.entries[0].connection.id;
    data.connections[2].machineAssignment = assignment(collection.id, targetId);
    const copied = rebindDatabaseQuickActions(data, collection.id, "copy-db");
    expect(copied.connections[2].machineAssignment?.connectionRef).toEqual({
      databaseId: "copy-db",
      connectionId: targetId,
    });
  });

  it("does not infer a whole-database source from an advisory link", async () => {
    const data = await fullData();
    data.connections[2].machineAssignment = assignment();
    const copied = rebindDatabaseQuickActions(data, undefined, "copy-db");
    expect(copied.connections[2].machineAssignment).toEqual(assignment());
  });

  it("still rejects missing route and credential dependencies alongside advisory links", async () => {
    for (const patch of [
      {
        security: {
          tunnelChain: [
            {
              id: "hop",
              type: "ssh-tunnel",
              enabled: true,
              sshTunnel: {
                connectionId: "absent",
                ownerDatabaseId: collection.id,
              },
            },
          ],
        },
      },
      {
        credentialSource: {
          kind: "vault",
          credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
      },
    ]) {
      const data = await fullData();
      Object.assign(data.connections[2], patch, {
        machineAssignment: assignment(collection.id, "absent"),
      });
      await expect(
        buildFullDatabaseArchive(collection, data, trust),
      ).rejects.toMatchObject({ code: "dependencies" });
    }
  });

  it.each(["host", "absent"])(
    "vault archives preserve advisory target %s while remapping credential IDs",
    (targetId) => {
      const source = {
        format: "sorng-vault-archive" as const,
        version: 1 as const,
        createdAt: NOW,
        credentials: [
          {
            id: VAULT_ID,
            name: "Vault login",
            createdAt: NOW,
            updatedAt: NOW,
            facets: { password: "SECRET" },
          },
        ],
        connections: [linked("foreign-db", targetId), connection("host")].map(
          (row) => ({
            ...row,
            credentialSource: {
              kind: "vault" as const,
              credentialId: VAULT_ID,
            },
          }),
        ),
      };
      const normalized = normalizeDatabaseVaultArchive(source);
      expect(normalized.connections[0].machineAssignment).toEqual(
        assignment("foreign-db", targetId),
      );
      const result = prepareVaultArchiveImport(
        [],
        { version: 1, revision: 0, entries: [] },
        source,
      );
      expect(result.connections[0].id).not.toBe("guest");
      expect(result.connections[0].credentialSource).not.toEqual(
        source.connections[0].credentialSource,
      );
      expect(result.connections[0].machineAssignment).toEqual(
        assignment("foreign-db", targetId),
      );
    },
  );
});
