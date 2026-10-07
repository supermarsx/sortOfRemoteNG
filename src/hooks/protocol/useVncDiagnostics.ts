import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  VncDiagnosticReport,
  VncDiagnosticRequest,
} from "../../types/protocols/vncDiagnostics";
import { validVncDiagnosticTarget } from "./vncDiagnostics";

export function useVncDiagnostics(request: VncDiagnosticRequest) {
  const key = JSON.stringify(request);
  const current = useRef(key);
  current.current = key;
  const mounted = useRef(false);
  const pending = useRef(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    key: string;
    report: VncDiagnosticReport;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async () => {
    if (pending.current) return;
    pending.current = true;
    setRunning(true);
    setResult(null);
    const empty = (code: VncDiagnosticReport["code"]): VncDiagnosticReport => ({
      code,
      steps: [],
      resolvedAddresses: [],
      protocolVersion: null,
      durationMs: 0,
    });
    let report: VncDiagnosticReport;
    try {
      report =
        request.route === "blocked"
          ? empty("routeBlocked")
          : !validVncDiagnosticTarget(request)
            ? empty("invalidTarget")
            : await invoke<VncDiagnosticReport>("diagnose_vnc", { request });
    } catch {
      report = empty("unavailable");
    } finally {
      pending.current = false;
      if (mounted.current) setRunning(false);
    }
    if (mounted.current && current.current === key) setResult({ key, report });
  };
  return { run, running, report: result?.key === key ? result.report : null };
}
