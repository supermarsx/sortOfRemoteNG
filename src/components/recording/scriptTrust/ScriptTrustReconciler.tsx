import { useScriptRunTrustReconciler } from "../../../hooks/recording/useScriptRunTrustReconciler";

/**
 * Keeps the record of trusted scripts free of entries for deleted connections
 * and databases. It renders nothing. Mount it once, in the main window only,
 * inside the connection provider.
 */
export function ScriptTrustReconciler(): null {
  useScriptRunTrustReconciler();
  return null;
}
