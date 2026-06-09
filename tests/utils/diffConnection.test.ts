/**
 * Unit tests for the connection-edit diff helper (P9).
 *
 * The diff produces the human-readable lines that go into the audit
 * log when a connection is updated. The big-picture contract:
 *
 * - Field-level granularity (per-field deltas, not "something changed")
 * - Secrets are masked (no plaintext password ever in the log)
 * - Noise fields like `updatedAt` are filtered out
 * - Structural fields (tags, security, proxy) report a single boolean
 *   delta when anything inside changes
 */
import { describe, it, expect } from "vitest";
import {
  diffConnection,
  formatConnectionDiff,
} from "../../src/utils/connection/diffConnection";
import type { Connection } from "../../src/types/connection/connection";

function makeConn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Server",
    protocol: "rdp",
    hostname: "host",
    port: 3389,
    createdAt: new Date("2026-01-01").toISOString(),
    updatedAt: new Date("2026-01-01").toISOString(),
    isGroup: false,
    ...overrides,
  } as Connection;
}

describe("diffConnection", () => {
  it("returns empty for no changes", () => {
    const conn = makeConn();
    expect(diffConnection(conn, conn)).toEqual([]);
  });

  it("returns empty when only updatedAt changed", () => {
    const before = makeConn({ updatedAt: "2026-01-01T00:00:00Z" });
    const after = makeConn({ updatedAt: "2026-01-02T00:00:00Z" });
    expect(diffConnection(before, after)).toEqual([]);
  });

  it("returns empty when before is undefined (new connection)", () => {
    // Diff against undefined → empty (the caller logs "created"
    // separately; this helper is only for updates).
    expect(diffConnection(undefined, makeConn())).toEqual([]);
  });

  it("captures a name change", () => {
    const before = makeConn({ name: "Old" });
    const after = makeConn({ name: "New" });
    const d = diffConnection(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe("name");
    expect(d[0].before).toBe('"Old"');
    expect(d[0].after).toBe('"New"');
    expect(d[0].secret).toBe(false);
  });

  it("captures a port change with numeric values", () => {
    const before = makeConn({ port: 22 });
    const after = makeConn({ port: 2222 });
    const d = diffConnection(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe("port");
    expect(d[0].before).toBe("22");
    expect(d[0].after).toBe("2222");
  });

  it("captures multiple field changes in one diff", () => {
    const before = makeConn({ name: "A", hostname: "host-a", port: 22 });
    const after = makeConn({ name: "B", hostname: "host-b", port: 2222 });
    const fields = diffConnection(before, after).map((d) => d.field).sort();
    expect(fields).toEqual(["hostname", "name", "port"]);
  });

  it("masks password changes — never prints the value", () => {
    const before = makeConn({ password: "secret1" } as Partial<Connection>);
    const after = makeConn({ password: "secret2" } as Partial<Connection>);
    const d = diffConnection(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe("password");
    expect(d[0].before).toBeNull();
    expect(d[0].after).toBeNull();
    expect(d[0].secret).toBe(true);
  });

  it("masks every secret field in SECRET_FIELDS", () => {
    const secrets = [
      "password",
      "basicAuthPassword",
      "bearerToken",
      "privateKey",
      "passphrase",
      "vncPassword",
      "rdpPassword",
      "apiKey",
      "totpSecret",
    ];
    for (const field of secrets) {
      const before = makeConn({ [field]: "before" } as Partial<Connection>);
      const after = makeConn({ [field]: "after" } as Partial<Connection>);
      const d = diffConnection(before, after);
      expect(d).toHaveLength(1);
      expect(d[0].field).toBe(field);
      expect(d[0].secret).toBe(true);
      expect(d[0].before).toBeNull();
      expect(d[0].after).toBeNull();
    }
  });

  it("treats empty-string and undefined as equal (no spurious delta)", () => {
    const before = makeConn({ description: undefined } as Partial<Connection>);
    const after = makeConn({ description: "" } as Partial<Connection>);
    expect(diffConnection(before, after)).toEqual([]);
  });

  it("reports tags as a single structural change when contents differ", () => {
    const before = makeConn({ tags: ["prod"] } as Partial<Connection>);
    const after = makeConn({ tags: ["prod", "linux"] } as Partial<Connection>);
    const d = diffConnection(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe("tags");
    expect(d[0].before).toBeNull();
    expect(d[0].after).toBeNull();
  });

  it("ignores tag reordering equal contents (JSON-stringify based)", () => {
    // We use JSON.stringify so reordering DOES count as a change.
    // Asserting current behaviour — caller can swap to a set-based
    // compare later if that turns out to be the wrong call.
    const before = makeConn({ tags: ["a", "b"] } as Partial<Connection>);
    const after = makeConn({ tags: ["b", "a"] } as Partial<Connection>);
    expect(diffConnection(before, after)).toHaveLength(1);
  });

  it("captures parentId change (folder move)", () => {
    const before = makeConn({ parentId: "f1" } as Partial<Connection>);
    const after = makeConn({ parentId: "f2" } as Partial<Connection>);
    const d = diffConnection(before, after);
    expect(d).toHaveLength(1);
    expect(d[0].field).toBe("parentId");
    expect(d[0].before).toBe('"f1"');
    expect(d[0].after).toBe('"f2"');
  });
});

describe("formatConnectionDiff", () => {
  it('returns "no changes" for empty input', () => {
    expect(formatConnectionDiff([])).toBe("no changes");
  });

  it("joins per-field lines with commas", () => {
    const out = formatConnectionDiff([
      { field: "name", before: '"A"', after: '"B"', secret: false },
      { field: "port", before: "22", after: "2222", secret: false },
    ]);
    expect(out).toBe('name: "A" → "B", port: 22 → 2222');
  });

  it("uses 'changed' shorthand for secrets — no values", () => {
    const out = formatConnectionDiff([
      { field: "password", before: null, after: null, secret: true },
      { field: "name", before: '"A"', after: '"B"', secret: false },
    ]);
    expect(out).toBe('password changed, name: "A" → "B"');
    // Critical: no plaintext secret in the rendered string.
    expect(out).not.toContain("secret");
  });

  it("uses 'changed' shorthand for structural (tags) deltas", () => {
    const out = formatConnectionDiff([
      { field: "tags", before: null, after: null, secret: false },
    ]);
    expect(out).toBe("tags changed");
  });
});
