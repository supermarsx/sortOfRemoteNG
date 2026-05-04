import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: string) => f || k,
  }),
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mockToast }),
}));

const mockDispatch = vi.fn();
const mockConnections = [
  {
    id: "conn-1",
    name: "Server A",
    protocol: "rdp",
    hostname: "10.0.0.1",
    port: 3389,
    username: "admin",
    domain: "CORP",
    description: "Primary server",
    parentId: undefined,
    isGroup: false,
    tags: ["prod"],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-15"),
  },
  {
    id: "conn-2",
    name: "Server B",
    protocol: "ssh",
    hostname: "10.0.0.2",
    port: 22,
    username: "root",
    domain: "",
    description: "",
    parentId: undefined,
    isGroup: false,
    tags: [],
    createdAt: new Date("2026-02-01"),
    updatedAt: new Date("2026-02-10"),
  },
];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mockConnections },
    dispatch: mockDispatch,
  }),
}));

const mockExportCollection = vi.fn().mockResolvedValue('{"connections":[]}');
const mockGetCurrentCollection = vi
  .fn()
  .mockReturnValue({ id: "col-1", name: "Default" });
const mockGetAllConnections = vi.fn().mockResolvedValue([]);
const mockAddConnection = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getAllConnections: mockGetAllConnections,
      addConnection: mockAddConnection,
      getCurrentCollection: mockGetCurrentCollection,
      exportCollection: mockExportCollection,
    }),
    resetInstance: vi.fn(),
  },
}));

const mockLogAction = vi.fn();
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: mockLogAction,
      getSettings: vi.fn().mockReturnValue({}),
    }),
  },
}));

const mockImportConnections = vi.fn().mockResolvedValue([]);
const mockDetectImportFormat = vi.fn().mockReturnValue("json");
const mockGetFormatName = vi.fn().mockReturnValue("JSON");

vi.mock("../../src/components/ImportExport/utils", () => ({
  importConnections: (...args: unknown[]) => mockImportConnections(...args),
  detectImportFormat: (...args: unknown[]) => mockDetectImportFormat(...args),
  getFormatName: (...args: unknown[]) => mockGetFormatName(...args),
}));

const mockEncryptWithPassword = vi.fn().mockResolvedValue("encrypted-payload");
const mockDecryptWithPassword = vi.fn().mockResolvedValue('{"connections":[]}');
const mockIsWebCryptoPayload = vi.fn().mockReturnValue(true);

vi.mock("../../src/utils/crypto/webCryptoAes", () => ({
  encryptWithPassword: (...args: unknown[]) => mockEncryptWithPassword(...args),
  decryptWithPassword: (...args: unknown[]) => mockDecryptWithPassword(...args),
  isWebCryptoPayload: (...args: unknown[]) => mockIsWebCryptoPayload(...args),
}));

const mockListOpenVPN = vi.fn().mockResolvedValue([]);
const mockListWireGuard = vi.fn().mockResolvedValue([]);
const mockListTailscale = vi.fn().mockResolvedValue([]);
const mockListZeroTier = vi.fn().mockResolvedValue([]);
const mockCreateOpenVPN = vi.fn().mockResolvedValue("vpn-1");
const mockCreateWireGuard = vi.fn().mockResolvedValue("vpn-2");
const mockCreateTailscale = vi.fn().mockResolvedValue("vpn-3");
const mockCreateZeroTier = vi.fn().mockResolvedValue("vpn-4");

vi.mock("../../src/utils/network/proxyOpenVPNManager", () => ({
  ProxyOpenVPNManager: {
    getInstance: () => ({
      listOpenVPNConnections: mockListOpenVPN,
      listWireGuardConnections: mockListWireGuard,
      listTailscaleConnections: mockListTailscale,
      listZeroTierConnections: mockListZeroTier,
      createOpenVPNConnection: mockCreateOpenVPN,
      createWireGuardConnection: mockCreateWireGuard,
      createTailscaleConnection: mockCreateTailscale,
      createZeroTierConnection: mockCreateZeroTier,
    }),
  },
}));

const mockGetTunnelChains = vi.fn().mockReturnValue([]);
const mockCreateTunnelChain = vi.fn().mockResolvedValue({ id: "tc-1" });

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getTunnelChains: (...args: unknown[]) => mockGetTunnelChains(...args),
    createTunnelChain: (...args: unknown[]) => mockCreateTunnelChain(...args),
  },
}));

const mockPrompt = vi.fn();
const mockTauriInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockTauriInvoke(...args),
}));

import { useImportExport } from "../../src/hooks/sync/useImportExport";

// Drives the in-app password prompt for tests. Calls handleFileSelect, waits
// until the hook's `passwordPrompt` state appears, then submits or cancels.
async function selectFileWithPrompt(
  result: { current: ReturnType<typeof useImportExport> },
  event: React.ChangeEvent<HTMLInputElement>,
  prompts: (string | null)[],
) {
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = result.current.handleFileSelect(event);
  });
  for (const value of prompts) {
    await waitFor(() => {
      if (!result.current.passwordPrompt) {
        throw new Error("passwordPrompt not shown yet");
      }
    });
    await act(async () => {
      if (value === null) result.current.cancelPasswordPrompt();
      else result.current.submitPasswordPrompt(value);
    });
  }
  await act(async () => {
    await pending;
  });
}

// ── Helpers ────────────────────────────────────────────────────────

function renderImportExport(
  overrides?: Partial<Parameters<typeof useImportExport>[0]>,
) {
  const defaults = {
    isOpen: true,
    onClose: vi.fn(),
    initialTab: "export" as const,
  };
  return renderHook(() => useImportExport({ ...defaults, ...overrides }));
}

// Stub downloadFile's DOM interactions
beforeEach(() => {
  vi.clearAllMocks();
  mockEncryptWithPassword.mockReset();
  mockEncryptWithPassword.mockResolvedValue("encrypted-payload");
  mockDecryptWithPassword.mockReset();
  mockDecryptWithPassword.mockResolvedValue('{"connections":[]}');
  mockIsWebCryptoPayload.mockReset();
  mockIsWebCryptoPayload.mockReturnValue(true);
  mockPrompt.mockReset();
  mockPrompt.mockReturnValue("password");
  mockTauriInvoke.mockReset();
  mockTauriInvoke.mockResolvedValue('{"connections":[]}');
  vi.stubGlobal("prompt", mockPrompt);
  vi.stubGlobal("__TAURI__", { core: { invoke: mockTauriInvoke } });
  // Stub URL helpers used by downloadFile
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
  // Stub anchor element creation only — preserve real createElement for test containers
  const origCreate = document.createElement.bind(document);
  const mockLink = {
    href: "",
    download: "",
    click: vi.fn(),
  } as unknown as HTMLAnchorElement;
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: any) => {
    if (tag === "a") return mockLink;
    return origCreate(tag, options);
  });
  vi.spyOn(document.body, "appendChild").mockImplementation(
    (node) => node,
  );
  vi.spyOn(document.body, "removeChild").mockImplementation(
    (node) => node,
  );
});

// ── Tests ──────────────────────────────────────────────────────────

describe("useImportExport", () => {
  // ── Initial state ────────────────────────────────────────────

  it("returns default export state", () => {
    const { result } = renderImportExport();
    expect(result.current.activeTab).toBe("export");
    expect(result.current.exportFormat).toBe("json");
    expect(result.current.exportEncrypted).toBe(false);
    expect(result.current.exportPassword).toBe("");
    expect(result.current.includePasswords).toBe(false);
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.importResult).toBeNull();
    expect(result.current.importFilename).toBe("");
  });

  it("uses initialTab when provided", () => {
    const { result } = renderImportExport({ initialTab: "import" });
    expect(result.current.activeTab).toBe("import");
  });

  it("resets activeTab to initialTab when the dialog reopens", () => {
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useImportExport>[0]) => useImportExport(props),
      {
        initialProps: {
          isOpen: true,
          onClose,
          initialTab: "export" as const,
        },
      },
    );

    act(() => {
      result.current.setActiveTab("import");
    });
    expect(result.current.activeTab).toBe("import");

    rerender({ isOpen: false, onClose, initialTab: "export" });
    expect(result.current.activeTab).toBe("import");

    rerender({ isOpen: true, onClose, initialTab: "export" });
    expect(result.current.activeTab).toBe("export");
  });

  it("exposes the connections from context", () => {
    const { result } = renderImportExport();
    expect(result.current.connections).toBe(mockConnections);
  });

  // ── Format / settings toggles ───────────────────────────────

  it("setExportFormat changes format state", () => {
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("csv"));
    expect(result.current.exportFormat).toBe("csv");
    act(() => result.current.setExportFormat("xml"));
    expect(result.current.exportFormat).toBe("xml");
  });

  it("setExportEncrypted and setExportPassword work", () => {
    const { result } = renderImportExport();
    act(() => result.current.setExportEncrypted(true));
    expect(result.current.exportEncrypted).toBe(true);
    act(() => result.current.setExportPassword("secret"));
    expect(result.current.exportPassword).toBe("secret");
  });

  it("setIncludePasswords toggles", () => {
    const { result } = renderImportExport();
    act(() => result.current.setIncludePasswords(true));
    expect(result.current.includePasswords).toBe(true);
  });

  it("setActiveTab switches tab", () => {
    const { result } = renderImportExport();
    act(() => result.current.setActiveTab("import"));
    expect(result.current.activeTab).toBe("import");
  });

  it("handleImport clicks the hidden file input when present", () => {
    const { result } = renderImportExport();
    const click = vi.fn();

    act(() => {
      (result.current.fileInputRef as { current: HTMLInputElement | null }).current = {
        click,
      } as unknown as HTMLInputElement;
      result.current.handleImport();
    });

    expect(click).toHaveBeenCalledTimes(1);
  });

  // ── Export ──────────────────────────────────────────────────

  it("handleExport JSON — calls collectionManager and downloads", async () => {
    mockExportCollection.mockResolvedValueOnce('{"data":"ok"}');
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockExportCollection).toHaveBeenCalledWith(
      "col-1",
      false,
      undefined,
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining("Exported successfully"),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("JSON"),
    );
  });

  it("handleExport JSON relies on collection export encryption and skips the local encrypt helper", async () => {
    mockExportCollection.mockResolvedValueOnce('{"connections":[]}');
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("json-secret");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockExportCollection).toHaveBeenCalledWith(
      "col-1",
      false,
      "json-secret",
    );
    expect(mockEncryptWithPassword).not.toHaveBeenCalled();
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("JSON (encrypted)"),
    );
  });

  it("handleExport JSON enriches exports with VPNs and tunnel chains", async () => {
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    mockExportCollection.mockResolvedValueOnce('{"connections":[]}');
    mockListOpenVPN.mockResolvedValueOnce([{ name: "OpenVPN A", config: "ovpn-config" }]);
    mockListWireGuard.mockRejectedValueOnce(new Error("wireguard unavailable"));
    mockListTailscale.mockResolvedValueOnce([{ name: "Tailnet A", config: "tail-config" }]);
    mockListZeroTier.mockRejectedValueOnce(new Error("zerotier unavailable"));
    mockGetTunnelChains.mockReturnValueOnce([
      { id: "chain-1", name: "Chain A", layers: [], description: "desc", tags: ["prod"] },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const exportedBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0][0] as Blob;
    const exportedJson = JSON.parse(await exportedBlob.text());

    expect(exportedJson.vpnConnections).toEqual({
      openvpn: [{ name: "OpenVPN A", config: "ovpn-config" }],
      wireguard: [],
      tailscale: [{ name: "Tailnet A", config: "tail-config" }],
      zerotier: [],
    });
    expect(exportedJson.tunnelChainTemplates).toEqual([
      { id: "chain-1", name: "Chain A", layers: [], description: "desc", tags: ["prod"] },
    ]);

    expect(warnSpy).not.toHaveBeenCalledWith(
      "Failed to include VPN data in export:",
      expect.anything(),
    );
    warnSpy.mockRestore();
    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport JSON keeps the raw payload when VPN enrichment parsing fails", async () => {
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    mockExportCollection.mockResolvedValueOnce("not-json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const exportedBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await exportedBlob.text()).toBe("not-json");
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to include VPN data in export:",
      expect.any(SyntaxError),
    );

    warnSpy.mockRestore();
    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport JSON falls back to empty VPN buckets when OpenVPN or Tailscale lookups fail", async () => {
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    mockExportCollection.mockResolvedValueOnce('{"connections":[]}');
    mockListOpenVPN.mockRejectedValueOnce(new Error("openvpn unavailable"));
    mockListWireGuard.mockResolvedValueOnce([{ name: "WireGuard A", config: "wg-config" }]);
    mockListTailscale.mockRejectedValueOnce(new Error("tailscale unavailable"));
    mockListZeroTier.mockResolvedValueOnce([{ name: "ZeroTier A", config: "zt-config" }]);

    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const objectUrlCalls = vi.mocked(globalThis.URL.createObjectURL).mock.calls;
    const exportedBlob = objectUrlCalls[objectUrlCalls.length - 1][0] as Blob;
    const exportedJson = JSON.parse(await exportedBlob.text());

    expect(exportedJson.vpnConnections).toEqual({
      openvpn: [],
      wireguard: [{ name: "WireGuard A", config: "wg-config" }],
      tailscale: [],
      zerotier: [{ name: "ZeroTier A", config: "zt-config" }],
    });

    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport CSV — serialises connections as CSV", async () => {
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("csv"));

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining("Exported successfully"),
    );
  });

  it("handleExport CSV leaves simple fields unquoted", async () => {
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("csv"));

    await act(async () => {
      await result.current.handleExport();
    });

    const exportedBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0][0] as Blob;
    const exportedCsv = await exportedBlob.text();

    expect(exportedCsv).toContain("Server A,rdp,10.0.0.1,3389,admin,CORP,Primary server");
    expect(exportedCsv).not.toContain('"Server A"');

    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport CSV escapes commas, quotes, and newlines in fields", async () => {
    const OriginalBlob = globalThis.Blob;
    const originalConnection = { ...mockConnections[0] };
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    Object.assign(mockConnections[0], {
      name: 'Server, "Prod"\nA',
      description: 'Line 1\nLine 2',
    });

    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("csv"));

    await act(async () => {
      await result.current.handleExport();
    });

    const exportedBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0][0] as Blob;
    const exportedCsv = await exportedBlob.text();

    expect(exportedCsv).toContain('"Server, ""Prod""\nA"');
    expect(exportedCsv).toContain('"Line 1\nLine 2"');

    Object.assign(mockConnections[0], originalConnection);
    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport serializes empty usernames and missing tags as blank XML and CSV fields", async () => {
    const OriginalBlob = globalThis.Blob;
    const originalConnection = { ...mockConnections[0] };
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        private readonly parts: string[];

        constructor(parts: BlobPart[]) {
          this.parts = parts.map((part) => String(part));
        }

        async text() {
          return this.parts.join("");
        }
      } as unknown as typeof Blob,
    );

    Object.assign(mockConnections[0], {
      username: undefined,
      tags: undefined,
    });

    const { result } = renderImportExport();

    act(() => result.current.setExportFormat("xml"));
    await act(async () => {
      await result.current.handleExport();
    });

    const xmlObjectUrlCalls = vi.mocked(globalThis.URL.createObjectURL).mock.calls;
    const xmlBlob = xmlObjectUrlCalls[xmlObjectUrlCalls.length - 1][0] as Blob;
    const exportedXml = await xmlBlob.text();
    expect(exportedXml).toContain('Username=""');
    expect(exportedXml).toContain('Tags=""');

    act(() => result.current.setExportFormat("csv"));
    await act(async () => {
      await result.current.handleExport();
    });

    const csvObjectUrlCalls = vi.mocked(globalThis.URL.createObjectURL).mock.calls;
    const csvBlob = csvObjectUrlCalls[csvObjectUrlCalls.length - 1][0] as Blob;
    const exportedCsv = await csvBlob.text();
    expect(exportedCsv).toContain("conn-1,Server A,rdp,10.0.0.1,3389,,CORP,Primary server,,false,");

    Object.assign(mockConnections[0], originalConnection);
    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport XML — serialises connections as XML", async () => {
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("xml"));

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining("Exported successfully"),
    );
  });

  it("handleExport encrypts non-JSON exports when requested", async () => {
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportFormat("xml");
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("lock-it-down");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockEncryptWithPassword).toHaveBeenCalledWith(
      expect.stringContaining("<sortOfRemoteNG>"),
      "lock-it-down",
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining(".encrypted.xml"),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("XML (encrypted)"),
    );
  });

  it("handleExport skips password-based encryption when the password is empty", async () => {
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportFormat("json");
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockExportCollection).toHaveBeenCalledWith(
      "col-1",
      false,
      undefined,
    );
    expect(mockEncryptWithPassword).not.toHaveBeenCalled();
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      "Exported 2 connections to JSON",
    );
  });

  it("handleExport reports unsupported formats through the error toast", async () => {
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportFormat("yaml" as never);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "Export failed. Check the console for details.",
    );
  });

  it("handleExport shows error toast when no collection is selected", async () => {
    mockGetCurrentCollection.mockReturnValueOnce(null);
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("Export failed"),
    );
  });

  // ── Import file processing ──────────────────────────────────

  it("handleFileSelect sets importResult on success", async () => {
    const importedConns = [
      { id: "imp-1", name: "Imported", protocol: "ssh" },
    ];
    mockImportConnections.mockResolvedValueOnce(importedConns);
    mockDetectImportFormat.mockReturnValueOnce("json");

    const { result } = renderImportExport();

    const file = new File(['[{"id":"imp-1"}]'], "import.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).not.toBeNull();
    expect(result.current.importResult!.success).toBe(true);
    expect(result.current.importResult!.connections).toEqual(importedConns);
    expect(result.current.importFilename).toBe("import.json");
    expect(mockImportConnections).toHaveBeenCalledWith(
      '[{"id":"imp-1"}]',
      "import.json",
      "json",
    );
  });

  it("handleFileSelect sets error result when import returns empty", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    const { result } = renderImportExport();

    const file = new File([""], "empty.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).not.toBeNull();
    expect(result.current.importResult!.success).toBe(false);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it("handleFileSelect does nothing when no file is selected", async () => {
    const { result } = renderImportExport();

    const event = {
      target: { files: [] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toBeNull();
  });

  it("handleFileSelect rejects oversized files before reading them", async () => {
    const { result } = renderImportExport();

    const event = {
      target: {
        files: [
          {
            name: "huge.json",
            size: 50 * 1024 * 1024 + 1,
          },
        ],
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      "File is too large. Maximum allowed size is 50 MB.",
    );
    expect(result.current.importResult).toBeNull();
    expect(result.current.importFilename).toBe("");
  });

  it("handleFileSelect accepts files exactly at the size limit", async () => {
    const OriginalFileReader = globalThis.FileReader;
    vi.stubGlobal(
      "FileReader",
      class MockFileReader {
        result: string | ArrayBuffer | null = null;
        onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
        onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;

        readAsText() {
          this.result = '{"connections":[]}';
          this.onload?.call(
            this as unknown as FileReader,
            new ProgressEvent("load") as ProgressEvent<FileReader>,
          );
        }
      } as unknown as typeof FileReader,
    );

    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "limit-1", name: "Limit Host", protocol: "ssh" },
    ]);

    const { result } = renderImportExport();

    const event = {
      target: {
        files: [
          {
            name: "limit.json",
            size: 50 * 1024 * 1024,
          },
        ],
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
    });
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "File is too large. Maximum allowed size is 50 MB.",
    );

    vi.stubGlobal("FileReader", OriginalFileReader);
  });

  it("handleFileSelect falls back to legacy Tauri decryption for .encrypted files", async () => {
    mockIsWebCryptoPayload.mockReturnValueOnce(true);
    mockDecryptWithPassword.mockRejectedValueOnce(new Error("bad webcrypto payload"));
    mockTauriInvoke.mockResolvedValueOnce('{"connections":[{"id":"legacy-1"}]}');
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "legacy-1", name: "Legacy Import", protocol: "ssh" },
    ]);

    const { result } = renderImportExport();

    const file = new File(["legacy-ciphertext"], "legacy.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["legacy-pass"]);

    expect(mockDecryptWithPassword).toHaveBeenCalledWith(
      "legacy-ciphertext",
      "legacy-pass",
    );
    expect(mockTauriInvoke).toHaveBeenCalledWith(
      "crypto_legacy_decrypt_cryptojs",
      {
        ciphertext: "legacy-ciphertext",
        password: "legacy-pass",
      },
    );
    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
    });
    expect(result.current.importFilename).toBe("legacy.encrypted");
  });

  it("handleFileSelect uses legacy invoke directly when encrypted data is not WebCrypto", async () => {
    mockIsWebCryptoPayload.mockReturnValueOnce(false);
    mockTauriInvoke.mockResolvedValueOnce('{"connections":[{"id":"legacy-2"}]}');
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "legacy-2", name: "Legacy Only", protocol: "ssh" },
    ]);

    const { result } = renderImportExport();

    const file = new File(["legacy-only-ciphertext"], "legacy-only.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["legacy-only-pass"]);

    expect(mockDecryptWithPassword).not.toHaveBeenCalled();
    expect(mockTauriInvoke).toHaveBeenCalledWith(
      "crypto_legacy_decrypt_cryptojs",
      {
        ciphertext: "legacy-only-ciphertext",
        password: "legacy-only-pass",
      },
    );
    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
    });
  });

  it("handleFileSelect surfaces an error when encrypted imports are missing a password", async () => {
    const { result } = renderImportExport();

    const file = new File(["ciphertext"], "cancelled.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, [null]);

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Password required for encrypted file"],
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Import failed. Check the file format and try again.",
    );
  });

  it("handleFileSelect reports decrypt failures when no legacy invoke is available", async () => {
    mockIsWebCryptoPayload.mockReturnValueOnce(false);
    mockTauriInvoke.mockRejectedValueOnce(new Error("not registered"));

    const { result } = renderImportExport();

    const file = new File(["ciphertext"], "no-backend.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["no-backend-pass"]);

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Failed to decrypt file. Check your password."],
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Import failed. Check the file format and try again.",
    );
  });

  it("handleFileSelect reports decrypt failures when the legacy invoke throws", async () => {
    mockIsWebCryptoPayload.mockReturnValueOnce(false);
    mockTauriInvoke.mockRejectedValueOnce(new Error("legacy decrypt exploded"));

    const { result } = renderImportExport();

    const file = new File(["ciphertext"], "legacy-throws.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["legacy-throws"]);

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Failed to decrypt file. Check your password."],
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith(
      "crypto_legacy_decrypt_cryptojs",
      {
        ciphertext: "ciphertext",
        password: "legacy-throws",
      },
    );
  });

  it("handleFileSelect rejects encrypted imports when both decrypt paths return empty strings", async () => {
    mockIsWebCryptoPayload.mockReturnValueOnce(true);
    mockDecryptWithPassword.mockResolvedValueOnce("");
    mockTauriInvoke.mockResolvedValueOnce("");

    const { result } = renderImportExport();

    const file = new File(["ciphertext"], "empty.encrypted", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["empty-cipher"]);

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Failed to decrypt file. Check your password."],
    });
    expect(mockTauriInvoke).toHaveBeenCalledWith(
      "crypto_legacy_decrypt_cryptojs",
      {
        ciphertext: "ciphertext",
        password: "empty-cipher",
      },
    );
  });

  it("handleFileSelect accepts JSON imports that only contain VPNs or tunnel chains", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");
    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Only", config: "ovpn" }],
            wireguard: [],
            tailscale: [],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Chain Only", layers: [], description: "desc", tags: [] },
          ],
        }),
      ],
      "vpn-only.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 0,
      vpnConnections: {
        openvpn: [{ name: "OpenVPN Only", config: "ovpn" }],
        wireguard: [],
        tailscale: [],
        zerotier: [],
      },
    });
    expect(result.current.importResult?.tunnelChainTemplates).toEqual([
      { name: "Chain Only", layers: [], description: "desc", tags: [] },
    ]);
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "Import failed. Check the file format and try again.",
    );
  });

  it("handleFileSelect accepts zerotier-only JSON imports and restores them on confirm", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");
    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [],
            wireguard: { invalid: true },
            tailscale: [],
            zerotier: [{ name: "ZT Only", config: "zt-config" }],
          },
        }),
      ],
      "zerotier-only.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 0,
      vpnConnections: {
        openvpn: [],
        wireguard: [],
        tailscale: [],
        zerotier: [{ name: "ZT Only", config: "zt-config" }],
      },
    });

    await act(async () => {
      await result.current.confirmImport("zerotier-only.json");
    });

    expect(mockCreateZeroTier).toHaveBeenCalledWith("ZT Only", "zt-config");
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 1 VPN connection(s) from zerotier-only.json",
    );
  });

  it("handleFileSelect sanitizes malformed JSON VPN metadata", async () => {
    mockImportConnections.mockResolvedValueOnce([
      { id: "json-1", name: "JSON Host", protocol: "ssh" },
    ]);
    mockDetectImportFormat.mockReturnValueOnce("json");

    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: { invalid: true },
            wireguard: [{ name: "WG Valid", config: "wg-config" }],
            tailscale: "oops",
            zerotier: { invalid: true },
          },
          tunnelChainTemplates: { invalid: true },
        }),
      ],
      "malformed-vpn.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
      vpnConnections: {
        openvpn: [],
        wireguard: [{ name: "WG Valid", config: "wg-config" }],
        tailscale: [],
        zerotier: [],
      },
    });
    expect(result.current.importResult?.tunnelChainTemplates).toBeUndefined();

    await act(async () => {
      await result.current.confirmImport("malformed-vpn.json");
    });

    expect(mockCreateOpenVPN).not.toHaveBeenCalled();
    expect(mockCreateWireGuard).toHaveBeenCalledWith("WG Valid", "wg-config");
    expect(mockCreateTailscale).not.toHaveBeenCalled();
    expect(mockCreateZeroTier).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 1 connection(s), 1 VPN connection(s) from malformed-vpn.json",
    );
  });

  it("handleFileSelect only extracts VPN metadata for JSON imports", async () => {
    mockImportConnections.mockResolvedValueOnce([
      { id: "xml-1", name: "XML Import", protocol: "ssh" },
    ]);
    mockDetectImportFormat.mockReturnValueOnce("xml");

    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Hidden", config: "ovpn" }],
            wireguard: [],
            tailscale: [],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Hidden Chain", layers: [], description: "desc", tags: [] },
          ],
        }),
      ],
      "metadata.xml",
      { type: "application/xml" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
      connections: [{ id: "xml-1", name: "XML Import", protocol: "ssh" }],
    });
    expect(result.current.importResult?.vpnConnections).toBeUndefined();
    expect(result.current.importResult?.tunnelChainTemplates).toBeUndefined();
    expect(mockImportConnections).toHaveBeenCalledWith(
      JSON.stringify({
        vpnConnections: {
          openvpn: [{ name: "OpenVPN Hidden", config: "ovpn" }],
          wireguard: [],
          tailscale: [],
          zerotier: [],
        },
        tunnelChainTemplates: [
          { name: "Hidden Chain", layers: [], description: "desc", tags: [] },
        ],
      }),
      "metadata.xml",
      "xml",
    );
  });

  // ── Confirm / cancel import ─────────────────────────────────

  it("confirmImport dispatches ADD_CONNECTION for each connection", async () => {
    const importedConns = [
      { id: "c1", name: "A" },
      { id: "c2", name: "B" },
    ];
    mockImportConnections.mockResolvedValueOnce(importedConns);
    const onClose = vi.fn();
    const { result } = renderImportExport({ onClose });

    const file = new File(["data"], "file.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    await act(async () => {
      await result.current.confirmImport("file.json");
    });

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: importedConns[0],
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: importedConns[1],
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining("Imported 2"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("confirmImport restores VPNs and tunnel chains from encrypted JSON imports", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDecryptWithPassword.mockResolvedValueOnce(
      JSON.stringify({
        vpnConnections: {
          openvpn: [{ name: "OpenVPN A", config: "ovpn-config" }],
          wireguard: [{ name: "WireGuard A", config: "wg-config" }],
          tailscale: [{ name: "Tailscale A", config: "tail-config" }],
          zerotier: [{ name: "ZeroTier A", config: "zt-config" }],
        },
        tunnelChainTemplates: [
          {
            name: "Chain A",
            layers: [],
            description: "First chain",
            tags: ["prod"],
          },
          {
            name: "Chain B",
            layers: [],
            description: "Second chain",
            tags: [],
          },
        ],
      }),
    );
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "conn-import-1", name: "Imported SSH", protocol: "ssh" },
    ]);
    mockCreateWireGuard.mockRejectedValueOnce(new Error("duplicate WG profile"));
    mockCreateZeroTier.mockRejectedValueOnce(new Error("duplicate ZT profile"));
    mockCreateTunnelChain
      .mockResolvedValueOnce({ id: "tc-1" })
      .mockRejectedValueOnce(new Error("duplicate tunnel chain"));

    const onClose = vi.fn();
    const { result } = renderImportExport({ onClose });

    const file = new File(["encrypted-json"], "import.encrypted.json", {
      type: "application/octet-stream",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["decrypt-me"]);

    expect(result.current.importResult).toMatchObject({
      success: true,
      imported: 1,
      vpnConnections: {
        openvpn: [{ name: "OpenVPN A", config: "ovpn-config" }],
        wireguard: [{ name: "WireGuard A", config: "wg-config" }],
        tailscale: [{ name: "Tailscale A", config: "tail-config" }],
        zerotier: [{ name: "ZeroTier A", config: "zt-config" }],
      },
    });
    expect(result.current.importResult?.tunnelChainTemplates).toHaveLength(2);

    await act(async () => {
      await result.current.confirmImport("import.encrypted.json");
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: { id: "conn-import-1", name: "Imported SSH", protocol: "ssh" },
    });
    expect(mockCreateOpenVPN).toHaveBeenCalledWith("OpenVPN A", "ovpn-config");
    expect(mockCreateWireGuard).toHaveBeenCalledWith("WireGuard A", "wg-config");
    expect(mockCreateTailscale).toHaveBeenCalledWith("Tailscale A", "tail-config");
    expect(mockCreateZeroTier).toHaveBeenCalledWith("ZeroTier A", "zt-config");
    expect(mockCreateTunnelChain).toHaveBeenCalledWith("Chain A", [], {
      description: "First chain",
      tags: ["prod"],
    });
    expect(mockCreateTunnelChain).toHaveBeenCalledWith("Chain B", [], {
      description: "Second chain",
      tags: [],
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 1 connection(s), 2 VPN connection(s), 1 tunnel chain(s) from import.encrypted.json",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data imported",
      undefined,
      "Imported 1 connection(s), 2 VPN connection(s), 1 tunnel chain(s) from import.encrypted.json",
    );
    expect(result.current.importResult).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("confirmImport summarizes VPN-only imports when no filename is provided", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");

    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Only", config: "ovpn" }],
            wireguard: [],
            tailscale: [],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Chain Only", layers: [], description: "desc", tags: [] },
          ],
        }),
      ],
      "vpn-only.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    await act(async () => {
      await result.current.confirmImport();
    });

    expect(mockCreateOpenVPN).toHaveBeenCalledWith("OpenVPN Only", "ovpn");
    expect(mockCreateTunnelChain).toHaveBeenCalledWith("Chain Only", [], {
      description: "desc",
      tags: [],
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 1 VPN connection(s), 1 tunnel chain(s) successfully",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data imported",
      undefined,
      "Imported 1 VPN connection(s), 1 tunnel chain(s)",
    );
  });

  it("confirmImport falls back to a 0-item summary when every restore operation fails", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockCreateOpenVPN.mockRejectedValueOnce(new Error("duplicate ovpn"));
    mockCreateTailscale.mockRejectedValueOnce(new Error("duplicate tailnet"));
    mockCreateTunnelChain.mockRejectedValueOnce(new Error("duplicate tunnel chain"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Only", config: "ovpn" }],
            wireguard: [],
            tailscale: [{ name: "Tailnet Only", config: "tail-config" }],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Broken Chain", layers: [], description: "desc", tags: [] },
          ],
        }),
      ],
      "restore-failures.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    await act(async () => {
      await result.current.confirmImport("restore-failures.json");
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 0 items from restore-failures.json",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data imported",
      undefined,
      "Imported 0 items from restore-failures.json",
    );
    warnSpy.mockRestore();
  });

  it("confirmImport is a no-op when there is no successful import result", async () => {
    const onClose = vi.fn();
    const { result } = renderImportExport({ onClose });

    await act(async () => {
      await result.current.confirmImport("noop.json");
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancelImport clears importResult and filename", async () => {
    const importedConns = [{ id: "c1", name: "A" }];
    mockImportConnections.mockResolvedValueOnce(importedConns);
    const { result } = renderImportExport();

    const file = new File(["data"], "file.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).not.toBeNull();

    act(() => result.current.cancelImport());
    expect(result.current.importResult).toBeNull();
    expect(result.current.importFilename).toBe("");
  });

  // ── Error handling ──────────────────────────────────────────

  it("handleFileSelect shows toast on unexpected read error", async () => {
    mockImportConnections.mockRejectedValueOnce(new Error("Parse explosion"));
    const { result } = renderImportExport();

    const file = new File(["bad data"], "broken.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).not.toBeNull();
    expect(result.current.importResult!.success).toBe(false);
    expect(result.current.importResult!.errors.length).toBeGreaterThan(0);
  });

  it("handleFileSelect uses a generic import error when processImportFile catches a non-Error throw", async () => {
    mockDetectImportFormat.mockImplementationOnce(() => {
      throw "string failure";
    });
    const { result } = renderImportExport();

    const file = new File(['{"connections":[]}'], "string-error.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Import failed"],
    });
  });

  it("handleFileSelect surfaces FileReader failures from readFileContent", async () => {
    const OriginalFileReader = globalThis.FileReader;
    vi.stubGlobal(
      "FileReader",
      class MockFileReader {
        result: string | ArrayBuffer | null = null;
        onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
        onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;

        readAsText() {
          this.onerror?.call(
            this as unknown as FileReader,
            new ProgressEvent("error") as ProgressEvent<FileReader>,
          );
        }
      } as unknown as typeof FileReader,
    );

    const { result } = renderImportExport();

    const file = new File(["bad data"], "reader-error.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Failed to read file"],
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Import failed. Check the console for details.",
    );

    vi.stubGlobal("FileReader", OriginalFileReader);
  });

  it("handleFileSelect falls back to an Unknown error message when file reading throws a non-Error", async () => {
    const OriginalFileReader = globalThis.FileReader;
    vi.stubGlobal(
      "FileReader",
      class MockFileReader {
        result: string | ArrayBuffer | null = null;
        onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
        onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;

        readAsText() {
          throw "plain reader failure";
        }
      } as unknown as typeof FileReader,
    );

    const { result } = renderImportExport();

    const file = new File(["bad data"], "reader-throws.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(result.current.importResult).toMatchObject({
      success: false,
      errors: ["Unknown error"],
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      "Import failed. Check the console for details.",
    );

    vi.stubGlobal("FileReader", OriginalFileReader);
  });
});
