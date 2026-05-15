import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToastContext } from '../../contexts/ToastContext';

interface StartupFailurePayload {
  component?: string;
  message?: string;
  port?: number;
}

/**
 * Subscribes to non-fatal startup failures emitted by the Rust side
 * (`startup-failure` Tauri event) and surfaces them to the user as a
 * toast instead of letting them disappear into the console. The app
 * keeps running; the user just gets told something didn't start.
 */
export function useStartupFailureAlerts(): void {
  const { toast } = useToastContext();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const handle = await listen<StartupFailurePayload>(
          'startup-failure',
          (event) => {
            const payload = event.payload ?? {};
            const componentLabel = payload.component
              ? payload.component
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())
              : 'A startup component';
            const detail =
              payload.message ??
              `${componentLabel} failed to start. The app will keep running but the feature may be unavailable.`;
            toast.error(detail, 10_000);
          },
        );
        unlisten = handle;
      } catch {
        // Not running under Tauri — nothing to do.
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [toast]);
}
