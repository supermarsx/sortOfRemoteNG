import { useCallback, useEffect, useRef, useState } from "react";
import {
  SYNOLOGY_ADMIN_ACTIONS,
  adminActionArgs,
  type AdminAction,
} from "../../components/synology/synologyPanel/adminActions";
import { toSafeManagementError } from "../../utils/security/managementInvoke";

type Values = Record<string, string | boolean>;
interface Review {
  id: number;
  scopeKey: string;
  action: AdminAction;
  values: Values;
}
export function useSynologyAdminActions({
  scopeKey,
  invoke,
  onSuccess,
}: {
  scopeKey: string;
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  onSuccess: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [result, setResult] = useState<{
    action: AdminAction;
    value: unknown;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef({ scopeKey, invoke, onSuccess });
  current.current = { scopeKey, invoke, onSuccess };
  const alive = useRef(true),
    token = useRef(0),
    pending = useRef(false),
    reviewRef = useRef<Review | null>(null);
  const previous = useRef(scopeKey);
  if (previous.current !== scopeKey) {
    previous.current = scopeKey;
    token.current++;
    reviewRef.current = null;
    pending.current = false;
  }
  useEffect(() => {
    setReview(null);
    setResult(null);
    setError(null);
    setMessage(null);
    setBusy(false);
  }, [scopeKey]);
  useEffect(() => {
    alive.current = true;
    const attempts = token;
    return () => {
      alive.current = false;
      attempts.current++;
      reviewRef.current = null;
    };
  }, []);
  const open = useCallback((id: string, values: Values = {}) => {
    if (pending.current) return;
    const action = SYNOLOGY_ADMIN_ACTIONS.find((item) => item.id === id);
    if (!action) return;
    const next = {
      id: ++token.current,
      scopeKey: current.current.scopeKey,
      action,
      values,
    };
    reviewRef.current = next;
    setReview(next);
    setError(null);
    setMessage(null);
    setResult(null);
  }, []);
  const cancel = useCallback(() => {
    if (pending.current) return;
    token.current++;
    reviewRef.current = null;
    setReview(null);
    setError(null);
  }, []);
  const execute = async (values: Values): Promise<boolean> => {
    const captured = review;
    if (
      !captured ||
      pending.current ||
      captured.id !== reviewRef.current?.id ||
      captured.scopeKey !== current.current.scopeKey
    )
      return false;
    let args: Record<string, unknown>;
    try {
      args = adminActionArgs(captured.action, values);
    } catch (failure) {
      setError(toSafeManagementError(failure));
      return false;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    const stillCurrent = () =>
      alive.current &&
      token.current === captured.id &&
      current.current.scopeKey === captured.scopeKey;
    try {
      const value = await current.current.invoke(captured.action.command, args);
      if (!stillCurrent()) return false;
      if (captured.action.mutation) {
        setMessage(
          `${captured.action.label}: request accepted by the NAS. Refresh the relevant status to verify its final state.`,
        );
        current.current.onSuccess();
      } else {
        setResult({ action: captured.action, value });
      }
      reviewRef.current = null;
      setReview(null);
      return true;
    } catch (failure) {
      if (stillCurrent()) setError(toSafeManagementError(failure));
      return false;
    } finally {
      if (stillCurrent()) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return {
    review: review?.scopeKey === scopeKey ? review : null,
    result,
    error,
    message,
    busy,
    open,
    cancel,
    execute,
    clearResult: () => setResult(null),
  };
}
