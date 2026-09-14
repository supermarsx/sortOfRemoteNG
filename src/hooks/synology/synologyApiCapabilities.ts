import { invokeManagement } from "../../utils/security/managementInvoke";

export const SYNOLOGY_TRANSPORT_RESTART =
  "Restart or update the desktop app before connecting. This native backend has not confirmed support for the current Synology API transport. No NAS credentials were sent and no direct fallback was used.";

/** Read-only compatibility handshake before any credential resolution or NAS call.
 * Older Tauri commands can ignore unknown arguments, so route support is explicit. */
export async function verifySynologyApiTransportCapabilities(): Promise<void> {
  const deadline = performance.now() + 6000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      invokeManagement<unknown>("syn_fs_transport_capabilities"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(SYNOLOGY_TRANSPORT_RESTART)),
          6000,
        );
      }),
    ]);
    if (
      performance.now() >= deadline ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error(SYNOLOGY_TRANSPORT_RESTART);
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      data.httpProxy !== true ||
      data.quickConnect !== true
    )
      throw new Error(SYNOLOGY_TRANSPORT_RESTART);
  } catch {
    throw new Error(SYNOLOGY_TRANSPORT_RESTART);
  } finally {
    clearTimeout(timeout);
  }
}
