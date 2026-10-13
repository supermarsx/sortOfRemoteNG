import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { DdnsManager } from "../../src/components/ddns/DdnsManager";
import { ToastContext } from "../../src/contexts/ToastContext";
import type { useDdnsManager } from "../../src/hooks/ddns/useDdnsManager";
import type { DdnsExportData } from "../../src/types/ddns/ddns";
import {
  emptySentence,
  installSecureClipboard,
  lockedSentence,
  settle,
  watchConsole,
  type SecureClipboardFake,
} from "./secretCopyHarness";

const bridge = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: bridge.getInvoke,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

type Mgr = ReturnType<typeof useDdnsManager>;
let mgr: Mgr;
vi.mock("../../src/hooks/ddns/useDdnsManager", () => ({
  useDdnsManager: () => mgr,
}));

// Synthetic credentials: what `ddns_export_profiles` returns is not redacted.
const TOKEN = "DDNS-TOKEN-SYNTHETIC-1";
const PASSWORD = "DDNS-PASSWORD-SYNTHETIC-2";
const secrets = [TOKEN, PASSWORD];
const profile = (id: string, auth: unknown) => ({
  id,
  name: id,
  enabled: true,
  provider: "Cloudflare",
  auth,
  domain: "example.test",
  hostname: id,
});
const EXPORT = {
  version: 1,
  exported_at: "2026-09-11T00:00:00Z",
  profiles: [
    profile("token", { ApiToken: { token: TOKEN } }),
    profile("basic", { Basic: { username: "user", password: PASSWORD } }),
  ],
  config: {},
} as unknown as DdnsExportData;

let clipboard: SecureClipboardFake;
let logs: ReturnType<typeof watchConsole>;
let exportProfiles: Mock<() => Promise<DdnsExportData | undefined>>;
const idle = vi.fn();
const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

function open(state: Partial<Mgr> = {}) {
  const held: Record<string, unknown> = {
    profiles: [],
    selectedProfile: null,
    updateResults: [],
    ipResult: null,
    currentIps: [null, null],
    healthList: [],
    systemStatus: null,
    providers: [],
    schedulerStatus: null,
    config: null,
    auditLog: [],
    cfZones: [],
    cfRecords: [],
    loading: false,
    error: null,
    exportProfiles,
    ...state,
  };
  // Every other member of the hook is an action this suite never needs.
  mgr = new Proxy(held, {
    get: (target, key: string) => (key in target ? target[key] : idle),
  }) as unknown as Mgr;
  render(
    <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
      <DdnsManager isOpen onClose={vi.fn()} />
    </ToastContext.Provider>,
  );
}
const exportButton = () => screen.getByRole("button", { name: "Export" });

describe("DDNS manager: profile export", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboard = installSecureClipboard(bridge.getInvoke);
    logs = watchConsole();
    exportProfiles = vi
      .fn<() => Promise<DdnsExportData | undefined>>()
      .mockResolvedValue(EXPORT);
  });
  afterEach(() => {
    try {
      clipboard.expectNoRawClipboard();
      logs.expectSilentAbout(...secrets);
    } finally {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("copies the export, which holds provider credentials in clear, as an export kept 60 s", async () => {
    open();
    fireEvent.click(exportButton());
    await settle();
    const copied = JSON.stringify(EXPORT, null, 2);
    for (const secret of secrets) expect(copied).toContain(secret);
    clipboard.expectOnlyCopy({
      value: copied,
      kind: "genericSecret",
      field: "export",
      clearAfterSecs: 60,
    });
    expect(screen.queryByText(lockedSentence)).not.toBeInTheDocument();
  });

  it("shows why a refused write failed in the error banner, without a credential", async () => {
    open();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    expect(screen.getByText(lockedSentence)).toBeInTheDocument();
    for (const secret of secrets)
      expect(document.body).not.toHaveTextContent(secret);
  });

  it("clears its message when the next export is copied", async () => {
    open();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(exportButton());
    await settle();
    expect(screen.getByText(lockedSentence)).toBeInTheDocument();
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(lockedSentence)).not.toBeInTheDocument();
  });

  it("lets the banner's close button dismiss its message", async () => {
    open();
    clipboard.secureCopy.mockRejectedValueOnce("locked");
    fireEvent.click(exportButton());
    await settle();
    const banner = screen
      .getByText(lockedSentence)
      .closest("div")!.parentElement!;
    fireEvent.click(banner.querySelector("button")!);
    expect(screen.queryByText(lockedSentence)).not.toBeInTheDocument();
  });

  it("exports and writes once when Export is clicked again while one is running", async () => {
    let answer!: (data: DdnsExportData) => void;
    exportProfiles.mockReturnValueOnce(
      new Promise<DdnsExportData>((resolve) => {
        answer = resolve;
      }),
    );
    open();
    fireEvent.click(exportButton());
    await settle();
    // A click while the export is being fetched, then one while it is written.
    fireEvent.click(exportButton());
    await settle();
    expect(exportProfiles).toHaveBeenCalledOnce();
    const write = clipboard.hold();
    answer(EXPORT);
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    fireEvent.click(exportButton());
    await settle();
    expect(exportProfiles).toHaveBeenCalledOnce();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    write.release();
    await settle();
    // The next export is accepted as soon as the first has settled.
    fireEvent.click(exportButton());
    await settle();
    expect(exportProfiles).toHaveBeenCalledTimes(2);
    expect(clipboard.secureCopy).toHaveBeenCalledTimes(2);
  });

  it("accepts the next export after one that could not be fetched, and writes nothing for it", async () => {
    exportProfiles.mockResolvedValueOnce(undefined);
    open({ error: "Export failed" });
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    // The hook's own error stays in the banner.
    expect(screen.getByText("Export failed")).toBeInTheDocument();
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).toHaveBeenCalledOnce();
  });

  it("shows no message of its own when the export could not be fetched", async () => {
    exportProfiles.mockResolvedValueOnce(undefined);
    open();
    fireEvent.click(exportButton());
    await settle();
    expect(clipboard.secureCopy).not.toHaveBeenCalled();
    expect(screen.queryByText(emptySentence)).not.toBeInTheDocument();
  });

  it("accepts the next export after one that was rejected", async () => {
    exportProfiles.mockRejectedValueOnce(new Error("bridge lost"));
    open();
    // The click handler's promise is dropped by React; listen in Vitest's
    // place so the rejection is observed here rather than failing the run.
    const vitestListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      fireEvent.click(exportButton());
      for (let turn = 0; turn < 5 && !unhandled.mock.calls.length; turn++)
        await settle();
      expect(unhandled).toHaveBeenCalledOnce();
      expect(clipboard.secureCopy).not.toHaveBeenCalled();
      fireEvent.click(exportButton());
      await settle();
      expect(clipboard.secureCopy).toHaveBeenCalledOnce();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
      for (const listener of vitestListeners)
        process.on("unhandledRejection", listener);
    }
  });
});
