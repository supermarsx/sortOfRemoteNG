// Stable naming DATA only: no root creation, reuse, restore or execution authority.
// The owner must exclusively mkdir this basename beneath its fixed checkout's
// .artifacts directory, reject EEXIST, and retain fresh random owner bytes/fences.
import { createHash } from "node:crypto";

export const FULL_SDK_SOURCE_ROOT_POLICY = Object.freeze({
  domain: "sortOfRemoteNG/windows-arm-full-sdk/root/v1",
  repositoryId: "1010282954",
  target: "aarch64-pc-windows-msvc",
  sources: Object.freeze({
    "20261103.298.1":
      "e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90",
    "20261021.278.1":
      "fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa",
  }),
  uuidVersionNibble: 4,
  rootCreationImplemented: false,
  compiledCheckpointImplemented: false,
  executionAdmitted: false,
});

export function fullSdkSourceRootName(image, sourceId) {
  const policy = FULL_SDK_SOURCE_ROOT_POLICY;
  if (
    arguments.length !== 2 ||
    typeof image !== "string" ||
    !Object.hasOwn(policy.sources, image) ||
    sourceId !== policy.sources[image]
  )
    throw new Error("FULL_SDK_SOURCE_ROOT_SCOPE");
  const bytes = createHash("sha256")
    .update(
      policy.domain +
        "\0repositoryId=" +
        policy.repositoryId +
        "\0target=" +
        policy.target +
        "\0image=" +
        image +
        "\0sourceId=" +
        sourceId,
    )
    .digest();
  // The existing source validator requires a version4-shaped UUID. This name
  // is a deterministic digest, not a random lifetime/ownership credential.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return (
    "windows-arm-full-sdk-" +
    [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-")
  );
}
