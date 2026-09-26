import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveExportFile,
  openExportFolder,
} from "../../src/components/ImportExport/exportFile";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  runtime: vi.fn(),
  save: vi.fn(),
  write: vi.fn(),
  dirname: vi.fn(),
  dialogImported: vi.fn(),
  fsImported: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: mock.runtime }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  get save() {
    mock.dialogImported();
    return mock.save;
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  get writeFile() {
    mock.fsImported();
    return mock.write;
  },
}));
vi.mock("@tauri-apps/api/path", () => ({ dirname: mock.dirname }));

beforeEach(() => {
  vi.resetAllMocks();
  mock.runtime.mockResolvedValue(mock.invoke);
  mock.save.mockResolvedValue("F:\\Exports\\chosen name.json");
  mock.write.mockResolvedValue(undefined);
  mock.dirname.mockResolvedValue("F:\\Exports");
  mock.invoke.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => "blob:export-test");
  URL.revokeObjectURL = vi.fn();
});

describe("export destination", () => {
  it("returns the actual chosen path only after the native write finishes", async () => {
    let finish!: () => void;
    mock.write.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let complete = false;
    const pending = saveExportFile(
      "{}",
      "suggested.json",
      "application/json",
    ).then((value) => {
      complete = true;
      return value;
    });
    await vi.waitFor(() => expect(mock.write).toHaveBeenCalled());
    expect(complete).toBe(false);
    finish();
    expect(await pending).toEqual({
      status: "saved",
      path: "F:\\Exports\\chosen name.json",
    });
    expect(mock.write).toHaveBeenCalledWith(
      "F:\\Exports\\chosen name.json",
      new TextEncoder().encode("{}"),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("writes encrypted bytes without text conversion", async () => {
    const bytes = new Uint8Array([0, 255, 17, 128]);
    await saveExportFile(
      bytes,
      "archive.encrypted.json",
      "application/octet-stream",
    );
    expect(mock.write).toHaveBeenCalledWith(expect.any(String), bytes);
  });

  it("does not write or report a path on cancellation", async () => {
    mock.save.mockResolvedValue(null);
    expect(
      await saveExportFile("{}", "archive.json", "application/json"),
    ).toEqual({ status: "cancelled" });
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("propagates a native failure without starting a browser download", async () => {
    mock.write.mockRejectedValue(new Error("Disk full"));
    await expect(
      saveExportFile("{}", "archive.json", "application/json"),
    ).rejects.toThrow("Disk full");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("keeps browser downloads without inventing a destination", async () => {
    mock.runtime.mockResolvedValue(null);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    expect(
      await saveExportFile("{}", "archive.json", "application/json"),
    ).toEqual({ status: "downloaded", filename: "archive.json" });
    expect(click).toHaveBeenCalledOnce();
    expect(mock.save).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export-test");
    click.mockRestore();
  });

  it("opens the parent of the confirmed destination", async () => {
    await openExportFolder("F:\\Exports\\chosen name.json");
    expect(mock.dirname).toHaveBeenCalledWith("F:\\Exports\\chosen name.json");
    expect(mock.invoke).toHaveBeenCalledWith("open_folder", {
      path: "F:\\Exports",
    });
  });

  it("blocks a source revoked while the native Save dialog is open", async () => {
    let allowed = true;
    let choosePath!: (path: string) => void;
    mock.save.mockReturnValue(
      new Promise<string>((resolve) => {
        choosePath = resolve;
      }),
    );
    const assertAccess = () => {
      if (!allowed) throw new Error("Source access expired");
    };
    const pending = saveExportFile(
      "secret",
      "archive.json",
      "application/json",
      assertAccess,
    );
    await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    allowed = false;
    const rejected = expect(pending).rejects.toThrow("Source access expired");
    choosePath("F:\\Exports\\archive.json");
    await rejected;
    expect(mock.write).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(["native", "browser"])(
    "rechecks access after pending %s runtime discovery",
    async (runtime) => {
      let allowed = true;
      let discover!: (value: typeof mock.invoke | null) => void;
      mock.runtime.mockReturnValue(
        new Promise<typeof mock.invoke | null>((resolve) => {
          discover = resolve;
        }),
      );
      const pending = saveExportFile(
        "secret",
        "archive.json",
        "application/json",
        () => {
          if (!allowed) throw new Error("Source evicted");
        },
      );
      await vi.waitFor(() => expect(mock.runtime).toHaveBeenCalledOnce());
      allowed = false;
      const rejected = expect(pending).rejects.toThrow("Source evicted");
      discover(runtime === "native" ? mock.invoke : null);
      await rejected;
      expect(mock.save).not.toHaveBeenCalled();
      expect(mock.write).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it.each(["dialog", "filesystem"])(
    "rechecks access after the %s module is imported",
    async (module) => {
      let allowed = true;
      const imported =
        module === "dialog" ? mock.dialogImported : mock.fsImported;
      imported.mockImplementation(() => {
        allowed = false;
      });
      await expect(
        saveExportFile("secret", "archive.json", "application/json", () => {
          if (!allowed) throw new Error("Source locked during import");
        }),
      ).rejects.toThrow("Source locked during import");
      expect(imported).toHaveBeenCalled();
      if (module === "dialog") expect(mock.save).not.toHaveBeenCalled();
      expect(mock.write).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("waits for the final async access check and propagates rejection without a fallback", async () => {
    let rejectAccess!: (error: Error) => void;
    const finalCheck = new Promise<void>((_, reject) => {
      rejectAccess = reject;
    });
    const assertAccess = vi.fn(() =>
      mock.fsImported.mock.calls.length ? finalCheck : undefined,
    );
    const pending = saveExportFile(
      "secret",
      "archive.json",
      "application/json",
      assertAccess,
    );
    const rejected = expect(pending).rejects.toThrow("Access revoked");
    await vi.waitFor(() => expect(mock.fsImported).toHaveBeenCalled());
    expect(mock.write).not.toHaveBeenCalled();
    rejectAccess(new Error("Access revoked"));
    await rejected;
    expect(mock.write).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("checks browser access immediately before releasing a download", async () => {
    mock.runtime.mockResolvedValue(null);
    const assertAccess = vi.fn(() => {
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      if (assertAccess.mock.calls.length === 3)
        throw new Error("Download access revoked");
    });
    await expect(
      saveExportFile(
        "secret",
        "archive.json",
        "application/json",
        assertAccess,
      ),
    ).rejects.toThrow("Download access revoked");
    expect(mock.write).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("allows a valid async guard and retains cancellation semantics", async () => {
    const assertAccess = vi.fn(async () => undefined);
    await expect(
      saveExportFile("{}", "archive.json", "application/json", assertAccess),
    ).resolves.toMatchObject({ status: "saved" });
    expect(assertAccess).toHaveBeenCalled();
    mock.write.mockClear();
    mock.save.mockResolvedValue(null);
    await expect(
      saveExportFile("{}", "archive.json", "application/json", assertAccess),
    ).resolves.toEqual({ status: "cancelled" });
    expect(mock.write).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("propagates a native dialog failure without a browser fallback", async () => {
    mock.save.mockRejectedValue(new Error("Dialog unavailable"));
    await expect(
      saveExportFile("{}", "archive.json", "application/json", () => undefined),
    ).rejects.toThrow("Dialog unavailable");
    expect(mock.write).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
