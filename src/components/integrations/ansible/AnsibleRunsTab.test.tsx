import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

import { ansibleRunsApi } from "../../../hooks/integration/ansible/useAnsibleRuns";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("ansibleRunsApi bindings", () => {
  it("binds all 27 runs-category commands", () => {
    // 9 inventory + 7 playbooks + 6 ad-hoc + 2 facts + 3 history.
    expect(Object.keys(ansibleRunsApi)).toHaveLength(27);
  });

  it("passes camelCase command args and snake-case struct payloads", () => {
    ansibleRunsApi.adhocShell("sess", "web", "uptime", undefined, true);
    expect(invokeMock).toHaveBeenCalledWith("ansible_adhoc_shell", {
      id: "sess",
      pattern: "web",
      command: "uptime",
      inventory: undefined,
      useBecome: true,
    });

    ansibleRunsApi.adhocPackage("sess", "web", "nginx", "present");
    expect(invokeMock).toHaveBeenCalledWith("ansible_adhoc_package", {
      id: "sess",
      pattern: "web",
      package: "nginx",
      packageState: "present",
      inventory: undefined,
    });

    ansibleRunsApi.historyGet("exec-1");
    expect(invokeMock).toHaveBeenCalledWith("ansible_history_get", {
      execId: "exec-1",
    });

    // Path-based inventory mutation uses `path`, not the session id.
    ansibleRunsApi.inventoryRemoveHost("/etc/ansible/hosts", "db1");
    expect(invokeMock).toHaveBeenCalledWith("ansible_inventory_remove_host", {
      path: "/etc/ansible/hosts",
      host: "db1",
    });
  });
});
