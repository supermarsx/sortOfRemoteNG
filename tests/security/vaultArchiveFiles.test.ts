import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseVaultArchiveFile,
  saveVaultArchiveFile,
} from "../../src/utils/security/vaultArchiveFiles";
const h = vi.hoisted(() => ({
  choose: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: h.choose, save: h.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ open: h.open, writeFile: h.write }));
beforeEach(() => {
  vi.clearAllMocks();
  h.choose.mockResolvedValue("chosen.sorngvault");
  h.save.mockResolvedValue("saved.sorngvault");
  h.close.mockResolvedValue(undefined);
  h.write.mockResolvedValue(undefined);
  h.open.mockResolvedValue({ read: h.read, close: h.close });
});
describe("native vault archive bounded files", () => {
  it("streams selectedbytes andalwayscloses thehandle", async () => {
    let first = true;
    h.read.mockImplementation(async (buffer: Uint8Array) => {
      if (!first) return null;
      first = false;
      buffer.set(new TextEncoder().encode("ciphertext"));
      return 10;
    });
    expect(await chooseVaultArchiveFile(() => {})).toBe("ciphertext");
    expect(h.open).toHaveBeenCalledWith("chosen.sorngvault", { read: true });
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("rejects filegrowth past24MiB andcloses", async () => {
    h.read.mockImplementation(async (buffer: Uint8Array) => buffer.length);
    await expect(chooseVaultArchiveFile(() => {})).rejects.toThrow("24 MiB");
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("revokes a pendingread beforedecoding andstillcloses", async () => {
    let allowed = true;
    h.read.mockImplementation(async () => {
      allowed = false;
      return 1;
    });
    await expect(
      chooseVaultArchiveFile(() => {
        if (!allowed) throw new Error("scope changed");
      }),
    ).rejects.toThrow("scope changed");
    expect(h.close).toHaveBeenCalledOnce();
  });
  it("cancelleddialogs donotreadorwrite", async () => {
    h.choose.mockResolvedValue(null);
    h.save.mockResolvedValue(null);
    expect(await chooseVaultArchiveFile(() => {})).toBeNull();
    expect(
      await saveVaultArchiveFile(
        "ciphertext",
        () => {},
        async () => {},
      ),
    ).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  it("verifies protectedreceipt aftersavechoice beforewriting ciphertext", async () => {
    const verify = vi.fn(async () => {
      throw new Error("revoked");
    });
    await expect(
      saveVaultArchiveFile("ciphertext", () => {}, verify),
    ).rejects.toThrow("revoked");
    expect(h.write).not.toHaveBeenCalled();
  });
});
