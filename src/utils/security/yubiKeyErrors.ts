export type YubiKeyErrorKind =
  "unavailable" | "permission" | "device" | "operation";
/** Native output can contain PINs or imported data. Expose fixed guidance only. */
export function describeYubiKeyError(error: unknown): {
  kind: YubiKeyErrorKind;
  message: string;
} {
  const raw = (
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  ).toLowerCase();
  if (
    raw.startsWith("ykman_unavailable:") ||
    raw.includes("ykman not detected") ||
    raw.includes("ykman not found")
  )
    return {
      kind: "unavailable",
      message:
        "YubiKey Manager (ykman) is unavailable. Install the external ykman tool, or correct its executable path in Configuration if it is already installed, then retry detection. The app does not install it automatically.",
    };
  if (raw.startsWith("ykman_permission_denied:"))
    return {
      kind: "permission",
      message:
        "YubiKey access was denied. Check device permissions and whether another application is using the key, then retry.",
    };
  if (raw.startsWith("ykman_device_missing:"))
    return {
      kind: "device",
      message:
        "The selected YubiKey is not connected. Insert the intended key and refresh the device list.",
    };
  if (raw.includes("oath applet is password protected"))
    return {
      kind: "operation",
      message:
        "This OATH applet is password protected. The current operation cannot safely supply its password; unlock it with the supported YubiKey Manager workflow.",
    };
  return {
    kind: "operation",
    message:
      "The YubiKey operation failed. Check that the intended key is connected and its PIN, touch and application requirements are satisfied, then retry. Native command output is not displayed.",
  };
}
