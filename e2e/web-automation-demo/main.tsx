import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import BookmarkBar from "../../src/components/protocol/webBrowser/BookmarkBar";
import type { WebBrowserMgr } from "../../src/components/protocol/webBrowser/types";
import type { Connection } from "../../src/types/connection/connection";
import type { useWebAutomation } from "../../src/hooks/protocol/useWebAutomation";
import type {
  WebAutomationItem,
  WebInteractionMacro,
} from "../../src/types/recording/webAutomation";
import { refuse } from "./native";
import { normalizeWebsiteDarkModeConfig } from "../../src/utils/connection/websiteDarkMode";
declare global {
  interface Window {
    __WEB_AUTOMATION_DEMO__: { ready: boolean; refused: string[] };
  }
}
window.__WEB_AUTOMATION_DEMO__ = { ready: false, refused: [] };
window.addEventListener("error", (event) =>
  window.__WEB_AUTOMATION_DEMO__.refused.push(event.message),
);
window.addEventListener("unhandledrejection", () =>
  window.__WEB_AUTOMATION_DEMO__.refused.push("unhandled rejection"),
);
const stamp = "2026-09-09T12:00:00.000Z";
const macro: WebInteractionMacro = {
  kind: "macro",
  id: "demo-macro",
  name: "Update display preferences",
  description: "Demo only. Review the page layout before replaying.",
  createdAt: stamp,
  updatedAt: stamp,
  steps: [
    {
      kind: "click",
      selector: "html > body > main:nth-of-type(1) > button:nth-of-type(1)",
    },
    {
      kind: "check",
      selector: "html > body > main:nth-of-type(1) > input:nth-of-type(1)",
      checked: true,
    },
    {
      kind: "fill",
      selector: "html > body > main:nth-of-type(1) > input:nth-of-type(2)",
    },
  ],
};
const scripts = [
  {
    kind: "script" as const,
    id: "demo-script",
    name: "Highlight maintenance notices",
    description:
      "Apply a temporary outline to maintenance notices on the current page.",
    code: "// Page-only example. No native APIs or credentials.\nfor (const notice of document.querySelectorAll('.maintenance-notice')) {\n  notice.style.outline = '2px solid #60a5fa';\n}",
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    kind: "script" as const,
    id: "demo-tables",
    name: "Make tables easier to read",
    description: "Temporary page styling.",
    code: "document.querySelectorAll('table').forEach(table => {\n  table.style.fontSize = '15px';\n});",
    createdAt: stamp,
    updatedAt: stamp,
  },
];
export function Demo() {
  const view = new URL(location.href).searchParams.get("view") ?? "library";
  const [open, setOpen] = useState(["library", "macro"].includes(view));
  const [libraryKind, setLibraryKind] = useState<
    "script" | "macro" | undefined
  >();
  const [enabled, setEnabled] = useState(view !== "setup");
  const [recording, setRecording] = useState(
    ["recording", "capture-review", "discard"].includes(view),
  );
  const [steps, setSteps] = useState(
    ["macro", "recording", "capture-review", "discard"].includes(view)
      ? macro.steps
      : [],
  );
  const [pendingRun, setPendingRun] = useState<WebAutomationItem | null>(
    view === "review" ? scripts[0] : null,
  );
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
    window.__WEB_AUTOMATION_DEMO__.ready = true;
  }, []);
  const automation: ReturnType<typeof useWebAutomation> = {
    darkMode: {
      scopeKey: "demo",
      enabled: false,
      available: false,
      busy: false,
      error: null,
      unavailableReason:
        "Extension unavailable in the synthetic recording fixture.",
      configuration: normalizeWebsiteDarkModeConfig(undefined),
      theme: normalizeWebsiteDarkModeConfig(undefined).theme,
      defaultTheme: normalizeWebsiteDarkModeConfig(undefined).theme,
      presets: [],
      setEnabled: async () => false,
      updateConfiguration: async () => false,
    },
    permissions: {
      showActionBar: true,
      interactionMacrosEnabled: enabled,
      scriptInjectionEnabled: true,
      forceDark: false,
      confirmBeforeScriptRun: true,
    },
    error: null,
    libraryReady: true,
    library: { version: 1, scripts, macros: [macro] },
    allItems: [macro, ...scripts],
    favorites: [macro, scripts[0]],
    open,
    setOpen,
    libraryKind,
    openLibrary: (kind) => {
      setLibraryKind(kind);
      setOpen(true);
    },
    busy: false,
    saving: false,
    recording,
    recordingPending: false,
    recordingScopeKey: "demo-database:1:demo-connection:https:1",
    recordingUnavailableReason: null,
    canEnableMacroRecording: !enabled,
    enableMacroRecording: async () => {
      setEnabled(true);
      return true;
    },
    discardRecording: () => {
      setRecording(false);
      setSteps([]);
    },
    steps,
    // Synthetic state transitions only: no page agent, bridge or real capture.
    startRecording: async () => {
      setRecording(true);
      setSteps(macro.steps);
      return true;
    },
    stopRecording: async () => {
      setRecording(false);
      setOpen(true);
    },
    requestRun: setPendingRun,
    pendingRun,
    setPendingRun,
    execute: async () => refuse("script or macro execution"),
    cancel: () => setPendingRun(null),
    reload: async () => refuse("storage reload"),
    save: async () => refuse("storage save"),
    remove: async () => refuse("storage deletion"),
    favorite: async () => refuse("connection mutation"),
    recordedMacro: () => macro,
    clearSteps: () => setSteps([]),
    valuePrompt: null,
    answerValue: () => refuse("value entry"),
    pageReady: true,
  };
  const bookmarkProps = {
    automation,
    connection: {
      id: "demo-connection",
      name: "Demo website",
      protocol: "https",
      hostname: "demo.example.test",
      port: 443,
      isGroup: false,
      httpBookmarks: Array.from({ length: 24 }, (_, index) => ({
        name: `Demo bookmark ${index + 1}`,
        path: `/demo/${index + 1}`,
      })),
    } satisfies Connection,
    buildTargetUrl: () => "https://demo.example.test",
    currentPath: "/demo/1",
    isCurrentPageBookmarked: true,
    editingBmIdx: null,
    dragOverIdx: null,
    bmContextMenu: null,
    bmBarContextMenu: null,
    handleDragStart: () => () => refuse("bookmark drag"),
    handleDragOver: () => () => refuse("bookmark drag"),
    handleDrop: () => () => refuse("bookmark drop"),
    handleDragEnd: () => refuse("bookmark drag"),
    navigateToUrl: () => refuse("website navigation"),
    setBmContextMenu: () => refuse("bookmark menu"),
    setBmBarContextMenu: () => refuse("bookmark menu"),
  };
  // Only the real bar's render surface is provided; unexpected manager access
  // fails the fixture instead of touching application state.
  const manager = new Proxy(bookmarkProps, {
    get(target, property) {
      // React's development profiler checks whether arbitrary props are elements.
      if (property === "$$typeof" || property === Symbol.toStringTag)
        return undefined;
      if (property in target) return Reflect.get(target, property);
      return refuse(`unprovided browser manager property ${String(property)}`);
    },
  }) as unknown as WebBrowserMgr;
  return (
    <div
      style={{
        height: "100vh",
        background: "#10151f",
        color: "#e5e7eb",
        paddingTop: 48,
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 10,
          left: 8,
          right: 8,
          textAlign: "center",
          zIndex: 2147483647,
          pointerEvents: "none",
          fontSize: 12,
          color: "#dbeafe",
        }}
      >
        Demo data — no live connection, scripts or native storage
      </div>
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #334155",
          fontSize: 14,
        }}
      >
        Website workspace · demo.example.test
      </header>
      <BookmarkBar mgr={manager} />
      <main style={{ padding: 24, color: "#94a3b8" }}>
        The website stays separate from its saved macros and scripts.
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
