import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigTab } from "../../src/components/ssh/mcpServer/ConfigTab";
import type { UseMcpServerResult } from "../../src/hooks/ssh/useMcpServer";
import { DEFAULT_MCP_CONFIG } from "../../src/types/mcp/mcpServer";
import {
  hasTick,
  installSecureClipboard,
  lockedSentence,
  settle,
  watchConsole,
  type SecureClipboardFake,
} from "../security/secretCopyHarness";

const bridge = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: bridge.getInvoke,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Synthetic: not a key of any server.
const KEY = "MCP-KEY-SYNTHETIC-1";

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;

function open() {
  const mgr = {
    config: { ...DEFAULT_MCP_CONFIG, require_auth: true, api_key: KEY },
    status: null,
    isStarting: false,
    isStopping: false,
    isGeneratingKey: false,
    tools: [],
    resources: [],
    prompts: [],
    generateApiKey: vi.fn(),
    updateConfig: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
  } as unknown as UseMcpServerResult;
  render(<ConfigTab mgr={mgr} />);
}
const copyButton = () => screen.getByRole("button", { name: "Copy key" });

describe("MCP server API key: copy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(KEY);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("copies the key as an API key through the secure clipboard", async () => {
    open();
    fireEvent.click(copyButton());
    await settle();
    clipboard.expectOnlyCopy({ value: KEY, kind: "apiKey", field: "apiKey" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the tick only after the write succeeded", async () => {
    open();
    const write = clipboard.hold();
    fireEvent.click(copyButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hasTick(copyButton())).toBe(false);
    write.release();
    await settle();
    expect(hasTick(copyButton())).toBe(true);
  });

  it("writes once when Copy is clicked again while a write is pending", async () => {
    open();
    const write = clipboard.hold();
    fireEvent.click(copyButton());
    await settle();
    fireEvent.click(copyButton());
    fireEvent.click(copyButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    // No tick may appear for a click that wrote nothing.
    expect(hasTick(copyButton())).toBe(false);
    write.release();
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(hasTick(copyButton())).toBe(true);
    // The row accepts the next copy as soon as the first has settled.
    fireEvent.click(copyButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
  });

  it("shows why a refused write failed, with no tick and no key, until the next success", async () => {
    open();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(copyButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(lockedSentence);
    expect(screen.getByRole("alert")).not.toHaveTextContent(KEY);
    expect(hasTick(copyButton())).toBe(false);
    fireEvent.click(copyButton());
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(hasTick(copyButton())).toBe(true);
  });
});
