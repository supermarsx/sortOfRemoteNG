import { useState, useEffect, useRef, useCallback } from "react";
import { debugLog } from "../../utils/core/debugLogger";
import { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

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

export type VNCConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<VNCConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<VNCSettings>(DEFAULT_VNC_SETTINGS);
  const rfbRef = useRef<any>(null);
  const connectHandlerRef = useRef<EventListener | null>(null);
  const disconnectHandlerRef = useRef<EventListener | null>(null);
  const credentialsHandlerRef = useRef<EventListener | null>(null);
  const securityFailureHandlerRef = useRef<EventListener | null>(null);
  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const handleConnect = useCallback(() => {
    setErrorMessage(null);
    setIsConnected(true);
    setConnectionStatus("connected");
    updateSession({ status: "connected", errorMessage: undefined });
    debugLog("VNC connection established");
  }, [updateSession]);

  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    setConnectionStatus("disconnected");
    updateSession({ status: "disconnected" });
    debugLog("VNC connection disconnected");
  }, [updateSession]);

  const handleCredentialsRequired = useCallback(() => {
    debugLog("VNC credentials required");
    const password = prompt("VNC Password:");
    const activeRfb = rfbRef.current;
    if (password && activeRfb) {
      activeRfb.sendCredentials({ password });
    }
  }, []);

  const handleSecurityFailure = useCallback(() => {
    setErrorMessage("VNC security negotiation failed.");
    setConnectionStatus("error");
    updateSession({
      status: "error",
      errorMessage: "VNC security negotiation failed.",
    });
    debugLog("VNC security failure");
  }, [updateSession]);

  const initializeVNCConnection = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setConnectionStatus("connecting");
      setErrorMessage(null);
      const { default: RFB } = await import("novnc/core/rfb" as any);
      const currentSession = sessionRef.current;
      const currentConnection = connectionRef.current;
      const url = `ws://${currentSession.hostname}:${currentConnection?.port || 5900}`;
      debugLog(`Connecting to VNC server at ${url}`);
      const rfbConnection = new RFB(canvasRef.current, url, {
        credentials: { password: currentConnection?.password || "" },
      });

      connectHandlerRef.current = handleConnect.bind(null);
      rfbConnection.addEventListener("connect", connectHandlerRef.current);
      disconnectHandlerRef.current = handleDisconnect.bind(null);
      rfbConnection.addEventListener(
        "disconnect",
        disconnectHandlerRef.current,
      );
      credentialsHandlerRef.current = handleCredentialsRequired.bind(null);
      rfbConnection.addEventListener(
        "credentialsrequired",
        credentialsHandlerRef.current,
      );
      securityFailureHandlerRef.current = handleSecurityFailure.bind(null);
      rfbConnection.addEventListener(
        "securityfailure",
        securityFailureHandlerRef.current,
      );

      rfbConnection.viewOnly = settings.viewOnly;
      rfbConnection.scaleViewport = settings.scaleViewport;
      rfbConnection.clipViewport = settings.clipViewport;
      rfbConnection.dragViewport = settings.dragViewport;
      rfbConnection.resizeSession = settings.resizeSession;
      rfbConnection.showDotCursor = settings.showDotCursor;

      rfbRef.current = rfbConnection;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setIsConnected(false);
      setConnectionStatus("error");
      setErrorMessage(message);
      updateSession({ status: "error", errorMessage: message });
      debugLog("VNC connection failed:", error);
      console.error("VNC connection failed:", error);
    }
  }, [
    settings,
    handleConnect,
    handleDisconnect,
    handleCredentialsRequired,
    handleSecurityFailure,
    updateSession,
  ]);

  const cleanup = useCallback(() => {
    const activeRfb = rfbRef.current;
    if (activeRfb) {
      if (connectHandlerRef.current)
        activeRfb.removeEventListener("connect", connectHandlerRef.current);
      if (disconnectHandlerRef.current)
        activeRfb.removeEventListener(
          "disconnect",
          disconnectHandlerRef.current,
        );
      if (credentialsHandlerRef.current)
        activeRfb.removeEventListener(
          "credentialsrequired",
          credentialsHandlerRef.current,
        );
      if (securityFailureHandlerRef.current)
        activeRfb.removeEventListener(
          "securityfailure",
          securityFailureHandlerRef.current,
        );
      activeRfb.disconnect();
      rfbRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus("disconnected");
  }, []);

  useEffect(() => {
    initializeVNCConnection();
    return () => {
      cleanup();
    };
  }, [session.id, initializeVNCConnection, cleanup]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isConnected || settings.viewOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;

    debugLog(`VNC Click at: ${canvasX}, ${canvasY}`);

    const activeRfb = rfbRef.current;
    if (activeRfb) {
      activeRfb.sendPointerEvent(canvasX, canvasY, 0x1);
      setTimeout(() => {
        activeRfb.sendPointerEvent(canvasX, canvasY, 0x0);
      }, 100);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    event.preventDefault();
    const activeRfb = rfbRef.current;
    if (activeRfb) activeRfb.sendKey(event.keyCode, "KeyDown");
    debugLog(`VNC Key: ${event.key}`);
  };

  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    event.preventDefault();
    const activeRfb = rfbRef.current;
    if (activeRfb) activeRfb.sendKey(event.keyCode, "KeyUp");
  };

  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  const sendCtrlAltDel = () => {
    const activeRfb = rfbRef.current;
    if (activeRfb) activeRfb.sendCtrlAltDel();
  };

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
    getStatusColor,
    getStatusIcon,
  };
}
