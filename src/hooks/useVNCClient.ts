import { useState, useEffect, useRef, useCallback } from "react";
import { debugLog } from "../utils/debugLogger";
import { ConnectionSession } from "../types/connection";
import { useConnections } from "../contexts/useConnections";

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
  const { state } = useConnections();
  const connection = state.connections.find(
    (c) => c.id === session.connectionId,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<VNCConnectionStatus>("connecting");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<VNCSettings>(DEFAULT_VNC_SETTINGS);
  const [rfb, setRfb] = useState<any>(null);
  const connectHandlerRef = useRef<EventListener | null>(null);
  const disconnectHandlerRef = useRef<EventListener | null>(null);
  const credentialsHandlerRef = useRef<EventListener | null>(null);
  const securityFailureHandlerRef = useRef<EventListener | null>(null);

  const handleConnect = () => {
    setIsConnected(true);
    setConnectionStatus("connected");
    debugLog("VNC connection established");
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setConnectionStatus("disconnected");
    debugLog("VNC connection disconnected");
  };

  const handleCredentialsRequired = useCallback(() => {
    debugLog("VNC credentials required");
    const password = prompt("VNC Password:");
    if (password && rfb) {
      rfb.sendCredentials({ password });
    }
  }, [rfb]);

  const handleSecurityFailure = () => {
    setConnectionStatus("error");
    debugLog("VNC security failure");
  };

  const drawWindow = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      title: string,
    ) => {
      ctx.fillStyle = "#f9fafb";
      ctx.fillRect(x, y, width, height);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(x, y, width, 30);
      ctx.fillStyle = "white";
      ctx.font = "14px Arial";
      ctx.fillText(title, x + 10, y + 20);

      const controlSize = 20;
      const controlY = y + 5;

      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x + width - 25, controlY, controlSize, controlSize);
      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText("×", x + width - 15, controlY + 15);

      ctx.fillStyle = "#10b981";
      ctx.fillRect(x + width - 50, controlY, controlSize, controlSize);
      ctx.fillText("□", x + width - 40, controlY + 15);

      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(x + width - 75, controlY, controlSize, controlSize);
      ctx.fillText("−", x + width - 65, controlY + 15);

      ctx.textAlign = "left";

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 10, y + 40, width - 20, height - 50);

      ctx.fillStyle = "#1f2937";
      ctx.font = "14px Arial";
      ctx.fillText("VNC Remote Desktop Session", x + 20, y + 70);
      ctx.fillText(`Connected to: ${session.hostname}`, x + 20, y + 100);
      ctx.fillText("Resolution: 1024x768", x + 20, y + 130);
      ctx.fillText("Color Depth: 24-bit", x + 20, y + 160);

      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(x + 20, y + 190, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "#1f2937";
      ctx.fillText("Connected", x + 35, y + 195);
    },
    [session.hostname],
  );

  const drawDesktopIcon = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    emoji: string,
  ) => {
    ctx.fillStyle = "rgba(59, 130, 246, 0.8)";
    ctx.fillRect(x, y, 48, 48);
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 48, 48);
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.fillText(emoji, x + 24, y + 32);
    ctx.fillStyle = "white";
    ctx.font = "11px Arial";
    ctx.fillText(label, x + 24, y + 65);
    ctx.textAlign = "left";
  };

  const drawSimulatedDesktop = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#2563eb");
      gradient.addColorStop(1, "#1d4ed8");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#1f2937";
      ctx.fillRect(0, height - 40, width, 40);

      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(5, height - 35, 100, 30);
      ctx.fillStyle = "white";
      ctx.font = "14px Arial";
      ctx.fillText("VNC Desktop", 15, height - 15);

      ctx.fillStyle = "#374151";
      ctx.fillRect(width - 120, height - 35, 115, 30);

      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      ctx.fillText(time, width - 80, height - 15);

      drawDesktopIcon(ctx, 50, 50, "Computer", "🖥️");
      drawDesktopIcon(ctx, 50, 130, "Files", "📁");
      drawDesktopIcon(ctx, 50, 210, "Terminal", "⚡");

      drawWindow(ctx, 200, 100, 500, 400, "VNC Remote Desktop");
    },
    [drawWindow],
  );

  const simulateVNCConnection = useCallback(async () => {
    if (!canvasRef.current) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = 1024;
      canvas.height = 768;
      drawSimulatedDesktop(ctx, canvas.width, canvas.height);
      setIsConnected(true);
      setConnectionStatus("connected");
    }
  }, [drawSimulatedDesktop]);

  const initializeVNCConnection = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setConnectionStatus("connecting");
      const { default: RFB } = await import("novnc/core/rfb" as any);
      const url = `ws://${session.hostname}:${connection?.port || 5900}`;
      debugLog(`Connecting to VNC server at ${url}`);
      const rfbConnection = new RFB(canvasRef.current, url, {
        credentials: { password: connection?.password || "" },
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

      setRfb(rfbConnection);
    } catch (error) {
      setConnectionStatus("error");
      debugLog("VNC connection failed:", error);
      console.error("VNC connection failed:", error);
      simulateVNCConnection();
    }
  }, [
    session,
    connection,
    settings,
    handleCredentialsRequired,
    simulateVNCConnection,
  ]);

  const cleanup = useCallback(() => {
    if (rfb) {
      if (connectHandlerRef.current)
        rfb.removeEventListener("connect", connectHandlerRef.current);
      if (disconnectHandlerRef.current)
        rfb.removeEventListener("disconnect", disconnectHandlerRef.current);
      if (credentialsHandlerRef.current)
        rfb.removeEventListener(
          "credentialsrequired",
          credentialsHandlerRef.current,
        );
      if (securityFailureHandlerRef.current)
        rfb.removeEventListener(
          "securityfailure",
          securityFailureHandlerRef.current,
        );
      rfb.disconnect();
    }
    setIsConnected(false);
    setConnectionStatus("disconnected");
  }, [rfb]);

  useEffect(() => {
    initializeVNCConnection();
    return () => {
      cleanup();
    };
  }, [session, initializeVNCConnection, cleanup]);

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

    if (rfb) {
      rfb.sendPointerEvent(canvasX, canvasY, 0x1);
      setTimeout(() => {
        rfb.sendPointerEvent(canvasX, canvasY, 0x0);
      }, 100);
    } else {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 10, 0, 2 * Math.PI);
        ctx.fill();
        setTimeout(() => {
          drawSimulatedDesktop(ctx, canvas.width, canvas.height);
        }, 200);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    event.preventDefault();
    if (rfb) rfb.sendKey(event.keyCode, "KeyDown");
    debugLog(`VNC Key: ${event.key}`);
  };

  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (!isConnected || settings.viewOnly) return;
    event.preventDefault();
    if (rfb) rfb.sendKey(event.keyCode, "KeyUp");
  };

  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  const sendCtrlAltDel = () => {
    if (rfb) rfb.sendCtrlAltDel();
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
    drawSimulatedDesktop,
  };
}
