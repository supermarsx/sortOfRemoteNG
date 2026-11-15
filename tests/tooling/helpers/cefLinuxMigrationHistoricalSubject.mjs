import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  realpath,
  rm,
  lstat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { actualFeatureSource } from "./cefLinuxWindowFeatureFixture.mjs";
import { inverseCompositeLinuxData } from "./cefCompositeReviewedHistory.mjs";
const contexts = new Map();
const blob = (raw) =>
  createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex");
export function linuxMigrationHistoricalSubject(root) {
  if (!contexts.has(root)) contexts.set(root, create(root));
  return contexts.get(root);
}
async function create(root) {
  const actual = actualFeatureSource(root),
    subject = inverseCompositeLinuxData(actual.rows, actual.files);
  const expected =
    "60d51f32b97ff59bf028643f4f7d1f05bb81f6a872710fae55ef1d83231f5901";
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "cef-linux-migration-history-")),
  );
  const cleanup = async () => {
    assert(path.basename(directory).startsWith("cef-linux-migration-history-"));
    const s = await lstat(directory);
    assert(s.isDirectory() && !s.isSymbolicLink());
    await rm(directory, { recursive: true, force: true });
  };
  try {
    for (const row of subject.rows) {
      const raw = subject.files.get(row.path);
      assert.equal(blob(raw), row.sha);
      const file = path.join(directory, row.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, raw, {
        flag: "wx",
        mode: row.mode === "100755" ? 0o755 : 0o644,
      });
    }
    const require = createRequire(import.meta.url),
      modules = path.dirname(
        path.dirname(require.resolve("typescript/package.json")),
      );
    await symlink(
      modules,
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const core = await import(
      pathToFileURL(
        path.join(directory, "scripts/lib/cef-engineering-checkpoint.mjs"),
      )
    );
    assert.equal(core.codeTreeDigest(subject.rows), expected);
    const migration = await import(
      pathToFileURL(
        path.join(directory, "scripts/lib/cef-linux-producer-migration.mjs"),
      )
    );
    return {
      historical: true,
      authority: false,
      SDK: false,
      producer: expected,
      currentProducer: actual.producer,
      core,
      migration,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
