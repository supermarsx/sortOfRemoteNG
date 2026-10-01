import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotificationsGrid from "../../src/components/SettingsDialog/sections/cloudSync/NotificationsGrid";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";

afterEach(cleanup);
describe("cloud sync failure notification setting", () => {
  it("defaults to 30 minutes with a themed input and persists custom/every-failure values", () => {
    const update = vi.fn();
    function Harness() {
      const [cloudSync, setCloudSync] = useState<CloudSyncConfig>({
        ...defaultCloudSyncConfig,
        failureNotificationIntervalMinutes: undefined,
      });
      return (
        <NotificationsGrid
          mgr={
            {
              cloudSync,
              updateCloudSync: (patch: Partial<CloudSyncConfig>) => {
                update(patch);
                setCloudSync((current) => ({ ...current, ...patch }));
              },
            } as Mgr
          }
        />
      );
    }
    render(<Harness />);
    const input = screen.getByRole("spinbutton", {
      name: "Sync Failure Notification Interval",
    });
    expect(input).toHaveClass("sor-settings-input");
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "90" } });
    expect(update).toHaveBeenLastCalledWith({
      failureNotificationIntervalMinutes: 90,
    });
    expect(input).toHaveValue(90);
    fireEvent.change(input, { target: { value: "0" } });
    expect(update).toHaveBeenLastCalledWith({
      failureNotificationIntervalMinutes: 0,
    });
    expect(screen.getByText(/Target statuses always update/)).toBeVisible();
  });
});
