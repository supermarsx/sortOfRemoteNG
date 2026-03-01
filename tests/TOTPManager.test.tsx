import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { TOTPManager } from "../src/components/security/TOTPManager";

const mocks = vi.hoisted(() => ({
  getAllConfigs: vi.fn(),
  generateToken: vi.fn(),
  generateSecret: vi.fn(),
  generateOTPAuthURL: vi.fn(),
  saveConfig: vi.fn(),
  deleteConfig: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock("../src/utils/totpService", () => ({
  TOTPService: class {
    getAllConfigs = mocks.getAllConfigs;
    generateToken = mocks.generateToken;
    generateSecret = mocks.generateSecret;
    generateOTPAuthURL = mocks.generateOTPAuthURL;
    saveConfig = mocks.saveConfig;
    deleteConfig = mocks.deleteConfig;
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: mocks.toDataURL,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe("TOTPManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getAllConfigs.mockResolvedValue([
      {
        secret: "SECRET_1",
        issuer: "sortOfRemoteNG",
        account: "alice@example.com",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ]);
    mocks.generateToken.mockReturnValue("123456");
    mocks.generateSecret.mockReturnValue("NEW_SECRET");
    mocks.generateOTPAuthURL.mockReturnValue("otpauth://totp/example");
    mocks.saveConfig.mockResolvedValue(undefined);
    mocks.deleteConfig.mockResolvedValue(undefined);
    mocks.toDataURL.mockResolvedValue("data:image/png;base64,qr");

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

  it("renders existing configs when open", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    expect(await screen.findByText("TOTP Authenticator")).toBeInTheDocument();
    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
  });

  it("adds a new TOTP config", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    fireEvent.click(await screen.findByText("Add TOTP"));
    fireEvent.change(screen.getByPlaceholderText("user@example.com"), {
      target: { value: "bob@example.com" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add TOTP" })[1]);

    await waitFor(() => {
      expect(mocks.saveConfig).toHaveBeenCalled();
      expect(mocks.toDataURL).toHaveBeenCalled();
    });
  });

  it("deletes a config after confirmation", async () => {
    render(<TOTPManager isOpen onClose={() => {}} />);

    const deleteButtons = await screen.findAllByTitle("Delete");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mocks.deleteConfig).toHaveBeenCalledWith("SECRET_1");
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
