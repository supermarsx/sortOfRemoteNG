import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: string | { defaultValue?: string }) => {
      if (typeof f === "string") return f;
      if (f && typeof f === "object" && typeof f.defaultValue === "string") {
        return f.defaultValue;
      }
      return k;
    },
  }),
}));

/** Deterministic ISO timestamp used by every `Connection` fixture in
 *  this file. Centralised so a date change doesn't drift across rows
 *  and so we can grep all fixture rows at once. */
const FIXTURE_NOW = "2026-01-01T00:00:00.000Z";

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
const mockLoadData = vi.fn().mockResolvedValue(undefined);
const mockConnections: Connection[] = [
  {
    id: "conn-1",
    name: "Server A",
    protocol: "rdp",
    hostname: "10.0.0.1",
    port: 3389,
    username: "admin",
    password: "secret",
    domain: "CORP",
    description: "Primary server",
    parentId: undefined,
    isGroup: false,
    tags: ["prod"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
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
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mockConnections },
    dispatch: mockDispatch,
    loadData: mockLoadData,
  }),
}));

const mockExportCollection = vi.fn().mockResolvedValue('{"connections":[]}');
const mockGetCurrentCollection = vi
  .fn()
  .mockReturnValue({ id: "col-1", name: "Default", isEncrypted: false });
const mockGetExportableDatabases = vi.fn().mockResolvedValue([
  {
    id: "col-1",
    name: "Default",
    isEncrypted: false,
    isCurrent: true,
    isUnlocked: true,
    isExportable: true,
  },
]);
const mockReadExportableSnapshot = vi.fn().mockResolvedValue({
  collection: {
    id: "col-2",
    name: "Archive",
    isEncrypted: false,
    exportDate: "2026-01-01T00:00:00.000Z",
  },
  connections: [],
  settings: {},
  tabGroups: [],
  colorTags: {},
});
const mockGetAllConnections = vi.fn().mockResolvedValue([]);
const mockAddConnection = vi.fn().mockResolvedValue(undefined);
const mockAppendConnectionsToDatabase = vi.fn().mockResolvedValue(undefined);
const mockSelectDatabase = vi.fn().mockResolvedValue(undefined);
const mockUnlockDatabase = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getAllConnections: mockGetAllConnections,
      addConnection: mockAddConnection,
      getCurrentDatabase: mockGetCurrentCollection,
      getExportableDatabases: mockGetExportableDatabases,
      readExportableDatabaseSnapshot: mockReadExportableSnapshot,
      appendConnectionsToDatabase: mockAppendConnectionsToDatabase,
      selectDatabase: mockSelectDatabase,
      unlockDatabase: mockUnlockDatabase,
      exportDatabase: mockExportCollection,
    }),
    resetInstance: vi.fn(),
  },
}));

const mockLogAction = vi.fn();
const mockGetSettings = vi.fn().mockReturnValue({});
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: mockLogAction,
      getSettings: mockGetSettings,
    }),
  },
}));

const mockImportConnections = vi.fn().mockResolvedValue([]);
const mockDetectImportFormat = vi.fn().mockReturnValue("json");
const mockGetFormatName = vi.fn().mockReturnValue("JSON");
const mockDetectMRemoteNGEncryption = vi.fn().mockReturnValue({
  isEncrypted: false,
  fullFileEncryption: false,
  requiresPassword: false,
});
const mockDecryptMRemoteNGXml = vi.fn();
const mockVerifyMRemoteNGPassword = vi.fn().mockResolvedValue({ valid: true });

vi.mock("../../src/components/ImportExport/utils", () => ({
  importConnections: (...args: unknown[]) => mockImportConnections(...args),
  detectImportFormat: (...args: unknown[]) => mockDetectImportFormat(...args),
  getFormatName: (...args: unknown[]) => mockGetFormatName(...args),
  getImportFormatCompatibility: (format: string) => ({ value: format, label: format.toUpperCase() }),
  detectMRemoteNGEncryption: (...args: unknown[]) => mockDetectMRemoteNGEncryption(...args),
  decryptMRemoteNGXml: (...args: unknown[]) => mockDecryptMRemoteNGXml(...args),
  verifyMRemoteNGPassword: (...args: unknown[]) => mockVerifyMRemoteNGPassword(...args),
  MREMOTENG_DEFAULT_MASTER_PASSWORD: "mR3m",
}));

const mockEncryptWithPassword = vi.fn().mockResolvedValue("encrypted-payload");
const mockDecryptWithPassword = vi.fn().mockResolvedValue('{"connections":[]}');
const mockIsWebCryptoPayload = vi.fn().mockReturnValue(false);

vi.mock("../../src/utils/crypto/webCryptoAes", () => ({
  encryptWithPassword: (...args: unknown[]) => mockEncryptWithPassword(...args),
  decryptWithPassword: (...args: unknown[]) => mockDecryptWithPassword(...args),
  isWebCryptoPayload: (...args: unknown[]) => mockIsWebCryptoPayload(...args),
  normalizePbkdf2Iterations: (value?: number) => value ?? 100000,
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
const mockGetTunnelChain = vi.fn();
const mockCreateTunnelChain = vi.fn().mockResolvedValue({ id: "tc-1" });
const mockGetProfiles = vi.fn().mockReturnValue([]);
const mockGetProfile = vi.fn();
const mockCreateProfile = vi.fn().mockResolvedValue({ id: "profile-cloned" });
const mockGetChains = vi.fn().mockReturnValue([]);
const mockGetChain = vi.fn();
const mockCreateChain = vi.fn().mockResolvedValue({ id: "chain-cloned" });

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: {
    getTunnelChains: (...args: unknown[]) => mockGetTunnelChains(...args),
    getTunnelChain: (...args: unknown[]) => mockGetTunnelChain(...args),
    getProfiles: (...args: unknown[]) => mockGetProfiles(...args),
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    createProfile: (...args: unknown[]) => mockCreateProfile(...args),
    getChains: (...args: unknown[]) => mockGetChains(...args),
    getChain: (...args: unknown[]) => mockGetChain(...args),
    createChain: (...args: unknown[]) => mockCreateChain(...args),
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

function stubReadableBlob() {
  const OriginalBlob = globalThis.Blob;
  vi.stubGlobal(
    "Blob",
    class MockBlob {
      readonly type: string;
      private readonly parts: string[];

      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        this.parts = parts.map((part) => String(part));
        this.type = options?.type ?? "";
      }

      async text() {
        return this.parts.join("");
      }
    } as unknown as typeof Blob,
  );

  return () => vi.stubGlobal("Blob", OriginalBlob);
}

async function getLastDownloadedText() {
  const objectUrlCalls = vi.mocked(globalThis.URL.createObjectURL).mock.calls;
  const exportedBlob = objectUrlCalls[objectUrlCalls.length - 1][0] as Blob;
  return {
    blob: exportedBlob,
    text: await exportedBlob.text(),
  };
}

// Stub downloadFile's DOM interactions
beforeEach(() => {
  vi.clearAllMocks();
  mockEncryptWithPassword.mockReset();
  mockEncryptWithPassword.mockResolvedValue("encrypted-payload");
  mockDecryptWithPassword.mockReset();
  mockDecryptWithPassword.mockResolvedValue('{"connections":[]}');
  mockIsWebCryptoPayload.mockReset();
  mockIsWebCryptoPayload.mockReturnValue(false);
  mockPrompt.mockReset();
  mockPrompt.mockReturnValue("password");
  mockGetSettings.mockReset();
  mockGetSettings.mockReturnValue({});
  mockGetCurrentCollection.mockReset();
  mockGetCurrentCollection.mockReturnValue({ id: "col-1", name: "Default", isEncrypted: false });
  mockGetExportableDatabases.mockReset();
  mockGetExportableDatabases.mockResolvedValue([
    {
      id: "col-1",
      name: "Default",
      isEncrypted: false,
      isCurrent: true,
      isUnlocked: true,
      isExportable: true,
    },
  ]);
  mockReadExportableSnapshot.mockReset();
  mockReadExportableSnapshot.mockResolvedValue({
    collection: {
      id: "col-2",
      name: "Archive",
      isEncrypted: false,
      exportDate: "2026-01-01T00:00:00.000Z",
    },
    connections: [],
    settings: {},
    tabGroups: [],
    colorTags: {},
  });
  mockListOpenVPN.mockReset();
  mockListOpenVPN.mockResolvedValue([]);
  mockListWireGuard.mockReset();
  mockListWireGuard.mockResolvedValue([]);
  mockListTailscale.mockReset();
  mockListTailscale.mockResolvedValue([]);
  mockListZeroTier.mockReset();
  mockListZeroTier.mockResolvedValue([]);
  mockCreateOpenVPN.mockReset();
  mockCreateOpenVPN.mockResolvedValue("vpn-1");
  mockCreateWireGuard.mockReset();
  mockCreateWireGuard.mockResolvedValue("vpn-2");
  mockCreateTailscale.mockReset();
  mockCreateTailscale.mockResolvedValue("vpn-3");
  mockCreateZeroTier.mockReset();
  mockCreateZeroTier.mockResolvedValue("vpn-4");
  mockGetTunnelChains.mockReset();
  mockGetTunnelChains.mockReturnValue([]);
  mockGetTunnelChain.mockReset();
  mockGetTunnelChain.mockReturnValue(undefined);
  mockCreateTunnelChain.mockReset();
  mockCreateTunnelChain.mockResolvedValue({ id: "tc-1" });
  mockGetProfiles.mockReset();
  mockGetProfiles.mockReturnValue([]);
  mockGetProfile.mockReset();
  mockGetProfile.mockReturnValue(undefined);
  mockCreateProfile.mockReset();
  mockCreateProfile.mockResolvedValue({ id: "profile-cloned" });
  mockGetChains.mockReset();
  mockGetChains.mockReturnValue([]);
  mockGetChain.mockReset();
  mockGetChain.mockReturnValue(undefined);
  mockCreateChain.mockReset();
  mockCreateChain.mockResolvedValue({ id: "chain-cloned" });
  mockTauriInvoke.mockReset();
  mockTauriInvoke.mockResolvedValue('{"connections":[]}');
  vi.stubGlobal("prompt", mockPrompt);
  vi.stubGlobal("__TAURI__", { core: { invoke: mockTauriInvoke } });
  // Stub URL helpers used by downloadFile
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
  // Stub anchor element creation only — preserve real createElement for test containers
  // Capture original before any mocking to avoid recursive call stack
  const origCreate = Document.prototype.createElement;
  const mockLink = {
    href: "",
    download: "",
    click: vi.fn(),
  } as unknown as HTMLAnchorElement;
  vi.spyOn(document, "createElement").mockImplementation(function(this: Document, tag: string, options?: any) {
    if (tag === "a") return mockLink;
    return origCreate.call(this, tag, options);
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
    expect(result.current.exportInclusion).toMatchObject({
      includeConnections: true,
      includeCredentials: false,
      includeSettings: true,
      includeFolderItems: true,
      includeEmptyFolders: true,
      includeExportMetadata: true,
      includeDatabaseMetadata: true,
    });
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
    act(() => result.current.setExportFormat("excel"));
    expect(result.current.exportFormat).toBe("excel");
    act(() => result.current.setExportFormat("mremoteng"));
    expect(result.current.exportFormat).toBe("mremoteng");
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

  it("uses export security settings as initial defaults", () => {
    mockGetSettings.mockReturnValueOnce({
      exportSecurity: {
        defaultFormat: "markdown",
        encryptByDefault: true,
        includeConnectionsByDefault: false,
        includePasswordsByDefault: true,
        includeSettingsByDefault: false,
        includeFolderItemsByDefault: false,
        includeEmptyFoldersByDefault: false,
        keyDerivationIterations: 500000,
        includeVpnDataByDefault: false,
        includeTunnelChainsByDefault: false,
        includeTabGroupsByDefault: false,
        includeColorTagsByDefault: false,
        includeExportMetadataByDefault: false,
        includeDatabaseMetadataByDefault: false,
      },
    });

    const { result } = renderImportExport();

    expect(result.current.exportFormat).toBe("markdown");
    expect(result.current.exportEncrypted).toBe(true);
    expect(result.current.includePasswords).toBe(true);
    expect(result.current.exportInclusion).toMatchObject({
      includeConnections: false,
      includeCredentials: true,
      includeSettings: false,
      includeFolderItems: false,
      includeEmptyFolders: false,
      includeExportMetadata: false,
      includeDatabaseMetadata: false,
    });
    expect(result.current.exportKeyDerivationIterations).toBe(500000);
    expect(result.current.includeVpnData).toBe(false);
    expect(result.current.includeTunnelChains).toBe(false);
    expect(result.current.includeTabGroups).toBe(false);
    expect(result.current.includeColorTags).toBe(false);
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

  it("handleExport JSON builds a backward-compatible single-database payload", async () => {
    const restoreBlob = stubReadableBlob();
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const parsed = JSON.parse(text);
    expect(mockExportCollection).not.toHaveBeenCalled();
    expect(parsed).toHaveProperty("collection");
    expect(parsed).toHaveProperty("connections");
    expect(parsed).not.toHaveProperty("schema");
    expect(parsed).not.toHaveProperty("databases");
    expect(parsed.connections).toHaveLength(2);
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining("Exported successfully"),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("JSON"),
    );
    restoreBlob();
  });

  it("handleExport JSON includes export and database metadata inside the payload", async () => {
    const restoreBlob = stubReadableBlob();
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const parsed = JSON.parse(text);
    expect(parsed.exportMetadata).toMatchObject({
      app: { name: "sortOfRemoteNG" },
      schema: { name: "sortOfRemoteNG.database-export", version: 1 },
      format: "json",
      encrypted: false,
      scope: {
        mode: "current",
        effectiveDatabaseIds: ["col-1"],
      },
      inclusion: {
        includeConnections: true,
        includeSettings: true,
        includeExportMetadata: true,
        includeDatabaseMetadata: true,
      },
      totals: {
        databases: 1,
        connections: 2,
      },
    });
    expect(parsed.exportMetadata.exportId).toEqual(expect.any(String));
    expect(parsed.exportMetadata.exportedAt).toEqual(expect.any(String));
    expect(parsed.exportMetadata.sourceClient.machineId).toEqual(expect.any(String));
    expect(parsed.databaseMetadata).toMatchObject({
      collectionId: "col-1",
      name: "Default",
      isEncrypted: false,
      wasCurrentAtExport: true,
      counts: {
        leafConnections: 2,
      },
    });

    restoreBlob();
  });

  it("handleExport JSON encrypts the fully assembled export package locally", async () => {
    mockExportCollection.mockResolvedValueOnce('{"connections":[]}');
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("json-secret");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockExportCollection).not.toHaveBeenCalled();
    expect(mockEncryptWithPassword).toHaveBeenCalledWith(
      expect.stringContaining('"connections"'),
      "json-secret",
      { iterations: 310000 },
    );
    const plaintextBeforeEncryption = mockEncryptWithPassword.mock.calls[0][0] as string;
    expect(JSON.parse(plaintextBeforeEncryption).exportMetadata).toMatchObject({
      encrypted: true,
      encryption: {
        encrypted: true,
        keyDerivationIterations: 310000,
      },
    });
    const { text: downloadedText } = await getLastDownloadedText();
    expect(downloadedText).toBe("encrypted-payload");
    expect(downloadedText).not.toContain("exportMetadata");
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("JSON (encrypted, 310000 PBKDF2 iterations)"),
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

  it("handleExport JSON encrypts sidecars after enrichment", async () => {
    mockExportCollection.mockResolvedValueOnce('{"connections":[]}');
    mockListOpenVPN.mockResolvedValueOnce([{ name: "OpenVPN Secure", config: "ovpn" }]);
    mockGetTunnelChains.mockReturnValueOnce([
      { id: "chain-secure", name: "Secure Chain", layers: [], description: "", tags: [] },
    ]);
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("json-secret");
      result.current.setExportKeyDerivationIterations(640000);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const plaintextBeforeEncryption = mockEncryptWithPassword.mock.calls[0][0] as string;
    const parsed = JSON.parse(plaintextBeforeEncryption);
    expect(parsed.vpnConnections.openvpn).toEqual([
      { name: "OpenVPN Secure", config: "ovpn" },
    ]);
    expect(parsed.tunnelChainTemplates).toEqual([
      { id: "chain-secure", name: "Secure Chain", layers: [], description: "", tags: [] },
    ]);
    expect(mockEncryptWithPassword).toHaveBeenCalledWith(
      expect.any(String),
      "json-secret",
      { iterations: 640000 },
    );
  });

  it("handleExport JSON encrypts the assembled multi-database package", async () => {
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ]);
    mockReadExportableSnapshot.mockResolvedValueOnce({
      collection: {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        exportDate: "2026-01-01T00:00:00.000Z",
      },
      connections: [],
      settings: {},
      tabGroups: [],
      colorTags: {},
    });
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportScopeMode("all");
      result.current.setExportEncrypted(true);
      result.current.setExportPassword("package-secret");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const plaintextBeforeEncryption = mockEncryptWithPassword.mock.calls[0][0] as string;
    const parsed = JSON.parse(plaintextBeforeEncryption);
    expect(parsed.schema).toBe("sortOfRemoteNG.database-export-package");
    expect(parsed.databases).toHaveLength(2);
    expect(mockEncryptWithPassword).toHaveBeenCalledWith(
      expect.any(String),
      "package-secret",
      { iterations: 310000 },
    );
  });

  it("handleExport JSON respects sidecar and metadata toggles", async () => {
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

    mockExportCollection.mockResolvedValueOnce(
      JSON.stringify({ connections: [], tabGroups: [{ id: "tabs" }], colorTags: { red: "#f00" } }),
    );
    const { result } = renderImportExport();

    act(() => {
      result.current.setIncludeVpnData(false);
      result.current.setIncludeTunnelChains(false);
      result.current.setIncludeTabGroups(false);
      result.current.setIncludeColorTags(false);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const exportedBlob = vi.mocked(globalThis.URL.createObjectURL).mock.calls[0][0] as Blob;
    const exportedJson = JSON.parse(await exportedBlob.text());
    expect(exportedJson).not.toHaveProperty("vpnConnections");
    expect(exportedJson).not.toHaveProperty("tunnelChainTemplates");
    expect(exportedJson).not.toHaveProperty("tabGroups");
    expect(exportedJson).not.toHaveProperty("colorTags");

    vi.stubGlobal("Blob", OriginalBlob);
  });

  it("handleExport JSON omits connections, settings, and metadata when inclusion disables them", async () => {
    const restoreBlob = stubReadableBlob();
    const { result } = renderImportExport();

    act(() => {
      result.current.updateExportInclusion({
        includeConnections: false,
        includeSettings: false,
        includeExportMetadata: false,
        includeDatabaseMetadata: false,
      });
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const exportedJson = JSON.parse(text);
    expect(exportedJson).toHaveProperty("collection");
    expect(exportedJson.connections).toEqual([]);
    expect(exportedJson).not.toHaveProperty("settings");
    expect(exportedJson).not.toHaveProperty("exportMetadata");
    expect(exportedJson).not.toHaveProperty("databaseMetadata");

    restoreBlob();
  });

  it("handleExport JSON redacts nested secret-ish fields when credentials are excluded", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnection = { ...mockConnections[0] } as Connection;
    Object.assign(mockConnections[0], {
      privateKey: "PRIVATE KEY",
      passphrase: "key-passphrase",
      totpSecret: "totp-secret",
      basicAuthPassword: "basic-secret",
      rustdeskPassword: "rustdesk-secret",
      httpHeaders: {
        Authorization: "Bearer token",
        "X-Trace": "keep-me",
      },
      cloudProvider: {
        provider: "gcp",
        projectId: "project-1",
        apiKey: "api-key",
        accessToken: "access-token",
        clientSecret: "client-secret",
        serviceAccountKey: "service-account",
      },
      securityQuestions: [{ question: "Pet?", answer: "secret-answer" }],
      recoveryInfo: { alternativeEmail: "ops@example.com", seedPhrase: "seed words" },
      rdpSettings: {
        gateway: {
          enabled: true,
          hostname: "gateway.example.com",
          password: "gateway-secret",
          accessToken: "gateway-token",
        },
      },
    });
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const exportedConnection = JSON.parse(text).connections[0];
    expect(exportedConnection.password).toBe("***ENCRYPTED***");
    expect(exportedConnection.basicAuthPassword).toBe("***ENCRYPTED***");
    expect(exportedConnection.rustdeskPassword).toBe("***ENCRYPTED***");
    expect(exportedConnection).not.toHaveProperty("privateKey");
    expect(exportedConnection).not.toHaveProperty("passphrase");
    expect(exportedConnection).not.toHaveProperty("totpSecret");
    expect(exportedConnection.httpHeaders).toEqual({ "X-Trace": "keep-me" });
    expect(exportedConnection.cloudProvider).toEqual({ provider: "gcp", projectId: "project-1" });
    expect(exportedConnection.securityQuestions).toEqual([{ question: "Pet?" }]);
    expect(exportedConnection.recoveryInfo).toEqual({ alternativeEmail: "ops@example.com" });
    expect(exportedConnection.rdpSettings.gateway).toMatchObject({
      hostname: "gateway.example.com",
      password: "***ENCRYPTED***",
    });
    expect(exportedConnection.rdpSettings.gateway).not.toHaveProperty("accessToken");

    mockConnections.splice(0, 1, originalConnection);
    restoreBlob();
  });

  it("handleExport JSON filters protocols and keeps only needed folder ancestors", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnections = mockConnections.map((connection) => ({ ...connection }));
    mockConnections.splice(
      0,
      mockConnections.length,
      {
        id: "folder-root",
        name: "Root",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "folder-empty",
        name: "Empty",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "rdp-child",
        name: "RDP Host",
        protocol: "rdp",
        hostname: "10.0.0.10",
        port: 3389,
        parentId: "folder-root",
        isGroup: false,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "ssh-child",
        name: "SSH Host",
        protocol: "ssh",
        hostname: "10.0.0.11",
        port: 22,
        parentId: "folder-root",
        isGroup: false,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const { result } = renderImportExport();

    act(() => {
      result.current.updateExportInclusion({
        includeEmptyFolders: false,
        includedProtocols: ["ssh"],
      });
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const exportedConnections = JSON.parse(text).connections;
    expect(exportedConnections.map((connection: Connection) => connection.id)).toEqual([
      "folder-root",
      "ssh-child",
    ]);
    expect(exportedConnections.find((connection: Connection) => connection.id === "ssh-child").parentId).toBe("folder-root");

    mockConnections.splice(0, mockConnections.length, ...originalConnections);
    restoreBlob();
  });

  it("handleExport JSON drops folder records and normalizes parents when folders are excluded", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnections = mockConnections.map((connection) => ({ ...connection }));
    mockConnections.splice(
      0,
      mockConnections.length,
      {
        id: "folder-root",
        name: "Root",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "ssh-child",
        name: "SSH Host",
        protocol: "ssh",
        hostname: "10.0.0.11",
        port: 22,
        parentId: "folder-root",
        isGroup: false,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    const { result } = renderImportExport();

    act(() => {
      result.current.updateExportInclusion({ includeFolderItems: false });
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const exportedConnections = JSON.parse(text).connections;
    expect(exportedConnections).toHaveLength(1);
    expect(exportedConnections[0]).toMatchObject({ id: "ssh-child", isGroup: false });
    expect(exportedConnections[0]).not.toHaveProperty("parentId");

    mockConnections.splice(0, mockConnections.length, ...originalConnections);
    restoreBlob();
  });

  it("handleExport JSON packages all exportable databases and excludes locked databases", async () => {
    const restoreBlob = stubReadableBlob();
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: true,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-locked",
        name: "Locked",
        isEncrypted: true,
        isCurrent: false,
        isUnlocked: false,
        isExportable: false,
        lockedReason: "Unlock first",
      },
    ]);
    mockReadExportableSnapshot.mockResolvedValueOnce({
      collection: {
        id: "col-2",
        name: "Archive",
        isEncrypted: true,
        exportDate: "2026-01-01T00:00:00.000Z",
      },
      connections: [
        {
          id: "archive-1",
          name: "Archive Host",
          protocol: "ssh",
          hostname: "10.0.0.9",
          port: 22,
          isGroup: false,
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      settings: {},
      tabGroups: [],
      colorTags: {},
    });
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportScopeMode("all");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    const exportedJson = JSON.parse(text);
    expect(exportedJson).toMatchObject({
      schema: "sortOfRemoteNG.database-export-package",
      version: 1,
    });
    expect(exportedJson.databases.map((entry: any) => entry.collection.id)).toEqual([
      "col-1",
      "col-2",
    ]);
    expect(JSON.stringify(exportedJson)).not.toContain("col-locked");
    expect(mockReadExportableSnapshot).toHaveBeenCalledWith("col-2", false);
    expect(mockReadExportableSnapshot).not.toHaveBeenCalledWith("col-locked", expect.anything());

    restoreBlob();
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

  it("handleExport CSV includes database labels for multi-database exports", async () => {
    const restoreBlob = stubReadableBlob();
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ]);
    mockReadExportableSnapshot.mockResolvedValueOnce({
      collection: {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        exportDate: "2026-01-01T00:00:00.000Z",
      },
      connections: [
        {
          id: "archive-1",
          name: "Archive Host",
          protocol: "ssh",
          hostname: "10.0.0.9",
          port: 22,
          isGroup: false,
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      settings: {},
      tabGroups: [],
      colorTags: {},
    });
    const { result } = renderImportExport();

    act(() => {
      result.current.setExportFormat("csv");
      result.current.setExportScopeMode("all");
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const { text } = await getLastDownloadedText();
    expect(text.split("\n")[0]).toContain("Database,DatabaseId,ID,Name");
    expect(text).toContain("Default,col-1");
    expect(text).toContain("Archive,col-2,archive-1,Archive Host");

    restoreBlob();
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

  it("handleExport TXT writes a human-readable inventory outline", async () => {
    const restoreBlob = stubReadableBlob();
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("txt"));

    await act(async () => {
      await result.current.handleExport();
    });

    const { blob, text } = await getLastDownloadedText();
    expect(blob.type).toBe("text/plain");
    expect(text).toContain("sortOfRemoteNG connection inventory");
    expect(text).toContain("Total items: 2");
    expect(text).toContain("Credential-bearing connections: 1");
    expect(text).toContain("- [Connection] Server A");
    expect(text).toContain("Credentials: present (not included)");

    restoreBlob();
  });

  it("handleExport Markdown writes an escaped report table", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnection = { ...mockConnections[0] };
    Object.assign(mockConnections[0], {
      name: "Server | A",
      description: "<primary>\nline 2",
    });
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("markdown"));

    await act(async () => {
      await result.current.handleExport();
    });

    const { blob, text } = await getLastDownloadedText();
    expect(blob.type).toBe("text/markdown");
    expect(text).toContain("# sortOfRemoteNG Connection Inventory");
    expect(text).toContain("| Name | Kind | Protocol | Hostname");
    expect(text).toContain("Server \\| A");
    expect(text).toContain("&lt;primary&gt;<br>line 2");

    Object.assign(mockConnections[0], originalConnection);
    restoreBlob();
  });

  it("handleExport HTML escapes table content safely", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnection = { ...mockConnections[0] };
    Object.assign(mockConnections[0], {
      name: "<script>alert(1)</script>",
    });
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("html"));

    await act(async () => {
      await result.current.handleExport();
    });

    const { blob, text } = await getLastDownloadedText();
    expect(blob.type).toBe("text/html");
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).not.toContain("<script>alert(1)</script>");

    Object.assign(mockConnections[0], originalConnection);
    restoreBlob();
  });

  it("handleExport Excel writes an Excel-openable HTML table with .xls MIME", async () => {
    const restoreBlob = stubReadableBlob();
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("excel"));

    await act(async () => {
      await result.current.handleExport();
    });

    const { blob, text } = await getLastDownloadedText();
    expect(blob.type).toBe("application/vnd.ms-excel");
    expect(text).toContain("urn:schemas-microsoft-com:office:excel");
    expect(text).toContain("<table aria-label=\"Connection inventory\">");
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining(".xls"),
    );

    restoreBlob();
  });

  it("handleExport mRemoteNG writes Connections and nested Node XML without native encryption", async () => {
    const restoreBlob = stubReadableBlob();
    const originalConnections = mockConnections.map((connection) => ({ ...connection }));
    mockConnections.splice(
      0,
      mockConnections.length,
      {
        id: "group-1",
        name: "Ops",
        protocol: "rdp",
        hostname: "",
        port: 0,
        username: "",
        domain: "",
        description: "Operations",
        parentId: undefined,
        isGroup: true,
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "ssh-child",
        name: "Shell <Prod>",
        protocol: "ssh",
        hostname: "10.0.0.5",
        port: 22,
        username: "root",
        password: "secret",
        domain: "",
        description: "Nested host",
        parentId: "group-1",
        isGroup: false,
        tags: [],
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    );
    const { result } = renderImportExport();
    act(() => result.current.setExportFormat("mremoteng"));

    await act(async () => {
      await result.current.handleExport();
    });

    const { blob, text } = await getLastDownloadedText();
    expect(blob.type).toBe("application/xml");
    expect(text).toContain("<Connections Name=\"Connections\" Export=\"False\" Protected=\"\" ConfVersion=\"2.6\">");
    expect(text).toContain("<Node Name=\"Ops\" Type=\"Container\"");
    expect(text).toContain("<Node Name=\"Shell &lt;Prod&gt;\" Type=\"Connection\"");
    expect(text).toContain("Protocol=\"SSH2\"");
    expect(text).toContain("Password=\"\"");
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining(".mremoteng.xml"),
    );

    mockConnections.splice(0, mockConnections.length, ...originalConnections);
    restoreBlob();
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
      { iterations: 310000 },
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining(".encrypted.xml"),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      expect.stringContaining("XML (encrypted, 310000 PBKDF2 iterations)"),
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

    expect(mockExportCollection).not.toHaveBeenCalled();
    expect(mockEncryptWithPassword).not.toHaveBeenCalled();
    expect(mockLogAction).toHaveBeenCalledWith(
      "info",
      "Data exported",
      undefined,
      "Exported 2 connections from 1 database(s) to JSON",
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
    mockGetCurrentCollection.mockReturnValue(null);
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

  it("handleFileSelect prompts for WebCrypto payloads even when the filename is plain JSON", async () => {
    mockIsWebCryptoPayload.mockReturnValue(true);
    mockDecryptWithPassword.mockResolvedValueOnce('{"connections":[{"id":"secure-1"}]}');
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "secure-1", name: "Secure Import", protocol: "ssh" },
    ]);

    const { result } = renderImportExport();

    const file = new File(["encrypted-json-envelope"], "renamed.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await selectFileWithPrompt(result, event, ["payload-pass"]);

    expect(mockDecryptWithPassword).toHaveBeenCalledWith(
      "encrypted-json-envelope",
      "payload-pass",
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
      errors: ["Failed to decrypt file. The password is likely incorrect."],
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
      errors: ["Failed to decrypt file. The password is likely incorrect."],
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
      errors: ["Failed to decrypt file. The password is likely incorrect."],
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
    expect(result.current.importPreviewItems.map((item) => item.kind)).toEqual([
      "vpn",
      "tunnelChain",
    ]);
    expect(mockToast.error).not.toHaveBeenCalledWith(
      "Import failed. Check the file format and try again.",
    );
  });

  it("confirmImport restores only selected VPN and tunnel-chain preview rows", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");
    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Selected", config: "ovpn-selected" }],
            wireguard: [{ name: "WireGuard Skipped", config: "wg-skipped" }],
            tailscale: [],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Chain Selected", layers: [], description: "keep", tags: [] },
            { name: "Chain Skipped", layers: [], description: "drop", tags: [] },
          ],
        }),
      ],
      "selected-sidecars.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    const wireGuardRow = result.current.importPreviewItems.find(
      (item) => item.name === "WireGuard Skipped",
    );
    const skippedChainRow = result.current.importPreviewItems.find(
      (item) => item.name === "Chain Skipped",
    );
    expect(wireGuardRow?.kind).toBe("vpn");
    expect(skippedChainRow?.kind).toBe("tunnelChain");

    await act(async () => {
      result.current.togglePreviewSelection(wireGuardRow!.id);
      result.current.togglePreviewSelection(skippedChainRow!.id);
    });

    await act(async () => {
      await result.current.confirmImport("selected-sidecars.json");
    });

    expect(mockCreateOpenVPN).toHaveBeenCalledWith(
      "OpenVPN Selected",
      "ovpn-selected",
    );
    expect(mockCreateWireGuard).not.toHaveBeenCalled();
    expect(mockCreateTunnelChain).toHaveBeenCalledTimes(1);
    expect(mockCreateTunnelChain).toHaveBeenCalledWith("Chain Selected", [], {
      description: "keep",
      tags: [],
    });
  });

  it("confirmImport master toggles block selected VPN and tunnel-chain rows", async () => {
    mockImportConnections.mockResolvedValueOnce([]);
    mockDetectImportFormat.mockReturnValueOnce("json");
    const { result } = renderImportExport();

    const file = new File(
      [
        JSON.stringify({
          vpnConnections: {
            openvpn: [{ name: "OpenVPN Blocked", config: "ovpn-blocked" }],
            wireguard: [],
            tailscale: [],
            zerotier: [],
          },
          tunnelChainTemplates: [
            { name: "Chain Blocked", layers: [], description: "blocked", tags: [] },
          ],
        }),
      ],
      "blocked-sidecars.json",
      { type: "application/json" },
    );
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
      result.current.updateImportOptions({
        includeVpnData: false,
        includeTunnelChains: false,
      });
    });

    await act(async () => {
      await result.current.confirmImport("blocked-sidecars.json");
    });

    expect(mockCreateOpenVPN).not.toHaveBeenCalled();
    expect(mockCreateTunnelChain).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 0 items from blocked-sidecars.json",
    );
  });

  it("handleFileSelect lists SSH tunnel rows and confirmImport strips deselected tunnels", async () => {
    mockDetectImportFormat.mockReturnValueOnce("mremoteng");
    mockGetFormatName.mockReturnValueOnce("mRemoteNG");
    mockImportConnections.mockResolvedValueOnce([
      {
        id: "jump-1",
        name: "Bastion",
        protocol: "ssh",
        hostname: "bastion.example.com",
        port: 22,
        username: "jump",
        isGroup: false,
        tags: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: "target-1",
        name: "Internal RDP",
        protocol: "rdp",
        hostname: "10.10.0.25",
        port: 3389,
        isGroup: false,
        tags: [],
        security: {
          tunnelChain: [
            {
              id: "layer-1",
              type: "ssh-tunnel",
              enabled: true,
              localBindPort: 0,
              sshTunnel: {
                forwardType: "local",
                host: "bastion.example.com",
                port: 22,
                username: "jump",
                remoteHost: "10.10.0.25",
                remotePort: 3389,
              },
            },
          ],
        },
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ] as Connection[]);
    const { result } = renderImportExport();

    const file = new File(["<Connections />"], "tunnels.xml", {
      type: "text/xml",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    const sshTunnelRow = result.current.importPreviewItems.find(
      (item) => item.kind === "sshTunnel",
    );
    expect(sshTunnelRow).toMatchObject({
      name: "Internal RDP SSH tunnel",
      hostname: "bastion.example.com",
      sshTunnelConnectionId: "target-1",
    });
    expect(result.current.importAnalysis?.counts.sshTunnels).toBe(1);

    await act(async () => {
      result.current.togglePreviewSelection(sshTunnelRow!.id);
    });

    await act(async () => {
      await result.current.confirmImport("tunnels.xml");
    });

    const importedTarget = mockDispatch.mock.calls
      .map(([action]) => action?.payload)
      .find((connection) => connection?.name === "Internal RDP");
    expect(importedTarget?.security?.tunnelChain).toBeUndefined();
    expect(mockToast.success).toHaveBeenCalledWith(
      "Imported 2 connection(s) from tunnels.xml",
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

  it("handleFileSelect honors a forced import format over auto-detection", async () => {
    mockDetectImportFormat.mockReturnValueOnce("json");
    mockImportConnections.mockResolvedValueOnce([
      { id: "termius-1", name: "Termius Host", protocol: "ssh" },
    ]);
    const { result } = renderImportExport();

    await act(async () => {
      await result.current.setImportFormatSelection("termius");
    });

    const file = new File([JSON.stringify({ hosts: [] })], "ambiguous.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    expect(mockImportConnections).toHaveBeenCalledWith(
      JSON.stringify({ hosts: [] }),
      "ambiguous.json",
      "termius",
    );
    expect(result.current.importAnalysis?.formatForced).toBe(true);
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

  it("confirmImport appends to a selected non-current database and can switch after import", async () => {
    const databases = [
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ];
    mockGetExportableDatabases
      .mockResolvedValueOnce(databases)
      .mockResolvedValueOnce(databases);
    const importedConns = [{ id: "archive-1", name: "Archive Host" }];
    mockImportConnections.mockResolvedValueOnce(importedConns);
    const { result } = renderImportExport();

    await waitFor(() => {
      expect(result.current.importDatabaseOptions).toHaveLength(2);
    });

    await act(async () => {
      await result.current.setSelectedImportDatabaseId("col-2");
      result.current.updateImportOptions({ switchToTargetDatabaseAfterImport: true });
    });

    const file = new File(["data"], "archive.json", {
      type: "application/json",
    });
    const event = {
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileSelect(event);
    });

    await act(async () => {
      await result.current.confirmImport("archive.json");
    });

    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "ADD_CONNECTION",
      payload: importedConns[0],
    });
    expect(mockAppendConnectionsToDatabase).toHaveBeenCalledWith("col-2", importedConns);
    expect(mockSelectDatabase).toHaveBeenCalledWith("col-2");
    expect(mockLoadData).toHaveBeenCalled();
  });

  it("confirmImport restores VPNs and tunnel chains from encrypted JSON imports", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockIsWebCryptoPayload.mockReturnValueOnce(true);
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

  it("handleClone filters qualified connection ids against each source database", async () => {
    const databases = [
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-3",
        name: "Target",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ];
    const archiveConnections: Connection[] = [
      {
        id: "conn-1",
        name: "Archive SSH",
        protocol: "ssh",
        hostname: "10.0.0.50",
        port: 22,
        isGroup: false,
        tags: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ];
    mockGetExportableDatabases.mockResolvedValue(databases);
    mockReadExportableSnapshot.mockImplementation(async (databaseId: string) => ({
      collection: {
        id: databaseId,
        name: databaseId === "col-2" ? "Archive" : "Target",
        isEncrypted: false,
      },
      connections: databaseId === "col-2" ? archiveConnections : [],
      settings: {},
      tabGroups: [],
      colorTags: {},
    }));

    const { result } = renderImportExport({ initialTab: "clone" });
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions).toHaveLength(3);
    });

    act(() => {
      result.current.setCloneSourceMode("selected");
      result.current.setSelectedCloneSourceDatabaseIds(["col-1", "col-2"]);
      result.current.setCloneTargetDatabaseIds(["col-3"]);
      result.current.updateCloneInclusion({
        includedConnectionIds: ["col-2:conn-1"],
      });
    });
    await waitFor(() => {
      expect(result.current.cloneSourceMode).toBe("selected");
    });

    await act(async () => {
      await result.current.handleClone();
    });

    expect(mockAppendConnectionsToDatabase).toHaveBeenCalledWith(
      "col-3",
      expect.arrayContaining([
        expect.objectContaining({ name: "Archive SSH", hostname: "10.0.0.50" }),
      ]),
    );
    expect(mockAppendConnectionsToDatabase.mock.calls[0][1]).toHaveLength(1);
  });

  it("handleClone filters qualified folder ids and preserves selected parent folders", async () => {
    const databases = [
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Archive",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-3",
        name: "Target",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ];
    const archiveConnections: Connection[] = [
      {
        id: "folder-prod",
        name: "Production",
        protocol: "rdp",
        hostname: "",
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: "conn-prod",
        name: "Production SSH",
        protocol: "ssh",
        hostname: "10.0.0.60",
        port: 22,
        parentId: "folder-prod",
        isGroup: false,
        tags: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: "conn-outside",
        name: "Outside SSH",
        protocol: "ssh",
        hostname: "10.0.0.61",
        port: 22,
        isGroup: false,
        tags: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ];
    mockGetExportableDatabases.mockResolvedValue(databases);
    mockReadExportableSnapshot.mockImplementation(async (databaseId: string) => ({
      collection: {
        id: databaseId,
        name: databaseId === "col-2" ? "Archive" : "Target",
        isEncrypted: false,
      },
      connections: databaseId === "col-2" ? archiveConnections : [],
      settings: {},
      tabGroups: [],
      colorTags: {},
    }));

    const { result } = renderImportExport({ initialTab: "clone" });
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions).toHaveLength(3);
    });

    act(() => {
      result.current.setCloneSourceMode("selected");
      result.current.setSelectedCloneSourceDatabaseIds(["col-2"]);
      result.current.setCloneTargetDatabaseIds(["col-3"]);
      result.current.updateCloneInclusion({
        includedFolderIds: ["col-2:folder-prod"],
        includeEmptyFolders: false,
      });
    });

    await act(async () => {
      await result.current.handleClone();
    });

    const cloned = mockAppendConnectionsToDatabase.mock.calls[0][1] as Connection[];
    expect(cloned.map((connection) => connection.name)).toEqual([
      "Production",
      "Production SSH",
    ]);
    expect(cloned.find((connection) => connection.name === "Production SSH")?.parentId)
      .toBe("folder-prod");
  });

  it("handleClone clones selected sidecars and remaps cloned connection references", async () => {
    const databases = [
      {
        id: "col-1",
        name: "Default",
        isEncrypted: false,
        isCurrent: true,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-2",
        name: "Source",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
      {
        id: "col-3",
        name: "Target",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
      },
    ];
    const sourceConnections: Connection[] = [
      {
        id: "conn-sidecars",
        name: "Sidecar SSH",
        protocol: "ssh",
        hostname: "10.0.0.60",
        port: 22,
        isGroup: false,
        tags: [],
        proxyChainId: "proxy-chain-1",
        tunnelChainId: "tunnel-chain-1",
        security: {
          openvpn: { enabled: true, configId: "vpn-old" },
        },
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ];
    const proxyProfile = {
      id: "profile-1",
      name: "HTTP Proxy",
      config: { type: "http", host: "proxy.local", port: 8080 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const proxyChain = {
      id: "proxy-chain-1",
      name: "Proxy Chain",
      layers: [{ position: 0, type: "proxy", proxyProfileId: "profile-1" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const tunnelChain = {
      id: "tunnel-chain-1",
      name: "Tunnel Chain",
      layers: [
        {
          id: "layer-1",
          type: "openvpn",
          enabled: true,
          vpn: { configId: "vpn-old" },
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    mockGetExportableDatabases.mockResolvedValue(databases);
    mockReadExportableSnapshot.mockImplementation(async (databaseId: string) => ({
      collection: {
        id: databaseId,
        name: databaseId === "col-2" ? "Source" : "Target",
        isEncrypted: false,
      },
      connections: databaseId === "col-2" ? sourceConnections : [],
      settings: {},
      tabGroups: [],
      colorTags: {},
    }));
    mockGetProfiles.mockReturnValue([proxyProfile]);
    mockGetProfile.mockReturnValue(proxyProfile);
    mockGetChains.mockReturnValue([proxyChain]);
    mockGetChain.mockReturnValue(proxyChain);
    mockGetTunnelChains.mockReturnValue([tunnelChain]);
    mockGetTunnelChain.mockReturnValue(tunnelChain);
    mockListOpenVPN.mockResolvedValue([
      {
        id: "vpn-old",
        name: "VPN Old",
        config: { remoteHost: "vpn.local" },
        status: "disconnected",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    mockCreateProfile.mockResolvedValue({ ...proxyProfile, id: "profile-new" });
    mockCreateOpenVPN.mockResolvedValue("vpn-new");
    mockCreateChain.mockResolvedValue({ ...proxyChain, id: "proxy-chain-new" });
    mockCreateTunnelChain.mockResolvedValue({
      ...tunnelChain,
      id: "tunnel-chain-new",
    });

    const { result } = renderImportExport({ initialTab: "clone" });
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions).toHaveLength(3);
    });

    act(() => {
      result.current.setCloneSourceMode("selected");
      result.current.setSelectedCloneSourceDatabaseIds(["col-2"]);
      result.current.setCloneTargetDatabaseIds(["col-3"]);
      result.current.updateCloneInclusion({
        includedConnectionIds: ["col-2:conn-sidecars"],
        includeTunnelChains: true,
        includeVpnData: true,
        includedProxyProfileIds: ["profile-1"],
        includedProxyChainIds: ["proxy-chain-1", "tunnel-chain-1"],
        includedVpnConnectionIds: ["vpn-old"],
      });
    });

    await act(async () => {
      await result.current.handleClone();
    });

    expect(mockCreateProfile).toHaveBeenCalledWith(
      "HTTP Proxy",
      { type: "http", host: "proxy.local", port: 8080 },
      {
        description: undefined,
        tags: undefined,
        isDefault: false,
      },
    );
    expect(mockCreateOpenVPN).toHaveBeenCalledWith("VPN Old", {
      remoteHost: "vpn.local",
    });
    expect(mockCreateChain).toHaveBeenCalledWith(
      "Proxy Chain",
      [{ position: 0, type: "proxy", proxyProfileId: "profile-new" }],
      {
        description: undefined,
        tags: undefined,
      },
    );
    expect(mockCreateTunnelChain).toHaveBeenCalledWith(
      "Tunnel Chain",
      [
        {
          id: "layer-1",
          type: "openvpn",
          enabled: true,
          vpn: { configId: "vpn-new" },
        },
      ],
      {
        description: undefined,
        tags: undefined,
      },
    );
    expect(mockAppendConnectionsToDatabase).toHaveBeenCalledWith(
      "col-3",
      expect.arrayContaining([
        expect.objectContaining({
          name: "Sidecar SSH",
          proxyChainId: "proxy-chain-new",
          tunnelChainId: "tunnel-chain-new",
          security: expect.objectContaining({
            openvpn: expect.objectContaining({ configId: "vpn-new" }),
          }),
        }),
      ]),
    );
    expect(result.current.cloneResult?.sidecarsCloned).toMatchObject({
      proxyProfiles: 1,
      proxyChains: 1,
      tunnelChains: 1,
      vpnConnections: 1,
      total: 4,
    });
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

  // ── handleUnlockDatabase ────────────────────────────────────────

  it("handleUnlockDatabase returns true and refreshes lists on correct password", async () => {
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "locked-1",
        name: "Locked DB",
        description: "",
        isEncrypted: true,
        isCurrent: false,
        isUnlocked: false,
        isExportable: false,
        lockedReason: "Encrypted database is locked.",
        lastAccessed: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockUnlockDatabase.mockResolvedValueOnce(undefined);

    const { result } = renderImportExport();
    // Wait for the initial database-options fetch to resolve so the
    // unlock handler can look up the row by id.
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions.length).toBeGreaterThan(0);
    });

    // Kick off the unlock — it will queue a password prompt.
    let unlockPromise: Promise<boolean> | undefined;
    act(() => {
      unlockPromise = result.current.handleUnlockDatabase("locked-1");
    });
    await waitFor(() => {
      expect(result.current.passwordPrompt).not.toBeNull();
    });
    expect(result.current.passwordPrompt?.title).toContain("Locked DB");

    // Submit the correct password.
    act(() => {
      result.current.submitPasswordPrompt("right-secret");
    });

    const success = await unlockPromise!;
    expect(success).toBe(true);
    expect(mockUnlockDatabase).toHaveBeenCalledWith(
      "locked-1",
      "right-secret",
    );
    // All three option lists were refreshed — getExportableDatabases
    // is called at least once per refresh × 3 lists, plus the
    // initial mount fetch.
    expect(mockGetExportableDatabases.mock.calls.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(mockToast.success).toHaveBeenCalledWith('Unlocked "Locked DB".');
  });

  it("handleUnlockDatabase retries the prompt with a wrong-password error", async () => {
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "locked-2",
        name: "Vault",
        description: "",
        isEncrypted: true,
        isCurrent: false,
        isUnlocked: false,
        isExportable: false,
        lockedReason: "",
        lastAccessed: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const invalid = new Error("Invalid password");
    invalid.name = "InvalidPasswordError";
    mockUnlockDatabase.mockRejectedValueOnce(invalid);
    mockUnlockDatabase.mockResolvedValueOnce(undefined);

    const { result } = renderImportExport();
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions.length).toBeGreaterThan(0);
    });

    let unlockPromise: Promise<boolean> | undefined;
    act(() => {
      unlockPromise = result.current.handleUnlockDatabase("locked-2");
    });

    // First prompt — submit a wrong password.
    await waitFor(() => {
      expect(result.current.passwordPrompt).not.toBeNull();
    });
    expect(result.current.passwordPrompt?.error).toBeUndefined();
    act(() => {
      result.current.submitPasswordPrompt("wrong");
    });

    // Hook re-prompts with the error string.
    await waitFor(() => {
      expect(result.current.passwordPrompt?.error).toBe(
        "Wrong password — try again.",
      );
    });

    // Second prompt — submit the correct password.
    act(() => {
      result.current.submitPasswordPrompt("right");
    });

    const success = await unlockPromise!;
    expect(success).toBe(true);
    expect(mockUnlockDatabase).toHaveBeenCalledTimes(2);
    expect(mockUnlockDatabase).toHaveBeenLastCalledWith("locked-2", "right");
  });

  it("handleUnlockDatabase returns false when the user cancels the prompt", async () => {
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "locked-3",
        name: "Cancel Test",
        description: "",
        isEncrypted: true,
        isCurrent: false,
        isUnlocked: false,
        isExportable: false,
        lockedReason: "",
        lastAccessed: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const { result } = renderImportExport();
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions.length).toBeGreaterThan(0);
    });

    let unlockPromise: Promise<boolean> | undefined;
    act(() => {
      unlockPromise = result.current.handleUnlockDatabase("locked-3");
    });
    await waitFor(() => {
      expect(result.current.passwordPrompt).not.toBeNull();
    });
    act(() => {
      result.current.cancelPasswordPrompt();
    });

    const success = await unlockPromise!;
    expect(success).toBe(false);
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
  });

  it("handleUnlockDatabase short-circuits on non-encrypted databases", async () => {
    mockGetExportableDatabases.mockResolvedValue([
      {
        id: "open-1",
        name: "Open",
        description: "",
        isEncrypted: false,
        isCurrent: false,
        isUnlocked: true,
        isExportable: true,
        lockedReason: undefined,
        lastAccessed: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const { result } = renderImportExport();
    await waitFor(() => {
      expect(result.current.cloneDatabaseOptions.length).toBeGreaterThan(0);
    });

    const success = await act(async () =>
      result.current.handleUnlockDatabase("open-1"),
    );
    expect(success).toBe(true);
    // No prompt was shown; no unlockDatabase call.
    expect(result.current.passwordPrompt).toBeNull();
    expect(mockUnlockDatabase).not.toHaveBeenCalled();
  });
});
