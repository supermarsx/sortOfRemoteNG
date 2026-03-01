import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { TotpImportDialog } from "../src/components/security/TotpImportDialog";

const mocks = vi.hoisted(() => ({
  importTotpEntries: vi.fn(),
}));

vi.mock("jsqr", () => ({
  default: vi.fn(),
}));

vi.mock("../src/utils/totpImport", () => ({
  IMPORT_SOURCES: [
    {
      id: "auto",
      label: "Auto-detect",
      extensions: [".json", ".txt"],
      description: "Automatically detect format",
    },
    {
      id: "otpauth-uri",
      label: "otpauth:// URIs",
      extensions: [".txt"],
      description: "Plain text URIs",
    },
  ],
  importTotpEntries: mocks.importTotpEntries,
  parseOtpauthUri: vi.fn(),
}));

describe("TotpImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.importTotpEntries.mockReturnValue({
      source: "auto",
      errors: [],
      entries: [
        {
          secret: "SECRET1",
          issuer: "GitHub",
          account: "dev@example.com",
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
        {
          secret: "SECRET2",
          issuer: "Google",
          account: "ops@example.com",
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders dialog and closes via close button", () => {
    const onClose = vi.fn();
    const { container } = render(
      <TotpImportDialog onImport={() => {}} onClose={onClose} />,
    );

    expect(screen.getByText("Import 2FA / TOTP Entries")).toBeInTheDocument();
    const closeIcon = container.querySelector("button svg.lucide-x");
    expect(closeIcon).toBeTruthy();
    if (closeIcon?.parentElement) {
      fireEvent.click(closeIcon.parentElement);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("loads entries from selected file and displays results", async () => {
    const { container } = render(
      <TotpImportDialog onImport={() => {}} onClose={() => {}} />,
    );
    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["otpauth://totp/Test"], "tokens.txt", {
      type: "text/plain",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(await screen.findByText("Google")).toBeInTheDocument();
  });

  it("imports selected entries and closes dialog", async () => {
    const onImport = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <TotpImportDialog
        onImport={onImport}
        onClose={onClose}
        existingSecrets={["SECRET2"]}
      />,
    );

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["otpauth://totp/Test"], "tokens.txt", {
      type: "text/plain",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await screen.findByText("GitHub");
    const importButton = screen.getByRole("button", { name: /Import/i });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledTimes(1);
      const imported = onImport.mock.calls[0][0];
      expect(imported).toHaveLength(1);
      expect(imported[0].issuer).toBe("GitHub");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <TotpImportDialog onImport={() => {}} onClose={onClose} />,
    );

    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });
});
