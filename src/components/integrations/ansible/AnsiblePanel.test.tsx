import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory (hoisted above imports) can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import AnsiblePanel from "./AnsiblePanel";
import { ansibleDescriptor } from "./descriptor";

beforeEach(() => {
  invokeMock.mockReset();
  (
    globalThis as unknown as {
      __TAURI__?: { core: { invoke: typeof invokeMock } };
    }
  ).__TAURI__ = {
    core: {
      invoke: ((cmd: string, args?: Record<string, unknown>) =>
        invokeMock(cmd, args)) as unknown as typeof invokeMock,
    },
  };
});

describe("AnsiblePanel (shell)", () => {
  it("exports an infra descriptor keyed 'ansible'", () => {
    expect(ansibleDescriptor.key).toBe("ansible");
    expect(ansibleDescriptor.category).toBe("infra");
    expect(typeof ansibleDescriptor.importPanel).toBe("function");
  });

  it("renders the connect form with control-node fields", async () => {
    invokeMock.mockResolvedValue(null); // read_app_data -> no instances
    render(<AnsiblePanel isOpen onClose={() => {}} />);
    expect(await screen.findByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("ansible.cfg path")).toBeInTheDocument();
    expect(screen.getByText("Default inventory")).toBeInTheDocument();
  });

  it("persists config (no secret) and maps connect to ansible_connect", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "read_app_data":
          return Promise.resolve(null);
        case "ansible_connect":
          return Promise.resolve({
            version: "2.16.3",
            python_version: "3.11.6",
            config_file: "/etc/ansible/ansible.cfg",
            default_module_path: null,
            executable: "/usr/bin/ansible",
            available_modules: [],
            available_plugins: [],
          });
        default:
          return Promise.resolve(undefined);
      }
    });

    render(<AnsiblePanel isOpen onClose={() => {}} />);
    await screen.findByText("Connect");

    fireEvent.change(screen.getByPlaceholderText("control-node"), {
      target: { value: "prod" },
    });
    fireEvent.click(screen.getByText("Connect"));

    // Connect maps to ansible_connect with the snake_case config payload.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "ansible_connect",
        expect.objectContaining({
          id: expect.any(String),
          config: expect.objectContaining({
            name: "prod",
            ask_vault_pass: false,
          }),
        }),
      ),
    );

    // Non-secret config persisted; Ansible stores NO vault secret.
    expect(invokeMock).toHaveBeenCalledWith(
      "write_app_data",
      expect.objectContaining({ key: "integrations.instances" }),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "vault_store_secret",
      expect.anything(),
    );
  });
});
