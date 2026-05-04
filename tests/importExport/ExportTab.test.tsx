import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportTab, {
  type ExportConfig,
} from "../../src/components/ImportExport/ExportTab";
import type { Connection } from "../../src/types/connection/connection";

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

function renderExportTab(overrides?: {
  connections?: Connection[];
  config?: ExportConfig;
  isProcessing?: boolean;
  onConfigChange?: (update: Partial<ExportConfig>) => void;
  handleExport?: () => void;
}) {
  const onConfigChange = overrides?.onConfigChange ?? vi.fn<(update: Partial<ExportConfig>) => void>();
  const handleExport = overrides?.handleExport ?? vi.fn<() => void>();

  const result = render(
    <ExportTab
      connections={overrides?.connections ?? connections}
      config={
        overrides?.config ?? {
          format: "json",
          includePasswords: false,
          encrypted: false,
          password: "",
        }
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

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("XML").closest("button")!);
    fireEvent.click(screen.getByText("CSV").closest("button")!);

    expect(onConfigChange).toHaveBeenCalledWith({ format: "xml" });
    expect(onConfigChange).toHaveBeenCalledWith({ format: "csv" });
  });

  it("propagates include-passwords, encryption, and password changes", () => {
    const { onConfigChange, rerender } = renderExportTab();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "exportTab.includePasswords" }),
    );
    fireEvent.click(screen.getByTestId("export-encrypt"));

    expect(onConfigChange).toHaveBeenCalledWith({ includePasswords: true });
    expect(onConfigChange).toHaveBeenCalledWith({ encrypted: true });

    rerender(
      <ExportTab
        connections={connections}
        config={{
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "",
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
    });

    expect(screen.getByTestId("export-confirm")).toBeDisabled();

    rerender(
      <ExportTab
        connections={connections}
        config={{
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "",
        }}
        onConfigChange={vi.fn<(update: Partial<ExportConfig>) => void>()}
        isProcessing={false}
        handleExport={handleExport}
      />,
    );

    expect(screen.getByTestId("export-confirm")).toBeDisabled();

    rerender(
      <ExportTab
        connections={connections}
        config={{
          format: "json",
          includePasswords: false,
          encrypted: true,
          password: "top-secret",
        }}
        onConfigChange={vi.fn<(update: Partial<ExportConfig>) => void>()}
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
          format: "json",
          includePasswords: false,
          encrypted: false,
          password: "",
        }}
        onConfigChange={vi.fn()}
        isProcessing={true}
        handleExport={handleExport}
      />,
    );

    expect(screen.getByTestId("export-confirm")).toBeDisabled();
  });
});