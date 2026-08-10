import { listen } from "@tauri-apps/api/event";

export const SSH_ROUTED_EVENT_NAMES = {
  output: "ssh-output",
  error: "ssh-error",
  closed: "ssh-shell-closed",
  bufferRequest: "request-terminal-buffer",
} as const;

export type SshRoutedEventKind = keyof typeof SSH_ROUTED_EVENT_NAMES;

export interface SshEventMetadata {
  generation?: number;
}

export interface SshOutputEventPayload extends SshEventMetadata {
  session_id: string;
  data: string;
  sequence_start?: number;
  sequence_end?: number;
  retained_start?: number;
  dropped_bytes?: number;
}

export interface SshErrorEventPayload extends SshEventMetadata {
  session_id: string;
  message: string;
}

export interface SshClosedEventPayload extends SshEventMetadata {
  session_id: string;
  reason?: "requested" | "remote_eof" | "transport_error" | string;
  recoverable?: boolean;
  message?: string | null;
}

export interface SshBufferRequestPayload extends SshEventMetadata {
  sessionId: string;
}

export interface SshActorEventSubscriber {
  generation?: number;
  onOutput?: (payload: SshOutputEventPayload) => void;
  onError?: (payload: SshErrorEventPayload) => void;
  onClosed?: (payload: SshClosedEventPayload) => void;
}

type RoutedPayload =
  | SshOutputEventPayload
  | SshErrorEventPayload
  | SshClosedEventPayload
  | SshBufferRequestPayload;

type RoutedHandler = (payload: never) => void;

interface RoutedSubscription {
  generation?: number;
  handler: RoutedHandler;
}

interface BackendBinding {
  pending: boolean;
  unlisten: (() => void) | null;
}

export interface SshEventRouterDiagnostics {
  backendListeners: number;
  pendingBackendListeners: number;
  subscribers: number;
  subscribersByKind: Record<SshRoutedEventKind, number>;
}

export type SshEventListen = <T>(
  eventName: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

const defaultListen: SshEventListen = (eventName, handler) =>
  listen(eventName, handler);

const eventKinds = Object.keys(SSH_ROUTED_EVENT_NAMES) as SshRoutedEventKind[];

const createRouteTable = (): Record<
  SshRoutedEventKind,
  Map<string, Map<number, RoutedSubscription>>
> => ({
  output: new Map(),
  error: new Map(),
  closed: new Map(),
  bufferRequest: new Map(),
});

const payloadSessionId = (
  kind: SshRoutedEventKind,
  payload: RoutedPayload,
): string | null => {
  if (kind === "bufferRequest") {
    const sessionId = (payload as SshBufferRequestPayload).sessionId;
    return typeof sessionId === "string" && sessionId ? sessionId : null;
  }
  const sessionId = (
    payload as
      | SshOutputEventPayload
      | SshErrorEventPayload
      | SshClosedEventPayload
  ).session_id;
  return typeof sessionId === "string" && sessionId ? sessionId : null;
};

/**
 * One router is shared by every SSH view in a browser/Tauri window. Native
 * event listeners are installed lazily and ref-counted by routed subscriber,
 * so the backend listener count is constant as session count grows.
 */
export class SshEventRouter {
  private readonly routes = createRouteTable();
  private readonly bindings = new Map<SshRoutedEventKind, BackendBinding>();
  private readonly retryTimers = new Map<
    SshRoutedEventKind,
    ReturnType<typeof setTimeout>
  >();
  private readonly retryAttempts = new Map<SshRoutedEventKind, number>();
  private nextSubscriptionId = 1;
  private disposed = false;

  constructor(
    private readonly listenToEvent: SshEventListen = defaultListen,
    private readonly onListenerError: (error: unknown) => void = (error) =>
      console.error("Failed to attach shared SSH event listener:", error),
  ) {}

  subscribeActor(
    sessionId: string,
    subscriber: SshActorEventSubscriber,
  ): () => void {
    if (!sessionId)
      throw new Error("SSH event subscriptions require a session ID");
    if (this.disposed) throw new Error("SSH event router is disposed");

    const removers: Array<() => void> = [];
    if (subscriber.onOutput) {
      removers.push(
        this.addSubscription(
          "output",
          sessionId,
          subscriber.onOutput,
          subscriber.generation,
        ),
      );
    }
    if (subscriber.onError) {
      removers.push(
        this.addSubscription(
          "error",
          sessionId,
          subscriber.onError,
          subscriber.generation,
        ),
      );
    }
    if (subscriber.onClosed) {
      removers.push(
        this.addSubscription(
          "closed",
          sessionId,
          subscriber.onClosed,
          subscriber.generation,
        ),
      );
    }

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      removers.forEach((remove) => remove());
    };
  }

  subscribeBufferRequests(
    frontendSessionId: string,
    handler: (payload: SshBufferRequestPayload) => void,
  ): () => void {
    if (!frontendSessionId) {
      throw new Error("Terminal buffer subscriptions require a session ID");
    }
    return this.addSubscription(
      "bufferRequest",
      frontendSessionId,
      handler,
      undefined,
    );
  }

  diagnostics(): SshEventRouterDiagnostics {
    const subscribersByKind = Object.fromEntries(
      eventKinds.map((kind) => [kind, this.subscriptionCount(kind)]),
    ) as Record<SshRoutedEventKind, number>;
    return {
      backendListeners: [...this.bindings.values()].filter(
        (binding) => binding.unlisten !== null,
      ).length,
      pendingBackendListeners: [...this.bindings.values()].filter(
        (binding) => binding.pending,
      ).length,
      subscribers: Object.values(subscribersByKind).reduce(
        (total, count) => total + count,
        0,
      ),
      subscribersByKind,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const routes of Object.values(this.routes)) routes.clear();
    for (const binding of this.bindings.values()) {
      binding.unlisten?.();
      binding.unlisten = null;
    }
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();
    // Pending listeners observe `disposed` when their promises resolve and
    // immediately unlisten themselves.
  }

  private addSubscription<T extends RoutedPayload>(
    kind: SshRoutedEventKind,
    sessionId: string,
    handler: (payload: T) => void,
    generation: number | undefined,
  ): () => void {
    if (this.disposed) throw new Error("SSH event router is disposed");
    const id = this.nextSubscriptionId++;
    let sessionRoutes = this.routes[kind].get(sessionId);
    if (!sessionRoutes) {
      sessionRoutes = new Map();
      this.routes[kind].set(sessionId, sessionRoutes);
    }
    sessionRoutes.set(id, {
      generation,
      handler: handler as RoutedHandler,
    });
    this.ensureBackendBinding(kind);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const current = this.routes[kind].get(sessionId);
      current?.delete(id);
      if (current?.size === 0) this.routes[kind].delete(sessionId);
      if (this.subscriptionCount(kind) === 0) this.releaseBackendBinding(kind);
    };
  }

  private subscriptionCount(kind: SshRoutedEventKind): number {
    let count = 0;
    for (const sessionRoutes of this.routes[kind].values()) {
      count += sessionRoutes.size;
    }
    return count;
  }

  private ensureBackendBinding(kind: SshRoutedEventKind): void {
    if (this.disposed || this.bindings.has(kind)) return;

    const binding: BackendBinding = { pending: true, unlisten: null };
    this.bindings.set(kind, binding);
    this.listenToEvent<RoutedPayload>(SSH_ROUTED_EVENT_NAMES[kind], (event) =>
      this.dispatch(kind, event.payload),
    )
      .then((unlisten) => {
        binding.pending = false;
        if (
          this.disposed ||
          this.bindings.get(kind) !== binding ||
          this.subscriptionCount(kind) === 0
        ) {
          unlisten();
          if (this.bindings.get(kind) === binding) this.bindings.delete(kind);
          return;
        }
        binding.unlisten = unlisten;
        this.retryAttempts.delete(kind);
      })
      .catch((error) => {
        binding.pending = false;
        if (this.bindings.get(kind) === binding) this.bindings.delete(kind);
        this.onListenerError(error);
        this.scheduleBackendRetry(kind);
      });
  }

  private scheduleBackendRetry(kind: SshRoutedEventKind): void {
    if (
      this.disposed ||
      this.subscriptionCount(kind) === 0 ||
      this.retryTimers.has(kind)
    ) {
      return;
    }
    const attempt = (this.retryAttempts.get(kind) ?? 0) + 1;
    this.retryAttempts.set(kind, attempt);
    const delayMs = Math.min(1_000, 25 * 2 ** Math.min(attempt - 1, 5));
    const timer = setTimeout(() => {
      this.retryTimers.delete(kind);
      if (!this.disposed && this.subscriptionCount(kind) > 0) {
        this.ensureBackendBinding(kind);
      }
    }, delayMs);
    this.retryTimers.set(kind, timer);
  }

  private releaseBackendBinding(kind: SshRoutedEventKind): void {
    const retryTimer = this.retryTimers.get(kind);
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      this.retryTimers.delete(kind);
    }
    this.retryAttempts.delete(kind);
    const binding = this.bindings.get(kind);
    if (!binding) return;
    if (binding.unlisten) {
      binding.unlisten();
      binding.unlisten = null;
      this.bindings.delete(kind);
    }
    // If installation is pending, leave the binding in the map. It will
    // unlisten on resolution unless a StrictMode remount reuses it first.
  }

  private dispatch(kind: SshRoutedEventKind, payload: RoutedPayload): void {
    if (this.disposed) return;
    const sessionId = payloadSessionId(kind, payload);
    if (!sessionId) return;
    const subscribers = this.routes[kind].get(sessionId);
    if (!subscribers) return;
    const generation = payload.generation;

    // Snapshot so a callback can safely unsubscribe itself while dispatching.
    for (const subscription of [...subscribers.values()]) {
      if (
        subscription.generation !== undefined &&
        generation !== undefined &&
        subscription.generation !== generation
      ) {
        continue;
      }
      subscription.handler(payload as never);
    }
  }
}

let windowRouter: SshEventRouter | null = null;

export const getSshEventRouter = (): SshEventRouter => {
  windowRouter ??= new SshEventRouter();
  return windowRouter;
};

export const resetSshEventRouterForTests = (): void => {
  windowRouter?.dispose();
  windowRouter = null;
};
