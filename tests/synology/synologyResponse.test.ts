import { describe, expect, it } from "vitest";
import { validateSynologyAdminResponse } from "../../src/hooks/synology/synologyResponse";
import type {
  ConnectionEntry,
  LogEntry,
  SynoGroup,
  SynoUser,
} from "../../src/types/hardware/synology";

const INVALID_COLLECTION =
  "The NAS returned an invalid collection. Update the desktop application or check package compatibility.";

describe("Synology admin response boundary", () => {
  it("accepts system logs without an id, as the native DTO serializes DSM log items", () => {
    const logs: LogEntry[] = [
      {
        id: null,
        time: "2026/09/15 08:00:00",
        msg: "System started",
        level: "info",
        user: "SYSTEM",
        event: null,
        logType: "system",
      },
      { time: "2026/09/15 08:01:00", msg: "Absent id key", level: "warn" },
    ];
    expect(() =>
      validateSynologyAdminResponse("syn_get_system_logs", logs),
    ).not.toThrow();
  });

  it("still accepts system logs that carry a numeric id", () => {
    expect(() =>
      validateSynologyAdminResponse("syn_get_system_logs", [
        { id: 7, time: "12:34", msg: "Native log message", level: "info" },
      ]),
    ).not.toThrow();
  });

  it.each([
    [{ id: 1, msg: "No time", level: "info" }],
    [{ id: null, time: null, msg: "Null time", level: "info" }],
    [{ time: { value: "12:34" }, msg: "Object time", level: "info" }],
  ])("rejects a system log row without a usable time %j", (row) => {
    expect(() =>
      validateSynologyAdminResponse("syn_get_system_logs", [
        { time: "12:00", msg: "ok", level: "info" },
        row,
      ]),
    ).toThrow(INVALID_COLLECTION);
  });

  it("accepts users without uid and groups without members", () => {
    const users: SynoUser[] = [
      { name: "alice", uid: null, description: "Operator" },
      { name: "bob" },
    ];
    const groups: SynoGroup[] = [
      { name: "staff", gid: 100, members: null },
      { name: "admins", gid: 101 },
    ];
    expect(() =>
      validateSynologyAdminResponse("syn_list_users", users),
    ).not.toThrow();
    expect(() =>
      validateSynologyAdminResponse("syn_list_groups", groups),
    ).not.toThrow();
    expect(() =>
      validateSynologyAdminResponse("syn_list_users", [{ uid: 1026 }]),
    ).toThrow(INVALID_COLLECTION);
  });

  it("accepts connections whose login and success flags DSM does not report", () => {
    const connections: ConnectionEntry[] = [
      {
        time: "1757894400",
        ip: "192.0.2.4",
        user: "alice",
        type: "HTTP/HTTPS",
        isLogin: null,
        success: null,
        description: "DSM",
        protocol: "HTTPS",
        canBeKicked: true,
      },
    ];
    for (const command of [
      "syn_get_connection_logs",
      "syn_get_active_connections",
    ])
      expect(() =>
        validateSynologyAdminResponse(command, connections),
      ).not.toThrow();
    expect(() =>
      validateSynologyAdminResponse("syn_get_active_connections", [
        { time: "1757894400", ip: null, user: "alice", type: "HTTP" },
      ]),
    ).toThrow(INVALID_COLLECTION);
  });

  it("rejects a collection command that returns a non-array or a non-object row", () => {
    for (const value of [{ items: [] }, null, "rows", [null], [["time"]]])
      expect(() =>
        validateSynologyAdminResponse("syn_get_system_logs", value),
      ).toThrow(INVALID_COLLECTION);
  });

  it("keeps the system information check unchanged", () => {
    expect(() =>
      validateSynologyAdminResponse("syn_get_system_info", {
        model: "DS923+",
      }),
    ).not.toThrow();
    for (const value of [null, [], {}, { model: 923 }])
      expect(() =>
        validateSynologyAdminResponse("syn_get_system_info", value),
      ).toThrow("The NAS returned invalid system information.");
  });

  it("passes commands without a boundary check through", () => {
    expect(() =>
      validateSynologyAdminResponse("syn_check_update", {
        update: { available: false },
      }),
    ).not.toThrow();
  });
});
