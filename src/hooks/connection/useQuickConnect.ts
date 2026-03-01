import { useState, useEffect, useCallback } from "react";
import { QuickConnectHistoryEntry } from "../../types/settings";

export interface UseQuickConnectOptions {
  isOpen: boolean;
  onClose: () => void;
  historyEnabled: boolean;
  history: QuickConnectHistoryEntry[];
  onClearHistory: () => void;
  onConnect: (payload: {
    hostname: string;
    protocol: string;
    username?: string;
    password?: string;
    domain?: string;
    authType?: "password" | "key";
    privateKey?: string;
    passphrase?: string;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    httpVerifySsl?: boolean;
  }) => void;
}

export function useQuickConnect({
  isOpen,
  onClose,
  historyEnabled,
  history,
  onClearHistory,
  onConnect,
}: UseQuickConnectOptions) {
  const [hostname, setHostname] = useState("");
  const [protocol, setProtocol] = useState("rdp");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [basicAuthUsername, setBasicAuthUsername] = useState("");
  const [basicAuthPassword, setBasicAuthPassword] = useState("");
  const [httpVerifySsl, setHttpVerifySsl] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const isSsh = protocol === "ssh";
  const isRdp = protocol === "rdp";
  const isVnc = protocol === "vnc";
  const isHttp = protocol === "http" || protocol === "https";
  const isHttps = protocol === "https";
  const isTelnet = protocol === "telnet";
  const historyItems = historyEnabled ? history : [];

  const resetFields = useCallback(() => {
    setHostname("");
    setUsername("");
    setPassword("");
    setDomain("");
    setPrivateKey("");
    setPassphrase("");
    setBasicAuthUsername("");
    setBasicAuthPassword("");
    setHttpVerifySsl(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!hostname.trim()) return;

      if (isSsh) {
        if (!username.trim()) return;
        if (authType === "password" && !password) return;
        if (authType === "key" && !privateKey.trim()) return;
      }

      const payload: Parameters<typeof onConnect>[0] = {
        hostname: hostname.trim(),
        protocol,
      };

      if (isSsh) {
        payload.username = username.trim();
        payload.authType = authType;
        if (authType === "password") {
          payload.password = password;
        } else {
          payload.privateKey = privateKey.trim();
          payload.passphrase = passphrase || undefined;
        }
      } else if (isRdp) {
        if (username.trim()) payload.username = username.trim();
        if (password) payload.password = password;
        if (domain.trim()) payload.domain = domain.trim();
      } else if (isVnc) {
        if (password) payload.password = password;
      } else if (isHttp) {
        if (basicAuthUsername.trim())
          payload.basicAuthUsername = basicAuthUsername.trim();
        if (basicAuthPassword)
          payload.basicAuthPassword = basicAuthPassword;
        if (isHttps) payload.httpVerifySsl = httpVerifySsl;
      } else if (isTelnet) {
        if (username.trim()) payload.username = username.trim();
        if (password) payload.password = password;
      }

      onConnect(payload);
      resetFields();
      onClose();
    },
    [
      hostname,
      protocol,
      username,
      password,
      domain,
      authType,
      privateKey,
      passphrase,
      basicAuthUsername,
      basicAuthPassword,
      httpVerifySsl,
      isSsh,
      isRdp,
      isVnc,
      isHttp,
      isHttps,
      isTelnet,
      onConnect,
      onClose,
      resetFields,
    ],
  );

  const handleHistorySelect = useCallback(
    (entry: QuickConnectHistoryEntry) => {
      setHostname(entry.hostname);
      setProtocol(entry.protocol);
      setUsername(entry.username ?? "");
      setAuthType(entry.authType ?? "password");
      setPassword("");
      setPrivateKey("");
      setPassphrase("");
      setShowHistory(false);
    },
    [],
  );

  return {
    hostname,
    setHostname,
    protocol,
    setProtocol,
    username,
    setUsername,
    password,
    setPassword,
    domain,
    setDomain,
    authType,
    setAuthType,
    privateKey,
    setPrivateKey,
    passphrase,
    setPassphrase,
    basicAuthUsername,
    setBasicAuthUsername,
    basicAuthPassword,
    setBasicAuthPassword,
    httpVerifySsl,
    setHttpVerifySsl,
    showHistory,
    setShowHistory,
    isSsh,
    isRdp,
    isVnc,
    isHttp,
    isHttps,
    isTelnet,
    historyItems,
    historyEnabled,
    onClearHistory,
    handleSubmit,
    handleHistorySelect,
  };
}
