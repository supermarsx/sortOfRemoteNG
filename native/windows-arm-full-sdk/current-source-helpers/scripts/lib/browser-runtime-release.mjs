// Transport identities only: a separately reviewed raw descriptor digest is the
// trust input. Release-hosted hashes do not establish source authenticity.
import path from "node:path";
import { TARGETS } from "../browser-runtime-package.mjs";
import { validateCustomRuntimeManifest } from "./browser-custom-runtime.mjs";

export const RELEASE_LIMITS = Object.freeze({
  descriptor: 1024 * 1024,
  metadata: 32 * 1024 * 1024,
  archive: 2 * 1024 ** 3 - 1,
  expanded: 32 * 1024 ** 3,
  members: 50_000,
  redirects: 5,
  timeoutMs: 30 * 60 * 1000,
});

function shape(value, keys, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`${name}: exact fields required (${keys.join(", ")})`);
}

export function reviewedSha256(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/.test(value) ||
    /^0+$/.test(value)
  )
    throw new Error(
      "An independently reviewed nonzero lowercase raw SHA-256 is required",
    );
  return value;
}

export function releaseRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[ .]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error("Unsafe release-relative path");
  return value;
}

/** Fixed release asset route, never API/latest/tag resolution or credentials.
 * The external raw digest pins bytes even if a publisher later replaces assets. */
export function releaseAssetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid GitHub release asset URL");
  }
  if (
    typeof value !== "string" ||
    url.href !== value ||
    url.origin !== "https://github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Only credential-free HTTPS GitHub release asset URLs are allowed",
    );
  const match =
    /^\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\/releases\/download\/([A-Za-z0-9_+.-]+)\/([A-Za-z0-9_+.-]+)$/.exec(
      url.pathname,
    );
  if (
    !match ||
    /^(?:latest|nightly|rolling|main|master|head|current|dev)$/i.test(match[3])
  )
    throw new Error(
      "An explicit immutable, digest-pinned GitHub release asset route is required",
    );
  for (const part of match.slice(1)) releaseRelativePath(part);
  return {
    url: url.href,
    release: url.href.slice(0, url.href.lastIndexOf("/")),
    asset: match[4],
  };
}

export function validateRuntimeReleaseDescriptor(
  value,
  { descriptorUrl, target } = {},
) {
  shape(
    value,
    [
      "schemaVersion",
      "kind",
      "target",
      "sourceLock",
      "manifest",
      "receipt",
      "archive",
      "sdk",
    ],
    "runtime release descriptor",
  );
  if (value.schemaVersion !== 1 || value.kind !== "sorng-cef-runtime-release")
    throw new Error("Unsupported runtime release descriptor schema/kind");
  if (
    !TARGETS.includes(value.target) ||
    (target !== undefined && value.target !== target)
  )
    throw new Error("Runtime release target mismatch");
  let release =
    descriptorUrl === undefined ? null : releaseAssetUrl(descriptorUrl).release;
  const paths = [];
  const urls = [];
  for (const field of ["sourceLock", "manifest", "receipt", "archive"]) {
    const pin = value[field];
    shape(pin, ["url", "path", "sha256", "size"], `${field} transport pin`);
    releaseRelativePath(pin.path);
    reviewedSha256(pin.sha256);
    const limit = RELEASE_LIMITS[field === "archive" ? "archive" : "metadata"];
    if (!Number.isSafeInteger(pin.size) || pin.size <= 0 || pin.size > limit)
      throw new Error(`${field}: size exceeds the bounded transport limit`);
    const parsed = releaseAssetUrl(pin.url);
    release ??= parsed.release;
    if (
      parsed.release !== release ||
      parsed.asset !== path.posix.basename(pin.path)
    )
      throw new Error(
        "All assets must match their paths and the descriptor's same release",
      );
    paths.push(pin.path.toLowerCase());
    urls.push(pin.url);
  }
  if (
    new Set(paths).size !== paths.length ||
    new Set(urls).size !== urls.length ||
    paths.some((a) => paths.some((b) => a !== b && a.startsWith(`${b}/`)))
  )
    throw new Error("Release paths/URLs collide");
  if (
    !path.posix.basename(value.archive.path).startsWith("sorng-cef-custom-") ||
    !value.archive.path.endsWith(".tar.bz2")
  )
    throw new Error("Distinct sorng-cef-custom-*.tar.bz2 archive required");
  shape(value.sdk, ["archiveRoot"], "SDK layout");
  const root = releaseRelativePath(value.sdk.archiveRoot);
  if (root.includes("/"))
    throw new Error("SDK archiveRoot must be one safe directory name");
  return value;
}

/** Raw transport hashes are checked by the caller BEFORE JSON parsing. */
export function bindRuntimeRelease(descriptor, manifest, sourceLock) {
  validateRuntimeReleaseDescriptor(descriptor);
  validateCustomRuntimeManifest(manifest, sourceLock);
  const artifact = manifest.artifacts.find(
    (entry) => entry.target === descriptor.target,
  );
  if (!artifact)
    throw new Error("Reviewed manifest is missing the release target");
  for (const [field, pin] of [
    ["archive", artifact.archive],
    ["receipt", artifact.provenance],
  ])
    if (
      ["path", "sha256", "size"].some(
        (key) => descriptor[field][key] !== pin[key],
      )
    )
      throw new Error(`Descriptor ${field} differs from reviewed manifest`);
  const expanded = artifact.sdkFiles.reduce(
    (sum, entry) => sum + (entry.size ?? 0),
    0,
  );
  if (
    !Number.isSafeInteger(expanded) ||
    expanded > RELEASE_LIMITS.expanded ||
    artifact.sdkFiles.length > RELEASE_LIMITS.members
  )
    throw new Error("SDK inventory exceeds extraction bounds");
  return artifact;
}
