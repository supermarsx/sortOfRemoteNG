import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedDatabaseProtectionSection } from "../../src/components/SettingsDialog/sections/security/ManagedDatabaseProtectionSection";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
const fixture = vi.hoisted(() => ({
  manager: {} as Record<string, ReturnType<typeof vi.fn>>,
  flush: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => fixture.manager },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ flushPendingSave: fixture.flush }),
}));
const database: ConnectionDatabase = {
  id: "fixture",
  name: "Fixture database",
  isEncrypted: true,
  protectionFormat: "sorng-db",
  securityRevision: "r1",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
beforeEach(() => {
  fixture.flush.mockReset().mockResolvedValue(undefined);
  fixture.manager = {
    getCurrentDatabase: vi.fn(() => database),
    getDatabase: vi.fn(async () => database),
    isDatabaseUnlocked: vi.fn(() => true),
    getDatabaseProtectionStatus: vi.fn(async () => ({
      kind: "managed",
      securityRevision: "r1",
      dataCipher: "aes-256-gcm",
      unlocked: true,
      slots: [
        { id: "p1", type: "password", label: "Password", deviceBound: false },
        { id: "v1", type: "os-vault", label: "Local vault", deviceBound: true },
      ],
    })),
    getDatabaseProtectionCapabilities: vi.fn(async () => ({
      schemaVersion: 1,
      ciphers: [
        { id: "aes-256-gcm", available: true },
        { id: "chacha20-poly1305", available: true },
        {
          id: "twofish-256-eax",
          available: true,
          reason:
            "Advanced software-only alternative; not VeraCrypt compatible.",
        },
        {
          id: "serpent-256-eax",
          available: true,
          reason:
            "Advanced software-only alternative; not VeraCrypt compatible.",
        },
      ],
      protectors: [
        { id: "password", available: true },
        { id: "os-vault", available: true },
        {
          id: "biometric",
          available: false,
          reason: "No cryptographic biometric provider",
        },
      ],
    })),
    changeManagedDatabaseProtection: vi.fn(async () => ({
      committed: true,
      cleanupPending: false,
      warnings: [],
      securityRevision: "r2",
    })),
    unlockManagedDatabase: vi.fn(async () => undefined),
  };
});
describe("managed protection controls", () => {
  it.each([
    [
      "vault-only",
      [{ id: "v1", type: "os-vault", label: "Local vault", deviceBound: true }],
      true,
    ],
    [
      "password and vault",
      [
        { id: "p1", type: "password", label: "Password", deviceBound: false },
        { id: "v1", type: "os-vault", label: "Local vault", deviceBound: true },
      ],
      false,
    ],
  ] as const)(
    "reviews the actual retained %s slots before a cipher transition",
    async (_name, slots, deviceOnly) => {
      fixture.manager.getDatabaseProtectionStatus.mockResolvedValue({
        kind: "managed",
        securityRevision: "r1",
        dataCipher: "aes-256-gcm",
        unlocked: true,
        slots,
      });
      render(<ManagedDatabaseProtectionSection database={database} />);
      fireEvent.change(await screen.findByLabelText("Database data cipher"), {
        target: { value: "twofish-256-eax" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Review protection change" }),
      );
      expect(
        Boolean(screen.queryByText(/This is device-bound-only access/)),
      ).toBe(deviceOnly);
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("confirm-no"));
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Review protection change" }),
      );
      fireEvent.click(screen.getByTestId("confirm-yes"));
      await waitFor(() =>
        expect(
          fixture.manager.changeManagedDatabaseProtection,
        ).toHaveBeenCalledExactlyOnceWith(
          "fixture",
          {
            dataCipher: "twofish-256-eax",
            keepSlotIds: slots.map((slot) => slot.id),
            newSlots: [],
          },
          expect.objectContaining({
            confirmRemoveProtection: false,
            confirmDeviceBoundOnly: deviceOnly,
          }),
        ),
      );
    },
  );
  it.each(["twofish-256-eax", "serpent-256-eax"])(
    "reviews %s with accurate scope and sends the exact target only after confirmation",
    async (dataCipher) => {
      render(<ManagedDatabaseProtectionSection database={database} />);
      const selector = await screen.findByLabelText("Database data cipher");
      expect(selector).toHaveValue("aes-256-gcm");
      expect(
        screen.getByRole("option", { name: "AES-256-GCM (recommended)" }),
      ).toBeInTheDocument();
      fireEvent.change(selector, { target: { value: dataCipher } });
      expect(
        screen.getByText(/Twofish and Serpent use EAX authentication/),
      ).toHaveTextContent(
        "not the global artifact cipher or password/OS-vault key wrapping",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Review protection change" }),
      );
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).not.toHaveBeenCalled();
      expect(
        screen.getByText(/Only this database's inner payload cipher changes/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-yes"));
      await waitFor(() =>
        expect(
          fixture.manager.changeManagedDatabaseProtection,
        ).toHaveBeenCalledWith(
          "fixture",
          { dataCipher, keepSlotIds: ["p1", "v1"], newSlots: [] },
          expect.objectContaining({ confirmRemoveProtection: false }),
        ),
      );
    },
  );
  it("preserves the existing advanced cipher and refuses unavailable capability choices", async () => {
    fixture.manager.getDatabaseProtectionCapabilities.mockResolvedValue({
      schemaVersion: 1,
      ciphers: [
        { id: "aes-256-gcm", available: true },
        {
          id: "serpent-256-eax",
          available: false,
          reason: "Unavailable in this native build",
        },
      ],
      protectors: [],
    });
    fixture.manager.getDatabaseProtectionStatus.mockResolvedValue({
      kind: "managed",
      securityRevision: "r1",
      slots: [],
      unlocked: true,
      dataCipher: "serpent-256-eax",
    });
    render(<ManagedDatabaseProtectionSection database={database} />);
    expect(await screen.findByLabelText("Database data cipher")).toHaveValue(
      "serpent-256-eax",
    );
    expect(
      screen.getByRole("option", { name: /Serpent-256-EAX/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Review protection change" }),
    ).toBeDisabled();
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
  });
  it("reviews cipher changes before invoking and retains all old slots", async () => {
    render(<ManagedDatabaseProtectionSection database={database} />);
    fireEvent.change(await screen.findByLabelText("Database data cipher"), {
      target: { value: "chacha20-poly1305" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review protection change" }),
    );
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await waitFor(() =>
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).toHaveBeenCalledWith(
        "fixture",
        {
          dataCipher: "chacha20-poly1305",
          keepSlotIds: ["p1", "v1"],
          newSlots: [],
        },
        expect.objectContaining({ confirmRemoveProtection: false }),
      ),
    );
    expect(fixture.flush).toHaveBeenCalled();
  });
  it("requires explicit full re-enrollment for replacement and clears secrets after commit", async () => {
    render(<ManagedDatabaseProtectionSection database={database} />);
    await screen.findByLabelText("Database data cipher");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Replace all existing/ }),
    );
    expect(
      screen.getByRole("button", { name: "Review protection change" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Managed database password"), {
      target: { value: "replacement-secret" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirm managed database password"),
      { target: { value: "replacement-secret" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review protection change" }),
    );
    expect(
      screen.getByText(/All existing unlock methods will be revoked/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await waitFor(() =>
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).toHaveBeenCalledWith(
        "fixture",
        expect.objectContaining({
          keepSlotIds: [],
          newSlots: [
            {
              type: "password",
              label: "Database password",
              password: "replacement-secret",
            },
          ],
        }),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Managed database password")).toHaveValue(
        "",
      ),
    );
  });
  it("removal requires explicit confirmation describing the independent outer layer", async () => {
    render(<ManagedDatabaseProtectionSection database={database} />);
    await screen.findByLabelText("Database data cipher");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove inner protection" }),
    );
    expect(
      screen.getByText(
        /Without that outer protection the payload may be plaintext/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-no"));
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove inner protection" }),
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await waitFor(() =>
      expect(
        fixture.manager.changeManagedDatabaseProtection,
      ).toHaveBeenCalledWith(
        "fixture",
        null,
        expect.objectContaining({ confirmRemoveProtection: true }),
      ),
    );
  });
  it("preserves committed warning if metadata refresh fails", async () => {
    render(<ManagedDatabaseProtectionSection database={database} />);
    await screen.findByLabelText("Database data cipher");
    fixture.manager.changeManagedDatabaseProtection.mockResolvedValue({
      committed: true,
      cleanupPending: true,
      warnings: ["Retained recovery journal"],
      securityRevision: "r2",
    });
    fixture.manager.getDatabaseProtectionStatus.mockRejectedValue(
      new Error("cleanup pending"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review protection change" }),
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    await screen.findByText(/Database protection change committed/);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "change committed",
    );
  });
  it("shows backend unavailability and never creates a browser fallback", async () => {
    fixture.manager.getDatabaseProtectionStatus.mockRejectedValue(
      new Error("Desktop app required"),
    );
    render(<ManagedDatabaseProtectionSection database={database} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Desktop app required",
    );
    expect(
      screen.queryByRole("button", { name: "Review protection change" }),
    ).not.toBeInTheDocument();
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
  });
  it("blocks mutation when the current durable flush fails", async () => {
    fixture.flush.mockRejectedValue(new Error("disk full"));
    render(<ManagedDatabaseProtectionSection database={database} />);
    await screen.findByLabelText("Database data cipher");
    fireEvent.click(
      screen.getByRole("button", { name: "Review protection change" }),
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(
      fixture.manager.changeManagedDatabaseProtection,
    ).not.toHaveBeenCalled();
  });
});
