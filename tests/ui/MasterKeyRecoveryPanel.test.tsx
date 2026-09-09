import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterKeyRecoveryPanel } from "../../src/components/encryption/MasterKeyRecoveryPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
const challenge = {
  token: "native-one-shot-token",
  delayMs: 10_000,
  expiresInMs: 120_000,
  verified: ["artifact-policy.enc"],
  warnings: [],
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
async function prepare() {
  fireEvent.click(screen.getByText("Choose portable master key file"));
  await flush();
  fireEvent.change(screen.getByLabelText("Backup password"), {
    target: { value: "fixture-backup-password" },
  });
  fireEvent.change(screen.getByLabelText("New local master password"), {
    target: { value: "fixture-new-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new local master password"), {
    target: { value: "fixture-new-password" },
  });
  fireEvent.click(screen.getByText("Verify recovery key"));
  await flush();
}
describe("verified master-key recovery UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.open.mockReset().mockResolvedValue("C:/fixture/backup.dek");
    mocks.invoke.mockReset().mockImplementation(async (command: string) =>
      command === "encryption_prepare_master_recovery"
        ? challenge
        : command === "encryption_commit_master_recovery"
          ? {
              restored: true,
              oldWrapperBackup: "dek.enc.recovery-fixture.bak",
              warnings: [],
            }
          : undefined,
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("authenticates first, clears password inputs, waits and commits only a native token", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<MasterKeyRecoveryPanel onRestored={refresh} />);
    await prepare();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_prepare_master_recovery",
      {
        sourcePath: "C:/fixture/backup.dek",
        backupPassword: "fixture-backup-password",
        newPassword: "fixture-new-password",
      },
    );
    const commit = screen.getByText("Restore verified key");
    expect(commit).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(9_999);
    });
    expect(commit).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(251);
    });
    fireEvent.click(commit);
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_commit_master_recovery",
      { token: challenge.token },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Backup password")).toHaveValue("");
    expect(
      screen.getByText("Original key receipt restored."),
    ).toBeInTheDocument();
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "encryption_import_portable_dek",
      ),
    ).toBe(false);
  });

  it("does not arm or report success after rejected proof", async () => {
    mocks.invoke.mockRejectedValue(
      new Error("Candidate does not match current profile"),
    );
    const refresh = vi.fn();
    render(<MasterKeyRecoveryPanel onRestored={refresh} />);
    await prepare();
    expect(screen.getByRole("alert")).toHaveTextContent("does not match");
    expect(screen.queryByText("Restore verified key")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Backup password")).toHaveValue("");
  });

  it("releases native candidate on cancel or unmount", async () => {
    const rendered = render(<MasterKeyRecoveryPanel onRestored={vi.fn()} />);
    await prepare();
    fireEvent.click(screen.getByText("Cancel recovery"));
    await flush();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_cancel_master_recovery",
      { token: challenge.token },
    );
    await prepare();
    rendered.unmount();
    await flush();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "encryption_cancel_master_recovery",
      ),
    ).toHaveLength(2);
  });

  it("does not turn native delay/expiry/commit refusal into success", async () => {
    const refresh = vi.fn();
    render(<MasterKeyRecoveryPanel onRestored={refresh} />);
    await prepare();
    mocks.invoke.mockRejectedValue(
      new Error("Native challenge expired or key state changed"),
    );
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByText("Restore verified key"));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Original key receipt restored.")).toBeNull();
    expect(screen.queryByText("Restore verified key")).toBeNull();
    expect(screen.getByText("Verify recovery key")).toBeInTheDocument();
  });

  it("expires the confirmation instead of displaying ready forever", async () => {
    render(<MasterKeyRecoveryPanel onRestored={vi.fn()} />);
    await prepare();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    await flush();
    expect(screen.queryByText("Restore verified key")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verify the backup again",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_cancel_master_recovery",
      { token: challenge.token },
    );
  });

  it("requires matching local password confirmation before authenticating", async () => {
    render(<MasterKeyRecoveryPanel onRestored={vi.fn()} />);
    fireEvent.click(screen.getByText("Choose portable master key file"));
    await flush();
    fireEvent.change(screen.getByLabelText("Backup password"), {
      target: { value: "backup" },
    });
    fireEvent.change(screen.getByLabelText("New local master password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(
      screen.getByLabelText("Confirm new local master password"),
      { target: { value: "mistyped" } },
    );
    expect(screen.getByText("Verify recovery key")).toBeDisabled();
    expect(
      screen.getByText("The new passwords must match."),
    ).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("cancels a preparation result arriving after its UI unmounts", async () => {
    let resolve: (value: typeof challenge) => void = () => undefined;
    mocks.invoke.mockImplementation((command: string) =>
      command === "encryption_prepare_master_recovery"
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(),
    );
    const rendered = render(<MasterKeyRecoveryPanel onRestored={vi.fn()} />);
    await prepare();
    rendered.unmount();
    await act(async () => {
      resolve(challenge);
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_cancel_master_recovery",
      { token: challenge.token },
    );
  });
});
