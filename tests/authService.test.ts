import fs from "fs/promises";
import * as fsSync from "fs";
import path from "path";
import os from "os";
import { vi } from "vitest";
import { AuthService } from "../src/utils/authService";

// Utility to create temp directory for user store
async function createStore(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-"));
  const file = path.join(dir, "users.json");
  await fs.writeFile(file, "[]");
  return file;
}

describe("AuthService", () => {
  let storePath: string;
  let service: AuthService;

  beforeEach(async () => {
    storePath = await createStore();
    service = new AuthService(storePath);
    await service.ready();
  });

  test("addUser and listUsers", async () => {
    await service.addUser("alice", "password1");
    await service.addUser("bob", "password2");
    const users = await service.listUsers();
    expect(users.sort()).toEqual(["alice", "bob"]);
    const contents = await fs.readFile(storePath, "utf8");
    expect(contents).toContain("alice");
    expect(contents).toContain("bob");
  });

  test("removeUser", async () => {
    await service.addUser("charlie", "secret");
    const removed = await service.removeUser("charlie");
    expect(removed).toBe(true);
    expect(await service.listUsers()).toEqual([]);
    const contents = await fs.readFile(storePath, "utf8");
    expect(contents).not.toContain("charlie");
  });

  test("updatePassword", async () => {
    await service.addUser("dave", "old");
    const updated = await service.updatePassword("dave", "new");
    expect(updated).toBe(true);
    expect(await service.verifyUser("dave", "new")).toBe(true);
  });

  test("removeUser propagates persist errors", async () => {
    await service.addUser("eve", "secret");
    const spy = vi
      .spyOn(fsSync.promises, "writeFile")
      .mockRejectedValue(new Error("disk full"));
    await expect(service.removeUser("eve")).rejects.toThrow("disk full");
    expect(await service.listUsers()).toContain("eve");
    spy.mockRestore();
  });

  test("updatePassword propagates persist errors", async () => {
    await service.addUser("frank", "old");
    const spy = vi
      .spyOn(fsSync.promises, "writeFile")
      .mockRejectedValue(new Error("disk full"));
    await expect(service.updatePassword("frank", "new")).rejects.toThrow(
      "disk full",
    );
    expect(await service.verifyUser("frank", "old")).toBe(true);
    spy.mockRestore();
  });
});
