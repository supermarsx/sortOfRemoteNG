import { Channel, invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  normalizeArdSettings,
  type ArdFrameMetadata,
  type ArdFrontendStatus,
  type ArdInputAction,
  type ArdRuntimeCapabilities,
  type ArdSessionInfo,
  type ArdSessionStats,
  type ArdSettings,
  type ArdStatusEvent,
} from "../../types/protocols/ard";
import { sanitizeBehaviorText } from "../../utils/behavior/template";
import {
  ArdFrameAssembler,
  ardUnsupportedNetworkPath,
  type ArdBinaryPayload,
  type ArdDeliveredFrame,
} from "./ardRuntime";

export interface ArdClientModel {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: ArdFrontendStatus | "nativeHandoff";
  error: string | null;
  message: string | null;
  backendSessionId: string | null;
  settings: ArdSettings;
  capabilities: ArdRuntimeCapabilities | null;
  stats: ArdSessionStats | null;
  desktopWidth: number;
  desktopHeight: number;
  sendInput(action: ArdInputAction): Promise<void>;
  setClipboard(text: string): Promise<void>;
  setCurtainMode(enabled: boolean): Promise<void>;
  disconnect(): Promise<void>;
  launchNativeScreenSharing(): Promise<void>;
}

const resizeCanvasPreservingContents = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) => {
  if (width <= canvas.width && height <= canvas.height) return;
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
  canvas.width = Math.max(width, canvas.width);
  canvas.height = Math.max(height, canvas.height);
  canvas.getContext("2d")?.drawImage(snapshot, 0, 0);
};

const safeError = (value: unknown): string =>
  sanitizeBehaviorText(value instanceof Error ? value.message : String(value));

export function useArdClient(session: ConnectionSession): ArdClientModel {
  const { state, dispatch } = useConnections();
  const connection = state.connections.find(
    (candidate) => candidate.id === session.connectionId,
  );
  const settings = useMemo(
    () => normalizeArdSettings(connection?.ardSettings),
    [connection?.ardSettings],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<ArdClientModel["status"]>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backendSessionId, setBackendSessionId] = useState<string | null>(
    session.backendSessionId ?? null,
  );
  const [capabilities, setCapabilities] =
    useState<ArdRuntimeCapabilities | null>(null);
  const [stats, setStats] = useState<ArdSessionStats | null>(null);
  const [desktopSize, setDesktopSize] = useState({ width: 0, height: 0 });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const backendRef = useRef(session.backendSessionId ?? null);
  const nativeHandoffStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const preserveOnUnmountRef = useRef(false);

  const updateFrontendSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const applyFrame = useCallback(
    ({ metadata, data }: ArdDeliveredFrame) => {
      if (!mountedRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      if (metadata.kind.type === "desktopSize") {
        resizeCanvasPreservingContents(canvas, metadata.width, metadata.height);
        setDesktopSize({ width: metadata.width, height: metadata.height });
        return;
      }

      if (metadata.kind.type === "copyRect") {
        resizeCanvasPreservingContents(
          canvas,
          metadata.x + metadata.width,
          metadata.y + metadata.height,
        );
        const copy = context.getImageData(
          metadata.kind.sourceX,
          metadata.kind.sourceY,
          metadata.width,
          metadata.height,
        );
        context.putImageData(copy, metadata.x, metadata.y);
        return;
      }

      const expectedLength = metadata.width * metadata.height * 4;
      if (data.byteLength !== expectedLength) {
        setError(
          `ARD framebuffer rectangle #${metadata.sequence} contained ${data.byteLength} bytes; expected ${expectedLength}.`,
        );
        return;
      }

      const rgba = new Uint8ClampedArray(data.byteLength);
      rgba.set(data);
      const pixels = new ImageData(rgba, metadata.width, metadata.height);
      if (metadata.kind.type === "cursor") {
        if (!settings.localCursor) return;
        const cursor = document.createElement("canvas");
        cursor.width = metadata.width;
        cursor.height = metadata.height;
        cursor.getContext("2d")?.putImageData(pixels, 0, 0);
        canvas.style.cursor = `url(${cursor.toDataURL("image/png")}) ${metadata.x} ${metadata.y}, default`;
        return;
      }

      resizeCanvasPreservingContents(
        canvas,
        metadata.x + metadata.width,
        metadata.y + metadata.height,
      );
      canvas.getContext("2d")?.putImageData(pixels, metadata.x, metadata.y);
      setDesktopSize((current) => ({
        width: Math.max(current.width, metadata.x + metadata.width),
        height: Math.max(current.height, metadata.y + metadata.height),
      }));
    },
    [settings.localCursor],
  );

  const assembler = useMemo(
    () => new ArdFrameAssembler(applyFrame),
    [applyFrame],
  );

  const handleStatus = useCallback(
    (event: ArdStatusEvent) => {
      if (!mountedRef.current) return;
      setMessage(event.message ?? null);
      if (event.status === "desktop_resize" && event.message) {
        const match = /^(\d+)x(\d+)$/.exec(event.message);
        if (match) {
          const width = Number(match[1]);
          const height = Number(match[2]);
          const canvas = canvasRef.current;
          if (canvas) resizeCanvasPreservingContents(canvas, width, height);
          setDesktopSize({ width, height });
        }
        return;
      }
      if (event.status === "connected") {
        setStatus("connected");
        setError(null);
        updateFrontendSession({
          backendSessionId: event.sessionId,
          status: "connected",
          errorMessage: undefined,
        });
      } else if (event.status === "authenticated") {
        setStatus("authenticated");
      } else if (event.status === "reconnecting") {
        setStatus("reconnecting");
      } else if (event.status === "disconnected") {
        setStatus("disconnected");
        updateFrontendSession({ status: "disconnected" });
      } else if (event.status === "error") {
        const detail = sanitizeBehaviorText(
          event.message ?? "ARD session failed",
        );
        setStatus("error");
        setError(detail);
        updateFrontendSession({ status: "error", errorMessage: detail });
      }
    },
    [updateFrontendSession],
  );

  const launchNativeScreenSharing = useCallback(async () => {
    if (!nativeHandoffStartedRef.current) {
      nativeHandoffStartedRef.current = true;
      try {
        await invoke("launch_apple_account_screen_sharing");
      } catch (cause) {
        nativeHandoffStartedRef.current = false;
        throw cause;
      }
    }
    if (!mountedRef.current) return;
    setStatus("nativeHandoff");
    setMessage(
      "Apple Screen Sharing opened. Complete Apple Account selection and approval in macOS; SortOfRemoteNG never receives that password.",
    );
    updateFrontendSession({ status: "connected", errorMessage: undefined });
  }, [updateFrontendSession]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const runtimeCapabilities = await invoke<ArdRuntimeCapabilities>(
          "get_ard_runtime_capabilities",
        );
        if (cancelled || !mountedRef.current) return;
        setCapabilities(runtimeCapabilities);
        if (!connection)
          throw new Error("ARD connection settings are unavailable.");
        if (settings.authMode === "appleAccountNative") {
          await launchNativeScreenSharing();
          return;
        }
        const routeError = ardUnsupportedNetworkPath(connection);
        if (routeError) throw new Error(routeError);

        const frameDataChannel = new Channel<ArdBinaryPayload>((data) =>
          assembler.acceptData(data),
        );
        const frameMetadataChannel = new Channel<ArdFrameMetadata>((metadata) =>
          assembler.acceptMetadata(metadata),
        );
        const statusChannel = new Channel<ArdStatusEvent>(handleStatus);
        const id = await invoke<string>("connect_ard", {
          host: session.hostname,
          port: connection.port || 5900,
          username: connection.username ?? "",
          password: connection.password ?? "",
          connectionId: connection.id,
          authenticationMode: settings.authMode,
          autoReconnect: settings.autoReconnect,
          curtainOnConnect: settings.curtainOnConnect,
          localCursor: settings.localCursor,
          frameDataChannel,
          frameMetadataChannel,
          statusChannel,
        });
        if (cancelled) {
          await invoke("disconnect_ard", { sessionId: id }).catch(
            () => undefined,
          );
          return;
        }
        backendRef.current = id;
        setBackendSessionId(id);
        updateFrontendSession({ backendSessionId: id });
      } catch (cause) {
        if (cancelled || !mountedRef.current) return;
        const detail = safeError(cause);
        setStatus("error");
        setError(detail);
        updateFrontendSession({ status: "error", errorMessage: detail });
      }
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [
    assembler,
    connection,
    handleStatus,
    launchNativeScreenSharing,
    session.hostname,
    settings,
    updateFrontendSession,
  ]);

  useEffect(() => {
    if (!backendSessionId || status !== "connected") return;
    const refresh = () => {
      void invoke<ArdSessionStats>("get_ard_stats", {
        sessionId: backendSessionId,
      })
        .then((snapshot) => mountedRef.current && setStats(snapshot))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [backendSessionId, status]);

  const disconnect = useCallback(async () => {
    const id = backendRef.current;
    if (id) await invoke("disconnect_ard", { sessionId: id });
    backendRef.current = null;
    setBackendSessionId(null);
    setStatus("disconnected");
    updateFrontendSession({
      backendSessionId: undefined,
      status: "disconnected",
      errorMessage: undefined,
    });
  }, [updateFrontendSession]);

  const sendInput = useCallback(
    async (action: ArdInputAction) => {
      const id = backendRef.current;
      if (!id || status !== "connected" || settings.viewOnly) return;
      await invoke("send_ard_input", { sessionId: id, action });
    },
    [settings.viewOnly, status],
  );

  const setClipboard = useCallback(async (text: string) => {
    const id = backendRef.current;
    if (!id) throw new Error("ARD session is not connected.");
    await invoke("set_ard_clipboard", { sessionId: id, text });
  }, []);

  const setCurtainMode = useCallback(async (enabled: boolean) => {
    const id = backendRef.current;
    if (!id) throw new Error("ARD session is not connected.");
    await invoke("set_ard_curtain_mode", { sessionId: id, enabled });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const preserveForDetach = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId === sessionRef.current.id) {
        preserveOnUnmountRef.current = true;
      }
    };
    window.addEventListener("sorng:session-will-detach", preserveForDetach);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(
        "sorng:session-will-detach",
        preserveForDetach,
      );
      assembler.clear();
      if (!preserveOnUnmountRef.current && backendRef.current) {
        void invoke("disconnect_ard", { sessionId: backendRef.current }).catch(
          () => undefined,
        );
      }
    };
  }, [assembler]);

  return {
    canvasRef,
    status,
    error,
    message,
    backendSessionId,
    settings,
    capabilities,
    stats,
    desktopWidth: desktopSize.width,
    desktopHeight: desktopSize.height,
    sendInput,
    setClipboard,
    setCurtainMode,
    disconnect,
    launchNativeScreenSharing,
  };
}
