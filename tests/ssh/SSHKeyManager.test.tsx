import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SSHKeyManager } from "../../src/components/ssh/SSHKeyManager";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(),
  join: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

async function renderOpenKeyManager({
  onClose = () => {},
  onSelectKey = () => {},
  expectedKeyName,
}: {
  onClose?: () => void;
  onSelectKey?: () => void;
  expectedKeyName?: string;
} = {}) {
  const view = render(
    <SSHKeyManager isOpen={true} onClose={onClose} onSelectKey={onSelectKey} />,
  );
  if (expectedKeyName) {
    await screen.findByText(expectedKeyName);
  } else {
    await screen.findByText("No SSH keys found");
  }
  return view;
}

describe("SSHKeyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appDataDir).mockResolvedValue("/app/data");
    vi.mocked(join).mockImplementation(async (...parts) => parts.join("/"));
    vi.mocked(exists).mockImplementation(async (path) =>
      String(path).endsWith("/ssh-keys"),
    );
    vi.mocked(readTextFile).mockResolvedValue("[]");
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "validate_ssh_key_file") return true;
      return undefined;
    });
  });

  it("renders when open", async () => {
    const view = await renderOpenKeyManager();
    expect(screen.getByText("SSH Key Manager")).toBeInTheDocument();
    act(() => view.unmount());
  });

  it("does not render when closed", () => {
    render(
      <SSHKeyManager
        isOpen={false}
        onClose={() => {}}
        onSelectKey={() => {}}
      />,
    );
    expect(screen.queryByText("SSH Key Manager")).not.toBeInTheDocument();
  });

  it("loads existing keys on mount", async () => {
    vi.mocked(readTextFile).mockResolvedValue(
      JSON.stringify([
        {
          id: "managed-key-1",
          name: "my_key",
          type: "rsa",
          publicKey: "ssh-rsa AAAA... my_key",
          privateKeyPath: "/app/data/ssh-keys/my_key",
          fingerprint: "SHA256:12:34:56:78",
          createdAt: "2026-07-01T00:00:00.000Z",
          hasPassphrase: false,
        },
      ]),
    );
    vi.mocked(exists).mockResolvedValue(true);

    const view = await renderOpenKeyManager({ expectedKeyName: "my_key" });

    expect(screen.getByText("my_key")).toBeInTheDocument();
    act(() => view.unmount());
  });

  it("has generate key button", async () => {
    const view = await renderOpenKeyManager();

    expect(screen.getByText("Generate Key")).toBeInTheDocument();
    act(() => view.unmount());
  });

  it("passes the typed passphrase into managed key generation", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_ssh_key") {
        return ["PRIVATE KEY", "ssh-ed25519 AAAA managed-key"] as [
          string,
          string,
        ];
      }
      if (command === "validate_ssh_key_file") return true;
      return undefined;
    });

    const view = await renderOpenKeyManager();

    fireEvent.click(screen.getByText("Generate Key"));
    fireEvent.change(screen.getByPlaceholderText("my-server-key"), {
      target: { value: "prod-key" },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional passphrase"), {
      target: { value: "top-secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm passphrase"), {
      target: { value: "top-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("generate_ssh_key", {
        keyType: "ed25519",
        bits: undefined,
        passphrase: "top-secret",
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("Confirm passphrase"),
      ).not.toBeInTheDocument();
    });
    act(() => view.unmount());
  });

  it("imports SSH key from file", async () => {
    vi.mocked(open).mockResolvedValue("/path/to/key");
    vi.mocked(readTextFile).mockResolvedValue("ssh-rsa AAAA... imported-key");
    vi.mocked(exists).mockResolvedValue(false);

    const view = await renderOpenKeyManager();

    const importButton = screen.getByText("Import Key");
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(open).toHaveBeenCalled();
      expect(readTextFile).toHaveBeenCalledWith("/path/to/key");
      expect(screen.getByText("key")).toBeInTheDocument();
      expect(writeTextFile).toHaveBeenCalledWith(
        "/app/data/ssh-keys/keys.json",
        expect.any(String),
        { mode: 0o600 },
      );
    });
    act(() => view.unmount());
  });

  it("has close button", async () => {
    const onClose = vi.fn();
    const view = await renderOpenKeyManager({ onClose });

    // Find the close button at bottom
    const closeButton = screen.getByText("Close");
    expect(closeButton).toBeInTheDocument();
    act(() => view.unmount());
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const view = await renderOpenKeyManager({ onClose });
    const { container } = view;

    await screen.findByText("SSH Key Manager");
    const backdrop = document.body.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
    act(() => view.unmount());
  });

  it("does not close on Escape key", async () => {
    const onClose = vi.fn();
    const view = await renderOpenKeyManager({ onClose });

    await screen.findByText("SSH Key Manager");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    act(() => view.unmount());
  });
});
