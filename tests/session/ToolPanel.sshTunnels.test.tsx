import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SSHTunnelCreateParams } from "../../src/utils/ssh/sshTunnelService";
import { ToolTabViewer } from "../../src/components/app/ToolPanel";
import { createToolSession } from "../../src/components/app/toolSession";

const h = vi.hoisted(() => ({
  availability: {
    status: "none",
    databaseId: undefined as string | undefined,
    generation: 0,
  },
  createTunnel: vi.fn(),
  updateTunnel: vi.fn(),
  getTunnel: vi.fn(),
  dialogProps: null as null | {
    onSave: (params: SSHTunnelCreateParams) => Promise<void>;
    sshConnections: { id: string }[];
  },
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: [],
      connections: [
        { id: "ssh-base", protocol: "ssh", isGroup: false },
        { id: "ssh-folder", protocol: "ssh", isGroup: true },
        { id: "rdp-base", protocol: "rdp", isGroup: false },
      ],
    },
    databaseAvailability: h.availability,
    dispatch: vi.fn(),
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
vi.mock("../../src/components/ssh/SSHTunnelDialog", () => ({
  SSHTunnelDialog: (props: NonNullable<typeof h.dialogProps>) => {
    h.dialogProps = props;
    return <div data-testid="tunnel-editor">SSH tunnel editor</div>;
  },
}));
vi.mock("../../src/utils/ssh/sshTunnelService", () => ({
  sshTunnelService: {
    ready: async () => {},
    createTunnel: h.createTunnel,
    updateTunnel: h.updateTunnel,
    getTunnel: h.getTunnel,
  },
}));

beforeEach(() => {
  h.availability = { status: "none", databaseId: undefined, generation: 0 };
  h.dialogProps = null;
  h.createTunnel.mockReset().mockResolvedValue({ id: "new-tunnel" });
  h.updateTunnel.mockReset().mockResolvedValue({ id: "existing-tunnel" });
  h.getTunnel.mockReset();
});

const standalone: SSHTunnelCreateParams = {
  name: "Standalone tunnel",
  sshConnectionId: "",
  host: "bastion.example.test",
  port: 22,
  username: "tunnel-user",
  password: "fixture-password",
  type: "dynamic",
  localPort: 15001,
};

async function openEditor(tunnelId?: string) {
  const onClose = vi.fn();
  render(
    <ToolTabViewer
      session={createToolSession("sshTunnelEditor", { connectionId: tunnelId })}
      onClose={onClose}
    />,
  );
  await screen.findByTestId("tunnel-editor");
  return onClose;
}

describe("SSH tunnel editor tool integration", () => {
  it("routes an existing tunnel id to update instead of creating a duplicate", async () => {
    h.getTunnel.mockReturnValue({
      ...standalone,
      id: "existing-tunnel",
      password: undefined,
      credentialRef: "existing-tunnel:ref",
    });
    const onClose = await openEditor("existing-tunnel");
    await h.dialogProps!.onSave(standalone);
    expect(h.updateTunnel).toHaveBeenCalledWith("existing-tunnel", {
      ...standalone,
      ownerDatabaseId: undefined,
    });
    expect(h.createTunnel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("persists a standalone tunnel without an open database before closing", async () => {
    let complete!: () => void;
    h.createTunnel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    );
    const onClose = await openEditor();
    let saving!: Promise<void>;
    await act(async () => {
      saving = h.dialogProps!.onSave(standalone);
      await Promise.resolve();
    });
    expect(h.createTunnel).toHaveBeenCalledWith({
      ...standalone,
      ownerDatabaseId: undefined,
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      complete();
      await saving;
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the editor open when protected storage rejects the save", async () => {
    h.createTunnel.mockRejectedValueOnce(
      new Error("OS credential vault unavailable"),
    );
    const onClose = await openEditor();
    await expect(h.dialogProps!.onSave(standalone)).rejects.toThrow(
      "OS credential vault unavailable",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("binds a saved SSH base to the current database and excludes folders", async () => {
    h.availability = { status: "ready", databaseId: "db-owner", generation: 1 };
    const onClose = await openEditor();
    expect(h.dialogProps!.sshConnections.map((c) => c.id)).toEqual([
      "ssh-base",
    ]);
    const params: SSHTunnelCreateParams = {
      name: "Derived tunnel",
      sshConnectionId: "ssh-base",
      type: "dynamic",
      localPort: 15002,
    };
    await h.dialogProps!.onSave(params);
    expect(h.createTunnel).toHaveBeenCalledWith({
      ...params,
      ownerDatabaseId: "db-owner",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["none", "suspended"])(
    "rejects a saved base when its database is %s",
    async (status) => {
      h.availability.status = status;
      const onClose = await openEditor();
      await expect(
        h.dialogProps!.onSave({
          name: "Derived",
          sshConnectionId: "ssh-base",
          type: "dynamic",
        }),
      ).rejects.toThrow(/Open and unlock/);
      expect(h.createTunnel).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});
