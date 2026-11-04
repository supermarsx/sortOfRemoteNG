// Exact inverse of the asset-upload recovery change in
// scripts/lib/cef-engineering-checkpoint.mjs. The historical-producer pin
// chains restore older bytes from the current file; this removes the recovery
// helper and puts back the two direct uploads so those chains stay exact.
const START = "export const UPLOAD_RECOVERY = ";
const END = "export async function verifyProducer(";
const direct = (name) =>
  "      const uploaded = await api(\n" +
  "        `releases/${release.id}/assets?name=${encodeURIComponent(" +
  name +
  ".name)}`,\n" +
  "        {\n" +
  '          method: "POST",\n' +
  "          upload: true,\n" +
  "          bodyBytes: " +
  name +
  ".bytes,\n" +
  "          body: createReadStream(path.join(bundle, " +
  name +
  ".name)),\n" +
  "        },\n" +
  "      );";
const recovered = (name) =>
  "      const uploaded = await uploadAssetWithRecovery(\n" +
  "        api,\n" +
  "        release.id,\n" +
  "        " +
  name +
  ",\n" +
  "        bundle,\n" +
  "      );";
// Linux ARM runner-image re-pin (20261026.354.1 -> 20261101.360.1): only the
// reviewed profile's source identity and input namespace changed.
const REPIN = [
  [
    "0829ec1953e25d71709a9324d6f4b05c929ce0dbbe6f5961918dc7e89a1740e5",
    "8c5af5d375371adef2e1a32d872f5c55f907d26786b698e5ab2aef0fdfb9f8eb",
  ],
  [
    "native/cef-build-inputs/20261104-r5-linuxarm-cross-sysroot-external-webview-char-20261101-360-1",
    "native/cef-build-inputs/20261028-r5-linuxarm-cross-sysroot-external-webview-char-20261026-354-1",
  ],
];
export function withoutUploadRecovery(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (
    start < 0 ||
    end <= start ||
    text.indexOf(START, start + 1) >= 0 ||
    text.indexOf(END, end + 1) >= 0
  )
    throw new Error("Upload recovery helper not found exactly once");
  let restored = text.slice(0, start) + text.slice(end);
  for (const [after, before] of REPIN) {
    if (restored.split(after).length !== 2)
      throw new Error("Runner image re-pin not found exactly once");
    restored = restored.replace(after, () => before);
  }
  for (const name of ["p", "pin"]) {
    if (restored.split(recovered(name)).length !== 2)
      throw new Error(`Upload recovery call site ${name} not found once`);
    restored = restored.replace(recovered(name), () => direct(name));
  }
  return restored;
}

// Exact inverse of the bounded failure-cause line in the CLI's final catch.
export function withoutCliCause(text) {
  const start = text.indexOf("    .catch((error) => {\n");
  const marker = "      process.exitCode = 1;\n    });";
  const end = text.indexOf(marker, start);
  if (
    start < 0 ||
    end < 0 ||
    text.indexOf("    .catch((error) => {\n", start + 1) >= 0
  )
    throw new Error("CLI failure catch not found exactly once");
  const old =
    "    .catch(() => {\n" +
    "      console.error(\n" +
    '        "[cef-engineering-checkpoint] operation failed; retained logs and partial bytes are not acceptance",\n' +
    "      );\n";
  return text.slice(0, start) + old + text.slice(end);
}

// Retained-producer rows: the pinned producer digest binds the pre-change
// bytes of the three files this change touched. Each retained blob is rebuilt
// from the committed text through its exact inverse (no hard-coded blob).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const NEW_SOURCE =
  "0829ec1953e25d71709a9324d6f4b05c929ce0dbbe6f5961918dc7e89a1740e5";
const OLD_SOURCE =
  "8c5af5d375371adef2e1a32d872f5c55f907d26786b698e5ab2aef0fdfb9f8eb";
export const blobSha = (text) =>
  createHash("sha1")
    .update(Buffer.from(`blob ${Buffer.byteLength(text)}\0`))
    .update(text)
    .digest("hex");
export function withoutWorkflowRepin(text) {
  if (text.split(NEW_SOURCE).length !== 2)
    throw new Error("Workflow source pin not found exactly once");
  return text.replace(NEW_SOURCE, () => OLD_SOURCE);
}
// Rows with this change's three files restored to their pre-change blobs.
export function withoutRepinRows(rows, root) {
  const inverse = {
    "scripts/cef-engineering-checkpoint.mjs": withoutCliCause,
    ".github/workflows/cef-engineering-checkpoint.yml": withoutWorkflowRepin,
  };
  return rows.map((row) => {
    const undo = inverse[row.path];
    if (!undo) return row;
    const text = execFileSync("git", ["cat-file", "blob", `HEAD:${row.path}`], {
      cwd: root,
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1 << 24,
    }).toString();
    return { ...row, sha: blobSha(undo(text)) };
  });
}
