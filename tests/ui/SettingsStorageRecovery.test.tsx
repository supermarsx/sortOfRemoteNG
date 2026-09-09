import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStorageNotice } from "../../src/components/encryption/SettingsStorageNotice";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), reload: vi.fn() }));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settingsReady: false,
    settingsLoadError: "interrupted transaction",
    reloadSettings: mocks.reload,
  }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));

describe("interrupted storage recovery after same-key restore", () => {
  beforeEach(() => {
    mocks.reload.mockReset().mockResolvedValue(undefined);
    mocks.invoke
      .mockReset()
      .mockImplementation(async (command: string) =>
        command === "encryption_status"
          ? { unlocked: true, artifactRecoveryRequired: true }
          : undefined,
      );
  });
  afterEach(cleanup);

  it("offers coordinated recovery on the blocking settings screen and then reloads settings", async () => {
    render(<SettingsStorageNotice />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Recover interrupted storage operation",
      }),
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith(
      "encryption_recover_artifact_transition",
    );
    expect(
      screen.queryByRole("button", {
        name: "Recover interrupted storage operation",
      }),
    ).toBeNull();
  });

  it("preserves blocked settings and reports recovery refusal", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "encryption_status")
        return { unlocked: true, artifactRecoveryRequired: true };
      throw new Error("Journal verification failed; preserve files");
    });
    render(<SettingsStorageNotice />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Recover interrupted storage operation",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Journal verification failed",
    );
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("does not offer artifact mutation while the master key remains locked", async () => {
    mocks.invoke.mockResolvedValue({
      unlocked: false,
      artifactRecoveryRequired: true,
    });
    render(<SettingsStorageNotice />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("encryption_status"),
    );
    expect(
      screen.queryByRole("button", {
        name: "Recover interrupted storage operation",
      }),
    ).toBeNull();
  });
});
