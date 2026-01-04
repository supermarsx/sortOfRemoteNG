"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { Connection, ConnectionSession } from "../../src/types/connection";
import { SessionViewer } from "../../src/components/SessionViewer";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Monitor, Pin, Square, X } from "lucide-react";

const reviveSession = (session: ConnectionSession): ConnectionSession => ({
  ...session,
  startTime: new Date(session.startTime),
  lastActivity: session.lastActivity ? new Date(session.lastActivity) : undefined,
});

const reviveConnection = (connection: Connection): Connection => ({
  ...connection,
  createdAt: connection.createdAt ? new Date(connection.createdAt) : new Date(),
  updatedAt: connection.updatedAt ? new Date(connection.updatedAt) : new Date(),
  lastConnected: connection.lastConnected ? new Date(connection.lastConnected) : undefined,
});

const DetachedSessionContent: React.FC = () => {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const { state, dispatch } = useConnections();
  const [error, setError] = useState("");
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const isTauri =
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing detached session id.");
      return;
    }

    try {
      const raw = localStorage.getItem(`detached-session-${sessionId}`);
      if (!raw) {
        setError("Detached session data not found.");
        return;
      }

      const payload = JSON.parse(raw) as {
        session: ConnectionSession;
        connection?: Connection | null;
      };

      if (!payload.session) {
        setError("Detached session payload is invalid.");
        return;
      }

      const revivedSession = reviveSession(payload.session);
      const revivedConnection = payload.connection ? reviveConnection(payload.connection) : null;

      if (revivedConnection) {
        dispatch({ type: "SET_CONNECTIONS", payload: [revivedConnection] });
      }

      if (!state.sessions.some((session) => session.id === revivedSession.id)) {
        dispatch({ type: "ADD_SESSION", payload: revivedSession });
      } else {
        dispatch({ type: "UPDATE_SESSION", payload: revivedSession });
      }
    } catch (err) {
      console.error("Failed to load detached session:", err);
      setError("Unable to load detached session data.");
    }
  }, [dispatch, sessionId, state.sessions]);

  useEffect(() => {
    if (!isTauri) return;
    const currentWindow = getCurrentWindow();
    currentWindow
      .isAlwaysOnTop()
      .then(setIsAlwaysOnTop)
      .catch(() => undefined);
  }, [isTauri]);

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === sessionId),
    [state.sessions, sessionId],
  );

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-200">
        <div className="text-center">
          <Monitor className="mx-auto mb-4 h-10 w-10 text-red-400" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-200">
        <div className="text-center">
          <Monitor className="mx-auto mb-4 h-10 w-10 text-blue-400" />
          <p className="text-sm">Loading detached session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-900 flex flex-col">
      <div
        className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-3 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-blue-400" />
          <div className="text-xs text-gray-200 truncate max-w-[60vw]">
            {activeSession.name || "Detached Session"}
          </div>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              const nextValue = !isAlwaysOnTop;
              await currentWindow.setAlwaysOnTop(nextValue);
              setIsAlwaysOnTop(nextValue);
            }}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={isAlwaysOnTop ? "Unpin window" : "Pin window"}
          >
            <Pin size={12} className={isAlwaysOnTop ? "rotate-45 text-blue-400" : ""} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              await currentWindow.minimize();
            }}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              await currentWindow.toggleMaximize();
            }}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            onClick={async () => {
              if (!isTauri) return;
              const currentWindow = getCurrentWindow();
              await currentWindow.close();
            }}
            className="p-1.5 hover:bg-red-600 rounded transition-colors text-gray-400 hover:text-white"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <SessionViewer session={activeSession} />
      </div>
    </div>
  );
};

const DetachedClient: React.FC = () => (
  <ConnectionProvider>
    <DetachedSessionContent />
  </ConnectionProvider>
);

export default DetachedClient;
