import { useEffect } from "react";
import { getInvoke } from "../../utils/tauri/invoke";

export function normalizeSecureClipboardMiB(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.0625, Math.min(512, value!)) : 150;
}

/** Apply the persisted size policy without changing native clipboard preferences. */
export function useSecureClipboardConfig(maxMiB: number | undefined): void {
  useEffect(() => {
    let current = true;
    void (async () => {
      const invoke = await getInvoke();
      if (!invoke || !current) return;
      const config = await invoke<Record<string, unknown>>(
        "secure_clip_get_config",
      );
      if (!current) return;
      const maxValueBytes = Math.floor(
        normalizeSecureClipboardMiB(maxMiB) * 1024 * 1024,
      );
      if (config.maxValueBytes !== maxValueBytes) {
        await invoke("secure_clip_update_config", {
          config: { ...config, maxValueBytes },
        });
      }
    })().catch(() => {
      // Native retains its last validated policy when locked or unavailable.
    });
    return () => {
      current = false;
    };
  }, [maxMiB]);
}
