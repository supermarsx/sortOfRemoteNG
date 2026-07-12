import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Hoisted so the module-mock factory can see it (mirrors LxdPanel.test).
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  isTauri: () => true,
}));

// No i18n provider under vitest — return the inline English default.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import LxdInstancesTab from "./LxdInstancesTab";
import { lxdInstancesApi } from "../../../hooks/integration/lxd/useLxdInstances";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
});

describe("lxdInstancesApi bindings", () => {
  it("binds all 37 instance-category commands", () => {
    // 23 instances + 6 snapshots + 5 backups + 3 migration/copy/publish.
    expect(Object.keys(lxdInstancesApi)).toHaveLength(37);
  });

  it("maps two-word args to camelCase invoke keys the Rust params expect", () => {
    lxdInstancesApi.renameInstance("c1", "c2");
    expect(invokeMock).toHaveBeenCalledWith("lxd_rename_instance", {
      name: "c1",
      newName: "c2",
    });

    lxdInstancesApi.copyInstance("src", "dst", true, false);
    expect(invokeMock).toHaveBeenCalledWith("lxd_copy_instance", {
      sourceName: "src",
      newName: "dst",
      instanceOnly: true,
      stateful: false,
    });

    lxdInstancesApi.renameSnapshot("c1", "s0", "s1");
    expect(invokeMock).toHaveBeenCalledWith("lxd_rename_snapshot", {
      instance: "c1",
      oldName: "s0",
      newName: "s1",
    });

    // `public` is a JS reserved-ish key on the wire — the wrapper renames it.
    lxdInstancesApi.publishInstance("c1", "img", true);
    expect(invokeMock).toHaveBeenCalledWith("lxd_publish_instance", {
      instance: "c1",
      alias: "img",
      public: true,
      properties: undefined,
    });
  });

  it("passes struct-valued requests through as `req`", () => {
    lxdInstancesApi.createSnapshot({ instance: "c1", name: "snap0" });
    expect(invokeMock).toHaveBeenCalledWith("lxd_create_snapshot", {
      req: { instance: "c1", name: "snap0" },
    });
  });
});

describe("LxdInstancesTab", () => {
  it("shows the not-connected hint when disconnected", () => {
    render(<LxdInstancesTab connected={false} />);
    expect(
      screen.getByText("Connect to an LXD server to manage instances."),
    ).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("lxd_list_instances", undefined);
  });

  it("loads instances via lxd_list_instances when connected", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "lxd_list_instances")
        return Promise.resolve([
          { name: "web-1", type: "container", status: "Running" },
        ]);
      return Promise.resolve([]);
    });

    render(<LxdInstancesTab connected />);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("lxd_list_instances", undefined),
    );
    expect(await screen.findByText("web-1")).toBeInTheDocument();
  });

  it("switches to containers/VMs filters", async () => {
    render(<LxdInstancesTab connected />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("lxd_list_instances", undefined),
    );
    fireEvent.click(screen.getByText("VMs"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "lxd_list_virtual_machines",
        undefined,
      ),
    );
  });
});
