import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  interfaceTargets,
  NETWORK_TARGET_HISTORY_KEY,
  readTargetHistory,
  rememberNetworkTarget,
  type InterfaceTarget,
} from "../../utils/discovery/networkTargets";

export function useDiscoveryTargets(native: boolean) {
  const [history, setHistory] = useState<string[]>([]);
  const historyRef = useRef(history);
  const [interfaces, setInterfaces] = useState<InterfaceTarget[]>([]);
  const [interfaceStatus, setInterfaceStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const mounted = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    generation.current++;
    const reload = () => {
      historyRef.current = readTargetHistory();
      setHistory(historyRef.current);
    };
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === NETWORK_TARGET_HISTORY_KEY || event.key === null)
        reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const remember = useCallback((value: string) => {
    const next = rememberNetworkTarget(
      [...historyRef.current, ...readTargetHistory()],
      value,
    );
    historyRef.current = next;
    setHistory(next);
    try {
      localStorage.setItem(NETWORK_TARGET_HISTORY_KEY, JSON.stringify(next));
    } catch {
      // History remains usable in memory when browser storage is unavailable.
    }
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setHistory([]);
    try {
      localStorage.removeItem(NETWORK_TARGET_HISTORY_KEY);
    } catch {
      // A storage failure must not prevent editing or scanning.
    }
  }, []);

  const refreshInterfaces = useCallback(async () => {
    if (!native || pending.current) return;
    const request = ++generation.current;
    pending.current = true;
    setInterfaceStatus("loading");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const detected = await Promise.race([
        invoke<unknown>("detect_interface_subnets"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Interface detection timed out")),
            5000,
          );
        }),
      ]);
      if (!mounted.current || request !== generation.current) return;
      if (!Array.isArray(detected))
        throw new Error("Invalid interface response");
      setInterfaces(interfaceTargets(detected));
      setInterfaceStatus("ready");
    } catch {
      if (!mounted.current || request !== generation.current) return;
      setInterfaces([]);
      setInterfaceStatus("error");
    } finally {
      clearTimeout(timer);
      pending.current = false;
    }
  }, [native]);

  return {
    history,
    remember,
    clearHistory,
    interfaces,
    interfaceStatus,
    refreshInterfaces,
  };
}
