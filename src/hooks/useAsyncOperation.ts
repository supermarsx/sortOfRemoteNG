import { useState, useCallback, useEffect, useRef } from 'react';

interface AsyncOperationState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseAsyncOperationReturn<T> extends AsyncOperationState<T> {
  execute: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
}

export function useAsyncOperation<T>(
  asyncFn: (...args: unknown[]) => Promise<T>,
): UseAsyncOperationReturn<T> {
  const [state, setState] = useState<AsyncOperationState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(async (...args: unknown[]): Promise<T | null> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await asyncFn(...args);
      if (mountedRef.current) {
        setState({ data: result, loading: false, error: null });
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (mountedRef.current) {
        setState(prev => ({ ...prev, loading: false, error: msg }));
      }
      return null;
    }
  }, [asyncFn]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}
