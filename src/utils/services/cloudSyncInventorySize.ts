import { readDatabaseSizes } from "../connection/databaseSize";

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Only the current database file, including its storage/encryption envelopes.
 * Not a full archive: trust sidecars, recovery generations and cloud encoding
 * are deliberately excluded. Metadata reads never open or unlock the database.
 */
export async function storedDatabaseBytes(
  id: string,
): Promise<number | undefined> {
  const size = (await readDatabaseSizes([id]))[id];
  return size.source === "stored-file" ? size.bytes : undefined;
}
