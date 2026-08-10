import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { debugLog } from "../../utils/core/debugLogger";
import { dispatchVncPointerClick } from "../../utils/session/canvasCoordinates";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import { useSessionFullscreen } from "../session/useSessionFullscreen";
import { VncAdmissionController } from "./vncAdmissionController";

export interface VNCSettings {
  viewOnly: boolean;
  scaleViewport: boolean;
  clipViewport: boolean;
  dragViewport: boolean;
  resizeSession: boolean;
  showDotCursor: boolean;
  localCursor: boolean;
  sharedMode: boolean;
  bellPolicy: string;
  compressionLevel: number;
  quality: number;
}

interface NativeVncSession {
  id: string;
  connected: boolean;
  security_type: string | null;
  server_name: string | null;
  framebuffer_width: number;
  framebuffer_height: number;
  pixel_format: string;
}

interface NativeVncStats {
  framebuffer_width: number;
  framebuffer_height: number;
  frame_count: number;
  bytes_received: number;
}

interface NativeVncFrame {
  session_id: string;
  data: string;
  x: number;
  y: number;
  width: number;
  height: number;
  source_x?: number;
  source_y?: number;
  delivery_epoch: number;
  frame_token: number;
}

type NativeVncEvent =
  | { kind: "frame"; frame: NativeVncFrame }
  | { kind: "bell" }
  | { kind: "clipboard"; text: string }
  | { kind: "resize"; width: number; height: number }
  | { kind: "stateChanged"; state: string; message: string }
  | { kind: "disconnected"; reason: string | null }
  | {
      kind: "connected";
      width: number;
      height: number;
      server_name: string;
      protocol_version: string;
      security_type: string;
    }
  | { kind: "cursorChanged" };

interface NativeVncPoll {
  stats: NativeVncStats;
  events: NativeVncEvent[];
}

interface NativeVncActivityResult {
  sessionId: string;
  active: boolean;
  activityGeneration: number;
  deliveryEpoch: number;
  accepted: boolean;
  refreshQueued: boolean;
}

interface NativeVncFrameAckResult {
  sessionId: string;
  accepted: boolean;
  active: boolean;
  activityGeneration: number;
  deliveryEpoch: number;
}

interface PressedVncPointer {
  sessionId: string;
  x: number;
  y: number;
  token: number;
}

const DEFAULT_VNC_SETTINGS: VNCSettings = {
  viewOnly: false,
  scaleViewport: true,
  clipViewport: false,
  dragViewport: true,
  resizeSession: false,
  showDotCursor: false,
  localCursor: true,
  sharedMode: false,
  bellPolicy: "on",
  compressionLevel: 2,
  quality: 6,
};

const MAX_FRAMEBUFFER_BYTES = 32 * 1024 * 1024;
const MAX_RECTANGLE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_CLIPBOARD_BYTES = 256 * 1024;
const FRAME_POLL_INTERVAL_MS = 33;
const MAX_ACTIVITY_CLAIM_ATTEMPTS = 3;
export const VNC_CONNECT_MAX_CONCURRENCY = 2;
export const VNC_ACTIVITY_MAX_CONCURRENCY = 2;

const vncConnectAdmission = new VncAdmissionController(
  VNC_CONNECT_MAX_CONCURRENCY,
);
const vncActivityAdmission = new VncAdmissionController(
  VNC_ACTIVITY_MAX_CONCURRENCY,
);

export type VNCConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

const safeVncError = (value: unknown, password?: string): string => {
  let message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : String(value);
  if (password) message = message.split(password).join("[redacted]");
  return sanitizeBehaviorText(message) || "VNC operation failed.";
};

const boundedDimensions = (
  width: number,
  height: number,
  byteLimit: number,
): boolean =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width > 0 &&
  height > 0 &&
  width <= MAX_DIMENSION &&
  height <= MAX_DIMENSION &&
  width * height * 4 <= byteLimit;

const resizeCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) => {
  if (!boundedDimensions(width, height, MAX_FRAMEBUFFER_BYTES)) {
    throw new Error("The VNC framebuffer dimensions exceed the safety limit.");
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
};

const drawNativeFrame = (canvas: HTMLCanvasElement, frame: NativeVncFrame) => {
  if (!boundedDimensions(frame.width, frame.height, MAX_RECTANGLE_BYTES)) {
    throw new Error("A VNC rectangle exceeds the safety limit.");
  }
  if (
    frame.x < 0 ||
    frame.y < 0 ||
    frame.x + frame.width > canvas.width ||
    frame.y + frame.height > canvas.height
  ) {
    throw new Error("A VNC rectangle lies outside the framebuffer.");
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The VNC canvas is unavailable.");

  if (frame.source_x !== undefined && frame.source_y !== undefined) {
    if (
      frame.source_x < 0 ||
      frame.source_y < 0 ||
      frame.source_x + frame.width > canvas.width ||
      frame.source_y + frame.height > canvas.height
    ) {
      throw new Error("A VNC CopyRect source lies outside the framebuffer.");
    }
    const copied = context.getImageData(
      frame.source_x,
      frame.source_y,
      frame.width,
      frame.height,
    );
    context.putImageData(copied, frame.x, frame.y);
    return;
  }

  const expectedBytes = frame.width * frame.height * 4;
  const maximumEncodedLength = Math.ceil(expectedBytes / 3) * 4 + 4;
  if (!frame.data || frame.data.length > maximumEncodedLength) {
    throw new Error("A VNC frame payload exceeds its declared dimensions.");
  }
  const binary = atob(frame.data);
  if (binary.length !== expectedBytes) {
    throw new Error("A VNC frame payload does not match its dimensions.");
  }
  const pixels = new Uint8ClampedArray(expectedBytes);
  for (let index = 0; index < binary.length; index += 1) {
    pixels[index] = binary.charCodeAt(index);
  }
  context.putImageData(
    new ImageData(pixels, frame.width, frame.height),
    frame.x,
    frame.y,
  );
};

const keyToKeysym = (event: React.KeyboardEvent): number | null => {
  if (event.key.length === 1) return event.key.codePointAt(0) ?? null;
  const named: Record<string, number> = {
    Backspace: 0xff08,
    Tab: 0xff09,
    Enter: 0xff0d,
    Escape: 0xff1b,
    Insert: 0xff63,
    Delete: 0xffff,
    Home: 0xff50,
    End: 0xff57,
    PageUp: 0xff55,
    PageDown: 0xff56,
    ArrowLeft: 0xff51,
    ArrowUp: 0xff52,
    ArrowRight: 0xff53,
    ArrowDown: 0xff54,
    Shift: 0xffe1,
    Control: 0xffe3,
    Alt: 0xffe9,
    Meta: 0xffeb,
    CapsLock: 0xffe5,
  };
  if (event.key in named) return named[event.key];
  const functionKey = /^F(\d{1,2})$/.exec(event.key);
  if (functionKey) {
    const number = Number(functionKey[1]);
    if (number >= 1 && number <= 12) return 0xffbd + number;
  }
  return null;
};

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isSafePositiveInteger = (value: unknown): value is number =>
  isSafeNonNegativeInteger(value) && value > 0;

const validateActivityResult = (
  value: unknown,
  sessionId: string,
): NativeVncActivityResult => {
  if (!value || typeof value !== "object") {
    throw new Error("The VNC activity response is invalid.");
  }
  const result = value as Partial<NativeVncActivityResult>;
  if (
    result.sessionId !== sessionId ||
    typeof result.active !== "boolean" ||
    !isSafeNonNegativeInteger(result.activityGeneration) ||
    !isSafePositiveInteger(result.deliveryEpoch) ||
    typeof result.accepted !== "boolean" ||
    typeof result.refreshQueued !== "boolean"
  ) {
    throw new Error("The VNC activity response is invalid.");
  }
  return result as NativeVncActivityResult;
};

const validateFrameAckResult = (
  value: unknown,
  sessionId: string,
): NativeVncFrameAckResult => {
  if (!value || typeof value !== "object") {
    throw new Error("The VNC frame acknowledgement is invalid.");
  }
  const result = value as Partial<NativeVncFrameAckResult>;
  if (
    result.sessionId !== sessionId ||
    typeof result.accepted !== "boolean" ||
    typeof result.active !== "boolean" ||
    !isSafeNonNegativeInteger(result.activityGeneration) ||
    !isSafePositiveInteger(result.deliveryEpoch)
  ) {
    throw new Error("The VNC frame acknowledgement is invalid.");
  }
  return result as NativeVncFrameAckResult;
};

export function useVNCClient(session: ConnectionSession) {
  const { isActive: isRenderActive } = useSessionRenderActivity();
  const { state, dispatch } = useConnections();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backendRef = useRef<string | null>(session.backendSessionId ?? null);
  const backendOwnerRef = useRef<string | null>(
    session.backendSessionId ? session.id : null,
  );
  const sessionInfoRef = useRef<NativeVncSession | null>(null);
  const connectedRef = useRef(false);
  const mountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const cleanupGenerationRef = useRef(0);
  const pollGenerationRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const activityGenerationRef = useRef(0);
  const activityIntentRevisionRef = useRef(0);
  const processedActivityRevisionRef = useRef(-1);
  const activityWorkerRunningRef = useRef(false);
  const connectAdmissionAbortRef = useRef<AbortController | null>(null);
  const activityAdmissionAbortRef = useRef<AbortController | null>(null);
  const deliveryEpochRef = useRef<number | null>(null);
  const disconnectRequestsRef = useRef(new Map<string, Promise<void>>());
  const disconnectedBackendsRef = useRef(new Set<string>());
  const pressedKeysymsRef = useRef(new Set<number>());
  const pressedPointerRef = useRef<PressedVncPointer | null>(null);
  const pointerSequenceRef = useRef(0);
  const pointerReleaseTimersRef = useRef(new Map<number, number>());
  const inputSequenceRef = useRef<Promise<void>>(Promise.resolve());
  const settingsRef = useRef(DEFAULT_VNC_SETTINGS);
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const effectiveRenderActive = isRenderActive && documentVisible;
  const effectiveRenderActiveRef = useRef(effectiveRenderActive);
  const desiredActivityRef = useRef(effectiveRenderActive);

  const executePollRef = useRef<
    (
      pollGeneration: number,
      lifecycleGeneration: number,
      sessionId: string,
      deliveryEpoch: number,
    ) => Promise<void>
  >(async () => undefined);
  const startPollingRef = useRef<
    (
      sessionId: string,
      lifecycleGeneration: number,
      deliveryEpoch: number,
    ) => void
  >(() => undefined);
  const publishActivityIntentRef = useRef<
    (active: boolean, force?: boolean) => void
  >(() => undefined);
  const applyActivityIntentRef = useRef<
    (intent: {
      active: boolean;
      lifecycleGeneration: number;
      revision: number;
      sessionId: string;
    }) => Promise<void>
  >(async () => undefined);
  const kickActivitySchedulerRef = useRef<() => void>(() => undefined);

  const reflowFullscreenCanvas = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }, []);
  const { isFullscreen, toggleFullscreen } = useSessionFullscreen(session.id, {
    onEnter: reflowFullscreenCanvas,
    onExit: reflowFullscreenCanvas,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<VNCConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<VNCSettings>(DEFAULT_VNC_SETTINGS);
  settingsRef.current = settings;
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [sessionInfo, setSessionInfo] = useState<NativeVncSession | null>(null);
  const [remoteClipboard, setRemoteClipboard] = useState<string | null>(null);
  const [bellCount, setBellCount] = useState(0);
  const [reconnectGeneration, setReconnectGeneration] = useState(0);

  const unsafeConsentLabels = [
    connection?.vncAllowUnencryptedTransport ? "unencrypted transport" : null,
    connection?.vncAllowWeakAuthentication
      ? "legacy weak authentication"
      : null,
    connection?.vncAllowUnauthenticated ? "unauthenticated access" : null,
  ].filter((value): value is string => Boolean(value));

  const stopPolling = useCallback(() => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const abortConnectAdmission = useCallback(() => {
    connectAdmissionAbortRef.current?.abort();
    connectAdmissionAbortRef.current = null;
  }, []);

  const abortActivityAdmission = useCallback(() => {
    activityAdmissionAbortRef.current?.abort();
    activityAdmissionAbortRef.current = null;
  }, []);

  const requestBackendDisconnect = useCallback((sessionId: string) => {
    if (disconnectedBackendsRef.current.has(sessionId)) {
      return Promise.resolve();
    }
    const existing = disconnectRequestsRef.current.get(sessionId);
    if (existing) return existing;

    const request = invoke<void>("disconnect_vnc", { sessionId }).then(
      () => {
        disconnectedBackendsRef.current.add(sessionId);
        if (disconnectRequestsRef.current.get(sessionId) === request) {
          disconnectRequestsRef.current.delete(sessionId);
        }
      },
      (error: unknown) => {
        if (disconnectRequestsRef.current.get(sessionId) === request) {
          disconnectRequestsRef.current.delete(sessionId);
        }
        throw error;
      },
    );
    disconnectRequestsRef.current.set(sessionId, request);
    return request;
  }, []);

  const enqueueInputOperation = useCallback(
    (operation: () => Promise<void>): Promise<void> => {
      const request = inputSequenceRef.current.then(operation, operation);
      inputSequenceRef.current = request.catch(() => undefined);
      return request;
    },
    [],
  );

  const clearPointerReleaseTimer = useCallback((token: number) => {
    const timer = pointerReleaseTimersRef.current.get(token);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pointerReleaseTimersRef.current.delete(token);
    }
  }, []);

  const clearTrackedInput = useCallback(() => {
    for (const timer of pointerReleaseTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    pointerReleaseTimersRef.current.clear();
    pressedKeysymsRef.current.clear();
    pressedPointerRef.current = null;
  }, []);

  const releasePressedInput = useCallback(
    (sessionId: string): Promise<void> => {
      const timers = [...pointerReleaseTimersRef.current.values()];
      pointerReleaseTimersRef.current.clear();
      for (const timer of timers) window.clearTimeout(timer);

      return enqueueInputOperation(async () => {
        const keys = [...pressedKeysymsRef.current].reverse();
        let firstError: unknown;
        for (const key of keys) {
          try {
            await invoke("send_vnc_key_event", {
              sessionId,
              down: false,
              key,
            });
          } catch (error) {
            firstError ??= error;
          } finally {
            pressedKeysymsRef.current.delete(key);
          }
        }
        const pointer = pressedPointerRef.current;
        if (pointer?.sessionId === sessionId) {
          try {
            await invoke("send_vnc_pointer_event", {
              sessionId,
              buttonMask: 0,
              x: pointer.x,
              y: pointer.y,
            });
          } catch (error) {
            firstError ??= error;
          } finally {
            if (pressedPointerRef.current?.token === pointer.token) {
              pressedPointerRef.current = null;
            }
          }
        }
        if (firstError !== undefined) throw firstError;
      });
    },
    [enqueueInputOperation],
  );

  const releasePressedPointer = useCallback(
    (sessionId: string, token: number): Promise<void> => {
      clearPointerReleaseTimer(token);
      return enqueueInputOperation(async () => {
        const pointer = pressedPointerRef.current;
        if (pointer?.sessionId !== sessionId || pointer.token !== token) return;
        try {
          await invoke("send_vnc_pointer_event", {
            sessionId,
            buttonMask: 0,
            x: pointer.x,
            y: pointer.y,
          });
        } finally {
          if (pressedPointerRef.current?.token === token) {
            pressedPointerRef.current = null;
          }
        }
      });
    },
    [clearPointerReleaseTimer, enqueueInputOperation],
  );

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      if (!mountedRef.current) return;
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const markError = useCallback(
    (value: unknown) => {
      if (!mountedRef.current) return;
      const message = safeVncError(value, connectionRef.current?.password);
      connectedRef.current = false;
      setIsConnected(false);
      setConnectionStatus("error");
      setErrorMessage(message);
      updateSession({ status: "error", errorMessage: message });
      debugLog("Native VNC operation failed");
    },
    [updateSession],
  );

  const markConnected = useCallback(
    (info: NativeVncSession, lifecycleGeneration: number): boolean => {
      if (
        !mountedRef.current ||
        lifecycleGenerationRef.current !== lifecycleGeneration ||
        backendRef.current !== info.id
      ) {
        return false;
      }
      sessionInfoRef.current = info;
      connectedRef.current = true;
      backendRef.current = info.id;
      setBackendSessionId(info.id);
      setSessionInfo(info);
      setIsConnected(true);
      setConnectionStatus("connected");
      setErrorMessage(null);
      updateSession({
        backendSessionId: info.id,
        status: "connected",
        errorMessage: undefined,
      });
      debugLog("Native VNC connection established");
      return true;
    },
    [updateSession],
  );

  const failAndClose = useCallback(
    async (lifecycleGeneration: number, sessionId: string, value: unknown) => {
      if (
        !mountedRef.current ||
        lifecycleGenerationRef.current !== lifecycleGeneration ||
        backendRef.current !== sessionId
      ) {
        return;
      }
      const failureGeneration = ++lifecycleGenerationRef.current;
      activityIntentRevisionRef.current += 1;
      abortConnectAdmission();
      abortActivityAdmission();
      deliveryEpochRef.current = null;
      connectedRef.current = false;
      stopPolling();
      const message = safeVncError(value, connectionRef.current?.password);
      await releasePressedInput(sessionId).catch(() => undefined);
      await requestBackendDisconnect(sessionId).catch(() => undefined);
      if (
        !mountedRef.current ||
        lifecycleGenerationRef.current !== failureGeneration ||
        backendRef.current !== sessionId
      ) {
        return;
      }
      backendRef.current = null;
      backendOwnerRef.current = null;
      sessionInfoRef.current = null;
      setBackendSessionId(null);
      setSessionInfo(null);
      markError(message);
      updateSession({ backendSessionId: undefined });
    },
    [
      abortActivityAdmission,
      abortConnectAdmission,
      markError,
      releasePressedInput,
      requestBackendDisconnect,
      stopPolling,
      updateSession,
    ],
  );

  const isPollCurrent = useCallback(
    (
      pollGeneration: number,
      lifecycleGeneration: number,
      sessionId: string,
      deliveryEpoch: number,
    ) =>
      mountedRef.current &&
      pollGenerationRef.current === pollGeneration &&
      lifecycleGenerationRef.current === lifecycleGeneration &&
      backendRef.current === sessionId &&
      connectedRef.current &&
      effectiveRenderActiveRef.current &&
      deliveryEpochRef.current === deliveryEpoch,
    [],
  );

  const executePoll = useCallback(
    async (
      pollGeneration: number,
      lifecycleGeneration: number,
      sessionId: string,
      deliveryEpoch: number,
    ) => {
      if (
        !isPollCurrent(
          pollGeneration,
          lifecycleGeneration,
          sessionId,
          deliveryEpoch,
        )
      ) {
        return;
      }

      try {
        const payload = await invoke<NativeVncPoll>("get_vnc_session_stats", {
          sessionId,
          maxEvents: 2,
        });
        if (
          !isPollCurrent(
            pollGeneration,
            lifecycleGeneration,
            sessionId,
            deliveryEpoch,
          )
        ) {
          return;
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          !payload.stats ||
          !Array.isArray(payload.events)
        ) {
          throw new Error("The VNC delivery response is invalid.");
        }

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("The VNC canvas is unavailable.");
        resizeCanvas(
          canvas,
          payload.stats.framebuffer_width,
          payload.stats.framebuffer_height,
        );

        for (const event of payload.events) {
          if (
            !isPollCurrent(
              pollGeneration,
              lifecycleGeneration,
              sessionId,
              deliveryEpoch,
            )
          ) {
            return;
          }

          if (event.kind === "frame") {
            if (event.frame.session_id !== sessionId) {
              throw new Error("A VNC frame belongs to another session.");
            }
            if (
              !isSafePositiveInteger(event.frame.delivery_epoch) ||
              !isSafePositiveInteger(event.frame.frame_token)
            ) {
              throw new Error("A VNC frame has invalid delivery metadata.");
            }
            if (event.frame.delivery_epoch !== deliveryEpoch) continue;

            drawNativeFrame(canvas, event.frame);
            if (
              !isPollCurrent(
                pollGeneration,
                lifecycleGeneration,
                sessionId,
                deliveryEpoch,
              )
            ) {
              return;
            }
            const acknowledgement = validateFrameAckResult(
              await invoke<NativeVncFrameAckResult>("acknowledge_vnc_frame", {
                sessionId,
                deliveryEpoch: event.frame.delivery_epoch,
                frameToken: event.frame.frame_token,
              }),
              sessionId,
            );
            if (
              !isPollCurrent(
                pollGeneration,
                lifecycleGeneration,
                sessionId,
                deliveryEpoch,
              )
            ) {
              return;
            }
            activityGenerationRef.current = Math.max(
              activityGenerationRef.current,
              acknowledgement.activityGeneration,
            );
            if (!acknowledgement.accepted) {
              deliveryEpochRef.current = null;
              stopPolling();
              publishActivityIntentRef.current(
                effectiveRenderActiveRef.current,
                true,
              );
              return;
            }
          } else if (event.kind === "resize") {
            resizeCanvas(canvas, event.width, event.height);
          } else if (event.kind === "clipboard") {
            if (event.text.length > MAX_CLIPBOARD_BYTES) {
              throw new Error(
                "The remote VNC clipboard exceeds the safety limit.",
              );
            }
            setRemoteClipboard(event.text);
          } else if (event.kind === "bell") {
            setBellCount((count) => count + 1);
          } else if (event.kind === "disconnected") {
            throw new Error(event.reason || "The VNC server disconnected.");
          }
        }

        if (
          isPollCurrent(
            pollGeneration,
            lifecycleGeneration,
            sessionId,
            deliveryEpoch,
          )
        ) {
          pollTimerRef.current = window.setTimeout(() => {
            pollTimerRef.current = null;
            void executePollRef.current(
              pollGeneration,
              lifecycleGeneration,
              sessionId,
              deliveryEpoch,
            );
          }, FRAME_POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (
          isPollCurrent(
            pollGeneration,
            lifecycleGeneration,
            sessionId,
            deliveryEpoch,
          )
        ) {
          await failAndClose(lifecycleGeneration, sessionId, error);
        }
      }
    },
    [failAndClose, isPollCurrent, stopPolling],
  );
  executePollRef.current = executePoll;

  const startPolling = useCallback(
    (sessionId: string, lifecycleGeneration: number, deliveryEpoch: number) => {
      stopPolling();
      const pollGeneration = pollGenerationRef.current;
      void executePollRef.current(
        pollGeneration,
        lifecycleGeneration,
        sessionId,
        deliveryEpoch,
      );
    },
    [stopPolling],
  );
  startPollingRef.current = startPolling;

  const isActivityIntentCurrent = useCallback(
    (intent: {
      active: boolean;
      lifecycleGeneration: number;
      revision: number;
      sessionId: string;
    }) =>
      mountedRef.current &&
      connectedRef.current &&
      lifecycleGenerationRef.current === intent.lifecycleGeneration &&
      activityIntentRevisionRef.current === intent.revision &&
      desiredActivityRef.current === intent.active &&
      effectiveRenderActiveRef.current === intent.active &&
      backendRef.current === intent.sessionId,
    [],
  );

  const claimActivityOwnership = useCallback(
    async (intent: {
      active: boolean;
      lifecycleGeneration: number;
      revision: number;
      sessionId: string;
    }): Promise<NativeVncActivityResult | null> => {
      const admissionAbort = new AbortController();
      activityAdmissionAbortRef.current?.abort();
      activityAdmissionAbortRef.current = admissionAbort;
      let requestedGeneration = activityGenerationRef.current + 1;
      try {
        for (
          let attempt = 0;
          attempt < MAX_ACTIVITY_CLAIM_ATTEMPTS;
          attempt += 1
        ) {
          if (
            !isSafePositiveInteger(requestedGeneration) ||
            !isActivityIntentCurrent(intent)
          ) {
            return null;
          }
          let lease;
          try {
            lease = await vncActivityAdmission.acquire(admissionAbort.signal);
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === "AbortError" &&
              admissionAbort.signal.aborted
            ) {
              return null;
            }
            throw error;
          }
          let response: unknown;
          try {
            if (!isActivityIntentCurrent(intent)) return null;
            response = await invoke<NativeVncActivityResult>(
              "set_vnc_session_activity",
              {
                sessionId: intent.sessionId,
                active: intent.active,
                activityGeneration: requestedGeneration,
              },
            );
          } finally {
            lease.release();
          }
          const result = validateActivityResult(response, intent.sessionId);
          if (!isActivityIntentCurrent(intent)) return null;
          activityGenerationRef.current = Math.max(
            activityGenerationRef.current,
            result.activityGeneration,
          );

          if (result.accepted) {
            if (
              result.activityGeneration !== requestedGeneration ||
              result.active !== intent.active
            ) {
              throw new Error("The VNC activity authority is inconsistent.");
            }
            if (intent.active && !result.refreshQueued) {
              throw new Error("The VNC resume did not queue a full refresh.");
            }
            return result;
          }

          requestedGeneration = result.activityGeneration + 1;
        }
        throw new Error("The VNC activity authority remained contested.");
      } finally {
        if (activityAdmissionAbortRef.current === admissionAbort) {
          activityAdmissionAbortRef.current = null;
        }
      }
    },
    [isActivityIntentCurrent],
  );

  const applyActivityIntent = useCallback(
    async (intent: {
      active: boolean;
      lifecycleGeneration: number;
      revision: number;
      sessionId: string;
    }) => {
      if (!intent.active) {
        deliveryEpochRef.current = null;
        stopPolling();
        await releasePressedInput(intent.sessionId);
        if (!isActivityIntentCurrent(intent)) return;
      }

      const result = await claimActivityOwnership(intent);
      if (!result || !isActivityIntentCurrent(intent)) return;
      if (!intent.active) return;

      const canvas = canvasRef.current;
      const info = sessionInfoRef.current;
      if (!canvas || !info || info.id !== intent.sessionId) {
        throw new Error("The VNC canvas is unavailable for resume.");
      }
      resizeCanvas(canvas, info.framebuffer_width, info.framebuffer_height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("The VNC canvas is unavailable.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (!isActivityIntentCurrent(intent)) return;

      deliveryEpochRef.current = result.deliveryEpoch;
      startPollingRef.current(
        intent.sessionId,
        intent.lifecycleGeneration,
        result.deliveryEpoch,
      );
    },
    [
      claimActivityOwnership,
      isActivityIntentCurrent,
      releasePressedInput,
      stopPolling,
    ],
  );
  applyActivityIntentRef.current = applyActivityIntent;

  const kickActivityScheduler = useCallback(() => {
    if (
      !mountedRef.current ||
      !connectedRef.current ||
      activityWorkerRunningRef.current
    ) {
      return;
    }
    activityWorkerRunningRef.current = true;
    void (async () => {
      try {
        while (mountedRef.current) {
          const sessionId = backendRef.current;
          if (!sessionId) return;
          const intent = {
            active: desiredActivityRef.current,
            lifecycleGeneration: lifecycleGenerationRef.current,
            revision: activityIntentRevisionRef.current,
            sessionId,
          };
          try {
            await applyActivityIntentRef.current(intent);
          } catch (error) {
            if (isActivityIntentCurrent(intent)) {
              await failAndClose(
                intent.lifecycleGeneration,
                intent.sessionId,
                error,
              );
            }
            return;
          }
          if (isActivityIntentCurrent(intent)) {
            processedActivityRevisionRef.current = intent.revision;
          }
          if (activityIntentRevisionRef.current === intent.revision) return;
        }
      } finally {
        activityWorkerRunningRef.current = false;
        if (
          mountedRef.current &&
          connectedRef.current &&
          backendRef.current &&
          processedActivityRevisionRef.current !==
            activityIntentRevisionRef.current
        ) {
          queueMicrotask(() => kickActivitySchedulerRef.current());
        }
      }
    })();
  }, [failAndClose, isActivityIntentCurrent]);
  kickActivitySchedulerRef.current = kickActivityScheduler;

  const publishActivityIntent = useCallback(
    (active: boolean, force = false) => {
      const changed = desiredActivityRef.current !== active;
      desiredActivityRef.current = active;
      effectiveRenderActiveRef.current = active;
      if (!active) {
        deliveryEpochRef.current = null;
        stopPolling();
      }
      if (!changed && !force) return;
      abortActivityAdmission();
      activityIntentRevisionRef.current += 1;
      kickActivitySchedulerRef.current();
    },
    [abortActivityAdmission, stopPolling],
  );
  publishActivityIntentRef.current = publishActivityIntent;

  const initialize = useCallback(
    async (lifecycleGeneration: number) => {
      const isCurrent = () =>
        mountedRef.current &&
        lifecycleGenerationRef.current === lifecycleGeneration;
      const currentConnection = connectionRef.current;
      const currentSession = sessionRef.current;
      if (!currentConnection) {
        if (isCurrent()) {
          markError("The saved VNC connection could not be found.");
        }
        return;
      }
      if (isCurrent()) {
        setConnectionStatus("connecting");
        setErrorMessage(null);
      }

      let newlyCreatedSessionId: string | null = null;
      try {
        let previousId: string | null =
          backendRef.current ?? currentSession.backendSessionId ?? null;
        if (
          previousId &&
          backendRef.current === null &&
          disconnectedBackendsRef.current.has(previousId)
        ) {
          previousId = null;
        }
        if (
          previousId &&
          backendOwnerRef.current &&
          backendOwnerRef.current !== currentSession.id
        ) {
          await releasePressedInput(previousId).catch(() => undefined);
          await requestBackendDisconnect(previousId).catch(() => undefined);
          if (!isCurrent()) return;
          if (backendRef.current === previousId) backendRef.current = null;
          backendOwnerRef.current = null;
          sessionInfoRef.current = null;
          connectedRef.current = false;
          previousId = null;
        }
        if (previousId) {
          const alive = await invoke<boolean>("is_vnc_connected", {
            sessionId: previousId,
          });
          if (!isCurrent()) return;
          if (alive) {
            const info = await invoke<NativeVncSession>(
              "get_vnc_session_info",
              { sessionId: previousId },
            );
            if (!isCurrent()) return;
            if (backendRef.current !== previousId) {
              activityGenerationRef.current = 0;
            }
            backendRef.current = previousId;
            backendOwnerRef.current = currentSession.id;
            deliveryEpochRef.current = null;
            if (markConnected(info, lifecycleGeneration)) {
              publishActivityIntent(effectiveRenderActiveRef.current, true);
            }
            return;
          }
          await requestBackendDisconnect(previousId).catch(() => undefined);
          if (!isCurrent()) return;
          if (backendRef.current === previousId) backendRef.current = null;
          backendOwnerRef.current = null;
          sessionInfoRef.current = null;
          connectedRef.current = false;
          deliveryEpochRef.current = null;
          setBackendSessionId(null);
          setSessionInfo(null);
          setIsConnected(false);
          updateSession({
            backendSessionId: undefined,
            status: "connecting",
            errorMessage: undefined,
          });
        }

        abortConnectAdmission();
        const admissionAbort = new AbortController();
        connectAdmissionAbortRef.current = admissionAbort;
        try {
          let lease;
          try {
            lease = await vncConnectAdmission.acquire(admissionAbort.signal);
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === "AbortError" &&
              admissionAbort.signal.aborted &&
              !isCurrent()
            ) {
              return;
            }
            throw error;
          }
          try {
            if (!isCurrent()) return;
            const connectedSessionId = await invoke<string>("connect_vnc", {
              host: currentConnection.hostname || currentSession.hostname,
              port: currentConnection.port || 5900,
              password: currentConnection.password || null,
              username: currentConnection.username || null,
              label: currentConnection.name || null,
              shared: settingsRef.current.sharedMode,
              viewOnly: settingsRef.current.viewOnly,
              allowUnencryptedTransport:
                currentConnection.vncAllowUnencryptedTransport === true,
              allowWeakAuthentication:
                currentConnection.vncAllowWeakAuthentication === true,
              allowUnauthenticated:
                currentConnection.vncAllowUnauthenticated === true,
            });
            if (!connectedSessionId) {
              throw new Error("The VNC backend returned no session ID.");
            }
            newlyCreatedSessionId = connectedSessionId;
          } finally {
            lease.release();
          }
        } finally {
          if (connectAdmissionAbortRef.current === admissionAbort) {
            connectAdmissionAbortRef.current = null;
          }
        }
        const sessionId = newlyCreatedSessionId;
        if (!sessionId) {
          throw new Error("The VNC backend returned no session ID.");
        }
        if (!isCurrent()) {
          await requestBackendDisconnect(sessionId).catch(() => undefined);
          return;
        }
        disconnectedBackendsRef.current.delete(sessionId);
        backendRef.current = sessionId;
        backendOwnerRef.current = currentSession.id;
        activityGenerationRef.current = 0;
        deliveryEpochRef.current = null;
        const info = await invoke<NativeVncSession>("get_vnc_session_info", {
          sessionId,
        });
        if (!isCurrent()) {
          await requestBackendDisconnect(sessionId).catch(() => undefined);
          return;
        }
        if (markConnected(info, lifecycleGeneration)) {
          publishActivityIntent(effectiveRenderActiveRef.current, true);
        }
      } catch (error) {
        if (newlyCreatedSessionId !== null) {
          if (backendRef.current === newlyCreatedSessionId) {
            backendRef.current = null;
            backendOwnerRef.current = null;
            sessionInfoRef.current = null;
            connectedRef.current = false;
          }
          await requestBackendDisconnect(newlyCreatedSessionId).catch(
            () => undefined,
          );
        }
        if (isCurrent()) markError(error);
      }
    },
    [
      abortConnectAdmission,
      markConnected,
      markError,
      publishActivityIntent,
      releasePressedInput,
      requestBackendDisconnect,
      updateSession,
    ],
  );

  useEffect(() => {
    const updateVisibility = () => {
      if (mountedRef.current) {
        setDocumentVisible(document.visibilityState !== "hidden");
      }
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useLayoutEffect(() => {
    publishActivityIntent(effectiveRenderActive);
  }, [effectiveRenderActive, publishActivityIntent]);

  useEffect(() => {
    mountedRef.current = true;
    cleanupGenerationRef.current += 1;
    return () => {
      mountedRef.current = false;
      const cleanupGeneration = ++cleanupGenerationRef.current;
      lifecycleGenerationRef.current += 1;
      activityIntentRevisionRef.current += 1;
      abortConnectAdmission();
      abortActivityAdmission();
      deliveryEpochRef.current = null;
      connectedRef.current = false;
      stopPolling();
      queueMicrotask(() => {
        if (
          mountedRef.current ||
          cleanupGenerationRef.current !== cleanupGeneration
        ) {
          return;
        }
        const sessionId = backendRef.current;
        backendRef.current = null;
        backendOwnerRef.current = null;
        sessionInfoRef.current = null;
        if (sessionId) {
          void (async () => {
            await releasePressedInput(sessionId).catch(() => undefined);
            await requestBackendDisconnect(sessionId).catch(() => undefined);
          })();
        } else {
          clearTrackedInput();
        }
      });
    };
  }, [
    abortActivityAdmission,
    abortConnectAdmission,
    clearTrackedInput,
    releasePressedInput,
    requestBackendDisconnect,
    stopPolling,
  ]);

  useEffect(() => {
    const lifecycleGeneration = ++lifecycleGenerationRef.current;
    void initialize(lifecycleGeneration);
    return () => {
      if (lifecycleGenerationRef.current === lifecycleGeneration) {
        lifecycleGenerationRef.current += 1;
      }
      activityIntentRevisionRef.current += 1;
      abortConnectAdmission();
      abortActivityAdmission();
      deliveryEpochRef.current = null;
      connectedRef.current = false;
      stopPolling();
    };
  }, [
    abortActivityAdmission,
    abortConnectAdmission,
    initialize,
    reconnectGeneration,
    session.id,
    stopPolling,
  ]);

  const canSendInteraction = useCallback((sessionId?: string) => {
    const currentSessionId = backendRef.current;
    return (
      mountedRef.current &&
      connectedRef.current &&
      effectiveRenderActiveRef.current &&
      deliveryEpochRef.current !== null &&
      currentSessionId !== null &&
      (sessionId === undefined || currentSessionId === sessionId)
    );
  }, []);

  const canSendInput = useCallback(
    (sessionId?: string) =>
      !settingsRef.current.viewOnly && canSendInteraction(sessionId),
    [canSendInteraction],
  );

  const closeAfterCurrentInputError = useCallback(
    async (lifecycleGeneration: number, sessionId: string, error: unknown) => {
      if (
        mountedRef.current &&
        lifecycleGenerationRef.current === lifecycleGeneration &&
        backendRef.current === sessionId
      ) {
        await failAndClose(lifecycleGeneration, sessionId, error);
      }
    },
    [failAndClose],
  );

  const releaseCurrentInput = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) {
      clearTrackedInput();
      return;
    }
    const lifecycleGeneration = lifecycleGenerationRef.current;
    try {
      await releasePressedInput(sessionId);
    } catch (error) {
      await closeAfterCurrentInputError(lifecycleGeneration, sessionId, error);
    }
  }, [clearTrackedInput, closeAfterCurrentInputError, releasePressedInput]);

  useLayoutEffect(() => {
    if (settings.viewOnly) void releaseCurrentInput();
  }, [releaseCurrentInput, settings.viewOnly]);

  useEffect(() => {
    if (!isConnected) return;
    const releaseOnFocusLoss = () => {
      void releaseCurrentInput();
    };
    const canvas = canvasRef.current;
    canvas?.addEventListener("blur", releaseOnFocusLoss);
    window.addEventListener("blur", releaseOnFocusLoss);
    return () => {
      canvas?.removeEventListener("blur", releaseOnFocusLoss);
      window.removeEventListener("blur", releaseOnFocusLoss);
    };
  }, [isConnected, releaseCurrentInput]);

  const sendKey = useCallback(
    (down: boolean, key: number): Promise<void> => {
      const sessionId = backendRef.current;
      if (!sessionId || !canSendInput(sessionId)) {
        return Promise.resolve();
      }
      const lifecycleGeneration = lifecycleGenerationRef.current;
      return enqueueInputOperation(async () => {
        if (!canSendInput(sessionId)) return;
        if (down) pressedKeysymsRef.current.add(key);
        await invoke("send_vnc_key_event", { sessionId, down, key });
        if (!down) pressedKeysymsRef.current.delete(key);
      }).catch(async (error) => {
        await closeAfterCurrentInputError(
          lifecycleGeneration,
          sessionId,
          error,
        );
      });
    },
    [canSendInput, closeAfterCurrentInputError, enqueueInputOperation],
  );

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (settings.viewOnly) return;
    const canvas = canvasRef.current;
    const sessionId = backendRef.current;
    if (!canvas || !sessionId || !canSendInput(sessionId)) return;
    const rect = canvas.getBoundingClientRect();
    const token = ++pointerSequenceRef.current;
    const lifecycleGeneration = lifecycleGenerationRef.current;
    dispatchVncPointerClick({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      objectFitContain: true,
      sendPointerEvent: (x, y, buttonMask) => {
        if (buttonMask === 0) {
          void releasePressedPointer(sessionId, token).catch((error) =>
            closeAfterCurrentInputError(lifecycleGeneration, sessionId, error),
          );
          return;
        }
        void enqueueInputOperation(async () => {
          if (!canSendInput(sessionId)) return;
          const previous = pressedPointerRef.current;
          if (previous) {
            clearPointerReleaseTimer(previous.token);
            try {
              await invoke("send_vnc_pointer_event", {
                sessionId: previous.sessionId,
                buttonMask: 0,
                x: previous.x,
                y: previous.y,
              });
            } finally {
              if (pressedPointerRef.current?.token === previous.token) {
                pressedPointerRef.current = null;
              }
            }
          }
          if (!canSendInput(sessionId)) return;
          pressedPointerRef.current = { sessionId, x, y, token };
          await invoke("send_vnc_pointer_event", {
            sessionId,
            buttonMask,
            x,
            y,
          });
        }).catch((error) =>
          closeAfterCurrentInputError(lifecycleGeneration, sessionId, error),
        );
      },
      scheduleRelease: (callback, delayMs) => {
        const timer = window.setTimeout(() => {
          pointerReleaseTimersRef.current.delete(token);
          callback();
        }, delayMs);
        pointerReleaseTimersRef.current.set(token, timer);
        return timer;
      },
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (settings.viewOnly || !canSendInput()) return;
    const key = keyToKeysym(event);
    if (key === null) return;
    event.preventDefault();
    void sendKey(true, key);
  };

  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (settings.viewOnly || !canSendInput()) return;
    const key = keyToKeysym(event);
    if (key === null) return;
    event.preventDefault();
    void sendKey(false, key);
  };

  const sendCtrlAltDel = useCallback((): Promise<void> => {
    const sessionId = backendRef.current;
    if (
      !sessionId ||
      settingsRef.current.viewOnly ||
      !canSendInput(sessionId)
    ) {
      return Promise.resolve();
    }

    const lifecycleGeneration = lifecycleGenerationRef.current;
    return enqueueInputOperation(async () => {
      if (!canSendInput(sessionId)) return;
      const chord = [0xffe3, 0xffe9, 0xffff];
      let firstError: unknown;
      try {
        for (const key of chord) {
          if (!canSendInput(sessionId)) break;
          pressedKeysymsRef.current.add(key);
          try {
            await invoke("send_vnc_key_event", {
              sessionId,
              down: true,
              key,
            });
          } catch (error) {
            firstError ??= error;
            break;
          }
        }
      } finally {
        for (const key of [...chord].reverse()) {
          if (!pressedKeysymsRef.current.has(key)) continue;
          try {
            await invoke("send_vnc_key_event", {
              sessionId,
              down: false,
              key,
            });
          } catch (error) {
            firstError ??= error;
          } finally {
            pressedKeysymsRef.current.delete(key);
          }
        }
      }
      if (firstError !== undefined) throw firstError;
    }).catch(async (error) => {
      await closeAfterCurrentInputError(lifecycleGeneration, sessionId, error);
    });
  }, [canSendInput, closeAfterCurrentInputError, enqueueInputOperation]);

  const sendClipboardFromSystem = useCallback(async () => {
    const sessionId = backendRef.current;
    if (
      !sessionId ||
      settingsRef.current.viewOnly ||
      !canSendInput(sessionId)
    ) {
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!canSendInput(sessionId)) return;
      if (
        text.length > MAX_CLIPBOARD_BYTES ||
        new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES
      ) {
        throw new Error("The clipboard exceeds the VNC safety limit.");
      }
      await invoke("send_vnc_clipboard", { sessionId, text });
    } catch (error) {
      if (canSendInteraction(sessionId)) markError(error);
    }
  }, [canSendInput, canSendInteraction, markError]);

  const copyRemoteClipboard = useCallback(async () => {
    if (remoteClipboard === null || !canSendInteraction()) return;
    try {
      await navigator.clipboard.writeText(remoteClipboard);
    } catch (error) {
      if (canSendInteraction()) markError(error);
    }
  }, [canSendInteraction, markError, remoteClipboard]);

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    const operationGeneration = ++lifecycleGenerationRef.current;
    activityIntentRevisionRef.current += 1;
    abortConnectAdmission();
    abortActivityAdmission();
    deliveryEpochRef.current = null;
    connectedRef.current = false;
    stopPolling();
    if (sessionId) {
      await releasePressedInput(sessionId).catch(() => undefined);
      try {
        await requestBackendDisconnect(sessionId);
      } catch (error) {
        if (
          mountedRef.current &&
          lifecycleGenerationRef.current === operationGeneration &&
          backendRef.current === sessionId
        ) {
          markError(error);
        }
        return;
      }
    } else {
      clearTrackedInput();
    }
    if (
      !mountedRef.current ||
      lifecycleGenerationRef.current !== operationGeneration ||
      (sessionId !== null && backendRef.current !== sessionId)
    ) {
      return;
    }
    backendRef.current = null;
    backendOwnerRef.current = null;
    sessionInfoRef.current = null;
    setBackendSessionId(null);
    setSessionInfo(null);
    setIsConnected(false);
    setConnectionStatus("disconnected");
    setErrorMessage(null);
    updateSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [
    abortActivityAdmission,
    abortConnectAdmission,
    markError,
    clearTrackedInput,
    releasePressedInput,
    requestBackendDisconnect,
    stopPolling,
    updateSession,
  ]);

  const reconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    const operationGeneration = ++lifecycleGenerationRef.current;
    activityIntentRevisionRef.current += 1;
    abortConnectAdmission();
    abortActivityAdmission();
    deliveryEpochRef.current = null;
    connectedRef.current = false;
    stopPolling();
    if (sessionId) {
      await releasePressedInput(sessionId).catch(() => undefined);
      try {
        await requestBackendDisconnect(sessionId);
      } catch (error) {
        if (
          mountedRef.current &&
          lifecycleGenerationRef.current === operationGeneration &&
          backendRef.current === sessionId
        ) {
          markError(error);
        }
        return;
      }
    } else {
      clearTrackedInput();
    }
    if (
      !mountedRef.current ||
      lifecycleGenerationRef.current !== operationGeneration
    ) {
      return;
    }
    backendRef.current = null;
    backendOwnerRef.current = null;
    sessionInfoRef.current = null;
    activityGenerationRef.current = 0;
    setBackendSessionId(null);
    setSessionInfo(null);
    setIsConnected(false);
    setErrorMessage(null);
    setConnectionStatus("connecting");
    updateSession({ backendSessionId: undefined, status: "connecting" });
    setReconnectGeneration((value) => value + 1);
  }, [
    abortActivityAdmission,
    abortConnectAdmission,
    markError,
    clearTrackedInput,
    releasePressedInput,
    requestBackendDisconnect,
    stopPolling,
    updateSession,
  ]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "text-green-400";
      case "connecting":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      default:
        return "text-[var(--color-textSecondary)]";
    }
  };

  const getStatusIcon = (): "connected" | "connecting" | "other" => {
    switch (connectionStatus) {
      case "connected":
        return "connected";
      case "connecting":
        return "connecting";
      default:
        return "other";
    }
  };

  return {
    session,
    canvasRef,
    backendSessionId,
    sessionInfo,
    isFullscreen,
    isConnected,
    connectionStatus,
    errorMessage,
    showSettings,
    setShowSettings,
    settings,
    setSettings,
    handleCanvasClick,
    handleKeyDown,
    handleKeyUp,
    toggleFullscreen,
    sendCtrlAltDel,
    sendClipboardFromSystem,
    copyRemoteClipboard,
    remoteClipboardAvailable: remoteClipboard !== null,
    bellCount,
    disconnect,
    reconnect,
    getStatusColor,
    getStatusIcon,
    unsafeConsentLabels,
  };
}
