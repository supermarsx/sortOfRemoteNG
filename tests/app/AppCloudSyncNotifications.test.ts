import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";

// Execute the actual completion branch without mounting unrelated native sessions.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(resolve("src/App.tsx"), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let notificationBranch: ts.IfStatement | undefined;
function visit(node: ts.Node) {
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(source).includes("currentConfig.notifyOnConflict")
  )
    notificationBranch = node;
  ts.forEachChild(node, visit);
}
visit(source);
if (!notificationBranch)
  throw new Error("Cloud sync completion branch not found");
const notify = new Function(
  "updatedCloudSync",
  "currentConfig",
  "toast",
  "showCloudSyncReviewToast",
  "handleOpenSettings",
  ts.transpileModule(notificationBranch.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText,
);

function run(status: string, options = {}) {
  const toast = { success: vi.fn() };
  const review = vi.fn();
  const openSettings = vi.fn();
  notify(
    { lastSyncStatus: status },
    { ...defaultCloudSyncConfig, ...options },
    toast,
    review,
    openSettings,
  );
  return { toast, review, openSettings };
}

describe("application cloud sync completion notifications", () => {
  it.each([undefined, false])(
    "does not show success or failure toasts when success notifications are %s",
    (notifyOnSyncSuccess) => {
      const { toast, review } = run("success", { notifyOnSyncSuccess });
      expect(toast.success).not.toHaveBeenCalled();
      expect(review).not.toHaveBeenCalled();
    },
  );

  it("shows an explicitly enabled success toast independently of failures", () => {
    const { toast, review } = run("success", {
      notifyOnSyncSuccess: true,
      notifyOnSync: false,
    });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Cloud sync completed.",
    );
    expect(review).not.toHaveBeenCalled();
  });

  it.each(["failed", "partial"])(
    "retains %s alerts and their cooldown by default",
    (status) => {
      const { toast, review, openSettings } = run(status);
      expect(toast.success).not.toHaveBeenCalled();
      expect(review).toHaveBeenCalledExactlyOnceWith(
        toast,
        openSettings,
        expect.any(String),
        "error",
        30,
      );
    },
  );

  it("retains conflict review alerts by default", () => {
    const { toast, review, openSettings } = run("conflict");
    expect(toast.success).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledExactlyOnceWith(
      toast,
      openSettings,
      expect.any(String),
      "warning",
    );
  });

  it("honors disabled failure notifications", () => {
    const { toast, review } = run("failed", {
      notifyOnSync: false,
      notifyOnSyncSuccess: true,
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });
});
