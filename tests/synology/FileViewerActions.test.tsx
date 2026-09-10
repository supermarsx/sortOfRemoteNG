import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import SettingsContext, {
  defaultSettings,
} from "../../src/contexts/SettingsContext";
import FileViewerActions from "../../src/components/synology/synologyPanel/FileViewerActions";
import {
  normalizeNasFileViewers,
  type NasFileViewerSettings,
} from "../../src/types/settings/nasFileViewers";
import type { Mgr } from "../../src/components/synology/synologyPanel/types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const settings = () => normalizeNasFileViewers(undefined);
const updateSettings = vi.fn();
const manager = (name = "note.txt") =>
  ({
    instanceId: "instance-a",
    sessionId: "session-a",
    connectionStatus: "connected",
    assertSessionAccess: vi.fn(),
    notifySessionExpired: vi.fn(),
    fileStation: {
      currentPath: "/public",
      selected: [`/public/${name}`],
      busy: false,
      fileList: {
        files: [{ name, path: `/public/${name}`, isdir: false }],
        total: 1,
        offset: 0,
      },
    },
  }) as unknown as Mgr;
const view = (mgr: Mgr, preferences = settings(), pending = false) => (
  <SettingsContext.Provider
    value={{
      settings: { ...defaultSettings, nasFileViewers: preferences },
      settingsReady: true,
      updateSettings,
      reloadSettings: vi.fn(),
    }}
  >
    <FileViewerActions mgr={mgr} listingPending={pending} />
  </SettingsContext.Provider>
);
const receipt = {
  viewerId: "viewer-a",
  name: "note.txt",
  bytes: 2048,
  isolation: "os-webview-process",
};
const closeArgs = {
  instanceId: "instance-a",
  expectedSessionId: "session-a",
  viewerId: "viewer-a",
};
beforeEach(() => {
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "syn_fs_close_preview" ? true : receipt,
    );
  updateSettings.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("isolated NAS file viewers", () => {
  it("never launches on render and keeps external opening disabled by default", () => {
    render(view(manager()));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Preview file" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Open externally" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open with…" })).toBeDisabled();
  });
  it.each(["note.txt", "file.pdf", "photo.png"])(
    "opens %s only in the native restricted viewer without rendering any file content",
    async (name) => {
      vi.mocked(invoke).mockImplementation(async (command) =>
        command === "syn_fs_close_preview" ? true : { ...receipt, name },
      );
      const create = vi.spyOn(URL, "createObjectURL");
      try {
        render(view(manager(name)));
        fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
        expect(
          await screen.findByText(/in a separate restricted viewer/),
        ).toHaveTextContent(name);
        expect(screen.getByText("2.0 KiB")).toHaveAttribute(
          "title",
          "2,048 bytes",
        );
        expect(
          document.querySelector("canvas,img,iframe,object,embed,pre"),
        ).toBeNull();
        expect(create).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith(
          "syn_fs_preview_file",
          expect.objectContaining({
            viewerOptions: {
              textWrap: true,
              textFontSize: 13,
              imageFit: "contain",
            },
          }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "Close preview" }),
          ).not.toBeInTheDocument(),
        );
        expect(invoke).toHaveBeenLastCalledWith(
          "syn_fs_close_preview",
          closeArgs,
        );
      } finally {
        create.mockRestore();
      }
    },
  );
  it.each(["session", "policy", "selection"])(
    "closes only the original handle on %s changes",
    async (change) => {
      const mgr = manager(),
        rendered = render(view(mgr));
      fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
      await screen.findByRole("button", { name: "Close preview" });
      rendered.rerender(
        view(
          change === "session"
            ? { ...mgr, instanceId: "instance-b", sessionId: "session-b" }
            : change === "selection"
              ? manager("other.txt")
              : mgr,
          change === "policy"
            ? {
                ...settings(),
                preview: { text: false, pdf: true, image: true },
              }
            : settings(),
        ),
      );
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("syn_fs_close_preview", closeArgs),
      );
      expect(
        screen.queryByRole("button", { name: "Close preview" }),
      ).not.toBeInTheDocument();
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "syn_fs_preview_file"),
      ).toHaveLength(1);
    },
  );
  it.each(["unmount", "policy", "session-aba"])(
    "closes a late launch after %s rather than publishing a stale handle",
    async (change) => {
      let resolve!: (value: unknown) => void;
      vi.mocked(invoke).mockImplementation((command) =>
        command === "syn_fs_close_preview"
          ? Promise.resolve(true)
          : new Promise((done) => {
              resolve = done;
            }),
      );
      const mgr = manager(),
        rendered = render(view(mgr));
      fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
      if (change === "unmount") rendered.unmount();
      else if (change === "policy")
        rendered.rerender(
          view(mgr, {
            ...settings(),
            preview: { text: false, pdf: true, image: true },
          }),
        );
      else {
        rendered.rerender(view({ ...mgr, sessionId: "session-b" }));
        rendered.rerender(view(mgr));
      }
      await act(async () => resolve(receipt));
      expect(invoke).toHaveBeenLastCalledWith(
        "syn_fs_close_preview",
        closeArgs,
      );
      expect(
        screen.queryByRole("button", { name: "Close preview" }),
      ).not.toBeInTheDocument();
    },
  );
  it("closes an active native viewer exactly once when unmounted", async () => {
    const rendered = render(view(manager()));
    fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
    await screen.findByRole("button", { name: "Close preview" });
    rendered.unmount();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("syn_fs_close_preview", closeArgs),
    );
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "syn_fs_close_preview"),
    ).toHaveLength(1);
  });
  it("retains the exact close handle for explicit retry after native close failure", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "syn_fs_close_preview")
        throw new Error("Native viewer is still closing. Retry.");
      return receipt;
    });
    render(view(manager()));
    fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close preview" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry");
    expect(screen.getByRole("button", { name: "Close preview" })).toBeEnabled();
    vi.mocked(invoke).mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close preview" }),
      ).not.toBeInTheDocument(),
    );
    expect(invoke).toHaveBeenLastCalledWith("syn_fs_close_preview", closeArgs);
  });
  it("shows unsupported-platform refusal without falling back to in-app rendering or external opening", async () => {
    vi.mocked(invoke).mockRejectedValue(
      new Error("Isolated preview is currently available only on Windows."),
    );
    render(view(manager("file.pdf")));
    fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only on Windows",
    );
    expect(document.querySelector("canvas,img,iframe,object,embed")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("requires confirmation for external opening, prevents duplicate dispatch and treats native picker cancellation as cancellation", async () => {
    const preferences: NasFileViewerSettings = {
      ...settings(),
      external: { text: true, pdf: false, image: false },
    };
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(view(manager(), preferences));
    fireEvent.click(screen.getByRole("button", { name: "Open with…" }));
    expect(screen.getByText(/plaintext local copy/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open local copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Open with…" }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_open_external",
      expect.objectContaining({
        application: "choose",
        expectedSessionId: "session-a",
        path: "/public/note.txt",
        retentionMinutes: 30,
      }),
    );
    await act(async () => resolve({ cancelled: true, message: "Cancelled" }));
    expect(screen.queryByText(/Opened a temporary/)).not.toBeInTheDocument();
  });
  it("revokes a pending external confirmation on file selection or viewer policy change", () => {
    const preferences = {
      ...settings(),
      external: { text: true, pdf: false, image: false },
    };
    const mgr = manager(),
      rendered = render(view(mgr, preferences));
    fireEvent.click(screen.getByRole("button", { name: "Open externally" }));
    expect(
      screen.getByRole("button", { name: "Open local copy" }),
    ).toBeInTheDocument();
    rendered.rerender(view(manager("another.txt"), settings()));
    expect(
      screen.queryByRole("button", { name: "Open local copy" }),
    ).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("blocks all selected-file actions during a folder read and when the owner lease is revoked", async () => {
    const mgr = manager(),
      rendered = render(view(mgr, settings(), true));
    expect(screen.getByRole("button", { name: "Preview file" })).toBeDisabled();
    rendered.rerender(view(mgr));
    vi.mocked(mgr.assertSessionAccess).mockImplementation(() => {
      throw new Error("NAS owner is locked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "NAS owner is locked",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
  it("persists actual per-type preferences and preserves draft after a failed settings write", async () => {
    updateSettings.mockRejectedValueOnce(new Error("storage locked"));
    render(view(manager()));
    fireEvent.click(screen.getByRole("button", { name: "Viewer settings" }));
    fireEvent.click(await screen.findByLabelText("Enable Text previews"));
    fireEvent.click(screen.getByLabelText("Allow Text external opening"));
    fireEvent.change(screen.getByLabelText("Maximum preview size (MiB)"), {
      target: { value: "8" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer settings" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your changes are still here",
    );
    expect(screen.getByLabelText("Enable Text previews")).not.toBeChecked();
    expect(screen.getByLabelText("Allow Text external opening")).toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "Save viewer settings" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "NAS viewer settings" }),
      ).not.toBeInTheDocument(),
    );
    expect(updateSettings).toHaveBeenLastCalledWith({
      nasFileViewers: expect.objectContaining({
        previewMaxMiB: 8,
        preview: { text: false, pdf: true, image: true },
        external: { text: true, pdf: false, image: false },
      }),
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
