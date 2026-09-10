import { afterEach, describe, expect, it } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  clearRuntimeConnectionsForTests,
  getRuntimeWebNavigation,
  registerRuntimeConnection,
  releaseReplacedRuntimeConnection,
  resolveRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const connection: Connection = {
  id: "ephemeral-source",
  name: "Redirect",
  protocol: "https",
  hostname: "example.test",
  port: 443,
  isGroup: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  username: "OLD_USER",
  password: "OLD_SECRET",
};
function session(id: string): ConnectionSession {
  return {
    id,
    connectionId: connection.id,
    name: "Redirect",
    protocol: "https",
    hostname: connection.hostname,
    status: "connected",
    startTime: new Date(),
  };
}
afterEach(clearRuntimeConnectionsForTests);
describe("same-tab redirect registry cleanup", () => {
  it("releases the replaced ephemeral credentials and navigation guard when there is no other owner", () => {
    registerRuntimeConnection(connection, {
      initialUrl: "https://example.test/",
      redirectHops: 1,
      assertCurrent: () => undefined,
    });
    expect(
      releaseReplacedRuntimeConnection(connection.id, "replaced", [
        session("replaced"),
      ]),
    ).toBe(true);
    expect(resolveRuntimeConnection([], connection.id)).toBeUndefined();
    expect(getRuntimeWebNavigation(connection.id)).toBeUndefined();
    expect(resolveRuntimeConnection([connection], connection.id)).toBe(
      connection,
    );
  });
  it("retains the exact old definition while another tab still uses it", () => {
    registerRuntimeConnection(connection);
    expect(
      releaseReplacedRuntimeConnection(connection.id, "replaced", [
        session("replaced"),
        session("other"),
      ]),
    ).toBe(false);
    expect(resolveRuntimeConnection([], connection.id)).toBe(connection);
    expect(
      releaseReplacedRuntimeConnection(connection.id, "other", [
        session("other"),
      ]),
    ).toBe(true);
    expect(resolveRuntimeConnection([], connection.id)).toBeUndefined();
  });
});
