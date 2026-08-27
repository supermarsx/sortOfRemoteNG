import { useState, useEffect, useCallback } from "react";
import { QuickConnectHistoryEntry } from "../../types/settings/settings";
import {
  sanitizeHostname,
  schemeToProtocol,
} from "../../utils/connection/sanitizeHostname";

/** Protocols the Quick Connect picker offers (keep in sync with QuickConnect.tsx). */
export const QUICK_CONNECT_PROTOCOLS = [
  "rdp",
  "ssh",
  "vnc",
  "http",
  "https",
  "telnet",
] as const;

/**
 * Derive hostname/protocol from a pasted or typed address. A scheme is
 * evidence: `https://portal:8443/x` → hostname `portal:8443`, protocol
 * `https`. Returns the cleaned hostname and the protocol to switch to (only
 * when the scheme maps to a picker option), or `undefined` when nothing
 * changed. Pure — exported for tests.
 */
export function deriveQuickConnectTarget(
  raw: string,
  currentProtocol: string,
): { hostname: string; protocol?: string } | undefined {
  const result = sanitizeHostname(raw);
  if (!result.stripped && raw === result.hostname) return undefined;
  const schemeProtocol = schemeToProtocol(result.scheme);
  const protocol =
    schemeProtocol &&
    schemeProtocol !== currentProtocol &&
    (QUICK_CONNECT_PROTOCOLS as readonly string[]).includes(schemeProtocol)
      ? schemeProtocol
      : undefined;
  // Quick Connect has no port field; keep an explicit URL port on the
  // hostname (`host:8443`) so the session layer can pick it up.
  const hostname = result.port
    ? `${result.hostname}:${result.port}`
    : result.hostname;
  return { hostname, protocol };
}

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
        if (basicAuthPassword) payload.basicAuthPassword = basicAuthPassword;
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

  /**
   * Normalise a pasted/typed URL: strip the scheme into the protocol
   * select and keep only host[:port] in the hostname field.
   */
  const normalizeHostnameInput = useCallback(
    (raw: string) => {
      const derived = deriveQuickConnectTarget(raw, protocol);
      if (!derived) return;
      setHostname(derived.hostname);
      if (derived.protocol) setProtocol(derived.protocol);
    },
    [protocol],
  );

  const handleHistorySelect = useCallback((entry: QuickConnectHistoryEntry) => {
    setHostname(entry.hostname);
    setProtocol(entry.protocol);
    setUsername(entry.username ?? "");
    setAuthType(entry.authType ?? "password");
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
    setShowHistory(false);
  }, []);

  return {
    hostname,
    setHostname,
    normalizeHostnameInput,
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
