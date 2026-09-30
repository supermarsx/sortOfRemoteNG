import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { ProxyProfileEditor } from "../../src/components/network/ProxyProfileEditor";
import { SshJumpLayerConfig } from "../../src/components/network/proxyChainMenu/tunnelChainShared";
import type { SavedProxyProfile } from "../../src/types/settings/settings";
import type { Connection } from "../../src/types/connection/connection";

afterEach(cleanup);
const base = {
  id: "base",
  name: "Bastion",
  protocol: "ssh",
  hostname: "saved.test",
  port: 22,
  username: "saved-user",
  password: "saved-secret",
} as Connection;
function fixture(config: Partial<SavedProxyProfile["config"]> = {}) {
  const context = {
    state: {
      connections: [
        base,
        { ...base, id: "other", name: "Not SSH", protocol: "rdp" },
        { ...base, id: "group", name: "Folder", isGroup: true },
      ],
    },
    databaseAvailability: { status: "ready", databaseId: "db", generation: 1 },
  } as ConnectionContextType;
  const onSave = vi.fn();
  const profile = {
    id: "profile",
    name: "Proxy",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: {
      type: "ssh",
      enabled: true,
      host: "inline.test",
      port: 22,
      username: "alice",
      password: "inline-secret",
      sshAuthMethod: "password",
      ...config,
    },
  } as SavedProxyProfile;
  const renderEditor = () => (
    <ConnectionContext.Provider value={context}>
      <ProxyProfileEditor
        isOpen
        onClose={() => {}}
        onSave={onSave}
        editingProfile={profile}
      />
    </ConnectionContext.Provider>
  );
  const view = render(renderEditor());
  return { context, onSave, view, renderEditor };
}

describe("SSH proxy source controls", () => {
  it("saves standalone password authentication and removes a stale key", () => {
    const { onSave } = fixture({
      sshKeyFile: "stale-key",
      sshKeyPassphrase: "stale-passphrase",
    });
    expect(
      screen.getByRole("combobox", { name: "SSH authentication" }),
    ).toHaveTextContent("Password");
    expect(
      screen.getByRole("combobox", { name: "SSH authentication" }),
    ).toHaveClass("sor-form-select");
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByLabelText("SSH key file")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("SSH password"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));
    const config = onSave.mock.calls[0][0].config;
    expect(config).toMatchObject({
      username: "alice",
      password: "new-password",
      sshAuthMethod: "password",
    });
    expect(config.sshKeyFile).toBeUndefined();
    expect(config.sshKeyPassphrase).toBeUndefined();
  });

  it("switches to key authentication explicitly and clears the old password", () => {
    const { onSave } = fixture();
    fireEvent.click(
      screen.getByRole("combobox", { name: "SSH authentication" }),
    );
    expect(
      screen.getByRole("listbox", { name: "SSH authentication" }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Private key file" }),
    );
    expect(screen.queryByLabelText("SSH password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update Profile" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("SSH key file"), {
      target: { value: "C:/keys/id_ed25519" },
    });
    fireEvent.change(screen.getByLabelText("Key passphrase"), {
      target: { value: "key-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));
    expect(onSave.mock.calls[0][0].config).toMatchObject({
      sshAuthMethod: "key",
      sshKeyFile: "C:/keys/id_ed25519",
      sshKeyPassphrase: "key-secret",
    });
    expect(onSave.mock.calls[0][0].config.password).toBeUndefined();
  });

  it("saves only a database-bound link and filters groups/non-SSH connections", () => {
    const { onSave } = fixture();
    fireEvent.click(screen.getByRole("combobox", { name: "SSH source" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Saved SSH connection" }),
    );
    expect(
      screen.getByRole("button", { name: "Update Profile" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Saved SSH connection" }),
    );
    expect(document.querySelector("select")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Saved SSH connection" }),
    ).toHaveClass("sor-form-select");
    expect(
      screen.queryByRole("option", { name: "Not SSH" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Folder" }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search SSH connections…" }),
      { target: { value: "Bast" } },
    );
    expect(
      screen.getByRole("listbox", { name: "Saved SSH connection" }),
    ).toHaveTextContent("saved.test:22");
    expect(
      screen.queryByRole("option", { name: "Select an SSH connection…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("listbox", { name: "Saved SSH connection" }),
    ).not.toHaveTextContent("saved-secret");
    fireEvent.mouseDown(screen.getByRole("option", { name: /Bastion/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));
    const config = onSave.mock.calls[0][0].config;
    expect(config).toMatchObject({
      sshConnectionId: "base",
      sshConnectionDatabaseId: "db",
      host: "",
    });
    expect(JSON.stringify(config)).not.toMatch(
      /saved-secret|saved-user|inline-secret|saved.test/,
    );
  });

  it.each(["deleted", "wrong-db"])("blocks saving a %s link", (mode) => {
    const { context, view, renderEditor, onSave } = fixture({
      sshConnectionId: "base",
      sshConnectionDatabaseId: "db",
    });
    if (mode === "deleted") context.state.connections = [];
    else
      context.databaseAvailability = {
        status: "ready",
        databaseId: "other-db",
        generation: 2,
      };
    view.rerender(renderEditor());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update Profile" }),
    ).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("uses the same source controls for tunnel-chain SSH layers", () => {
    const onUpdate = vi.fn();
    render(
      <SshJumpLayerConfig
        layer={{
          id: "layer",
          type: "ssh-tunnel",
          enabled: true,
          sshTunnel: {
            forwardType: "local",
            host: "inline.test",
            username: "alice",
            password: "inline-secret",
          },
        }}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "SSH source" }));
    expect(screen.getByRole("combobox", { name: "SSH source" })).toHaveClass(
      "sor-form-select",
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Saved SSH connection" }),
    );
    expect(onUpdate).toHaveBeenCalledWith({
      sshTunnel: expect.objectContaining({
        connectionId: "",
        password: undefined,
        host: undefined,
      }),
    });
  });
});
