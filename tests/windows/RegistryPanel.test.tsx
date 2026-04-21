import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RegistryPanel from "../../src/components/windows/panels/RegistryPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";

const saveMock = vi.fn();
const writeTextFileMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
}));

describe("RegistryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveMock.mockResolvedValue("C:/Temp/software.reg");
    writeTextFileMock.mockResolvedValue(undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  const buildContext = (): WinmgmtContext => ({
    sessionId: "session-1",
    hostname: "win-host",
    cmd: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "winmgmt_registry_enum_keys") {
        if (args?.path === "") return ["Software"];
        if (args?.path === "Software") return ["Microsoft"];
        return [];
      }
      if (command === "winmgmt_registry_get_key_info") {
        return { subkeys: [], values: [] };
      }
      if (command === "winmgmt_registry_export") {
        return "Windows Registry Editor Version 5.00";
      }
      return [];
    }) as WinmgmtContext["cmd"],
  });

  it("renders an accessible tree and expands nodes with keyboard", async () => {
    const ctx = buildContext();
    await act(async () => {
      render(<RegistryPanel ctx={ctx} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Load Registry/i }));
    });

    expect(await screen.findByRole("tree", { name: /Registry keys/i })).toBeInTheDocument();

    const softwareNode = await screen.findByRole("treeitem", { name: /Software/i });
    softwareNode.focus();

    await act(async () => {
      fireEvent.keyDown(softwareNode, { key: "ArrowRight" });
    });

    expect(await screen.findByRole("treeitem", { name: /Microsoft/i })).toBeInTheDocument();
  });

  it("exports the selected registry key", async () => {
    const ctx = buildContext();
    await act(async () => {
      render(<RegistryPanel ctx={ctx} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Load Registry/i }));
    });

    const softwareNode = await screen.findByRole("treeitem", { name: /Software/i });

    await act(async () => {
      fireEvent.click(softwareNode);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Export \.reg/i }));
    });

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalled();
      expect(writeTextFileMock).toHaveBeenCalledWith(
        "C:/Temp/software.reg",
        "Windows Registry Editor Version 5.00",
      );
    });
  });
});