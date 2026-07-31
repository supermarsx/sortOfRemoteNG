import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import { debugLog } from "../../utils/core/debugLogger";
import { dispatchVncPointerClick } from "../../utils/session/canvasCoordinates";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import { useSessionFullscreen } from "../session/useSessionFullscreen";

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

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

export function useVNCClient(session: ConnectionSession) {
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
  const generationRef = useRef(0);
  const settingsRef = useRef(DEFAULT_VNC_SETTINGS);

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

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const markError = useCallback(
    (value: unknown) => {
      const message = safeVncError(value, connectionRef.current?.password);
      setIsConnected(false);
      setConnectionStatus("error");
      setErrorMessage(message);
      updateSession({ status: "error", errorMessage: message });
      debugLog("Native VNC operation failed");
    },
    [updateSession],
  );

  const markConnected = useCallback(
    (info: NativeVncSession) => {
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
    },
    [updateSession],
  );

  const failAndClose = useCallback(
    async (generation: number, sessionId: string, value: unknown) => {
      if (
        generationRef.current !== generation ||
        backendRef.current !== sessionId
      ) {
        return;
      }
      const message = safeVncError(value, connectionRef.current?.password);
      await invoke("disconnect_vnc", { sessionId }).catch(() => undefined);
      if (generationRef.current !== generation) return;
      backendRef.current = null;
      setBackendSessionId(null);
      setSessionInfo(null);
      markError(message);
      updateSession({ backendSessionId: undefined });
    },
    [markError, updateSession],
  );

  const pollFrames = useCallback(
    async (generation: number, sessionId: string) => {
      let incremental = false;
      while (
        generationRef.current === generation &&
        backendRef.current === sessionId
      ) {
        try {
          const payload = await invoke<NativeVncPoll>("get_vnc_session_stats", {
            sessionId,
            maxEvents: 2,
          });
          if (
            generationRef.current !== generation ||
            backendRef.current !== sessionId
          ) {
            return;
          }

          const canvas = canvasRef.current;
          if (!canvas) throw new Error("The VNC canvas is unavailable.");
          resizeCanvas(
            canvas,
            payload.stats.framebuffer_width,
            payload.stats.framebuffer_height,
          );

          for (const event of payload.events) {
            if (event.kind === "frame") {
              if (event.frame.session_id !== sessionId) {
                throw new Error("A VNC frame belongs to another session.");
              }
              drawNativeFrame(canvas, event.frame);
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

          await invoke("request_vnc_update", {
            sessionId,
            incremental,
          });
          incremental = true;
          await delay(FRAME_POLL_INTERVAL_MS);
        } catch (error) {
          await failAndClose(generation, sessionId, error);
          return;
        }
      }
    },
    [failAndClose],
  );

  const initialize = useCallback(
    async (generation: number) => {
      const currentConnection = connectionRef.current;
      const currentSession = sessionRef.current;
      if (!currentConnection) {
        markError("The saved VNC connection could not be found.");
        return;
      }
      setConnectionStatus("connecting");
      setErrorMessage(null);

      let newlyCreatedSessionId: string | null = null;
      try {
        const previousId = currentSession.backendSessionId;
        if (previousId) {
          const alive = await invoke<boolean>("is_vnc_connected", {
            sessionId: previousId,
          }).catch(() => false);
          if (generationRef.current !== generation) return;
          if (alive) {
            const info = await invoke<NativeVncSession>(
              "get_vnc_session_info",
              { sessionId: previousId },
            );
            if (generationRef.current !== generation) return;
            if (canvasRef.current) {
              resizeCanvas(
                canvasRef.current,
                info.framebuffer_width,
                info.framebuffer_height,
              );
            }
            markConnected(info);
            void pollFrames(generation, previousId);
            return;
          }
        }

        const sessionId = await invoke<string>("connect_vnc", {
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
        newlyCreatedSessionId = sessionId;
        if (generationRef.current !== generation) {
          await invoke("disconnect_vnc", { sessionId }).catch(() => undefined);
          return;
        }
        backendRef.current = sessionId;
        const info = await invoke<NativeVncSession>("get_vnc_session_info", {
          sessionId,
        });
        if (generationRef.current !== generation) {
          await invoke("disconnect_vnc", { sessionId }).catch(() => undefined);
          return;
        }
        if (canvasRef.current) {
          resizeCanvas(
            canvasRef.current,
            info.framebuffer_width,
            info.framebuffer_height,
          );
        }
        markConnected(info);
        await invoke("request_vnc_update", {
          sessionId,
          incremental: false,
        });
        void pollFrames(generation, sessionId);
      } catch (error) {
        if (newlyCreatedSessionId !== null) {
          if (backendRef.current === newlyCreatedSessionId) {
            backendRef.current = null;
          }
          try {
            await invoke("disconnect_vnc", {
              sessionId: newlyCreatedSessionId,
            });
          } catch {
            // Preserve the initialization failure while still making a best-effort teardown.
          }
        }
        if (generationRef.current === generation) markError(error);
      }
    },
    [markConnected, markError, pollFrames],
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    void initialize(generation);
    return () => {
      generationRef.current += 1;
      const sessionId = backendRef.current;
      backendRef.current = null;
      if (sessionId) {
        void invoke("disconnect_vnc", { sessionId }).catch(() => undefined);
      }
    };
  }, [initialize, reconnectGeneration, session.id]);

  const sendKey = useCallback(
    async (down: boolean, key: number) => {
      const sessionId = backendRef.current;
      if (!sessionId) return;
      try {
        await invoke("send_vnc_key_event", { sessionId, down, key });
      } catch (error) {
        markError(error);
      }
    },
    [markError],
  );

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected || settings.viewOnly) return;
    const canvas = canvasRef.current;
    const sessionId = backendRef.current;
    if (!canvas || !sessionId) return;
    const rect = canvas.getBoundingClientRect();
    dispatchVncPointerClick({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      objectFitContain: true,
      sendPointerEvent: (x, y, buttonMask) => {
        void invoke("send_vnc_pointer_event", {
          sessionId,
          buttonMask,
          x,
          y,
        }).catch(markError);
      },
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    const key = keyToKeysym(event);
    if (key === null) return;
    event.preventDefault();
    void sendKey(true, key);
  };

  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    const key = keyToKeysym(event);
    if (key === null) return;
    event.preventDefault();
    void sendKey(false, key);
  };

  const sendCtrlAltDel = useCallback(async () => {
    if (settingsRef.current.viewOnly) return;
    await sendKey(true, 0xffe3);
    await sendKey(true, 0xffe9);
    await sendKey(true, 0xffff);
    await sendKey(false, 0xffff);
    await sendKey(false, 0xffe9);
    await sendKey(false, 0xffe3);
  }, [sendKey]);

  const sendClipboardFromSystem = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId || settingsRef.current.viewOnly) return;
    try {
      const text = await navigator.clipboard.readText();
      if (
        text.length > MAX_CLIPBOARD_BYTES ||
        new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES
      ) {
        throw new Error("The clipboard exceeds the VNC safety limit.");
      }
      await invoke("send_vnc_clipboard", { sessionId, text });
    } catch (error) {
      markError(error);
    }
  }, [markError]);

  const copyRemoteClipboard = useCallback(async () => {
    if (remoteClipboard === null) return;
    try {
      await navigator.clipboard.writeText(remoteClipboard);
    } catch (error) {
      markError(error);
    }
  }, [markError, remoteClipboard]);

  const disconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    if (!sessionId) return;
    generationRef.current += 1;
    try {
      await invoke("disconnect_vnc", { sessionId });
    } catch (error) {
      markError(error);
      return;
    }
    backendRef.current = null;
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
  }, [markError, updateSession]);

  const reconnect = useCallback(async () => {
    const sessionId = backendRef.current;
    generationRef.current += 1;
    if (sessionId) {
      try {
        await invoke("disconnect_vnc", { sessionId });
      } catch (error) {
        markError(error);
        return;
      }
    }
    backendRef.current = null;
    setBackendSessionId(null);
    setSessionInfo(null);
    setIsConnected(false);
    setErrorMessage(null);
    setConnectionStatus("connecting");
    updateSession({ backendSessionId: undefined, status: "connecting" });
    setReconnectGeneration((value) => value + 1);
  }, [markError, updateSession]);

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
