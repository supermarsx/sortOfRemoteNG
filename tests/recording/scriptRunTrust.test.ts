import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_SCRIPT_TRUST_ENTRIES,
  MAX_SCRIPT_TRUST_RECORD_CHARS,
  RUN_TRUST_STORE_KEY,
  ScriptTrustRecordError,
  bulkScriptRunContent,
  classifyRunRisk,
  createScriptTrustEntry,
  digestConnectionEndpoint,
  digestRunContent,
  emptyScriptTrustRecord,
  evaluateScriptTrust,
  isScriptTrustQuery,
  parseScriptTrustRecord,
  sanitizeScriptTrustRecord,
  scriptTrustEntryKey,
  scriptTrustSubjectKey,
  sshMacroRunContent,
  sshScriptCommand,
  sshScriptRunContent,
  type ScriptTrustEndpoint,
  type ScriptTrustEntry,
  type ScriptTrustGrant,
  type ScriptTrustQuery,
  type ScriptTrustRecord,
} from "../../src/utils/recording/scriptRunTrust";
import {
  SCRIPT_TRUST_TEST_KEY,
  SENTINELS,
  TRUST_TEST_TIME,
  connectionTrustEntry,
  containsSentinel,
  fakeDigest,
  trustEntry,
} from "./scriptTrustTestBackend";

const sha256 = (text: string) =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

const record = (...entries: ScriptTrustEntry[]): ScriptTrustRecord => ({
  version: 1,
  entries,
});

const step = (command: string, delayMs = 0, sendNewline = true) => ({
  command,
  delayMs,
  sendNewline,
});

describe("the key and the limits", () => {
  it("uses one versioned app-data key and caps the record at 1,000 entries", () => {
    expect(RUN_TRUST_STORE_KEY).toBe("automation.run-trust.v1");
    expect(SCRIPT_TRUST_TEST_KEY).toBe(RUN_TRUST_STORE_KEY);
    expect(MAX_SCRIPT_TRUST_ENTRIES).toBe(1000);
    expect(emptyScriptTrustRecord()).toStrictEqual({ version: 1, entries: [] });
  });
});

describe("what a run sends", () => {
  it("derives a script's command as the terminal does: every #! line is dropped", () => {
    // The terminal's own derivation (useWebTerminal.ts runScript).
    const reference = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("#!"))
        .join("\n");
    for (const text of [
      "#!/bin/bash\necho one\necho two",
      "echo one",
      "#!/bin/sh",
      "",
      "echo one\n#!/usr/bin/env bash\necho two\n",
      " #!not-first-column\necho",
      "#!/bin/bash\r\necho crlf\r\n",
    ])
      expect(sshScriptCommand(text)).toBe(reference(text));
    expect(sshScriptCommand("#!/bin/bash\necho one\n")).toBe("echo one\n");
  });

  it("sends a bulk command trimmed", () => {
    expect(bulkScriptRunContent("  uptime \n\n")).toBe("uptime");
    expect(bulkScriptRunContent("a\n b ")).toBe("a\n b");
  });

  it("encodes a script as language and command, and a macro as its three fields per step", () => {
    expect(sshScriptRunContent("bash", "echo 1")).toBe('["bash","echo 1"]');
    expect(
      sshMacroRunContent([step("ls", 250, true), step("q", 0, false)]),
    ).toBe('[["ls",250,true],["q",0,false]]');
    // Only what the replay uses takes part: no name, no key order.
    expect(
      sshMacroRunContent([
        {
          sendNewline: true,
          delayMs: 250,
          command: "ls",
          name: SENTINELS.name,
        } as never,
      ]),
    ).toBe('[["ls",250,true]]');
  });

  it("cannot be made to collide by moving text between the parts", () => {
    const contents = [
      sshScriptRunContent("ba", "sh x"),
      sshScriptRunContent("bash", " x"),
      sshScriptRunContent("bash", '","x'),
      sshScriptRunContent('bash","', "x"),
      sshMacroRunContent([step("ab")]),
      sshMacroRunContent([step("a"), step("b")]),
      sshMacroRunContent([step('a",0,true],["b')]),
      sshMacroRunContent([step("a\n", 0, false)]),
      sshMacroRunContent([step("a", 0, true)]),
    ];
    expect(new Set(contents).size).toBe(contents.length);
  });

  it("keeps values of the wrong type apart from every well-formed value", () => {
    const raw = (command: unknown, delayMs: unknown, sendNewline: unknown) =>
      ({ command, delayMs, sendNewline }) as never;
    const odd = [
      sshMacroRunContent([raw("x", Number.NaN, true)]),
      sshMacroRunContent([raw("x", Number.POSITIVE_INFINITY, true)]),
      sshMacroRunContent([raw("x", Number.NEGATIVE_INFINITY, true)]),
      sshMacroRunContent([raw("x", null, true)]),
      sshMacroRunContent([raw("x", undefined, true)]),
      sshMacroRunContent([raw("x", "0", true)]),
      sshMacroRunContent([raw("x", 0, true)]),
      sshMacroRunContent([raw(undefined, 0, true)]),
      sshMacroRunContent([raw(null, 0, true)]),
      sshMacroRunContent([raw("undefined", 0, true)]),
      sshMacroRunContent([raw("null", 0, true)]),
      sshMacroRunContent([raw("x", 0, 1)]),
      sshMacroRunContent([raw("x", 0, "true")]),
      sshMacroRunContent([raw("x", 0, undefined)]),
      sshMacroRunContent([undefined as never]),
      sshScriptRunContent(undefined as never, "x"),
      sshScriptRunContent(null as never, "x"),
      sshScriptRunContent("null", "x"),
      sshScriptRunContent("undefined", "x"),
      sshScriptRunContent("bash", undefined as never),
      sshScriptRunContent("bash", "undefined"),
    ];
    expect(new Set(odd).size).toBe(odd.length);
  });
});

describe("the content digest", () => {
  it("is SHA-256 over the tagged JSON array of kind and content, as UTF-8", async () => {
    const content = sshScriptRunContent("bash", "echo \u{e9}\u{4e2d}");
    expect(await digestRunContent("ssh-script", content)).toBe(
      sha256(
        JSON.stringify(["sorng.run-trust.content.v1", "ssh-script", content]),
      ),
    );
    expect(await digestRunContent("bulk-script", "uptime")).toBe(
      sha256('["sorng.run-trust.content.v1","bulk-script","uptime"]'),
    );
    expect(await digestRunContent("ssh-script", content)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("differs by one character, a final line feed, CRLF, the language and the kind", async () => {
    const digest = (language: string, command: string) =>
      digestRunContent("ssh-script", sshScriptRunContent(language, command));
    const base = await digest("bash", "echo one\necho two");
    const others = await Promise.all([
      digest("bash", "echo one\necho twp"),
      digest("bash", "echo one\necho two\n"),
      digest("bash", "echo one\r\necho two"),
      digest("sh", "echo one\necho two"),
      digest("powershell", "echo one\necho two"),
      digestRunContent(
        "bulk-script",
        sshScriptRunContent("bash", "echo one\necho two"),
      ),
      digestRunContent(
        "ssh-macro",
        sshScriptRunContent("bash", "echo one\necho two"),
      ),
    ]);
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
    expect(await digest("bash", "echo one\necho two")).toBe(base);
  });

  it("differs by a step's text, order, delay and Enter flag", async () => {
    const digest = (steps: ReturnType<typeof step>[]) =>
      digestRunContent("ssh-macro", sshMacroRunContent(steps));
    const base = await digest([step("cd /tmp", 100), step("ls", 0)]);
    const others = await Promise.all([
      digest([step("ls", 0), step("cd /tmp", 100)]),
      digest([step("cd /tmp", 101), step("ls", 0)]),
      digest([step("cd /tmp", 100, false), step("ls", 0)]),
      digest([step("cd /tmp", 100), step("ls", 0, false)]),
      digest([step("cd /tmq", 100), step("ls", 0)]),
      digest([step("cd /tmp", 100)]),
      digest([step("cd /tmp", 100), step("ls", 0), step("", 0)]),
    ]);
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
    expect(await digest([step("cd /tmp", 100), step("ls", 0)])).toBe(base);
  });
});

describe("the endpoint digest", () => {
  const endpoint: ScriptTrustEndpoint = {
    databaseId: "db-1",
    connectionId: "conn-1",
    protocol: "ssh",
    host: "host-a.example",
    port: 22,
    username: "operator",
    domain: "CORP",
    credentialKind: "vault",
    credentialId: "cred-1",
  };

  it("is SHA-256 over the tagged JSON array of its nine values", async () => {
    expect(await digestConnectionEndpoint(endpoint)).toBe(
      sha256(
        JSON.stringify([
          "sorng.run-trust.endpoint.v1",
          "db-1",
          "conn-1",
          "ssh",
          "host-a.example",
          22,
          "operator",
          "CORP",
          "vault",
          "cred-1",
        ]),
      ),
    );
    expect(
      await digestConnectionEndpoint({
        databaseId: "db-1",
        connectionId: "conn-1",
        protocol: "ssh",
        host: "host-a.example",
        port: 22,
      }),
    ).toBe(
      sha256(
        '["sorng.run-trust.endpoint.v1","db-1","conn-1","ssh","host-a.example",22,null,null,null,null]',
      ),
    );
  });

  it("differs by each of its values", async () => {
    const changes: Partial<ScriptTrustEndpoint>[] = [
      { databaseId: "db-2" },
      { connectionId: "conn-2" },
      { protocol: "telnet" },
      { host: "host-b.example" },
      { host: "HOST-A.example" },
      { port: 2222 },
      { username: "root" },
      { username: undefined },
      { domain: "OTHER" },
      { domain: undefined },
      { credentialKind: "local" },
      { credentialKind: undefined },
      { credentialId: "cred-2" },
      { credentialId: undefined },
    ];
    const base = await digestConnectionEndpoint(endpoint);
    const digests = await Promise.all(
      changes.map((change) =>
        digestConnectionEndpoint({ ...endpoint, ...change }),
      ),
    );
    expect(new Set([base, ...digests]).size).toBe(changes.length + 1);
  });

  it("ignores everything that is not an endpoint value, and treats an empty user or domain as none", async () => {
    const base = await digestConnectionEndpoint(endpoint);
    expect(
      await digestConnectionEndpoint({
        ...endpoint,
        name: SENTINELS.name,
        tags: ["x"],
        colorTag: "red",
        favorite: true,
        password: "never-read",
      } as ScriptTrustEndpoint),
    ).toBe(base);
    const bare = await digestConnectionEndpoint({
      ...endpoint,
      username: undefined,
      domain: undefined,
    });
    expect(
      await digestConnectionEndpoint({ ...endpoint, username: "", domain: "" }),
    ).toBe(bare);
    expect(
      await digestConnectionEndpoint({
        ...endpoint,
        username: null,
        domain: null,
      }),
    ).toBe(bare);
  });

  it("moves text between host and user without colliding", async () => {
    expect(
      await digestConnectionEndpoint({
        ...endpoint,
        host: "a",
        username: "bc",
      }),
    ).not.toBe(
      await digestConnectionEndpoint({
        ...endpoint,
        host: "ab",
        username: "c",
      }),
    );
  });
});

describe("the risk mark", () => {
  it("uses the bulk library's classifier over the command or the joined steps", () => {
    expect(
      classifyRunRisk({ kind: "ssh-script", command: "sudo reboot" }),
    ).toBe("destructive");
    expect(classifyRunRisk({ kind: "ssh-script", command: "uptime" })).toBe(
      "standard",
    );
    expect(classifyRunRisk({ kind: "bulk-script", command: "rm -rf /x" })).toBe(
      "destructive",
    );
    expect(
      classifyRunRisk({
        kind: "ssh-macro",
        steps: [step("cd /tmp"), step("systemctl stop nginx")],
      }),
    ).toBe("destructive");
    expect(
      classifyRunRisk({ kind: "ssh-macro", steps: [step("cd /tmp")] }),
    ).toBe("standard");
    // Each step is its own line: "ls" then "reboot" is a reboot.
    expect(
      classifyRunRisk({
        kind: "ssh-macro",
        steps: [step("ls"), step("reboot")],
      }),
    ).toBe("destructive");
    expect(classifyRunRisk({ kind: "ssh-macro", steps: [] })).toBe("standard");
  });
});

describe("entry keys", () => {
  it("has one key per kind, library, subject, scope, database and connection", () => {
    const entries: ScriptTrustEntry[] = [
      trustEntry(),
      trustEntry({ kind: "ssh-macro" }),
      trustEntry({ library: { kind: "database", databaseId: "db-1" } }),
      trustEntry({ library: { kind: "database", databaseId: "db-2" } }),
      trustEntry({ subjectId: "script-2" }),
      connectionTrustEntry(),
      connectionTrustEntry({
        connection: {
          databaseId: "db-2",
          connectionId: "conn-1",
          endpointDigest: fakeDigest("endpoint-1"),
        },
      }),
      connectionTrustEntry({
        connection: {
          databaseId: "db-1",
          connectionId: "conn-2",
          endpointDigest: fakeDigest("endpoint-1"),
        },
      }),
    ];
    expect(new Set(entries.map(scriptTrustEntryKey)).size).toBe(entries.length);
  });

  it("does not depend on the digests, the risk or the time", () => {
    expect(
      scriptTrustEntryKey(
        connectionTrustEntry({
          contentDigest: fakeDigest("other"),
          risk: "destructive",
          grantedAt: "2027-01-01T00:00:00.000Z",
          connection: {
            databaseId: "db-1",
            connectionId: "conn-1",
            endpointDigest: fakeDigest("other-endpoint"),
          },
        }),
      ),
    ).toBe(scriptTrustEntryKey(connectionTrustEntry()));
  });

  it("cannot collide by moving text between ids", () => {
    expect(
      scriptTrustEntryKey(
        trustEntry({
          library: { kind: "database", databaseId: "a" },
          subjectId: "bc",
        }),
      ),
    ).not.toBe(
      scriptTrustEntryKey(
        trustEntry({
          library: { kind: "database", databaseId: "ab" },
          subjectId: "c",
        }),
      ),
    );
    expect(scriptTrustSubjectKey(trustEntry())).toBe(
      scriptTrustSubjectKey(connectionTrustEntry()),
    );
    expect(scriptTrustSubjectKey(trustEntry())).not.toBe(
      scriptTrustSubjectKey(trustEntry({ kind: "ssh-macro" })),
    );
  });
});

describe("evaluating a run against the record", () => {
  const binding = {
    databaseId: "db-1",
    connectionId: "conn-1",
    endpointDigest: fakeDigest("endpoint-1"),
  };
  const query = (
    overrides: Partial<ScriptTrustQuery> = {},
  ): ScriptTrustQuery => ({
    kind: "ssh-script",
    library: { kind: "app" },
    subjectId: "script-1",
    contentDigest: fakeDigest("content-1"),
    connection: binding,
    ...overrides,
  });

  it("trusts exactly the recorded content, again after a change back (S1)", () => {
    const stored = record(trustEntry());
    expect(evaluateScriptTrust(stored, query())).toBe("everywhere");
    expect(
      evaluateScriptTrust(
        stored,
        query({ contentDigest: fakeDigest("content-edited") }),
      ),
    ).toBeNull();
    // A consult never changes the record, so the original content is trusted again.
    expect(stored).toStrictEqual(record(trustEntry()));
    expect(evaluateScriptTrust(stored, query())).toBe("everywhere");
  });

  it("asks for another connection, a duplicate and the same id in another database (S2)", () => {
    const stored = record(connectionTrustEntry());
    expect(evaluateScriptTrust(stored, query())).toBe("connection");
    for (const connection of [
      { ...binding, connectionId: "conn-2" },
      { ...binding, connectionId: "conn-1-copy" },
      { ...binding, databaseId: "db-2" },
      { ...binding, endpointDigest: fakeDigest("endpoint-edited") },
      null,
    ])
      expect(evaluateScriptTrust(stored, query({ connection }))).toBeNull();
  });

  it("asks for another id, another library and another kind (S3)", () => {
    const stored = record(trustEntry(), connectionTrustEntry());
    for (const change of [
      { subjectId: "script-1-copy" },
      { library: { kind: "database", databaseId: "db-1" } as const },
      { kind: "ssh-macro" as const },
      { kind: "bulk-script" as const },
    ])
      expect(evaluateScriptTrust(stored, query(change))).toBeNull();
    const inDatabase = record(
      trustEntry({ library: { kind: "database", databaseId: "db-1" } }),
    );
    expect(evaluateScriptTrust(inDatabase, query())).toBeNull();
    expect(
      evaluateScriptTrust(
        inDatabase,
        query({ library: { kind: "database", databaseId: "db-2" } }),
      ),
    ).toBeNull();
    expect(
      evaluateScriptTrust(
        inDatabase,
        query({ library: { kind: "database", databaseId: "db-1" } }),
      ),
    ).toBe("everywhere");
  });

  it("reports the connection when both scopes match, and everywhere without a binding", () => {
    const stored = record(trustEntry(), connectionTrustEntry());
    expect(evaluateScriptTrust(stored, query())).toBe("connection");
    expect(
      evaluateScriptTrust(
        record(connectionTrustEntry(), trustEntry()),
        query(),
      ),
    ).toBe("connection");
    expect(evaluateScriptTrust(stored, query({ connection: null }))).toBe(
      "everywhere",
    );
    // The connection entry is for other content: only "everywhere" applies.
    expect(
      evaluateScriptTrust(
        record(
          trustEntry(),
          connectionTrustEntry({ contentDigest: fakeDigest("older") }),
        ),
        query(),
      ),
    ).toBe("everywhere");
  });

  it("trusts nothing from an empty record or for a malformed question", () => {
    expect(evaluateScriptTrust(emptyScriptTrustRecord(), query())).toBeNull();
    const stored = record(trustEntry());
    for (const bad of [
      query({ contentDigest: "" }),
      query({ contentDigest: "*" }),
      query({ subjectId: "" }),
      query({ kind: "anything" as never }),
      query({ library: { kind: "everywhere" } as never }),
      query({ connection: { ...binding, endpointDigest: "x" } }),
      { ...query(), connection: undefined } as never,
      null as never,
    ]) {
      expect(isScriptTrustQuery(bad)).toBe(false);
      expect(evaluateScriptTrust(stored, bad)).toBeNull();
    }
    expect(isScriptTrustQuery(query())).toBe(true);
    expect(isScriptTrustQuery(query({ connection: null }))).toBe(true);
  });
});

describe("building an entry from a grant", () => {
  const everywhere = {
    kind: "ssh-script",
    library: { kind: "app" },
    subjectId: "script-1",
    contentDigest: fakeDigest("content-1"),
    scope: "everywhere",
    risk: "standard",
  } satisfies ScriptTrustGrant;
  const onConnection = {
    kind: "ssh-macro",
    library: { kind: "database", databaseId: "db-1" },
    subjectId: "macro-1",
    contentDigest: fakeDigest("content-2"),
    scope: "connection",
    connection: {
      databaseId: "db-1",
      connectionId: "conn-1",
      endpointDigest: fakeDigest("endpoint-1"),
    },
    risk: "destructive",
  } satisfies ScriptTrustGrant;

  it("holds exactly the named fields, in a fixed order", () => {
    expect(createScriptTrustEntry(everywhere, TRUST_TEST_TIME)).toStrictEqual({
      kind: "ssh-script",
      library: { kind: "app" },
      subjectId: "script-1",
      contentDigest: fakeDigest("content-1"),
      scope: "everywhere",
      risk: "standard",
      grantedAt: TRUST_TEST_TIME,
    });
    const entry = createScriptTrustEntry(onConnection, TRUST_TEST_TIME);
    expect(entry).toStrictEqual({
      kind: "ssh-macro",
      library: { kind: "database", databaseId: "db-1" },
      subjectId: "macro-1",
      contentDigest: fakeDigest("content-2"),
      scope: "connection",
      connection: {
        databaseId: "db-1",
        connectionId: "conn-1",
        endpointDigest: fakeDigest("endpoint-1"),
      },
      risk: "destructive",
      grantedAt: TRUST_TEST_TIME,
    });
    expect(Object.keys(entry!)).toEqual([
      "kind",
      "library",
      "subjectId",
      "contentDigest",
      "scope",
      "connection",
      "risk",
      "grantedAt",
    ]);
  });

  it("copies nothing else a caller hands over", () => {
    const entry = createScriptTrustEntry(
      {
        ...onConnection,
        name: SENTINELS.name,
        script: SENTINELS.script,
        library: {
          kind: "database",
          databaseId: "db-1",
          label: SENTINELS.name,
        },
        connection: {
          ...onConnection.connection,
          hostname: SENTINELS.host,
          username: SENTINELS.user,
        },
      } as ScriptTrustGrant,
      TRUST_TEST_TIME,
    );
    expect(entry).not.toBeNull();
    expect(containsSentinel(JSON.stringify(entry))).toBe(false);
  });

  it("refuses a grant that leaves anything out: there is no default", () => {
    const without = (grant: ScriptTrustGrant, key: string) => {
      const copy: Record<string, unknown> = { ...grant };
      delete copy[key];
      return copy as unknown as ScriptTrustGrant;
    };
    for (const key of [
      "kind",
      "library",
      "subjectId",
      "contentDigest",
      "scope",
      "risk",
    ])
      expect(
        createScriptTrustEntry(without(everywhere, key), TRUST_TEST_TIME),
        key,
      ).toBeNull();
    expect(
      createScriptTrustEntry(
        without(onConnection, "connection"),
        TRUST_TEST_TIME,
      ),
    ).toBeNull();
    for (const key of ["databaseId", "connectionId", "endpointDigest"]) {
      const connection: Record<string, unknown> = {
        ...onConnection.connection,
      };
      delete connection[key];
      expect(
        createScriptTrustEntry(
          { ...onConnection, connection } as unknown as ScriptTrustGrant,
          TRUST_TEST_TIME,
        ),
        key,
      ).toBeNull();
    }
  });

  it("refuses wildcards, patterns and anything out of range", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "everywhere",
      [],
      { ...everywhere, kind: "*" },
      { ...everywhere, kind: "ssh" },
      { ...everywhere, subjectId: "" },
      { ...everywhere, subjectId: "   " },
      { ...everywhere, subjectId: "a".repeat(129) },
      { ...everywhere, subjectId: "line\nbreak" },
      { ...everywhere, subjectId: "tab\tbed" },
      { ...everywhere, subjectId: "del\u007f" },
      { ...everywhere, subjectId: 7 },
      { ...everywhere, subjectId: ["script-1"] },
      { ...everywhere, contentDigest: "*" },
      { ...everywhere, contentDigest: "sha256:" },
      { ...everywhere, contentDigest: `sha256:${"A".repeat(64)}` },
      { ...everywhere, contentDigest: `sha256:${"a".repeat(63)}` },
      { ...everywhere, contentDigest: `sha256:${"a".repeat(65)}` },
      { ...everywhere, contentDigest: `sha1:${"a".repeat(64)}` },
      { ...everywhere, contentDigest: /sha256/ },
      { ...everywhere, scope: "all" },
      { ...everywhere, scope: "*" },
      { ...everywhere, scope: "session" },
      { ...everywhere, risk: "safe" },
      { ...everywhere, library: "app" },
      { ...everywhere, library: { kind: "*" } },
      { ...everywhere, library: { kind: "database" } },
      { ...everywhere, library: { kind: "database", databaseId: "" } },
      { ...everywhere, library: { kind: "app", databaseId: "db-1" } },
      // "everywhere" never carries a connection, a connection grant always does.
      { ...everywhere, connection: onConnection.connection },
      { ...everywhere, connection: null },
      { ...onConnection, connection: null },
      {
        ...onConnection,
        connection: {
          ...onConnection.connection,
          connectionId: "*",
          endpointDigest: "*",
        },
      },
      {
        ...onConnection,
        connection: { ...onConnection.connection, databaseId: "" },
      },
      // A bulk script goes to a selection: it is never bound to one connection,
      // and its library is the app's.
      { ...onConnection, kind: "bulk-script", library: { kind: "app" } },
      {
        ...everywhere,
        kind: "bulk-script",
        library: { kind: "database", databaseId: "db-1" },
      },
    ];
    for (const grant of bad)
      expect(
        createScriptTrustEntry(grant as ScriptTrustGrant, TRUST_TEST_TIME),
        JSON.stringify(grant) ?? String(grant),
      ).toBeNull();
    expect(
      createScriptTrustEntry(
        { ...everywhere, kind: "bulk-script" },
        TRUST_TEST_TIME,
      ),
    ).not.toBeNull();
    for (const time of [
      "",
      "today",
      "2026-10-13",
      "2026-13-40T00:00:00.000Z",
      5,
    ])
      expect(createScriptTrustEntry(everywhere, time as string)).toBeNull();
  });
});

describe("reading a stored record", () => {
  const valid = () => record(trustEntry(), connectionTrustEntry());

  it("returns a valid record unchanged, entry for entry, in a fixed key order", () => {
    const result = sanitizeScriptTrustRecord(valid());
    expect(result).toStrictEqual({ value: valid(), changed: false });
    // Key order on disk does not matter; the result is always canonical.
    const shuffled = {
      entries: [
        {
          grantedAt: TRUST_TEST_TIME,
          risk: "standard",
          scope: "everywhere",
          contentDigest: fakeDigest("content-1"),
          subjectId: "script-1",
          library: { kind: "app" },
          kind: "ssh-script",
        },
      ],
      version: 1,
    };
    const canonical = sanitizeScriptTrustRecord(shuffled).value;
    expect(JSON.stringify(canonical)).toBe(
      JSON.stringify(record(trustEntry())),
    );
    expect(sanitizeScriptTrustRecord(emptyScriptTrustRecord())).toStrictEqual({
      value: { version: 1, entries: [] },
      changed: false,
    });
  });

  it("refuses every foreign shape", () => {
    for (const value of [
      null,
      undefined,
      "",
      "[]",
      7,
      true,
      [],
      [trustEntry()],
      {},
      { entries: [] },
      { version: 1 },
      { version: 1, entries: {} },
      { version: 1, entries: "none" },
      { version: 2, entries: [] },
      { version: "1", entries: [] },
      { version: 0, entries: [] },
      { version: 1, entries: [], recordMetadata: {} },
      { version: 1, entries: [], trustAll: true },
    ])
      expect(
        () => sanitizeScriptTrustRecord(value),
        JSON.stringify(value) ?? String(value),
      ).toThrow(ScriptTrustRecordError);
  });

  it("refuses the whole record when one entry is not valid: nothing in it is trusted", () => {
    const good = trustEntry();
    const bad: unknown[] = [
      null,
      "ssh-script",
      [],
      {},
      { ...good, kind: "ssh" },
      { ...good, kind: undefined },
      { ...good, library: { kind: "everywhere" } },
      { ...good, library: { kind: "database" } },
      { ...good, library: { kind: "app", databaseId: "db-1" } },
      { ...good, subjectId: "" },
      { ...good, subjectId: "x".repeat(129) },
      { ...good, subjectId: "a\u0000b" },
      { ...good, subjectId: "a\rb" },
      { ...good, contentDigest: "sha256:xyz" },
      { ...good, contentDigest: fakeDigest("content-1").toUpperCase() },
      { ...good, scope: "session" },
      { ...good, scope: "connection" },
      { ...good, connection: connectionTrustEntry().connection },
      { ...good, risk: "low" },
      { ...good, risk: undefined },
      { ...good, grantedAt: "yesterday" },
      { ...good, grantedAt: 1760000000000 },
      { ...good, grantedAt: undefined },
      { ...good, name: "Nightly cleanup" },
      { ...good, script: "echo" },
      { ...good, hostname: "host-a.example" },
      {
        ...connectionTrustEntry(),
        connection: { databaseId: "db-1", connectionId: "conn-1" },
      },
      {
        ...connectionTrustEntry(),
        connection: {
          ...connectionTrustEntry().connection,
          endpointDigest: "sha256:0",
        },
      },
      {
        ...connectionTrustEntry(),
        connection: {
          ...connectionTrustEntry().connection,
          host: "host-a.example",
        },
      },
      {
        ...connectionTrustEntry(),
        connection: {
          ...connectionTrustEntry().connection,
          connectionId: "a\nb",
        },
      },
      { ...connectionTrustEntry(), connection: null },
      { ...connectionTrustEntry(), kind: "bulk-script" },
      {
        ...good,
        kind: "bulk-script",
        library: { kind: "database", databaseId: "db-1" },
      },
    ];
    for (const entry of bad) {
      const label = JSON.stringify(entry) ?? String(entry);
      // Alone, first, last and between two valid entries.
      for (const entries of [
        [entry],
        [entry, good],
        [good, entry],
        [good, entry, connectionTrustEntry()],
      ])
        expect(
          () => sanitizeScriptTrustRecord({ version: 1, entries }),
          label,
        ).toThrow(ScriptTrustRecordError);
    }
  });

  it("refuses two entries with one key and more than 1,000 entries", () => {
    expect(() =>
      sanitizeScriptTrustRecord(
        record(trustEntry(), trustEntry({ contentDigest: fakeDigest("b") })),
      ),
    ).toThrow(ScriptTrustRecordError);
    const many = (total: number) =>
      record(
        ...Array.from({ length: total }, (_, index) =>
          trustEntry({ subjectId: `script-${index}` }),
        ),
      );
    expect(
      sanitizeScriptTrustRecord(many(MAX_SCRIPT_TRUST_ENTRIES)).value.entries,
    ).toHaveLength(MAX_SCRIPT_TRUST_ENTRIES);
    expect(() =>
      sanitizeScriptTrustRecord(many(MAX_SCRIPT_TRUST_ENTRIES + 1)),
    ).toThrow(ScriptTrustRecordError);
  });

  it("parses stored text with the same rules, and refuses oversized text unparsed", () => {
    expect(parseScriptTrustRecord(JSON.stringify(valid()))).toStrictEqual(
      valid(),
    );
    for (const raw of [
      "",
      "{",
      "null",
      '"text"',
      "[]",
      '{"version":2,"entries":[]}',
      `{"version":1,"entries":[${JSON.stringify(trustEntry())},{}]}`,
    ])
      expect(() => parseScriptTrustRecord(raw), raw).toThrow(
        ScriptTrustRecordError,
      );
    for (const notText of [null, undefined, 5, {}, valid()])
      expect(() => parseScriptTrustRecord(notText as never)).toThrow(
        ScriptTrustRecordError,
      );
    // Valid JSON for a valid record, padded past the limit with white space.
    const padded =
      JSON.stringify(valid()) + " ".repeat(MAX_SCRIPT_TRUST_RECORD_CHARS);
    expect(JSON.parse(padded)).toStrictEqual(valid());
    expect(() => parseScriptTrustRecord(padded)).toThrow(
      ScriptTrustRecordError,
    );
  });

  it("leaves room under the text limit for 1,000 entries of the longest ids", () => {
    const longest = (index: number) =>
      `${String(index).padStart(4, "0")}${'"'.repeat(124)}`;
    const full = record(
      ...Array.from({ length: MAX_SCRIPT_TRUST_ENTRIES }, (_, index) =>
        connectionTrustEntry({
          kind: "ssh-macro",
          library: { kind: "database", databaseId: longest(index) },
          subjectId: longest(index),
          risk: "destructive",
          connection: {
            databaseId: longest(index),
            connectionId: longest(index),
            endpointDigest: fakeDigest("endpoint-1"),
          },
        }),
      ),
    );
    const raw = JSON.stringify(full);
    expect(raw.length).toBeLessThan(MAX_SCRIPT_TRUST_RECORD_CHARS);
    expect(parseScriptTrustRecord(raw).entries).toHaveLength(
      MAX_SCRIPT_TRUST_ENTRIES,
    );
  });

  it("says nothing about the content it refused", () => {
    const planted = {
      version: 1,
      entries: [
        {
          ...trustEntry(),
          subjectId: SENTINELS.script,
          name: SENTINELS.name,
          hostname: SENTINELS.host,
          username: SENTINELS.user,
        },
      ],
    };
    const messages: string[] = [];
    for (const attempt of [
      () => sanitizeScriptTrustRecord(planted),
      () => parseScriptTrustRecord(JSON.stringify(planted)),
      () => parseScriptTrustRecord(`{"oops": "${SENTINELS.host}"`),
    ]) {
      try {
        attempt();
      } catch (error) {
        expect(error).toBeInstanceOf(ScriptTrustRecordError);
        messages.push(
          `${(error as Error).message} ${String(error)} ${JSON.stringify(error)}`,
        );
        expect((error as { cause?: unknown }).cause).toBeUndefined();
      }
    }
    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
    expect(messages.some(containsSentinel)).toBe(false);
  });
});

describe("what the record can hold (S8)", () => {
  it("serialises with no script text, step, name, host, user or credential id", async () => {
    const scriptDigest = await digestRunContent(
      "ssh-script",
      sshScriptRunContent(
        "bash",
        sshScriptCommand(`#!/bin/bash\n${SENTINELS.script}`),
      ),
    );
    const macroDigest = await digestRunContent(
      "ssh-macro",
      sshMacroRunContent([step(SENTINELS.step, 10)]),
    );
    const bulkDigest = await digestRunContent(
      "bulk-script",
      bulkScriptRunContent(` ${SENTINELS.script} `),
    );
    const endpointDigest = await digestConnectionEndpoint({
      databaseId: "db-1",
      connectionId: "conn-1",
      protocol: "ssh",
      host: SENTINELS.host,
      port: 22,
      username: SENTINELS.user,
      domain: SENTINELS.domain,
      credentialKind: "vault",
      credentialId: SENTINELS.credential,
    });
    const entries = [
      createScriptTrustEntry(
        {
          kind: "ssh-script",
          library: { kind: "app" },
          subjectId: "script-1",
          contentDigest: scriptDigest,
          scope: "connection",
          connection: {
            databaseId: "db-1",
            connectionId: "conn-1",
            endpointDigest,
          },
          risk: classifyRunRisk({
            kind: "ssh-script",
            command: SENTINELS.script,
          }),
        },
        TRUST_TEST_TIME,
      ),
      createScriptTrustEntry(
        {
          kind: "ssh-macro",
          library: { kind: "database", databaseId: "db-1" },
          subjectId: "macro-1",
          contentDigest: macroDigest,
          scope: "everywhere",
          risk: "destructive",
        },
        TRUST_TEST_TIME,
      ),
      createScriptTrustEntry(
        {
          kind: "bulk-script",
          library: { kind: "app" },
          subjectId: "default-3",
          contentDigest: bulkDigest,
          scope: "everywhere",
          risk: "destructive",
        },
        TRUST_TEST_TIME,
      ),
    ];
    expect(entries.every(Boolean)).toBe(true);
    const stored = sanitizeScriptTrustRecord({ version: 1, entries }).value;
    const text = JSON.stringify(stored);
    expect(containsSentinel(text)).toBe(false);
    // Every string in the record is an id, a digest or one of a few fixed words.
    const strings: string[] = [];
    JSON.parse(text, (_key, value) => {
      if (typeof value === "string") strings.push(value);
      return value;
    });
    for (const value of strings)
      expect(value).toMatch(
        /^(sha256:[0-9a-f]{64}|ssh-script|ssh-macro|bulk-script|app|database|everywhere|connection|standard|destructive|db-1|conn-1|script-1|macro-1|default-3|2026-10-13T09:30:00\.000Z)$/,
      );
  });
});
