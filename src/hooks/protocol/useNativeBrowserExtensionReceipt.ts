"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import type { NativeBrowserExtensionReceipt } from "../../types/protocols/nativeBrowserExtensions";

/** Only the current, native-authorized attempt can enable extension controls. */
export function useNativeBrowserExtensionReceipt(
  identity: OriginBrowserIdentity | null,
  enabled: boolean,
  assertOwner: () => void,
) {
  const scope = enabled && identity ? JSON.stringify(identity) : "";
  const latest = useRef({ scope, identity, assertOwner });
  latest.current = { scope, identity, assertOwner };
  const [receipt, setReceipt] = useState<{
    scope: string;
    value: NativeBrowserExtensionReceipt;
  } | null>(null);
  useEffect(() => {
    // A completed approval belongs to this continuous enabled scope, not just
    // its serialized identity. Clear it even when leaving for a disabled scope
    // so an A-B-A transition cannot expose it while a fresh request is pending.
    setReceipt(null);
    const captured = latest.current;
    if (!scope || !captured.identity) return;
    let live = true;
    void (async () => {
      captured.assertOwner();
      const value = await invoke<NativeBrowserExtensionReceipt>(
        "origin_browser_extensions",
        { request: { identity: captured.identity } },
      );
      if (!live || latest.current.scope !== scope) return;
      latest.current.assertOwner();
      // The consuming hook additionally validates every receipt field and owner.
      setReceipt({ scope, value });
    })().catch(() => {
      if (live && latest.current.scope === scope) setReceipt(null);
    });
    return () => {
      live = false;
    };
  }, [scope]);
  return receipt?.scope === scope ? receipt.value : null;
}
