import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

import { ansibleContentApi } from "../../../hooks/integration/ansible/useAnsibleContent";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("ansibleContentApi bindings", () => {
  it("binds all 28 content-category commands", () => {
    // 5 roles + 6 vault + 9 galaxy + 8 config & modules.
    expect(Object.keys(ansibleContentApi)).toHaveLength(28);
  });

  it("maps command args to the camelCase keys the Rust params expect", () => {
    ansibleContentApi.rolesList("/opt/roles");
    expect(invokeMock).toHaveBeenCalledWith("ansible_roles_list", {
      rolesPath: "/opt/roles",
    });

    ansibleContentApi.vaultEncrypt("sess", "secrets.yml", "pw.txt", "prod");
    expect(invokeMock).toHaveBeenCalledWith("ansible_vault_encrypt", {
      id: "sess",
      filePath: "secrets.yml",
      vaultPasswordFile: "pw.txt",
      vaultId: "prod",
    });

    ansibleContentApi.galaxyInstallRequirements("sess", "req.yml", true);
    expect(invokeMock).toHaveBeenCalledWith(
      "ansible_galaxy_install_requirements",
      { id: "sess", requirementsPath: "req.yml", force: true },
    );

    ansibleContentApi.listPlugins("sess", "callback");
    expect(invokeMock).toHaveBeenCalledWith("ansible_list_plugins", {
      id: "sess",
      pluginType: "callback",
    });
  });
});
