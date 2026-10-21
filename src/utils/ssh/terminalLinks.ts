import { invoke, isTauri } from "@tauri-apps/api/core";
import { requestPrompt } from "../prompts/promptQueue";

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
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted || !canOpen()) return;
  const url = normalizeTerminalLink(value);
  if (!url) return;

  try {
    // OSC8 labels can conceal another destination. Use the window's themed
    // prompt, displaying the actual validated URL and failing closed if absent.
    if (source === "osc8") {
      const decision = await requestPrompt(
        {
          title: "Open this terminal link in your browser?",
          message:
            "The displayed terminal text may disguise the destination. Only continue if you trust this URL.",
          confirmLabel: "Open link",
          defaultAction: "cancel",
          preview: { label: "Destination", text: url },
        },
        { signal },
      );
      if (!decision.confirmed) return;
    }
    if (signal?.aborted || !canOpen()) return;
    if (isTauri()) {
      // A rejected native opener must never fall through to a browser opener.
      await invoke("open_url_external", { url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    if (signal?.aborted || !canOpen()) return;
    // Native errors can contain the destination; do not expose URL secrets.
    onError("Unable to open the terminal link in your browser.");
  }
}
