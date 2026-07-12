import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
  isTauri: () => true,
}));

// The .kdbx file picker — not exercised in this smoke test (we type the path).
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import { KeepassPanel, keepassDescriptor } from "./KeepassPanel";

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

describe("keepassDescriptor", () => {
  it("registers under the vault category with the keepass key", () => {
    expect(keepassDescriptor.key).toBe("keepass");
    expect(keepassDescriptor.category).toBe("vault");
    expect(typeof keepassDescriptor.importPanel).toBe("function");
  });
});

describe("KeepassPanel shell", () => {
  it("maps Open to keepass_open_database with the composite key", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_app_data") return Promise.resolve(null);
      if (cmd === "keepass_open_database")
        return Promise.resolve({
          id: "db-1",
          filePath: "/vault.kdbx",
          name: "vault",
          entryCount: 3,
        });
      return Promise.resolve(undefined);
    });

    render(<KeepassPanel isOpen onClose={() => {}} />);

    fireEvent.change(await screen.findByTestId("keepass-kdbx-path"), {
      target: { value: "/vault.kdbx" },
    });
    fireEvent.change(screen.getByTestId("keepass-master-password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByTestId("keepass-open"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("keepass_open_database", {
        req: expect.objectContaining({
          filePath: "/vault.kdbx",
          password: "hunter2",
        }),
      }),
    );

    // Header for the open database renders (entry count from the mock).
    expect(await screen.findByText("vault")).toBeInTheDocument();
  });
});
