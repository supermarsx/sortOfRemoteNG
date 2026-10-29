/**
 * Moves Win32 keyboard focus from a native browser child back to the shell
 * WebView. A DOM `focus()` cannot do that: while the child window owns focus,
 * the WebView document does not have it (`document.hasFocus()` is false) and
 * keystrokes for a shell prompt would go nowhere. The WebView controller's
 * programmatic focus move (Tauri `Webview.setFocus`) is the supported way back.
 */
export function reclaimShellFocus(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden" || document.hasFocus()) return;
  void import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) => getCurrentWebview().setFocus())
    .catch(() => undefined);
}
