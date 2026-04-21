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

vi.mock("../../src/utils/crypto/webCryptoAes", () => ({
  encryptWithPassword: vi.fn().mockResolvedValue("encrypted-payload"),
  decryptWithPassword: vi.fn().mockResolvedValue('{"connections":[]}'),
  isWebCryptoPayload: vi.fn().mockReturnValue(true),
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

import { useImportExport } from "../../src/hooks/sync/useImportExport";

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
});
