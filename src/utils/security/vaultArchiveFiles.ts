import { MAX_VAULT_ARCHIVE_FILE_BYTES } from "./vaultArchive";

/** Bounded reads even if the selected file grows after the native chooser. */
export async function chooseVaultArchiveFile(
  assertCurrent: () => void,
): Promise<string | null> {
  const { open: choose } = await import("@tauri-apps/plugin-dialog");
  assertCurrent();
  const path = await choose({
    title: "Open encrypted vault archive",
    multiple: false,
    directory: false,
    filters: [{ name: "Encrypted vault archive", extensions: ["sorngvault"] }],
  });
  assertCurrent();
  if (typeof path !== "string") return null;
  const { open } = await import("@tauri-apps/plugin-fs");
  assertCurrent();
  const file = await open(path, { read: true });
  try {
    assertCurrent();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const buffer = new Uint8Array(
        Math.min(65536, MAX_VAULT_ARCHIVE_FILE_BYTES - total + 1),
      );
      const read = await file.read(buffer);
      assertCurrent();
      if (read === null || read === 0) break;
      total += read;
      if (total > MAX_VAULT_ARCHIVE_FILE_BYTES)
        throw new Error("Vault archives are limited to 24 MiB.");
      chunks.push(buffer.slice(0, read));
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } finally {
    await file.close();
  }
}

export async function saveVaultArchiveFile(
  ciphertext: string,
  assertCurrent: () => void,
  verifyCurrent: () => Promise<void>,
): Promise<boolean> {
  if (
    new TextEncoder().encode(ciphertext).length > MAX_VAULT_ARCHIVE_FILE_BYTES
  )
    throw new Error("Vault archives are limited to 24 MiB.");
  const { save } = await import("@tauri-apps/plugin-dialog");
  assertCurrent();
  const path = await save({
    title: "Save password-encrypted vault archive",
    defaultPath: "credentials.sorngvault",
    filters: [{ name: "Encrypted vault archive", extensions: ["sorngvault"] }],
  });
  assertCurrent();
  if (!path) return false;
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  assertCurrent();
  await verifyCurrent();
  assertCurrent();
  await writeFile(path, new TextEncoder().encode(ciphertext));
  assertCurrent();
  return true;
}
