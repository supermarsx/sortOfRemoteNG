import { useState, useRef, useEffect, useCallback } from "react";

export interface UseRDPClientHeaderOptions {
  connectionStatus: string;
  connectionName: string;
  onRenameConnection: (name: string) => void;
}

export function useRDPClientHeader({
  connectionStatus,
  connectionName,
  onRenameConnection,
}: UseRDPClientHeaderOptions) {
  const [showSendKeys, setShowSendKeys] = useState(false);
  const [showHostInfo, setShowHostInfo] = useState(false);
  const [showTotpPanel, setShowTotpPanel] = useState(false);
  const [showRebootConfirm, setShowRebootConfirm] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(connectionName);

  const sendKeysRef = useRef<HTMLDivElement>(null);
  const hostInfoRef = useRef<HTMLDivElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isConnected = connectionStatus === "connected";
  const isReconnecting = connectionStatus === "reconnecting";
  const canReconnect =
    connectionStatus === "disconnected" ||
    connectionStatus === "error" ||
    isReconnecting;
  const canDisconnect =
    connectionStatus === "connected" ||
    connectionStatus === "connecting" ||
    isReconnecting;

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const startEditing = useCallback(() => {
    setEditName(connectionName);
    setIsEditingName(true);
  }, [connectionName]);

  const confirmRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== connectionName) {
      onRenameConnection(trimmed);
    }
    setIsEditingName(false);
  }, [editName, connectionName, onRenameConnection]);

  const cancelRename = useCallback(() => {
    setEditName(connectionName);
    setIsEditingName(false);
  }, [connectionName]);

  return {
    showSendKeys,
    setShowSendKeys,
    showHostInfo,
    setShowHostInfo,
    showTotpPanel,
    setShowTotpPanel,
    showRebootConfirm,
    setShowRebootConfirm,
    isEditingName,
    editName,
    setEditName,
    sendKeysRef,
    hostInfoRef,
    totpBtnRef,
    nameInputRef,
    isConnected,
    isReconnecting,
    canReconnect,
    canDisconnect,
    startEditing,
    confirmRename,
    cancelRename,
  };
}
