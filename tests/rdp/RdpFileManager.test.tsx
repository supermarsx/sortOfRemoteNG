import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const invokeMock = vi.fn();
const openMock = vi.fn();
const saveMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
  save: (...args: unknown[]) => saveMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

import RdpFileManager from "../../src/components/rdp/RdpFileManager";

describe("RdpFileManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((command: string) => {
      if (command === "rdp_get_supported_settings") return Promise.resolve([]);
      if (command === "rdp_parse_batch") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    openMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(null);
  });

  it("renders accessible tabs and switches by keyboard", async () => {
    await act(async () => {
      render(<RdpFileManager />);
    });

    const importTab = screen.getByRole("tab", { name: /Import \.rdp/i });
    const exportTab = screen.getByRole("tab", { name: /Export \.rdp/i });

    expect(screen.getByRole("tablist", { name: /RDP file manager tabs/i })).toBeInTheDocument();
    expect(importTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(importTab, { key: "ArrowRight" });

    expect(exportTab).toHaveAttribute("aria-selected", "true");
  });

  it("opens the file picker when the drop zone is activated with space", async () => {
    await act(async () => {
      render(<RdpFileManager />);
    });

    const dropZone = screen.getByRole("button", {
      name: /Click to browse or drag \.rdp files here/i,
    });

    await act(async () => {
      fireEvent.keyDown(dropZone, { key: " " });
    });

    expect(openMock).toHaveBeenCalled();
  });
});
