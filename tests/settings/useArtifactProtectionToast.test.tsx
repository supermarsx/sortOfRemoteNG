import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContext } from "../../src/contexts/ToastContext";
import { useArtifactProtection } from "../../src/hooks/settings/useArtifactProtection";
import type {
  ArtifactPolicyProgress,
  ArtifactPolicyResult,
} from "../../src/types/encryption/artifactProtection";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
const toast = {
  loading: vi.fn(() => "operation-toast"),
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(() => "unused"),
  warning: vi.fn(() => "unused"),
  error: vi.fn(() => "unused"),
  info: vi.fn(() => "unused"),
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastContext.Provider value={{ toast, removeAll: vi.fn() }}>
    {children}
  </ToastContext.Provider>
);
let listener: (event: { payload: ArtifactPolicyProgress }) => void;
let resolve: (value: ArtifactPolicyResult) => void;
let reject: (error: Error) => void;
let requestId: string;
const rows = ["macros", "logs"].map((id) => ({
  id,
  mutable: true,
  policy: "default",
  diskState: "plaintext",
  encryptedFiles: 0,
  plaintextFiles: 2,
  unverifiedFiles: 0,
  bytes: 12,
}));
beforeEach(() => {
  vi.clearAllMocks();
  requestId = "";
  h.listen.mockImplementation(async (_name, callback) => {
    listener = callback;
    return h.unlisten;
  });
  h.invoke.mockImplementation(async (command, args) => {
    if (command === "encryption_get_artifact_status")
      return {
        unlocked: true,
        busy: false,
        recoveryRequired: false,
        artifacts: rows,
        warnings: [],
      };
    if (command === "encryption_preview_artifact_policy")
      return {
        token: "preview",
        target: args.target,
        artifacts: rows,
        totalFiles: 4,
        totalBytes: 24,
      };
    if (command === "encryption_apply_artifact_policy") {
      requestId = args.requestId;
      return new Promise<ArtifactPolicyResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
    }
    return undefined;
  });
});
async function start(target: "encrypted" | "plaintext" = "encrypted") {
  const view = renderHook(() => useArtifactProtection(), { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () =>
    view.result.current.inspect(["macros", "logs"], target),
  );
  let pending!: Promise<ArtifactPolicyResult | null>;
  await act(async () => {
    pending = view.result.current.apply();
  });
  await waitFor(() => expect(requestId).toBeTruthy());
  return { ...view, pending };
}
const outcome = (
  kind: ArtifactPolicyResult["outcome"],
): ArtifactPolicyResult => ({
  requestId,
  outcome: kind,
  recoveryRequired: false,
  results: [
    { id: "macros", outcome: "committed", files: 2 },
    {
      id: "logs",
      outcome: kind === "completed" ? "committed" : "not-attempted",
      files: 2,
    },
  ],
});
describe("artifact operation progress toast", () => {
  it("labels phase-local units and allows the next artifact's file count to restart", async () => {
    const run = await start();
    for (const [phase, completed, total, text, progress] of [
      ["scan", 1, 2, "artifact families", undefined],
      [
        "stage",
        2,
        2,
        "current artifact group · 2 / 2 files",
        { completed: 2, total: 2 },
      ],
      ["commit", 0, 1, "committing current artifact group", undefined],
      [
        "stage",
        0,
        3,
        "current artifact group · 0 / 3 files",
        { completed: 0, total: 3 },
      ],
      ["rollback", 0, 1, "rolling back current artifact group", undefined],
      ["complete", 1, 2, "artifact families committed", undefined],
    ] as const) {
      act(() => listener({ payload: { requestId, phase, completed, total } }));
      expect(toast.update).toHaveBeenLastCalledWith(
        "operation-toast",
        expect.objectContaining({
          message: expect.stringContaining(text),
          progress,
        }),
      );
    }
    await act(async () => {
      resolve(outcome("failed"));
      await run.pending;
    });
  });
  it("updates one toast from matching validated counts and waits for verified completion", async () => {
    const run = await start();
    expect(toast.loading).toHaveBeenCalledOnce();
    const before = toast.update.mock.calls.length;
    act(() =>
      listener({
        payload: {
          requestId: "foreign",
          phase: "stage",
          completed: 1,
          total: 4,
        },
      }),
    );
    act(() =>
      listener({
        payload: { requestId, phase: "stage", completed: 5, total: 4 },
      }),
    );
    expect(toast.update).toHaveBeenCalledTimes(before);
    act(() =>
      listener({
        payload: { requestId, phase: "stage", completed: 2, total: 4 },
      }),
    );
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ progress: { completed: 2, total: 4 } }),
    );
    act(() =>
      listener({
        payload: { requestId, phase: "complete", completed: 4, total: 4 },
      }),
    );
    expect(
      toast.update.mock.calls.some(([, patch]) => patch.type === "success"),
    ).toBe(false);
    await act(async () => {
      resolve(outcome("completed"));
      await run.pending;
    });
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ type: "success", progress: undefined }),
    );
    expect(h.unlisten).toHaveBeenCalledOnce();
    const finishedCalls = toast.update.mock.calls.length;
    act(() =>
      listener({
        payload: { requestId, phase: "stage", completed: 1, total: 4 },
      }),
    );
    expect(toast.update).toHaveBeenCalledTimes(finishedCalls);
  });
  it.each(["failed", "cancelled"] as const)(
    "reports %s after partial completion without a success toast",
    async (kind) => {
      const run = await start("plaintext");
      await act(async () => {
        resolve(outcome(kind));
        await run.pending;
      });
      expect(toast.update).toHaveBeenLastCalledWith(
        "operation-toast",
        expect.objectContaining({
          type: kind === "failed" ? "error" : "warning",
          message: expect.stringContaining("partial completion"),
          duration: 0,
        }),
      );
    },
  );
  it("keeps the operation listener until completion after closing Settings", async () => {
    const run = await start();
    run.unmount();
    expect(h.unlisten).not.toHaveBeenCalled();
    act(() =>
      listener({
        payload: { requestId, phase: "stage", completed: 3, total: 4 },
      }),
    );
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ progress: { completed: 3, total: 4 } }),
    );
    await act(async () => {
      resolve(outcome("completed"));
      await run.pending;
    });
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ type: "success" }),
    );
    expect(h.unlisten).toHaveBeenCalledOnce();
    expect(
      h.invoke.mock.calls.some(
        ([command]) => command === "encryption_cancel_artifact_policy",
      ),
    ).toBe(false);
  });
  it("shows cancellation as a request until the native result arrives", async () => {
    const run = await start();
    await act(async () => run.result.current.cancel());
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({
        message: expect.stringContaining("Cancellation requested"),
      }),
    );
    expect(toast.update.mock.calls.some(([, patch]) => patch.type)).toBe(false);
    await act(async () => {
      resolve(outcome("cancelled"));
      await run.pending;
    });
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ type: "warning" }),
    );
  });
  it("settles a rejected operation without inventing completion or exposing raw error text", async () => {
    const run = await start();
    await act(async () => {
      reject(new Error("private-path-fixture"));
      await run.pending;
    });
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({
        type: "error",
        progress: undefined,
        duration: 0,
      }),
    );
    expect(JSON.stringify(toast.update.mock.calls)).not.toContain(
      "private-path-fixture",
    );
  });
  it("settles subscription failure and never starts an unobserved operation", async () => {
    h.listen.mockRejectedValueOnce(new Error("event unavailable"));
    const view = renderHook(() => useArtifactProtection(), { wrapper });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () =>
      view.result.current.inspect(["macros", "logs"], "encrypted"),
    );
    await act(async () => view.result.current.apply());
    expect(toast.update).toHaveBeenLastCalledWith(
      "operation-toast",
      expect.objectContaining({ type: "error" }),
    );
    expect(
      h.invoke.mock.calls.some(
        ([command]) => command === "encryption_apply_artifact_policy",
      ),
    ).toBe(false);
  });
});
