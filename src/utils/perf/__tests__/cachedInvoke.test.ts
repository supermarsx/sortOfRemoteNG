import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn(async (_cmd: string, _args?: unknown) => ({ ok: 1 }));
vi.mock("../../tauri/invoke", () => ({
  getInvoke: async () => invokeMock,
}));

import {
  cacheKeyFor,
  cachedInvoke,
  setCacheScope,
  stableStringify,
} from "../cachedInvoke";
import { queryStore } from "../queryStore";
import { cacheRefusalReason } from "../safety";

beforeEach(() => {
  invokeMock.mockClear();
  setCacheScope("");
  queryStore.clearAll();
});
afterEach(() => queryStore.clearAll());

describe("cachedInvoke", () => {
  it("dedupes concurrent identical reads and ignores key order", async () => {
    await Promise.all([
      cachedInvoke("dash_get_status", { a: 1, b: 2 }),
      cachedInvoke("dash_get_status", { b: 2, a: 1 }),
      cachedInvoke("dash_get_status", { a: 1, b: 2 }),
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await cachedInvoke("dash_get_status", { a: 1, b: 2 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    await cachedInvoke("dash_get_status", { a: 9 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("force bypasses a fresh entry", async () => {
    await cachedInvoke("dash_get_status");
    await cachedInvoke("dash_get_status", undefined, { force: true });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("refuses real-time, write and secret commands", async () => {
    for (const cmd of [
      "ssh_send_input",
      "ssh_resize_terminal",
      "serial_write",
      "rdp_send_input",
      "rdp_get_frame",
      "telnet_send",
      "save_settings",
      "delete_connection",
      "connect_ssh",
      "vault_list_entries",
      "get_password",
      "totp_generate_code",
      "dek_status",
      "get_credentials",
    ]) {
      expect(cacheRefusalReason(cmd), cmd).not.toBeNull();
      await expect(cachedInvoke(cmd)).rejects.toThrow(/refuses/);
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("accepts plain background reads", () => {
    for (const cmd of [
      "list_rdp_sessions",
      "get_rdp_stats",
      "dash_get_overview",
      "proxmox_list_nodes",
      "application_logs_list",
    ])
      expect(cacheRefusalReason(cmd), cmd).toBeNull();
  });

  it("passes refused commands through uncached in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await cachedInvoke("save_settings", { a: 1 });
      await cachedInvoke("save_settings", { a: 1 });
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(queryStore.size).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("changing the cache scope clears the cache and namespaces keys", async () => {
    await cachedInvoke("dash_get_status");
    const k1 = cacheKeyFor("dash_get_status");
    setCacheScope("db-2");
    expect(queryStore.size).toBe(0);
    expect(cacheKeyFor("dash_get_status")).not.toBe(k1);
  });

  it("stableStringify sorts keys and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: undefined } })).toBe(
      '{"a":{"d":1},"b":1}',
    );
  });
});
