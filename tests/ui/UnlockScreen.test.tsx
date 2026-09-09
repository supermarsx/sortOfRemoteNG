/**
 * Render-level tests for `UnlockScreen`. The hook is mocked at the
 * module level so we drive the component with concrete encryption
 * status / lockout snapshots and assert behaviour:
 *   - the overlay is only shown when a master key exists on disk
 *     and the state is locked,
 *   - password mode shows the input + Unlock button,
 *   - vault-only mode requires an intentional unlock action,
 *   - cool-down disables the Unlock button and renders the countdown,
 *   - wrong-password results surface the error band,
 *   - the screen self-dismisses when status.unlocked flips to true.
 */
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UnlockScreen } from "../../src/components/encryption/UnlockScreen";
import { shouldShowUnlockScreen } from "../../src/components/encryption/unlockScreenVisibility";
import type {
  EncryptionStatus,
  LockoutSnapshot,
  UnlockResult,
} from "../../src/types/encryption/encryption";

const baseStatus: EncryptionStatus = {
  schemaVersion: 2,
  masterKeyStorage: "password",
  unlocked: false,
  vaultAvailable: false,
  vaultHasMasterDek: false,
  vaultBackend: "not detected",
  artifactLabels: ["sorng-v1::settings"],
  passwordWrapPresent: true,
  settingsEncryptedOnDisk: true,
  settingsPlaintextPresent: false,
};

const zeroLockout: LockoutSnapshot = {
  failedAttempts: 0,
  lastFailureUnixMs: 0,
  remainingCooldownMs: 0,
};

const cooldownLockout: LockoutSnapshot = {
  failedAttempts: 2,
  lastFailureUnixMs: 1,
  remainingCooldownMs: 28_500,
};

interface HookOverride {
  status: EncryptionStatus | null;
  lockout: LockoutSnapshot | null;
  unlock: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
  refreshLockout?: ReturnType<typeof vi.fn>;
  setup?: ReturnType<typeof vi.fn>;
  lock?: ReturnType<typeof vi.fn>;
  changePassword?: ReturnType<typeof vi.fn>;
  migrateSettings?: ReturnType<typeof vi.fn>;
  importPortableDek?: ReturnType<typeof vi.fn>;
  loading?: boolean;
  error?: string | null;
}

let hookOverride: HookOverride;
const portableDialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: portableDialog.open }));

vi.mock("../../src/hooks/settings/useEncryption", () => ({
  useEncryption: () => ({
    loading: false,
    error: null,
    refresh: vi.fn(),
    refreshLockout: vi.fn(),
    setup: vi.fn(),
    lock: vi.fn(),
    changePassword: vi.fn(),
    migrateSettings: vi.fn(),
    importPortableDek: vi.fn().mockResolvedValue(undefined),
    ...hookOverride,
  }),
}));

describe("shouldShowUnlockScreen", () => {
  it("returns false when status is null", () => {
    expect(shouldShowUnlockScreen(null)).toBe(false);
  });

  it("returns false when state is unlocked", () => {
    expect(shouldShowUnlockScreen({ ...baseStatus, unlocked: true })).toBe(
      false,
    );
  });

  it("returns false when no master key exists anywhere", () => {
    expect(
      shouldShowUnlockScreen({
        ...baseStatus,
        passwordWrapPresent: false,
        vaultHasMasterDek: false,
        settingsEncryptedOnDisk: false,
      }),
    ).toBe(false);
  });

  it("returns true when locked and a password-wrap exists", () => {
    expect(shouldShowUnlockScreen(baseStatus)).toBe(true);
  });

  it("returns true when locked and the vault holds the DEK", () => {
    expect(
      shouldShowUnlockScreen({
        ...baseStatus,
        passwordWrapPresent: false,
        vaultAvailable: true,
        vaultHasMasterDek: true,
        masterKeyStorage: "vault",
      }),
    ).toBe(true);
  });
});

describe("UnlockScreen", () => {
  it("selects a native recovery file without calling the destructive importer", async () => {
    const importer = vi.fn();
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
      importPortableDek: importer,
    };
    portableDialog.open
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/granted/recovery.dek");
    render(<UnlockScreen />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));
    fireEvent.click(screen.getByText("Choose portable master key file"));
    await waitFor(() => expect(portableDialog.open).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Selected recovery file")).toBeNull();
    fireEvent.click(screen.getByText("Choose portable master key file"));
    await waitFor(() =>
      expect(screen.getByLabelText("Selected recovery file")).toHaveTextContent(
        "/granted/recovery.dek",
      ),
    );
    expect(importer).not.toHaveBeenCalled();
    expect(screen.getByText("Verify recovery key")).toBeDisabled();
  });
  it("renders nothing when status is null", () => {
    hookOverride = {
      status: null,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    const { container } = render(<UnlockScreen onUnlocked={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the password prompt in password mode", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    expect(screen.getByText("Encrypted storage is locked")).toBeTruthy();
    expect(screen.getByPlaceholderText("Master password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unlock/ })).toBeTruthy();
  });

  it("disables Unlock when the password field is empty", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const btn = screen.getByRole("button", {
      name: /^Unlock/,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("calls unlock with the typed password and dismisses on success", async () => {
    const onUnlocked = vi.fn();
    const unlock = vi.fn((): Promise<UnlockResult> =>
      Promise.resolve("unlocked-from-password"),
    );
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock,
    };
    const { rerender } = render(<UnlockScreen onUnlocked={onUnlocked} />);
    const input = screen.getByPlaceholderText("Master password");
    fireEvent.change(input, { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock/ }));
    await waitFor(() => expect(unlock).toHaveBeenCalledWith("p"));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));

    // Flip status to unlocked and rerender — onUnlocked should fire.
    hookOverride = {
      ...hookOverride,
      status: { ...baseStatus, unlocked: true },
    };
    rerender(<UnlockScreen onUnlocked={onUnlocked} />);
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
    rerender(<UnlockScreen onUnlocked={() => onUnlocked()} />);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    hookOverride = { ...hookOverride, status: baseStatus };
    rerender(<UnlockScreen onUnlocked={onUnlocked} />);
    expect(
      (screen.getByPlaceholderText("Master password") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("shows the cool-down banner when remainingCooldownMs > 0", () => {
    hookOverride = {
      status: baseStatus,
      lockout: cooldownLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const banner = screen.getByTestId("unlock-cooldown");
    expect(banner.textContent).toContain("29s");
    const btn = screen.getByRole("button", {
      name: /^Unlock/,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the wrong-password banner after a failed attempt", async () => {
    const unlock = vi.fn((): Promise<UnlockResult> =>
      Promise.resolve("wrong-password"),
    );
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock,
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Unlock/ }));
    await waitFor(() => {
      expect(screen.getByText(/Wrong password/i)).toBeTruthy();
    });
  });

  it("keeps a vault lock in place across status refreshes until intentional unlock", async () => {
    const unlock = vi.fn(() =>
      Promise.resolve("unlocked-from-vault" as UnlockResult),
    );
    hookOverride = {
      status: {
        ...baseStatus,
        passwordWrapPresent: false,
        vaultAvailable: true,
        vaultHasMasterDek: true,
        masterKeyStorage: "vault",
      },
      lockout: zeroLockout,
      unlock,
    };
    const { rerender } = render(<UnlockScreen onUnlocked={() => {}} />);
    hookOverride = { ...hookOverride, status: { ...hookOverride.status! } };
    rerender(<UnlockScreen onUnlocked={() => {}} />);
    expect(unlock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/not a separate master-password challenge/i),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock from OS vault" }),
    );
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(1));
    expect(unlock).toHaveBeenCalledWith();
  });

  it("toggles show/hide password", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const input = screen.getByPlaceholderText(
      "Master password",
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(input.type).toBe("password");
  });

  it("submits on Enter", async () => {
    const unlock = vi.fn((): Promise<UnlockResult> =>
      Promise.resolve("wrong-password"),
    );
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock,
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const input = screen.getByPlaceholderText("Master password");
    fireEvent.change(input, { target: { value: "guess" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(unlock).toHaveBeenCalledWith("guess"));
  });

  // ─────────────────────────────────────────────────────────────
  // Extended coverage (Test Layer D)
  // ─────────────────────────────────────────────────────────────

  it("renders the password prompt + dialog testid in password mode", () => {
    // Smoke test for the dialog wrapper itself — the testid is what
    // the parent (App.tsx) and downstream auto-lock listeners key on
    // to know the overlay is mounted.
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    expect(screen.getByTestId("encryption-unlock-screen")).toBeTruthy();
    expect(screen.getByPlaceholderText("Master password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Unlock/ })).toBeTruthy();
  });

  it("does not retry a pending vault unlock on click or status refresh", () => {
    const unlock = vi.fn(() => new Promise<UnlockResult>(() => {}));
    hookOverride = {
      status: {
        ...baseStatus,
        passwordWrapPresent: false,
        vaultAvailable: true,
        vaultHasMasterDek: true,
        masterKeyStorage: "vault",
      },
      lockout: zeroLockout,
      unlock,
    };
    const { rerender } = render(<UnlockScreen onUnlocked={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock from OS vault" }),
    );
    expect(screen.getByText(/Unlocking from your OS vault/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Unlocking from your OS vault/ }),
    );
    rerender(<UnlockScreen onUnlocked={() => {}} />);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("shows vault failures without automatically retrying", async () => {
    const unlock = vi.fn().mockRejectedValue(new Error("Vault access denied"));
    hookOverride = {
      status: {
        ...baseStatus,
        passwordWrapPresent: false,
        vaultAvailable: true,
        vaultHasMasterDek: true,
        masterKeyStorage: "vault",
      },
      lockout: zeroLockout,
      unlock,
    };
    const { rerender } = render(<UnlockScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock from OS vault" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Vault access denied",
      ),
    );
    rerender(<UnlockScreen />);
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Unlock from OS vault",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("serializes password unlock and verified recovery while an operation is pending", async () => {
    let finish!: (result: UnlockResult) => void;
    const unlock = vi.fn(
      () =>
        new Promise<UnlockResult>((resolve) => {
          finish = resolve;
        }),
    );
    hookOverride = { status: baseStatus, lockout: zeroLockout, unlock };
    render(<UnlockScreen />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "master-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Master password"), {
      key: "Enter",
    });
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Choose portable master key file")).toBeDisabled();
    expect(screen.getByLabelText("Backup password")).toBeDisabled();
    await act(async () => finish("unlocked-from-password"));
    expect(screen.getByPlaceholderText("Master password")).toHaveValue("");
  });

  it("clears both password fields and notifies once when another window unlocks", () => {
    const onUnlocked = vi.fn();
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    const { rerender } = render(<UnlockScreen onUnlocked={onUnlocked} />);
    fireEvent.change(screen.getByPlaceholderText("Master password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));
    fireEvent.change(screen.getByLabelText("Backup password"), {
      target: { value: "export-secret" },
    });
    hookOverride = {
      ...hookOverride,
      status: { ...baseStatus, unlocked: true },
    };
    rerender(<UnlockScreen onUnlocked={onUnlocked} />);
    rerender(<UnlockScreen onUnlocked={() => onUnlocked()} />);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    hookOverride = { ...hookOverride, status: baseStatus };
    rerender(<UnlockScreen onUnlocked={onUnlocked} />);
    expect(
      (screen.getByPlaceholderText("Master password") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Backup password") as HTMLInputElement).value,
    ).toBe("");
    expect(hookOverride.unlock).not.toHaveBeenCalled();
  });

  it("offers verified recovery when a password wrap is present", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));
    expect(screen.getByLabelText("Backup password")).toBeInTheDocument();
    expect(
      screen.getByLabelText("New local master password"),
    ).toBeInTheDocument();
    expect(screen.getByText("Verify recovery key")).toBeDisabled();
  });

  it("keeps recovery accessible for a loaded but rejected master key", () => {
    const onUnlocked = vi.fn();
    hookOverride = {
      status: {
        ...baseStatus,
        unlocked: true,
        criticalKeyFailure: true,
        keyHealthIssues: ["Current profile rejected the loaded key"],
      },
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={onUnlocked} />);
    expect(
      screen.getByText("Current profile rejected the loaded key"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("encryption-unlock-screen")).toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(shouldShowUnlockScreen(hookOverride.status)).toBe(true);
  });

  it("never offers an unverified import-and-unlock button", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));
    expect(screen.queryByTestId("unlock-import-submit")).toBeNull();
    expect(
      screen.getByText(/Native validation must prove/),
    ).toBeInTheDocument();
  });

  it("renders nothing when no master key on disk (needs-setup branch)", () => {
    // `shouldShowUnlockScreen` returns false when neither
    // passwordWrapPresent nor vaultHasMasterDek is true — the right
    // next step is the setup wizard in Settings → Security, not a
    // prompt the user can't possibly satisfy.
    hookOverride = {
      status: {
        ...baseStatus,
        passwordWrapPresent: false,
        vaultHasMasterDek: false,
        vaultAvailable: true,
        unlocked: false,
        settingsEncryptedOnDisk: false,
      },
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    const { container } = render(<UnlockScreen onUnlocked={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("encryption-unlock-screen")).toBeNull();
  });
});
