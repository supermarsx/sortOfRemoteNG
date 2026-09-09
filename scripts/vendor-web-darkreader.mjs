#!/usr/bin/env node
/** Reproducible, pinned official Dark Reader API vendoring; no npm install/CDN. */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const version = "4.9.130";
const source = `https://registry.npmjs.org/darkreader/-/darkreader-${version}.tgz`;
const integrity =
  "sha512-hLYjyUszzRc7n+EGbK+LYJV9uCp0JwwvRNgXgKyMkqCoetwkheefWUIxbxKiqQaSWLrCQuQuv55f2cHQMopJ2w==";
const destination = new URL(
  "../src-tauri/crates/sorng-protocols/src/vendor/darkreader/",
  import.meta.url,
);
const wanted = new Map([
  ["package/darkreader.js", "darkreader.js"],
  ["package/LICENSE", "LICENSE"],
]);
const check = process.argv.includes("--check");
const response = await fetch(source, {
  signal: AbortSignal.timeout(30000),
  redirect: "error",
});
if (!response.ok)
  throw new Error(`Official Dark Reader package returned ${response.status}`);
const packed = Buffer.from(await response.arrayBuffer());
if (
  packed.length > 4 * 1024 * 1024 ||
  `sha512-${createHash("sha512").update(packed).digest("base64")}` !== integrity
)
  throw new Error("Dark Reader package integrity or size mismatch.");
const tar = gunzipSync(packed, { maxOutputLength: 8 * 1024 * 1024 });
const files = new Map();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512);
  const name = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
  if (!name) break;
  const size = Number.parseInt(
    header.subarray(124, 136).toString().replace(/\0.*$/s, "").trim(),
    8,
  );
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    offset + 512 + size > tar.length
  )
    throw new Error("Invalid bounded vendor archive.");
  if (wanted.has(name)) {
    if (files.has(wanted.get(name)) || ![0, 48].includes(header[156]))
      throw new Error("Duplicate or non-file vendor entry.");
    files.set(
      wanted.get(name),
      tar.subarray(offset + 512, offset + 512 + size),
    );
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (files.size !== wanted.size)
  throw new Error("Pinned package did not contain the API and license.");
const provenance = {
  version,
  source,
  integrity,
  upstream: "https://github.com/darkreader/darkreader",
  documentation:
    "https://github.com/darkreader/darkreader/blob/main/README.md#using-for-a-website",
  files: Object.fromEntries(
    [...files].map(([name, bytes]) => [
      name,
      {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ]),
  ),
};
files.set(
  "provenance.json",
  Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
);
if (!check) await mkdir(destination, { recursive: true });
for (const [name, bytes] of files) {
  const target = new URL(name, destination);
  if (check) {
    if (!(await readFile(target)).equals(bytes))
      throw new Error(
        `Vendored ${name} differs from the pinned official package.`,
      );
  } else await writeFile(target, bytes);
}
console.log(
  `${check ? "Verified" : "Vendored"} official Dark Reader ${version} API + license at ${fileURLToPath(destination)}`,
);
console.log(JSON.stringify(provenance.files));
