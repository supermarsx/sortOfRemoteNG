import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ArtifactProtectionPanel from "../../src/components/SettingsDialog/sections/security/ArtifactProtectionPanel";
import { ARTIFACT_LABELS } from "../../src/types/encryption/encryption";
import {
  MUTABLE_ARTIFACT_IDS,
  type ArtifactPolicyPreview,
  type ArtifactPolicyProgress,
  type ArtifactPolicyResult,
  type ArtifactProtectionSnapshot,
  type ArtifactProtectionStatus,
} from "../../src/types/encryption/artifactProtection";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  available: true,
  progress: undefined as
    undefined | ((event: { payload: ArtifactPolicyProgress }) => void),
  unlisten: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (native.available ? native.invoke : null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, callback: typeof native.progress) => {
    native.progress = callback;
    return native.unlisten;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function row(
  id: ArtifactProtectionStatus["id"],
  changes: Partial<ArtifactProtectionStatus> = {},
): ArtifactProtectionStatus {
  return {
    id,
    policy: "default",
    diskState: "plaintext",
    encryptedFiles: 0,
    plaintextFiles: 2,
    unverifiedFiles: 0,
    bytes: 128,
    mutable: true,
    ...changes,
  };
}
function snapshot(
  changes: Partial<ArtifactProtectionSnapshot> = {},
): ArtifactProtectionSnapshot {
  return {
    unlocked: true,
    busy: false,
    recoveryRequired: false,
    warnings: [],
    artifacts: [
      ...MUTABLE_ARTIFACT_IDS.map((id) => row(id)),
      row("key-ring", {
        mutable: false,
        policy: "encrypted",
        diskState: "encrypted",
      }),
      row("artifact-policy", {
        mutable: false,
        policy: "encrypted",
        diskState: "encrypted",
      }),
    ],
    ...changes,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let state: ArtifactProtectionSnapshot;
let planned: ArtifactPolicyPreview;
function calls(command: string) {
  return native.invoke.mock.calls.filter(([name]) => name === command);
}
async function ready() {
  await screen.findByRole("button", { name: "Encrypt all supported" });
}
async function preview(target = "Decrypt all supported") {
  fireEvent.click(screen.getByRole("button", { name: target }));
  return screen.findByTestId("confirm-dialog");
}

beforeEach(() => {
  native.available = true;
  native.progress = undefined;
  native.unlisten.mockReset();
  state = snapshot();
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "encryption_get_artifact_status") return state;
    if (command === "encryption_preview_artifact_policy") {
      planned = {
        token: "opaque-preview",
        target: args.target,
        artifacts: state.artifacts.filter((item) =>
          args.artifacts.includes(item.id),
        ),
        totalFiles: args.artifacts.length * 2,
        totalBytes: args.artifacts.length * 128,
      };
      return planned;
    }
    if (command === "encryption_apply_artifact_policy")
      return {
        requestId: args.requestId,
        outcome: "completed",
        recoveryRequired: false,
        results: planned.artifacts.map((item) => ({
          id: item.id,
          outcome: "committed",
          files: 2,
        })),
      };
    if (
      command === "encryption_release_artifact_preview" ||
      command === "encryption_cancel_artifact_policy" ||
      command === "encryption_recover_artifact_transition"
    )
      return;
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("ArtifactProtectionPanel", () => {
  it("shows inspected states, physical scope, future-write policy and friendly protected names without polling", async () => {
    state.artifacts[0] = row("connections", {
      diskState: "mixed",
      encryptedFiles: 1,
      plaintextFiles: 2,
      unverifiedFiles: 3,
    });
    state.artifacts[1] = row("databases-index", { diskState: "unverified" });
    state.artifacts[2] = row("trust-store", { diskState: "absent" });
    render(<ArtifactProtectionPanel />);
    await ready();
    expect(screen.getByText("Mixed protection")).toBeInTheDocument();
    expect(
      screen.getByText("1 encrypted · 2 plaintext · 3 unverified"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("No managed files")).toBeInTheDocument();
    expect(screen.getByText("Database names and index")).toBeInTheDocument();
    expect(screen.getByText("Database trust records")).toBeInTheDocument();
    expect(screen.getAllByText("Read-only protection")).toHaveLength(2);
    expect(
      screen.getByText(/intentionally plaintext encryption audit/),
    ).toBeInTheDocument();
    expect(calls("encryption_get_artifact_status")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh artifact protection" }),
    );
    await waitFor(() =>
      expect(calls("encryption_get_artifact_status")).toHaveLength(2),
    );
  });

  it("previews only supported families, requires explicit plaintext confirmation, and Cancel/Enter mutate nothing", async () => {
    // Even malformed capability metadata cannot make infrastructure selectable.
    state.artifacts.find((item) => item.id === "key-ring")!.mutable = true;
    render(<ArtifactProtectionPanel />);
    await ready();
    const dialog = await preview();
    expect(calls("encryption_preview_artifact_policy")[0][1]).toEqual({
      artifacts: [...MUTABLE_ARTIFACT_IDS],
      target: "plaintext",
    });
    expect(
      within(dialog).getByText(/Separate database passwords remain unchanged/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/retained recovery keys are not deleted/),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
    await waitFor(() =>
      expect(calls("encryption_release_artifact_preview")).toHaveLength(1),
    );
    expect(calls("encryption_release_artifact_preview")[0][1]).toEqual({
      token: "opaque-preview",
    });
  });

  it("releases a displayed preview on unmount without applying it", async () => {
    const view = render(<ArtifactProtectionPanel />);
    await ready();
    await preview();
    view.unmount();
    await waitFor(() =>
      expect(calls("encryption_release_artifact_preview")).toHaveLength(1),
    );
    expect(calls("encryption_release_artifact_preview")[0][1]).toEqual({
      token: "opaque-preview",
    });
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
  });

  it.each(["plaintext", "encrypted"] as const)(
    "applies a token-bound %s plan once, then refreshes actual status",
    async (target) => {
      render(<ArtifactProtectionPanel />);
      await ready();
      const dialog = await preview(
        target === "plaintext"
          ? "Decrypt all supported"
          : "Encrypt all supported",
      );
      const button = within(dialog).getByTestId("confirm-yes");
      fireEvent.click(button);
      fireEvent.click(button);
      await screen.findByText(/Operation completed/);
      expect(calls("encryption_apply_artifact_policy")).toHaveLength(1);
      expect(calls("encryption_apply_artifact_policy")[0][1]).toEqual({
        token: "opaque-preview",
        confirmPlaintext: target === "plaintext",
        requestId: expect.any(String),
      });
      expect(calls("encryption_get_artifact_status")).toHaveLength(2);
      expect(native.unlisten).toHaveBeenCalledOnce();
    },
  );

  it("selection and per-row actions preserve exact requested scope", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    const label = ARTIFACT_LABELS["sorng-v1::settings"];
    fireEvent.click(screen.getByRole("checkbox", { name: `Select ${label}` }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select all supported artifact families",
        }) as HTMLInputElement
      ).indeterminate,
    ).toBe(true);
    const dialog = await preview("Encrypt selected");
    expect(calls("encryption_preview_artifact_policy")[0][1]).toEqual({
      artifacts: ["settings"],
      target: "encrypted",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(
      screen.getByRole("button", { name: "Encrypt selected" }),
    ).toBeDisabled();
    await preview(`Decrypt and disable ${label}`);
    expect(calls("encryption_preview_artifact_policy")[1][1]).toEqual({
      artifacts: ["settings"],
      target: "plaintext",
    });
  });

  it("select all/clear never selects protected rows", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    expect(screen.getAllByRole("checkbox")).toHaveLength(10);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all supported artifact families",
      }),
    );
    expect(
      screen.getByText("9 selected · 9 supported families"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all supported artifact families",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Decrypt selected" }),
    ).toBeDisabled();
  });

  it("excludes unverified and unsupported data from mutation even if capability metadata is inconsistent", async () => {
    state.artifacts[0] = row("connections", { diskState: "unverified" });
    state.artifacts[1] = row("databases-index", {
      mutable: false,
      reason: "Path cannot be inspected",
    });
    render(<ArtifactProtectionPanel />);
    await ready();
    expect(
      screen.queryByRole("checkbox", {
        name: `Select ${ARTIFACT_LABELS["sorng-v1::connections"]}`,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Path cannot be inspected")).toBeInTheDocument();
    await preview();
    expect(calls("encryption_preview_artifact_policy")[0][1].artifacts).toEqual(
      MUTABLE_ARTIFACT_IDS.filter(
        (id) => id !== "connections" && id !== "databases-index",
      ),
    );
  });

  it.each([
    { unlocked: false },
    { busy: true },
    { recoveryRequired: true },
    { policyError: "Policy authentication failed" },
  ])("blocks changes for restricted state %j", async (restriction) => {
    state = snapshot(restriction);
    render(<ArtifactProtectionPanel />);
    await ready();
    expect(
      screen.getByRole("button", { name: "Encrypt all supported" }),
    ).toBeDisabled();
    expect(calls("encryption_preview_artifact_policy")).toHaveLength(0);
  });

  it("does not fake a browser status or retry an unavailable backend", async () => {
    native.available = false;
    render(<ArtifactProtectionPanel />);
    await screen.findByText(/available only in the desktop app/);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("shows backend failure once and explicit Retry via refresh can recover", async () => {
    native.invoke.mockRejectedValueOnce(new Error("Command not found"));
    render(<ArtifactProtectionPanel />);
    await screen.findByText("Command not found");
    expect(native.invoke).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh artifact protection" }),
    );
    await ready();
    expect(screen.queryByText("Command not found")).not.toBeInTheDocument();
  });

  it("rejects duplicate IDs in a preview instead of silently changing bulk scope", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    native.invoke.mockResolvedValueOnce({
      token: "bad",
      target: "plaintext",
      artifacts: MUTABLE_ARTIFACT_IDS.map(() => row("settings")),
      totalFiles: 2,
      totalBytes: 128,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Decrypt all supported" }),
    );
    await screen.findByText(/native preview was invalid/);
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
    await waitFor(() =>
      expect(calls("encryption_release_artifact_preview")).toHaveLength(1),
    );
    expect(calls("encryption_release_artifact_preview")[0][1]).toEqual({
      token: "bad",
    });
  });

  it.each([undefined, "", "   ", 42])(
    "does not release or apply a malformed preview token %j",
    async (token) => {
      render(<ArtifactProtectionPanel />);
      await ready();
      native.invoke.mockResolvedValueOnce({
        token,
        target: "plaintext",
        artifacts: MUTABLE_ARTIFACT_IDS.map((id) => row(id)),
        totalFiles: 2,
        totalBytes: 128,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Decrypt all supported" }),
      );
      await screen.findByText(/native preview was invalid/);
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
      expect(calls("encryption_release_artifact_preview")).toHaveLength(0);
      expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
    },
  );

  it("releases the returned token when malformed preview rows throw during validation", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    native.invoke.mockResolvedValueOnce({
      token: "malformed-rows",
      target: "plaintext",
      artifacts: [null],
      totalFiles: 2,
      totalBytes: 128,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Decrypt and disable Settings" }),
    );
    await waitFor(() =>
      expect(calls("encryption_release_artifact_preview")).toHaveLength(1),
    );
    expect(calls("encryption_release_artifact_preview")[0][1]).toEqual({
      token: "malformed-rows",
    });
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
  });

  it("discards pending preview when key/status changes and does not apply after lock", async () => {
    const view = render(<ArtifactProtectionPanel refreshKey="unlocked" />);
    await ready();
    const pending = deferred<ArtifactPolicyPreview>();
    native.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(
      screen.getByRole("button", { name: "Decrypt all supported" }),
    );
    await waitFor(() =>
      expect(calls("encryption_preview_artifact_policy")).toHaveLength(1),
    );
    state = snapshot({ unlocked: false });
    view.rerender(<ArtifactProtectionPanel refreshKey="locked" />);
    await waitFor(() =>
      expect(calls("encryption_get_artifact_status")).toHaveLength(2),
    );
    await act(async () =>
      pending.resolve({
        token: "stale",
        target: "plaintext",
        artifacts: state.artifacts.filter((item) => item.mutable),
        totalFiles: 18,
        totalBytes: 1152,
      }),
    );
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
  });

  it("refresh invalidates an already displayed preview", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    await preview();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh artifact protection" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument(),
    );
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(0);
  });

  it("reports token drift without silently retrying plaintext apply", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    const dialog = await preview();
    native.invoke.mockRejectedValueOnce(
      new Error("Preview expired or files changed; preview again"),
    );
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await screen.findByText(/Preview expired or files changed/);
    expect(calls("encryption_apply_artifact_policy")).toHaveLength(1);
    expect(calls("encryption_preview_artifact_policy")).toHaveLength(1);
    expect(screen.queryByText(/Operation completed/)).not.toBeInTheDocument();
  });

  it("rejects mismatched native result request IDs", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    const dialog = await preview();
    native.invoke.mockResolvedValueOnce({
      requestId: "other",
      outcome: "completed",
      results: [],
      recoveryRequired: false,
    });
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await screen.findByText(/no verified result/);
    expect(screen.queryByText(/Operation completed/)).not.toBeInTheDocument();
  });

  it("keeps partial failures and physical scope warnings visible after refresh", async () => {
    state.warnings = ["Remote backups were not inspected"];
    render(<ArtifactProtectionPanel />);
    await ready();
    const dialog = await preview();
    const implementation = native.invoke.getMockImplementation()!;
    native.invoke.mockImplementation(async (command, args) =>
      command === "encryption_apply_artifact_policy"
        ? {
            requestId: args.requestId,
            outcome: "failed",
            recoveryRequired: false,
            results: planned.artifacts.map((item, index) => ({
              id: item.id,
              outcome:
                index === 0
                  ? "committed"
                  : index === 1
                    ? "failed"
                    : "not-attempted",
              files: index === 0 ? 2 : 0,
              error: index === 1 ? "Read-only file" : undefined,
            })),
          }
        : implementation(command, args),
    );
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await screen.findByText(/Operation failed/);
    expect(screen.getByText(/Read-only file/)).toBeInTheDocument();
    expect(
      screen.getByText("Remote backups were not inspected"),
    ).toBeInTheDocument();
    expect(screen.getByText(/not one all-or-nothing/)).toBeInTheDocument();
  });

  it("filters progress by request and cancels once before commit, with listener cleanup", async () => {
    render(<ArtifactProtectionPanel />);
    await ready();
    const dialog = await preview();
    const pending = deferred<ArtifactPolicyResult>();
    native.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await waitFor(() =>
      expect(calls("encryption_apply_artifact_policy")).toHaveLength(1),
    );
    const requestId = calls("encryption_apply_artifact_policy")[0][1].requestId;
    act(() =>
      native.progress?.({
        payload: {
          requestId: "other",
          phase: "commit",
          completed: 99,
          total: 100,
        },
      }),
    );
    expect(screen.queryByText("commit: 99 / 100")).not.toBeInTheDocument();
    act(() =>
      native.progress?.({
        payload: { requestId, phase: "stage", completed: 1, total: 18 },
      }),
    );
    const cancel = screen.getByRole("button", { name: "Request cancellation" });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(calls("encryption_cancel_artifact_policy")).toHaveLength(1),
    );
    expect(calls("encryption_cancel_artifact_policy")[0][1]).toEqual({
      requestId,
    });
    await act(async () =>
      pending.resolve({
        requestId,
        outcome: "cancelled",
        recoveryRequired: false,
        results: planned.artifacts.map((item) => ({
          id: item.id,
          outcome: "not-attempted",
          files: 0,
        })),
      }),
    );
    await screen.findByText(/Operation cancelled/);
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("disables cancellation at commit and immediately releases the progress listener on unmount", async () => {
    const onChanged = vi.fn();
    const view = render(<ArtifactProtectionPanel onChanged={onChanged} />);
    await ready();
    const dialog = await preview();
    const pending = deferred<ArtifactPolicyResult>();
    native.invoke.mockReturnValueOnce(pending.promise);
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await waitFor(() =>
      expect(calls("encryption_apply_artifact_policy")).toHaveLength(1),
    );
    const requestId = calls("encryption_apply_artifact_policy")[0][1].requestId;
    act(() =>
      native.progress?.({
        payload: { requestId, phase: "commit", completed: 1, total: 18 },
      }),
    );
    const cancel = screen.getByRole("button", { name: "Request cancellation" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(calls("encryption_cancel_artifact_policy")).toHaveLength(0);
    view.unmount();
    expect(native.unlisten).toHaveBeenCalledOnce();
    await act(async () =>
      pending.resolve({
        requestId,
        outcome: "completed",
        recoveryRequired: false,
        results: planned.artifacts.map((item) => ({
          id: item.id,
          outcome: "committed",
          files: 2,
        })),
      }),
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("reports a failed neighboring refresh without losing the committed result", async () => {
    render(
      <ArtifactProtectionPanel
        onChanged={async () => {
          throw new Error("Disk probe unavailable");
        }}
      />,
    );
    await ready();
    const dialog = await preview("Encrypt all supported");
    fireEvent.click(within(dialog).getByTestId("confirm-yes"));
    await screen.findByText(/Disk probe unavailable/);
    expect(screen.getByText(/Operation completed/)).toBeInTheDocument();
  });

  it("requires confirmation for interrupted transition recovery and refreshes afterward", async () => {
    state = snapshot({ recoveryRequired: true });
    render(<ArtifactProtectionPanel />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Recover interrupted transition" }),
    );
    expect(calls("encryption_recover_artifact_transition")).toHaveLength(0);
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(
      within(dialog).getByText(/finish cleanup for a committed one/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Recover transition" }),
    );
    await waitFor(() =>
      expect(calls("encryption_get_artifact_status")).toHaveLength(2),
    );
    expect(calls("encryption_recover_artifact_transition")).toHaveLength(1);
  });
});
