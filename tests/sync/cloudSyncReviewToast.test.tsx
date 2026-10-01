import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as notifications from "../../src/utils/services/cloudSyncNotifications";
import {
  ToastProvider,
  useToastContext,
} from "../../src/contexts/ToastContext";
import { showCloudSyncReviewToast } from "../../src/components/sync/cloudSyncReviewToast";

describe("cloud sync review action", () => {
  beforeEach(() =>
    vi
      .spyOn(notifications, "claimCloudSyncFailureNotification")
      .mockReturnValue(true),
  );
  afterEach(() => vi.restoreAllMocks());
  it("suppresses repeated failure toasts while retaining conflict notifications", () => {
    vi.mocked(notifications.claimCloudSyncFailureNotification).mockReturnValue(
      false,
    );
    const toast = {
      error: vi.fn(),
      warning: vi.fn(() => "warning"),
      update: vi.fn(),
    };
    expect(
      showCloudSyncReviewToast(toast, vi.fn(), "Failure", "error", 45),
    ).toBeNull();
    expect(
      notifications.claimCloudSyncFailureNotification,
    ).toHaveBeenCalledExactlyOnceWith(45);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.update).not.toHaveBeenCalled();
    showCloudSyncReviewToast(toast, vi.fn(), "Conflict", "warning");
    expect(toast.warning).toHaveBeenCalledOnce();
  });
  it.each(["error", "warning"] as const)(
    "opens the Cloud Sync settings section from a %s notification",
    (type) => {
      const openSettings = vi.fn();
      const { result, unmount } = renderHook(() => useToastContext(), {
        wrapper: ToastProvider,
      });
      act(() => {
        showCloudSyncReviewToast(
          result.current.toast,
          openSettings,
          "Review Cloud Sync statuses.",
          type,
        );
      });
      const button = screen.getByRole("button", { name: "Open sync settings" });
      expect(button).toHaveClass("sor-btn-secondary-sm");
      expect(button.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(openSettings).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(openSettings).toHaveBeenCalledExactlyOnceWith("cloudSync");
      unmount();
    },
  );
});
