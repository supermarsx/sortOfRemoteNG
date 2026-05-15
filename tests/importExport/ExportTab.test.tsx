import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportTab, {
  type ExportConfig,
} from "../../src/components/ImportExport/ExportTab";
import type { ExportConfigUpdate } from "../../src/components/ImportExport/types";
import type { Connection } from "../../src/types/connection/connection";
import { defaultExportSecuritySettings } from "../../src/types/settings/settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const connections: Connection[] = [
  {
    id: "conn-1",
    name: "Server A",
    protocol: "ssh",
    hostname: "10.0.0.10",
    port: 22,
    password: "secret",
    isGroup: false,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "group-1",
    name: "Group A",
    protocol: "rdp",
    hostname: "",
    port: 0,
    isGroup: true,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const defaultConfig: ExportConfig = {
  format: "json",
  scopeMode: "current",
  selectedDatabaseIds: ["db-current"],
  databaseOptions: [
    {
      id: "db-current",
      name: "Current DB",
      isCurrent: true,
      isEncrypted: false,
      isUnlocked: true,
      isExportable: true,
      connectionCount: connections.length,
    },
  ],
  inclusion: {
    includeConnections: true,
    includeCredentials: false,
    includeSettings: true,
    includeFolderItems: true,
    includeEmptyFolders: true,
    includeTabGroups: true,
    includeColorTags: true,
    includeVpnData: true,
    includeTunnelChains: true,
    includeExportMetadata: true,
    includeDatabaseMetadata: true,
    includedProtocols: [],
  },
  includePasswords: false,
  encrypted: false,
  password: "",
  keyDerivationIterations: defaultExportSecuritySettings.keyDerivationIterations,
  includeVpnData: true,
  includeTunnelChains: true,
  includeTabGroups: true,
  includeColorTags: true,
  strengthSettings: {
    showPasswordStrength: true,
    showEntropyBits: true,
    minimumPasswordScore: 2,
    enforceMinimumPasswordScore: false,
    detectCommonPasswords: true,
    detectRepeatedCharacters: true,
    detectSequentialPatterns: true,
    rewardUncommonSymbols: true,
    customCommonPasswords: "",
  },
};

function renderExportTab(overrides?: {
  connections?: Connection[];
  config?: ExportConfig;
  isProcessing?: boolean;
  onConfigChange?: (update: ExportConfigUpdate) => void;
  handleExport?: () => void;
}) {
  const onConfigChange = overrides?.onConfigChange ?? vi.fn<(update: ExportConfigUpdate) => void>();
  const handleExport = overrides?.handleExport ?? vi.fn<() => void>();

  const result = render(
    <ExportTab
      connections={overrides?.connections ?? connections}
      config={
        overrides?.config ?? defaultConfig
      }
      onConfigChange={onConfigChange}
      isProcessing={overrides?.isProcessing ?? false}
      handleExport={handleExport}
    />,
  );

  return {
    ...result,
    onConfigChange,
    handleExport,
  };
}

describe("ExportTab", () => {
  it("shows connection totals and lets the user switch export formats", () => {
    const { onConfigChange } = renderExportTab();

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: "exportTab.exportFormat" })).toBeInTheDocument();
    expect(screen.getByTestId("export-format-details")).toHaveTextContent("JSON");
    expect(screen.getByTestId("export-format-details")).toHaveTextContent("exportTab.formatJson");
    expect(screen.getByTestId("export-counter-total")).toHaveTextContent("2");
    expect(screen.getByTestId("export-counter-folders")).toHaveTextContent("1");
    expect(screen.getByTestId("export-counter-leaf")).toHaveTextContent("1");
    expect(screen.getByTestId("export-counter-credentials")).toHaveTextContent("1");
    expect(screen.getByTestId("export-counter-protocols")).toHaveTextContent("1");
    expect(screen.getByTestId("export-counter-warnings")).toHaveTextContent("0");

    const selectFormat = (name: string) => {
      fireEvent.click(screen.getByTestId("export-format-select"));
      fireEvent.mouseDown(screen.getByRole("option", { name }));
    };

    selectFormat("XML");
    selectFormat("CSV");
    selectFormat("TXT");
    selectFormat("Markdown");
    selectFormat("HTML");
    selectFormat("Excel");
    selectFormat("XML - mRemoteNG compatible");

    expect(onConfigChange).toHaveBeenCalledWith({ format: "xml" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "csv" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "txt" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "markdown" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "html" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "excel" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "mremoteng" });
  });

  it("renders export scope controls and disables locked encrypted databases", () => {
    const { onConfigChange } = renderExportTab({
      config: {
        ...defaultConfig,
        scopeMode: "selected",
        selectedDatabaseIds: ["db-current", "db-archive"],
        databaseOptions: [
          defaultConfig.databaseOptions[0]!,
          {
            id: "db-archive",
            name: "Archive DB",
            isCurrent: false,
            isEncrypted: true,
            isUnlocked: true,
            isExportable: true,
          },
          {
            id: "db-locked",
            name: "Locked DB",
            isCurrent: false,
            isEncrypted: true,
            isUnlocked: false,
            isExportable: false,
            lockedReason: "Unlock this database first.",
          },
        ],
      },
    });

    expect(screen.getByTestId("export-scope-section")).toHaveTextContent("exportTab.scopeTitle");
    expect(screen.getByTestId("export-counter-databases")).toHaveTextContent("2");
    expect(screen.getByTestId("export-counter-lockedDatabases")).toHaveTextContent("1");

    const lockedOption = screen.getByTestId("export-database-option-db-locked");
    expect(lockedOption).toHaveTextContent("Locked DB");
    expect(lockedOption).toHaveTextContent("Unlock this database first.");
    expect(within(lockedOption).getByRole("checkbox", { name: "Locked DB" })).toBeDisabled();

    fireEvent.click(within(screen.getByTestId("export-database-option-db-archive")).getByRole("checkbox", { name: "Archive DB" }));
    expect(onConfigChange).toHaveBeenCalledWith({ selectedDatabaseIds: ["db-current"] });

    fireEvent.click(screen.getByTestId("export-scope-all"));
    expect(onConfigChange).toHaveBeenCalledWith({ scopeMode: "all" });
  });

  it("shows format-aware compatibility warnings", () => {
    renderExportTab({
      config: {
        ...defaultConfig,
        format: "mremoteng",
        includePasswords: true,
        encrypted: true,
        password: "Correct-Horse-Battery-Staple!",
      },
    });

    expect(screen.getByTestId("export-counter-warnings")).toHaveTextContent("4");
    expect(screen.getByTestId("export-format-warnings")).toHaveTextContent(
      "exportTab.warningMRemoteNGLimited",
    );
    expect(screen.getByTestId("export-format-warnings")).toHaveTextContent(
      "exportTab.warningPasswordsSkipped",
    );
    expect(screen.getByTestId("export-format-warnings")).toHaveTextContent(
      "exportTab.warningSidecarsLimited",
    );
    expect(screen.getByTestId("export-format-warnings")).toHaveTextContent(
      "exportTab.warningMRemoteNGEncrypted",
    );
  });

  it("propagates include-passwords, encryption, and password changes", () => {
    const { onConfigChange, rerender } = renderExportTab();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "exportTab.includePasswords" }),
    );
    // The encryption accordion is collapsed by default; open it before
    // interacting with the encrypt checkbox.
    fireEvent.click(
      within(screen.getByTestId("export-encryption-section")).getByRole("button", {
        expanded: false,
      }),
    );
    fireEvent.click(screen.getByTestId("export-encrypt"));

    expect(onConfigChange).toHaveBeenCalledWith({ includePasswords: true });
    expect(onConfigChange).toHaveBeenCalledWith({ encrypted: true });

    rerender(
      <ExportTab
        connections={connections}
        config={{
          ...defaultConfig,
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "",
          keyDerivationIterations: defaultExportSecuritySettings.keyDerivationIterations,
          includeVpnData: true,
          includeTunnelChains: true,
          includeTabGroups: true,
          includeColorTags: true,
          strengthSettings: defaultConfig.strengthSettings,
        }}
        onConfigChange={onConfigChange}
        isProcessing={false}
        handleExport={vi.fn<() => void>()}
      />,
    );

    fireEvent.change(screen.getByTestId("export-password"), {
      target: { value: "top-secret" },
    });

    expect(onConfigChange).toHaveBeenCalledWith({ password: "top-secret" });
  });

  it("disables export until the config is valid and then submits", () => {
    const { handleExport, rerender } = renderExportTab({
      connections: [],
      config: { ...defaultConfig, databaseOptions: [], selectedDatabaseIds: [] },
    });

    expect(screen.getByTestId("export-confirm")).toBeDisabled();

    rerender(
      <ExportTab
        connections={connections}
        config={{
          ...defaultConfig,
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "",
          keyDerivationIterations: defaultExportSecuritySettings.keyDerivationIterations,
          includeVpnData: true,
          includeTunnelChains: true,
          includeTabGroups: true,
          includeColorTags: true,
          strengthSettings: defaultConfig.strengthSettings,
        }}
        onConfigChange={vi.fn<(update: ExportConfigUpdate) => void>()}
        isProcessing={false}
        handleExport={handleExport}
      />,
    );

    expect(screen.getByTestId("export-confirm")).toBeDisabled();

    rerender(
      <ExportTab
        connections={connections}
        config={{
          ...defaultConfig,
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "top-secret",
          keyDerivationIterations: defaultExportSecuritySettings.keyDerivationIterations,
          includeVpnData: true,
          includeTunnelChains: true,
          includeTabGroups: true,
          includeColorTags: true,
          strengthSettings: defaultConfig.strengthSettings,
        }}
        onConfigChange={vi.fn<(update: ExportConfigUpdate) => void>()}
        isProcessing={false}
        handleExport={handleExport}
      />,
    );

    fireEvent.click(screen.getByTestId("export-confirm"));
    expect(handleExport).toHaveBeenCalledTimes(1);

    rerender(
      <ExportTab
        connections={connections}
        config={{
          ...defaultConfig,
          format: "json",
          includePasswords: false,
          encrypted: false,
          password: "",
          keyDerivationIterations: defaultExportSecuritySettings.keyDerivationIterations,
          includeVpnData: true,
          includeTunnelChains: true,
          includeTabGroups: true,
          includeColorTags: true,
          strengthSettings: defaultConfig.strengthSettings,
        }}
        onConfigChange={vi.fn()}
        isProcessing={true}
        handleExport={handleExport}
      />,
    );

    expect(screen.getByTestId("export-confirm")).toBeDisabled();
  });

  it("propagates extended content and key-derivation options", () => {
    const { onConfigChange, rerender } = renderExportTab({
      config: {
        ...defaultConfig,
        encrypted: true,
        password: "Correct-Horse-Battery-Staple!",
      },
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /include vpn definitions/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /include tunnel chains/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /include tab groups/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /include color tags/i }));
    fireEvent.change(screen.getByTestId("export-kdf-iterations"), {
      target: { value: "500000" },
    });

    expect(onConfigChange).toHaveBeenCalledWith({ includeVpnData: false });
    expect(onConfigChange).toHaveBeenCalledWith({ includeTunnelChains: false });
    expect(onConfigChange).toHaveBeenCalledWith({ includeTabGroups: false });
    expect(onConfigChange).toHaveBeenCalledWith({ includeColorTags: false });
    expect(onConfigChange).toHaveBeenCalledWith({ keyDerivationIterations: 500000 });

    rerender(
      <ExportTab
        connections={connections}
        config={{ ...defaultConfig, format: "csv" }}
        onConfigChange={onConfigChange}
        isProcessing={false}
        handleExport={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByTestId("export-format-select")).toHaveTextContent("CSV");
    expect(screen.getByTestId("export-format-details")).toHaveTextContent("exportTab.formatCsv");
    expect(screen.getByTestId("export-counter-warnings")).toHaveTextContent("2");
  });

  it("shows entropy and password-pattern feedback", () => {
    renderExportTab({
      config: {
        ...defaultConfig,
        encrypted: true,
        password: "password1111",
      },
    });

    expect(screen.getByTestId("export-password-strength")).toBeInTheDocument();
    expect(screen.getByTestId("export-password-entropy")).toHaveTextContent(/bits/);
    expect(screen.getByTestId("export-password-warnings")).toHaveTextContent(
      "Repeated characters are easier to guess",
    );
  });

  it("disables export when settings enforce a minimum password score", () => {
    renderExportTab({
      config: {
        ...defaultConfig,
        encrypted: true,
        password: "password",
        strengthSettings: {
          ...defaultConfig.strengthSettings,
          enforceMinimumPasswordScore: true,
          minimumPasswordScore: 3,
        },
      },
    });

    expect(screen.getByTestId("export-password-too-weak")).toBeInTheDocument();
    expect(screen.getByTestId("export-confirm")).toBeDisabled();
  });
});