import { useCallback, useMemo } from "react";
import { Connection } from "../types/connection";
import { SSHConnectionConfig, defaultSSHConnectionConfig } from "../types/settings";
import { useSettings } from "../contexts/SettingsContext";

/* ═══════════════════════════════════════════════════════════════
   Constants — cipher/algorithm option lists
   ═══════════════════════════════════════════════════════════════ */

export const CIPHER_OPTIONS = [
  "aes256-gcm@openssh.com",
  "chacha20-poly1305@openssh.com",
  "aes256-ctr",
  "aes192-ctr",
  "aes128-ctr",
  "aes256-cbc",
  "aes192-cbc",
  "aes128-cbc",
  "3des-cbc",
];

export const MAC_OPTIONS = [
  "hmac-sha2-512-etm@openssh.com",
  "hmac-sha2-256-etm@openssh.com",
  "hmac-sha2-512",
  "hmac-sha2-256",
  "hmac-sha1",
  "hmac-md5",
];

export const KEX_OPTIONS = [
  "curve25519-sha256",
  "curve25519-sha256@libssh.org",
  "ecdh-sha2-nistp521",
  "ecdh-sha2-nistp384",
  "ecdh-sha2-nistp256",
  "diffie-hellman-group18-sha512",
  "diffie-hellman-group16-sha512",
  "diffie-hellman-group14-sha256",
  "diffie-hellman-group14-sha1",
  "diffie-hellman-group-exchange-sha256",
];

export const HOST_KEY_OPTIONS = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp521",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp256",
  "rsa-sha2-512",
  "rsa-sha2-256",
  "ssh-rsa",
  "ssh-dss",
];

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

type OverrideKey = keyof SSHConnectionConfig;

export function useSSHOverrides(
  formData: Partial<Connection>,
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>,
) {
  const { settings } = useSettings();

  const globalConfig: SSHConnectionConfig = useMemo(
    () =>
      (settings as Record<string, unknown>).sshConnection as SSHConnectionConfig ??
      defaultSSHConnectionConfig,
    [settings],
  );

  const overrides = useMemo(
    () => formData.sshConnectionConfigOverride || {},
    [formData.sshConnectionConfigOverride],
  );
  const hasOverrides = Object.keys(overrides).length > 0;
  const overrideCount = Object.keys(overrides).length;

  const updateOverride = useCallback(
    <K extends OverrideKey>(
      key: K,
      value: SSHConnectionConfig[K] | undefined,
    ) => {
      setFormData((prev) => {
        const cur = prev.sshConnectionConfigOverride || {};
        if (value === undefined) {
          const { [key]: _, ...rest } = cur;
          return {
            ...prev,
            sshConnectionConfigOverride:
              Object.keys(rest).length > 0 ? rest : undefined,
          };
        }
        return {
          ...prev,
          sshConnectionConfigOverride: { ...cur, [key]: value },
        };
      });
    },
    [setFormData],
  );

  const clearAllOverrides = useCallback(() => {
    setFormData((prev) => ({
      ...prev,
      sshConnectionConfigOverride: undefined,
    }));
  }, [setFormData]);

  const isOverridden = useCallback(
    (key: OverrideKey) => key in overrides,
    [overrides],
  );

  const getValue = useCallback(
    <K extends OverrideKey>(key: K): SSHConnectionConfig[K] =>
      (overrides[key] as SSHConnectionConfig[K]) ?? globalConfig[key],
    [overrides, globalConfig],
  );

  return {
    globalConfig,
    overrides,
    hasOverrides,
    overrideCount,
    updateOverride,
    clearAllOverrides,
    isOverridden,
    getValue,
  };
}

export type SSHOverridesMgr = ReturnType<typeof useSSHOverrides>;
