/**
 * Render-level tests for `UnlockScreen`. The hook is mocked at the
 * module level so we drive the component with concrete encryption
 * status / lockout snapshots and assert behaviour:
 *   - the overlay is only shown when a master key exists on disk
 *     and the state is locked,
 *   - password mode shows the input + Unlock button,
 *   - vault-only mode renders the silent "unlocking…" branch,
 *   - cool-down disables the Unlock button and renders the countdown,
 *   - wrong-password results surface the error band,
 *   - the screen self-dismisses when status.unlocked flips to true.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  shouldShowUnlockScreen,
  UnlockScreen,
} from "../../src/components/encryption/UnlockScreen";
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
    expect(
      shouldShowUnlockScreen({ ...baseStatus, unlocked: true }),
    ).toBe(false);
  });

  it("returns false when no master key exists anywhere", () => {
    expect(
      shouldShowUnlockScreen({
        ...baseStatus,
        passwordWrapPresent: false,
        vaultHasMasterDek: false,
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
    expect(
      screen.getByRole("button", { name: /^Unlock/ }),
    ).toBeTruthy();
  });

  it("disables Unlock when the password field is empty", () => {
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const btn = screen.getByRole("button", { name: /^Unlock/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("calls unlock with the typed password and dismisses on success", async () => {
    const onUnlocked = vi.fn();
    const unlock = vi.fn(
      (): Promise<UnlockResult> => Promise.resolve("unlocked-from-password"),
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

    // Flip status to unlocked and rerender — onUnlocked should fire.
    hookOverride = {
      ...hookOverride,
      status: { ...baseStatus, unlocked: true },
    };
    rerender(<UnlockScreen onUnlocked={onUnlocked} />);
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
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
    const btn = screen.getByRole("button", { name: /^Unlock/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the wrong-password banner after a failed attempt", async () => {
    const unlock = vi.fn(
      (): Promise<UnlockResult> => Promise.resolve("wrong-password"),
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

  it("renders the silent vault branch when only vault holds the DEK", () => {
    const unlock = vi.fn(() => Promise.resolve("unlocked-from-vault" as UnlockResult));
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
    render(<UnlockScreen onUnlocked={() => {}} />);
    expect(screen.getByText(/Unlocking from your OS vault/i)).toBeTruthy();
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
    const unlock = vi.fn(
      (): Promise<UnlockResult> => Promise.resolve("wrong-password"),
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

  it("shows the silent vault-unlocking spinner while the unlock call is pending", () => {
    // Pure vault mode: no password wrap, only the vault holds the DEK.
    // The mount effect fires a silent unlock; while it's still pending
    // we render the "Unlocking from your OS vault…" branch instead of
    // the password prompt. Use a Promise that never resolves so the
    // spinner stays visible for the assertion.
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
    render(<UnlockScreen onUnlocked={() => {}} />);
    // DEFAULT_LABELS.vaultUnlocking
    expect(screen.getByText(/Unlocking from your OS vault/i)).toBeTruthy();
  });

  it("renders the portable-dek import toggle when a password wrap is present", () => {
    // The recovery panel is the vault-eviction escape hatch — gated on
    // (passwordWrapPresent || !vaultAvailable). With a wrap on disk,
    // the toggle must be discoverable so users locked out of an
    // unreadable vault can still import a fresh .dek.
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    const toggle = screen.getByTestId("unlock-import-toggle");
    expect(toggle).toBeTruthy();

    fireEvent.click(toggle);

    // After expanding, the path + password inputs render and submit
    // stays disabled until both are filled (prevents accidental empty
    // submits).
    expect(
      screen.getByPlaceholderText("/secure/backup/sorng-master.dek"),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Export password")).toBeTruthy();
    const submit = screen.getByTestId(
      "unlock-import-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("import-dek submits with the typed path and password", async () => {
    // Lock the call shape: handleImportDek invokes the hook with
    // positional (path, password) — if a refactor accidentally swaps
    // them or drops one, the import would attempt to unwrap with the
    // wrong material and the user would see a misleading
    // wrong-password banner.
    const importPortableDek = vi.fn().mockResolvedValue(undefined);
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
      importPortableDek,
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));

    fireEvent.change(
      screen.getByPlaceholderText("/secure/backup/sorng-master.dek"),
      { target: { value: "/secure/key.dek" } },
    );
    fireEvent.change(screen.getByPlaceholderText("Export password"), {
      target: { value: "hunter2" },
    });

    const submit = screen.getByTestId("unlock-import-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(importPortableDek).toHaveBeenCalledWith(
        "/secure/key.dek",
        "hunter2",
      );
    });
  });

  it("import-dek failure surfaces the error and preserves the typed fields", async () => {
    // After a wrong-password rejection the user should not have to
    // retype the path or password — re-entering an absolute path is
    // tedious on the unlock screen (no autocomplete) and the field is
    // not a secret-handling regression because we don't auto-mask.
    const importPortableDek = vi
      .fn()
      .mockRejectedValue(new Error("wrong export password"));
    hookOverride = {
      status: baseStatus,
      lockout: zeroLockout,
      unlock: vi.fn(),
      importPortableDek,
    };
    render(<UnlockScreen onUnlocked={() => {}} />);
    fireEvent.click(screen.getByTestId("unlock-import-toggle"));

    const pathInput = screen.getByPlaceholderText(
      "/secure/backup/sorng-master.dek",
    ) as HTMLInputElement;
    const pwInput = screen.getByPlaceholderText(
      "Export password",
    ) as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "/some/path.dek" } });
    fireEvent.change(pwInput, { target: { value: "nope" } });

    fireEvent.click(screen.getByTestId("unlock-import-submit"));

    await waitFor(() => {
      expect(screen.getByText(/wrong export password/i)).toBeTruthy();
    });
    // Fields should still hold what the user typed.
    expect(pathInput.value).toBe("/some/path.dek");
    expect(pwInput.value).toBe("nope");
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
      },
      lockout: zeroLockout,
      unlock: vi.fn(),
    };
    const { container } = render(<UnlockScreen onUnlocked={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("encryption-unlock-screen")).toBeNull();
  });
});
