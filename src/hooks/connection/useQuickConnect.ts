import { useState, useEffect, useCallback, useRef } from "react";
import { QuickConnectHistoryEntry } from "../../types/settings/settings";
import { useSettings } from "../../contexts/SettingsContext";
import {
  DEFAULT_CONNECTION_PROTOCOLS,
  normalizeDefaultConnectionProtocol,
} from "../../utils/connection/defaultConnectionProtocol";
import {
  sanitizeHostname,
  schemeToProtocol,
} from "../../utils/connection/sanitizeHostname";

/** Wire protocols Quick Connect supports; HTTP/HTTPS share one Browser type. */
export const QUICK_CONNECT_PROTOCOLS = DEFAULT_CONNECTION_PROTOCOLS;

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
  // Keep the URL authority's bracket/port syntax. Rebuilding it from the
  // sanitised hostname loses IPv6 brackets and can discard invalid ports,
  // silently selecting a different endpoint. The builder validates it later.
  const authority = result.stripped
    ? raw
        .trim()
        .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
        .split(/[/?#]/, 1)[0]
    : result.hostname;
  const hostname = result.stripped
    ? authority.slice(authority.lastIndexOf("@") + 1)
    : authority;
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
  const { settings } = useSettings();
  const defaultProtocol = normalizeDefaultConnectionProtocol(
    settings.defaultConnectionProtocol,
  );
  const [hostname, setHostname] = useState("");
  const [protocol, setProtocolState] = useState<string>(defaultProtocol);
  const explicitProtocolRef = useRef(false);
  const setProtocol = useCallback((value: string) => {
    explicitProtocolRef.current = true;
    setProtocolState(value);
  }, []);
  useEffect(() => {
    // Settings may finish loading after the dialog is mounted. Honor that
    // preference only while no address/type/history selection owns the draft.
    if (!explicitProtocolRef.current && !hostname) {
      setProtocolState(defaultProtocol);
    }
  }, [defaultProtocol, hostname]);
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
    explicitProtocolRef.current = false;
    setProtocolState(defaultProtocol);
    setHostname("");
    setUsername("");
    setPassword("");
    setDomain("");
    setPrivateKey("");
    setPassphrase("");
    setBasicAuthUsername("");
    setBasicAuthPassword("");
    setHttpVerifySsl(true);
  }, [defaultProtocol]);

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      // Enter can submit before blur/paste normalization runs. The URL scheme
      // remains authoritative, and only the resolved transport's fields apply.
      const target = deriveQuickConnectTarget(hostname, protocol);
      const targetHostname = (target?.hostname ?? hostname).trim();
      const targetProtocol = target?.protocol ?? protocol;
      if (target) {
        setHostname(targetHostname);
        if (target.protocol) setProtocol(targetProtocol);
      }
      if (!targetHostname) return;

      if (targetProtocol === "ssh") {
        if (!username.trim()) return;
        if (authType === "password" && !password) return;
        if (authType === "key" && !privateKey.trim()) return;
      }

      const payload: Parameters<typeof onConnect>[0] = {
        hostname: targetHostname,
        protocol: targetProtocol,
      };

      if (targetProtocol === "ssh") {
        payload.username = username.trim();
        payload.authType = authType;
        if (authType === "password") {
          payload.password = password;
        } else {
          payload.privateKey = privateKey.trim();
          payload.passphrase = passphrase || undefined;
        }
      } else if (targetProtocol === "rdp") {
        if (username.trim()) payload.username = username.trim();
        if (password) payload.password = password;
        if (domain.trim()) payload.domain = domain.trim();
      } else if (targetProtocol === "vnc") {
        if (password) payload.password = password;
      } else if (targetProtocol === "http" || targetProtocol === "https") {
        if (basicAuthUsername.trim())
          payload.basicAuthUsername = basicAuthUsername.trim();
        if (basicAuthPassword) payload.basicAuthPassword = basicAuthPassword;
        if (targetProtocol === "https") payload.httpVerifySsl = httpVerifySsl;
      } else if (targetProtocol === "telnet") {
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
      onConnect,
      onClose,
      resetFields,
      setProtocol,
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
    [protocol, setProtocol],
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
    [setProtocol],
  );

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
