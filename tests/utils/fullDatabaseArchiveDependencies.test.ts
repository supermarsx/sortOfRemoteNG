import { describe, expect, it } from "vitest";
import {
  buildFullDatabaseArchive,
  FullDatabaseArchiveError,
  normalizeFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { MAX_ARCHIVE_DEPENDENCY_ISSUES } from "../../src/utils/connection/archiveDependencyDiagnostics";
import {
  collection,
  connection,
  fullData,
  trust,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";

async function rejection(
  operation: Promise<unknown>,
): Promise<FullDatabaseArchiveError> {
  const error = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(FullDatabaseArchiveError);
  return error as FullDatabaseArchiveError;
}

describe("full database archive dependency diagnostics", () => {
  it.each([false, true])(
    "preserves HTTP headers whose names resemble references (recycled=%s)",
    async (recycled) => {
      const data = await fullData();
      const row = recycled
        ? data.recycleBin!.entries[0].connection
        : data.connections[2];
      row.protocol = "https";
      row.httpHeaders = {
        connectionId: "header-value",
        credentialRef: "PRIVATE_HEADER_CREDENTIAL",
        configId: "header-config",
        privateKey: "PRIVATE_HEADER_KEY",
        proxyProfileId: "header-profile",
      };
      const original = structuredClone(data);
      const archive = await buildFullDatabaseArchive(collection, data, trust);
      const normalized = await normalizeFullDatabaseArchive(archive);
      expect(
        (recycled
          ? normalized.recycleBin.entries[0].connection
          : normalized.connections[2]
        ).httpHeaders,
      ).toEqual(row.httpHeaders);
      expect(data).toEqual(original);
    },
  );

  it("preserves scalar integration provider metadata without treating it as app references", async () => {
    const data = await fullData();
    data.connections[2].integration = {
      descriptorKey: "exchange",
      providerFields: {
        configId: "remote-provider-config",
        connectionId: "remote-id",
        proxyProfileId: null,
        privateKey: false,
      },
    };
    const archive = await buildFullDatabaseArchive(collection, data, trust);
    expect(archive.connections[2].integration).toEqual(
      data.connections[2].integration,
    );
  });

  it("still rejects real route references beside exempted dictionaries and leaves them intact", async () => {
    const data = await fullData();
    data.connections[2].httpHeaders = { proxyProfileId: "header-value" };
    data.connections[2].proxyProfileId = "PRIVATE_APP_PROFILE";
    const original = structuredClone(data);
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues).toEqual([
      {
        recordId: "local",
        path: "connections[2].proxyProfileId",
        reason: "external-route",
      },
    ]);
    expect(error.message).toContain("portable inline route");
    expect(error.message).not.toContain("PRIVATE_APP_PROFILE");
    expect(data).toEqual(original);
  });

  it("does not exempt nested objects smuggled into scalar dictionary fields", async () => {
    const data = await fullData();
    Object.assign(data.connections[2], {
      httpHeaders: { PRIVATE_DICTIONARY_KEY: { credentialRef: "PRIVATE_REF" } },
    });
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.code).toBe("dependencies");
    expect(error.message).toContain("credentialRef");
    expect(error.message).not.toMatch(/PRIVATE_/);
  });

  it("reports multiple active, recycled and document issues with safe record locations", async () => {
    const data = await fullData();
    data.credentialVault!.entries = [];
    data.automationLibrary!.terminalScripts.customScripts = [];
    data.documents!.documents[0].parentFolderId = "absent-folder";
    data.connections[1].name = "PRIVATE_NAME";
    const original = structuredClone(data);
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics).toMatchObject({
      databaseId: collection.id,
      totalIssues: 5,
    });
    expect(error.diagnostics?.issues).toEqual(
      expect.arrayContaining([
        {
          recordId: "host",
          path: "connections[1].credentialSource.credentialId",
          reason: "credential",
          targetId: VAULT_ID,
        },
        {
          recordId: "host",
          path: "connections[1].sshQuickActions.items[0]",
          reason: "script",
          targetId: "script",
        },
        {
          recordId: "archived",
          path: "recycleBin.entries[0].connection.credentialSource.credentialId",
          reason: "credential",
          targetId: VAULT_ID,
        },
        {
          recordId: "document",
          path: "documents.documents[0].parentFolderId",
          reason: "folder",
          targetId: "absent-folder",
        },
      ]),
    );
    expect(error.message).toContain("Recycle Bin before editing");
    expect(error.message).not.toMatch(/PRIVATE_|fixture\.test|JBSWY/);
    expect(JSON.stringify(error.diagnostics)).not.toMatch(
      /PRIVATE_|fixture\.test|JBSWY/,
    );
    expect(data).toEqual(original);
  });

  it("identifies a missing TOTP selection separately from its existing vault credential", async () => {
    const data = await fullData();
    delete data.credentialVault!.entries[0].facets.totp;
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues[0]).toMatchObject({
      reason: "totp",
      path: "connections[1].credentialSource.totpId",
    });
    expect(error.message).toContain("select an existing TOTP entry");
  });

  it.each([undefined, { kind: "database" as const, databaseId: "other-db" }])(
    "explains external quick-action scope %j",
    async (scope) => {
      const data = await fullData();
      data.connections[1].sshQuickActions!.items[0].scope = scope;
      const error = await rejection(
        buildFullDatabaseArchive(collection, data, trust),
      );
      expect(error.diagnostics?.issues[0]).toMatchObject({
        reason: "external-script",
        recordId: "host",
      });
      expect(error.message).toContain("reselect the database-owned item");
      expect(error.message).toContain("does not rebind this reference");
    },
  );

  it("keeps legacy lifecycle script content out of diagnostics", async () => {
    const data = await fullData();
    data.connections[2].scripts = { onConnect: ["PRIVATE_SCRIPT_BODY"] };
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues[0]).toMatchObject({
      reason: "legacy-script",
      path: "connections[2].scripts",
    });
    expect(error.message).not.toContain("PRIVATE_SCRIPT_BODY");
  });

  it("locates missing nested route connections and tab groups", async () => {
    const data = await fullData();
    data.connections[2].security!.sshTunnel!.connectionId = "absent-host";
    data.connections[2].defaultTabGroupId = "absent-group";
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues).toEqual(
      expect.arrayContaining([
        {
          recordId: "local",
          path: "connections[2].security.sshTunnel.connectionId",
          reason: "connection",
          targetId: "absent-host",
        },
        {
          recordId: "local",
          path: "connections[2].defaultTabGroupId",
          reason: "tab-group",
          targetId: "absent-group",
        },
      ]),
    );
  });

  it("identifies cycles without looping or altering the tree", async () => {
    const data = await fullData();
    data.connections[0].parentId = "folder";
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues).toEqual([
      {
        recordId: "folder",
        path: "connections[0].parentId",
        reason: "cycle",
        targetId: "folder",
      },
    ]);
    expect(data.connections[0].parentId).toBe("folder");
  });

  it("reports document reference paths on import without printing document content", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    const block = archive.documents.documents[0].blocks[2];
    if (block.type !== "reference") throw new Error("fixture");
    block.reference.id = "absent-target";
    const original = structuredClone(archive);
    const error = await rejection(normalizeFullDatabaseArchive(archive));
    expect(error.diagnostics?.issues).toEqual([
      {
        recordId: "document",
        path: "documents.documents[0].blocks[2].reference",
        reason: "document",
        targetId: "absent-target",
      },
    ]);
    expect(error.message).toContain("edit this reference in Documents");
    expect(error.message).not.toMatch(/PRIVATE_|private notes/);
    expect(archive).toEqual(original);
  });

  it("does not mistake an app-scoped document link for a database link with the same IDs", async () => {
    const data = await fullData();
    const block = data.documents!.documents[0].blocks[2];
    if (block.type !== "reference") throw new Error("fixture");
    block.reference = {
      scope: "app",
      databaseId: collection.id,
      kind: "document",
      id: "document",
    };
    const original = structuredClone(data);
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues).toEqual([
      {
        recordId: "document",
        path: "documents.documents[0].blocks[2].reference",
        reason: "external-document",
        targetId: "document",
      },
    ]);
    expect(error.message).toContain(
      "Copy the required target into this database and reselect it",
    );
    expect(data).toEqual(original);
    delete block.reference.scope;
    await expect(
      buildFullDatabaseArchive(collection, data, trust),
    ).resolves.toBeDefined();
  });

  it("identifies missing spreadsheet sheets and references owned by people and tickets", async () => {
    const data = await fullData();
    data.documents!.people.push({
      id: "person",
      name: "PRIVATE_PERSON",
      email: "",
      phone: "",
      organization: "",
      notes: "",
      references: [
        {
          databaseId: collection.id,
          kind: "cell",
          id: "document",
          blockId: "absent-block",
          sheetId: "absent-sheet",
          address: "A1",
        },
      ],
    });
    data.documents!.tickets.push({
      id: "ticket",
      title: "PRIVATE_TICKET",
      status: "open",
      priority: "normal",
      description: "",
      references: [
        { databaseId: "other-db", kind: "document", id: "document" },
      ],
    });
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.issues).toEqual([
      {
        recordId: "person",
        path: "documents.people[0].references[0]",
        reason: "cell",
        targetId: "document",
      },
      {
        recordId: "ticket",
        path: "documents.tickets[0].references[0]",
        reason: "external-document",
        targetId: "document",
      },
    ]);
    expect(error.message).not.toMatch(/PRIVATE_/);
  });

  it("identifies local key-file blockers without echoing the private path", async () => {
    const data = await fullData();
    data.recycleBin!.entries[0].connection.credentialSource = { kind: "local" };
    data.recycleBin!.entries[0].connection.privateKey =
      "C:/PRIVATE_USER/PRIVATE_KEY_FILE";
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.code).toBe("file-credential");
    expect(error.diagnostics?.issues[0]).toMatchObject({
      recordId: "archived",
      path: "recycleBin.entries[0].connection.privateKey",
    });
    expect(error.message).not.toMatch(/PRIVATE_/);
  });

  it("bounds the displayed issues and gives an exact remaining count", async () => {
    const data = await fullData();
    for (let index = 0; index < 25; index++)
      data.connections.push({
        ...connection(`dangling-${index}`),
        parentId: "absent",
      });
    const error = await rejection(
      buildFullDatabaseArchive(collection, data, trust),
    );
    expect(error.diagnostics?.totalIssues).toBe(25);
    expect(error.diagnostics?.issues).toHaveLength(
      MAX_ARCHIVE_DEPENDENCY_ISSUES,
    );
    expect(error.message).toContain("13 more issues");
    expect(data.connections).toHaveLength(28);
  });
});
