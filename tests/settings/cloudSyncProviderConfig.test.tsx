import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderConfig from "../../src/components/SettingsDialog/sections/cloudSync/ProviderConfig";
import AdvancedSection from "../../src/components/SettingsDialog/sections/cloudSync/AdvancedSection";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  defaultProviderConfigFor,
  defaultCloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";

afterEach(cleanup);
describe("cloud sync target trust and OAuth fields", () => {
  it.each([
    ["Database archives", "database:*"],
    ["Global scripts and automation libraries", "app:recording.*"],
    ["Portable settings (when available)", "app:settings"],
    ["Saved terminal scripts", "app:recording.managed-scripts"],
    ["Terminal macros", "app:recording.terminal-macros"],
    ["Website scripts and macros", "app:recording.web-automation.v1"],
  ])(
    "adds the actual artifact preset %s without removing custom patterns",
    (label, pattern) => {
      const updateCloudSync = vi.fn();
      render(
        <AdvancedSection
          mgr={
            {
              cloudSync: {
                ...defaultCloudSyncConfig,
                excludePatterns: ["custom-id"],
              },
              updateCloudSync,
            } as unknown as Mgr
          }
        />,
      );
      fireEvent.click(
        screen.getByRole("combobox", { name: "Add an exclude-pattern preset" }),
      );
      expect(
        screen.queryByRole("option", { name: "OS metadata files" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: "Build artifacts" }),
      ).not.toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("option", { name: label }));
      expect(updateCloudSync).toHaveBeenLastCalledWith({
        excludePatterns: ["custom-id", pattern],
      });
    },
  );

  it.each(["googleDrive", "oneDrive"] as const)(
    "edits optional %s refresh fields without discarding manual tokens",
    (provider) => {
      const updateSyncTarget = vi.fn();
      const openTokenDialog = vi.fn();
      const target: CloudSyncTarget = {
        id: "target",
        label: "Target",
        provider,
        enabled: true,
        [provider]: {
          folderPath: "/existing",
          accessToken: "existing-token",
          accountEmail: "account@test",
        },
      };
      render(
        <ProviderConfig
          target={target}
          mgr={{ updateSyncTarget, openTokenDialog } as unknown as Mgr}
        />,
      );
      fireEvent.change(screen.getByLabelText("Client ID (optional)"), {
        target: { value: "client" },
      });
      expect(updateSyncTarget).toHaveBeenLastCalledWith("target", {
        [provider]: { ...target[provider], clientId: "client" },
      });
      fireEvent.change(screen.getByLabelText("Client secret (optional)"), {
        target: { value: "secret" },
      });
      expect(updateSyncTarget).toHaveBeenLastCalledWith("target", {
        [provider]: { ...target[provider], clientSecret: "secret" },
      });
      if (provider === "oneDrive") {
        fireEvent.change(screen.getByLabelText("Tenant ID (optional)"), {
          target: { value: "tenant" },
        });
        expect(updateSyncTarget).toHaveBeenLastCalledWith("target", {
          oneDrive: { ...target.oneDrive, tenantId: "tenant" },
        });
      }
      fireEvent.click(
        screen.getByRole("button", { name: "Edit access / refresh tokens" }),
      );
      expect(openTokenDialog).toHaveBeenCalledExactlyOnceWith("target");
      expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument();
    },
  );

  it("requires a pinned SFTP SHA256 fingerprint with no bypass control", () => {
    const updateSyncTarget = vi.fn();
    const target: CloudSyncTarget = {
      id: "ssh",
      label: "SSH",
      provider: "sftp",
      enabled: true,
      ...defaultProviderConfigFor("sftp"),
    };
    render(
      <ProviderConfig
        target={target}
        mgr={{ updateSyncTarget } as unknown as Mgr}
      />,
    );
    const field = screen.getByLabelText(/Host key fingerprint/);
    expect(screen.getByPlaceholderText("sortOfRemoteNG")).toHaveValue(
      "sortOfRemoteNG",
    );
    expect(field).toBeRequired();
    fireEvent.change(field, {
      target: { value: `  SHA256:${"A".repeat(43)}  ` },
    });
    expect(updateSyncTarget).toHaveBeenLastCalledWith("ssh", {
      sftp: { ...target.sftp, hostKeyFingerprint: `SHA256:${"A".repeat(43)}` },
    });
    expect(
      screen.queryByRole("checkbox", { name: /skip|trust|accept/i }),
    ).not.toBeInTheDocument();
  });

  it("bounds the complete encrypted snapshot limit to 1–100 MiB", () => {
    const updateCloudSync = vi.fn();
    render(
      <AdvancedSection
        mgr={
          {
            cloudSync: defaultCloudSyncConfig,
            updateCloudSync,
          } as unknown as Mgr
        }
      />,
    );
    const limit = screen.getByRole("spinbutton", {
      name: "Maximum Sync Snapshot Size",
    });
    expect(limit).toHaveAttribute("min", "1");
    expect(limit).toHaveAttribute("max", "100");
    expect(
      screen.getByText(/including encrypted and encoded overhead/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Limit: 1–100 MiB/)).toBeInTheDocument();
    fireEvent.change(limit, { target: { value: "100" } });
    expect(updateCloudSync).toHaveBeenLastCalledWith({ maxFileSizeMB: 100 });
    fireEvent.change(limit, { target: { value: "500" } });
    expect(updateCloudSync).toHaveBeenLastCalledWith({ maxFileSizeMB: 100 });
    fireEvent.change(limit, { target: { value: "0" } });
    expect(updateCloudSync).toHaveBeenLastCalledWith({ maxFileSizeMB: 1 });
  });
});
