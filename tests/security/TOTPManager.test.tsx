import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { TOTPManager } from "../../src/components/security/TOTPManager";
import type { TotpEntry, TotpGeneratedCode } from "../../src/types/totp";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const ENTRY: TotpEntry = {
  id: "entry-1",
  issuer: "sortOfRemoteNG",
  label: "alice@example.com",
  secret: "SECRET_1",
  algorithm: "SHA1",
  digits: 6,
  otp_type: "totp",
  period: 30,
  counter: 0,
  group_id: null,
  icon: null,
  color: null,
  notes: null,
  favourite: false,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_used_at: null,
  use_count: 0,
  tags: [],
};

const CODE: TotpGeneratedCode = {
  code: "123456",
  remaining_seconds: 25,
  period: 30,
  progress: 0.5,
  counter: 0,
  entry_id: "entry-1",
};

function setupInvoke() {
  mocks.invoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "totp_list_entries":
        return Promise.resolve([ENTRY]);
      case "totp_generate_all_codes":
        return Promise.resolve([CODE]);
      case "totp_generate_secret":
        return Promise.resolve("NEW_SECRET");
      case "totp_create_entry":
        return Promise.resolve({ ...ENTRY, id: "entry-2", label: String(args?.label) });
      case "totp_entry_qr_data_uri":
        return Promise.resolve("data:image/png;base64,qr");
      case "totp_remove_entry":
        return Promise.resolve(ENTRY);
      default:
        return Promise.resolve(undefined);
    }
  });
}

describe("TOTPManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInvoke();

    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not render when closed", () => {
    render(<TOTPManager isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText("TOTP Authenticator")).not.toBeInTheDocument();
  });

  it("renders existing entries when open", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    expect(await screen.findByText("TOTP Authenticator")).toBeInTheDocument();
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("123456")).toBeInTheDocument();
    });
  });

  it("adds a new TOTP entry via totpApi", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    fireEvent.click(await screen.findByText("Add TOTP"));
    fireEvent.change(screen.getByPlaceholderText("user@example.com"), {
      target: { value: "bob@example.com" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add TOTP" })[1]);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "totp_create_entry",
        expect.objectContaining({ label: "bob@example.com", secret: "NEW_SECRET" }),
      );
      expect(mocks.invoke).toHaveBeenCalledWith(
        "totp_entry_qr_data_uri",
        expect.objectContaining({ id: "entry-2" }),
      );
    });
  });

  it("deletes an entry after confirmation", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    const deleteButtons = await screen.findAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("totp_remove_entry", { id: "entry-1" });
    });
  });

  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(<TOTPManager isOpen onClose={onClose} />);

    await screen.findByText("TOTP Authenticator");
    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on Escape key", async () => {
    const onClose = vi.fn();
    render(<TOTPManager isOpen onClose={onClose} />);

    await screen.findByText("TOTP Authenticator");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
