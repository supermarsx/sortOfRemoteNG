import { invoke, isTauri } from "@tauri-apps/api/core";

/** Global SSH policy only; other terminal protocols retain their link behavior. */
export function canOpenTerminalLink(
  protocol: string,
  allowSshExternalLinks: unknown,
): boolean {
  return protocol !== "ssh" || allowSshExternalLinks === true;
}

/** Never pass terminal-controlled credentials, control characters or schemes to the shell. */
export function normalizeTerminalLink(value: string): string | null {
  if (
    value.length > 8192 ||
    /[\s\p{Cc}\u202a-\u202e\u2066-\u2069\\]/u.test(value) ||
    !/^https?:\/\//i.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export async function openTerminalLink(
  value: string,
  source: "detected" | "osc8",
  canOpen: () => boolean,
  onError: (message: string) => void,
): Promise<void> {
  if (!canOpen()) return;
  const url = normalizeTerminalLink(value);
  if (!url) return;

  // OSC8 visible text can conceal a completely different destination. Preserve
  // xterm's confirmation, showing the validated actual URL instead of its label.
  if (
    source === "osc8" &&
    !window.confirm(
      `Open this terminal link in your browser?\n\n${url}\n\nThe displayed terminal text may disguise the destination. Only continue if you trust this URL.`,
    )
  ) {
    return;
  }
  if (!canOpen()) return;

  try {
    if (isTauri()) {
      // A rejected native opener must never fall through to a browser opener.
      await invoke("open_url_external", { url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    // Native errors can contain the destination; do not expose URL secrets.
    onError("Unable to open the terminal link in your browser.");
  }
}
