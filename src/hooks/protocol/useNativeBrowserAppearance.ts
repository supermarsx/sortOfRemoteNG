"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OriginBrowserIdentity } from "../../types/protocols/originBrowser";
import { useWebsiteAppPalette } from "./useWebsiteAppPalette";

export interface NativeAppearanceReceipt {
  status: "applied" | "off" | "fallback";
  followingAppTheme: boolean;
}

/** The shell supplies colors only. Native owns the saved theme, enablement,
 * safe custom CSS and every root/child renderer in this connection attempt. */
export function useNativeBrowserAppearance(
  identity: OriginBrowserIdentity | null,
  enabled: boolean,
  assertOwner: () => void,
) {
  const appPalette = useWebsiteAppPalette();
  const scope = enabled && identity ? JSON.stringify(identity) : "";
  const paletteKey = JSON.stringify(appPalette);
  const latest = useRef({
    scope,
    identity,
    appPalette,
    paletteKey,
    assertOwner,
  });
  latest.current = { scope, identity, appPalette, paletteKey, assertOwner };
  const trigger = useRef<(() => void) | null>(null);
  const [state, setState] = useState<{
    scope: string;
    receipt: NativeAppearanceReceipt | null;
    error: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    setState(null);
    if (!scope) return;
    let live = true;
    let busy = false;
    let last: string | null = null;
    const current = () => live && latest.current.scope === scope;
    const drain = async () => {
      if (!current() || busy || last === latest.current.paletteKey) return;
      const captured = latest.current;
      if (!captured.identity) return;
      last = captured.paletteKey;
      busy = true;
      try {
        captured.assertOwner();
        const receipt = await invoke<NativeAppearanceReceipt>(
          "origin_browser_appearance",
          {
            request: {
              identity: captured.identity,
              appPalette: captured.appPalette,
            },
          },
        );
        if (!current() || last !== latest.current.paletteKey) return;
        latest.current.assertOwner();
        if (
          !receipt ||
          !["applied", "off", "fallback"].includes(receipt.status) ||
          typeof receipt.followingAppTheme !== "boolean"
        )
          throw new Error("Invalid appearance receipt");
        setState({ scope, receipt, error: null });
      } catch {
        if (current() && last === latest.current.paletteKey)
          setState({
            scope,
            receipt: null,
            error:
              "Website appearance could not be applied. Reopen the website to retry; its saved appearance is unchanged.",
          });
      } finally {
        busy = false;
        if (current() && last !== latest.current.paletteKey) void drain();
      }
    };
    trigger.current = () => void drain();
    void drain();
    return () => {
      live = false;
      trigger.current = null;
    };
  }, [scope]);
  useLayoutEffect(() => {
    trigger.current?.();
  }, [paletteKey]);
  return state?.scope === scope ? state : null;
}
