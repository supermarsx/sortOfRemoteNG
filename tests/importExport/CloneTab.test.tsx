import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import CloneTab from "../../src/components/ImportExport/CloneTab";
import type {
  CloneSourceCatalogItem,
  ExportDatabaseOption,
  ExportInclusionConfig,
} from "../../src/components/ImportExport/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const proxyCollectionMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(() => [
    {
      id: "proxy-http",
      name: "HTTP Proxy",
      config: { type: "http", host: "proxy.local", port: 8080 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "proxy-socks",
      name: "SOCKS Proxy",
      config: { type: "socks5", host: "socks.local", port: 1080 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
  getChains: vi.fn(() => [
    {
      id: "proxy-chain-1",
      name: "Proxy Chain A",
      layers: [{ position: 0, type: "proxy", proxyProfileId: "proxy-http" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
  getTunnelChains: vi.fn(() => [
    {
      id: "tunnel-chain-1",
      name: "Tunnel Chain A",
      layers: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
}));

vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: proxyCollectionMocks,
}));

const vpnManagerMock = vi.hoisted(() => ({
  listOpenVPNConnections: vi.fn(async () => [
    {
      id: "vpn-openvpn",
      name: "OpenVPN Main",
      kind: "OpenVPN",
      config: {},
      status: "disconnected",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "vpn-backup",
      name: "OpenVPN Backup",
      kind: "OpenVPN",
      config: {},
      status: "disconnected",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ]),
  listWireGuardConnections: vi.fn(async () => []),
  listTailscaleConnections: vi.fn(async () => []),
  listZeroTierConnections: vi.fn(async () => []),
}));

vi.mock("../../src/utils/network/proxyOpenVPNManager", () => ({
  ProxyOpenVPNManager: {
    getInstance: () => vpnManagerMock,
  },
}));

const inclusion: ExportInclusionConfig = {
  includeConnections: true,
  includeCredentials: true,
  includeSettings: true,
  includeFolderItems: true,
  includeEmptyFolders: false,
  includeTabGroups: false,
  includeColorTags: true,
  includeVpnData: false,
  includeTunnelChains: false,
  includeExportMetadata: false,
  includeDatabaseMetadata: false,
  includedProtocols: [],
  includedConnectionIds: [],
  includedFolderIds: [],
  includedTextTags: [],
  includedColorTagIds: [],
  includedProxyProfileIds: [],
  includedProxyChainIds: [],
  includedVpnConnectionIds: [],
};

const databaseOptions: ExportDatabaseOption[] = [
  {
    id: "db-1",
    name: "Primary",
    isCurrent: true,
    isEncrypted: false,
    isUnlocked: true,
    isExportable: true,
  },
  {
    id: "db-2",
    name: "Archive",
    isCurrent: false,
    isEncrypted: false,
    isUnlocked: true,
    isExportable: true,
  },
  {
    id: "db-target",
    name: "Target",
    isCurrent: false,
    isEncrypted: false,
    isUnlocked: true,
    isExportable: true,
  },
];

const sourceCatalog: CloneSourceCatalogItem[] = [
  {
    key: "db-1:folder-ops",
    sourceDatabaseId: "db-1",
    sourceDatabaseName: "Primary",
    connectionId: "folder-ops",
    name: "Ops",
    path: "Ops",
    protocol: "rdp",
    tags: [],
    isGroup: true,
    ancestorKeys: [],
  },
  {
    key: "db-1:conn-1",
    sourceDatabaseId: "db-1",
    sourceDatabaseName: "Primary",
    connectionId: "conn-1",
    name: "Primary SSH",
    path: "Ops / Primary SSH",
    protocol: "ssh",
    hostname: "10.0.0.1",
    tags: ["prod"],
    colorTag: "#22c55e",
    isGroup: false,
    parentId: "folder-ops",
    ancestorKeys: ["db-1:folder-ops"],
  },
  {
    key: "db-2:folder-archive",
    sourceDatabaseId: "db-2",
    sourceDatabaseName: "Archive",
    connectionId: "folder-archive",
    name: "Archive Root",
    path: "Archive Root",
    protocol: "rdp",
    tags: [],
    isGroup: true,
    ancestorKeys: [],
  },
  {
    key: "db-2:conn-1",
    sourceDatabaseId: "db-2",
    sourceDatabaseName: "Archive",
    connectionId: "conn-1",
    name: "Archive SSH",
    path: "Archive SSH",
    protocol: "ssh",
    hostname: "10.0.0.2",
    tags: ["archive"],
    colorTag: "#ef4444",
    isGroup: false,
    parentId: "folder-archive",
    ancestorKeys: ["db-2:folder-archive"],
  },
];

function renderCloneTab(overrides?: Partial<ComponentProps<typeof CloneTab>>) {
  const updateInclusion = vi.fn();
  const props: ComponentProps<typeof CloneTab> = {
    sourceMode: "all",
    setSourceMode: vi.fn(),
    selectedSourceDatabaseIds: [],
    setSelectedSourceDatabaseIds: vi.fn(),
    inclusion,
    updateInclusion,
    sourceCatalog,
    targetDatabaseIds: ["db-target"],
    setTargetDatabaseIds: vi.fn(),
    conflictPolicy: "duplicate",
    setConflictPolicy: vi.fn(),
    addTags: "",
    setAddTags: vi.fn(),
    preserveFolders: true,
    setPreserveFolders: vi.fn(),
    includeCredentials: true,
    setIncludeCredentials: vi.fn(),
    switchToTargetAfterClone: false,
    setSwitchToTargetAfterClone: vi.fn(),
    databaseOptions,
    isCloning: false,
    cloneResult: null,
    onClone: vi.fn(),
    onClearResult: vi.fn(),
    ...overrides,
  };

  return { ...render(<CloneTab {...props} />), updateInclusion };
}

describe("CloneTab", () => {
  it("renders concrete connection, folder, tag, and color selectors grouped by source database", () => {
    renderCloneTab();

    fireEvent.click(within(screen.getByTestId("clone-filter-section")).getByRole("button"));

    expect(screen.getByTestId("clone-connections-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-folders-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-text-tags-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-color-tags-section")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("clone-connections-section")).getByRole("button"));

    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Primary SSH" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Archive SSH" })).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("clone-folders-section")).getByRole("button"));
    expect(screen.getByRole("checkbox", { name: "Ops" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Archive Root" })).toBeInTheDocument();
  });

  it("updates qualified folder ids and clearing returns to all folders", () => {
    const { updateInclusion } = renderCloneTab();

    fireEvent.click(within(screen.getByTestId("clone-filter-section")).getByRole("button"));
    fireEvent.click(within(screen.getByTestId("clone-folders-section")).getByRole("button"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ops" }));

    expect(updateInclusion).toHaveBeenCalledWith({
      includedFolderIds: ["db-2:folder-archive"],
    });

    renderCloneTab({
      inclusion: { ...inclusion, includedFolderIds: ["db-1:folder-ops"] },
      updateInclusion,
    });
    fireEvent.click(within(screen.getAllByTestId("clone-filter-section")[1]).getByRole("button"));
    fireEvent.click(within(screen.getAllByTestId("clone-folders-section")[1]).getByRole("button"));
    const clearButtons = screen.getAllByRole("button", {
      name: "Include all folders",
    });
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    expect(updateInclusion).toHaveBeenCalledWith({ includedFolderIds: [] });
  });

  it("updates qualified connection ids and clearing returns to all", () => {
    const { updateInclusion } = renderCloneTab();

    fireEvent.click(within(screen.getByTestId("clone-filter-section")).getByRole("button"));
    fireEvent.click(within(screen.getByTestId("clone-connections-section")).getByRole("button"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Archive SSH" }));

    expect(updateInclusion).toHaveBeenCalledWith({
      includedConnectionIds: ["db-1:conn-1"],
    });

    renderCloneTab({
      inclusion: { ...inclusion, includedConnectionIds: ["db-1:conn-1"] },
      updateInclusion,
    });
    fireEvent.click(within(screen.getAllByTestId("clone-filter-section")[1]).getByRole("button"));
    fireEvent.click(within(screen.getAllByTestId("clone-connections-section")[1]).getByRole("button"));
    const clearButtons = screen.getAllByRole("button", {
      name: "Include all connections",
    });
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    expect(updateInclusion).toHaveBeenCalledWith({ includedConnectionIds: [] });
  });

  it("renders proxy, chain, and VPN selectors and updates sidecar ids", async () => {
    const { updateInclusion } = renderCloneTab({
      inclusion: {
        ...inclusion,
        includeTunnelChains: true,
        includeVpnData: true,
      },
    });

    fireEvent.click(within(screen.getByTestId("clone-filter-section")).getByRole("button"));

    expect(screen.getByTestId("clone-proxy-profiles-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-proxy-chains-section")).toBeInTheDocument();
    expect(screen.getByTestId("clone-vpn-connections-section")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("clone-proxy-profiles-section")).getByRole("button"));
    fireEvent.click(screen.getByRole("checkbox", { name: "SOCKS Proxy" }));
    expect(updateInclusion).toHaveBeenCalledWith({
      includedProxyProfileIds: ["proxy-http"],
    });

    fireEvent.click(within(screen.getByTestId("clone-proxy-chains-section")).getByRole("button"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tunnel Chain A" }));
    expect(updateInclusion).toHaveBeenCalledWith({
      includedProxyChainIds: ["proxy-chain-1"],
    });

    fireEvent.click(within(screen.getByTestId("clone-vpn-connections-section")).getByRole("button"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "OpenVPN Backup" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "OpenVPN Backup" }));
    expect(updateInclusion).toHaveBeenCalledWith({
      includedVpnConnectionIds: ["vpn-openvpn"],
    });
  });
});
