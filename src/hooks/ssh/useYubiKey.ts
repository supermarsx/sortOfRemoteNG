import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  YubiKeyDevice,
  PivSlotInfo,
  PivPinStatus,
  PivSlot,
  PivAlgorithm,
  PinPolicy,
  TouchPolicy,
  ManagementKeyType,
  Fido2DeviceInfo,
  Fido2Credential,
  Fido2PinStatus,
  OathAccount,
  OathCode,
  OathType,
  OathAlgorithm,
  OtpSlot,
  OtpSlotConfig,
  AttestationResult,
  CsrParams,
  PivCertificate,
  YubiKeyConfig,
  YubiKeyAuditEntry,
  YubiKeyInterface,
} from "../../types/security/yubikey";

export function useYubiKey() {
  // ── State ────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<YubiKeyDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<YubiKeyDevice | null>(
    null,
  );
  const [pivSlots, setPivSlots] = useState<PivSlotInfo[]>([]);
  const [pivPinStatus, setPivPinStatus] = useState<PivPinStatus | null>(null);
  const [fido2Info, setFido2Info] = useState<Fido2DeviceInfo | null>(null);
  const [fido2Credentials, setFido2Credentials] = useState<Fido2Credential[]>(
    [],
  );
  const [fido2PinStatus, setFido2PinStatus] = useState<Fido2PinStatus | null>(
    null,
  );
  const [oathAccounts, setOathAccounts] = useState<OathAccount[]>([]);
  const [oathCodes, setOathCodes] = useState<Record<string, OathCode>>({});
  const [otpSlots, setOtpSlots] = useState<
    [OtpSlotConfig | null, OtpSlotConfig | null]
  >([null, null]);
  const [config, setConfig] = useState<YubiKeyConfig | null>(null);
  const [auditEntries, setAuditEntries] = useState<YubiKeyAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("devices");

  // ── Helpers ──────────────────────────────────────────────────────────

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ── Device Actions ───────────────────────────────────────────────────

  const listDevices = useCallback(async () => {
    return wrap(async () => {
      const result = await invoke<YubiKeyDevice[]>("yk_list_devices");
      setDevices(result);
      return result;
    });
  }, [wrap]);

  const getDeviceInfo = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<YubiKeyDevice>("yk_get_device_info", {
          serial,
        });
        setSelectedDevice(result);
        return result;
      });
    },
    [wrap],
  );

  const waitForDevice = useCallback(
    async (timeout: number) => {
      return wrap(async () => {
        const result = await invoke<YubiKeyDevice>("yk_wait_for_device", {
          timeout,
        });
        setSelectedDevice(result);
        return result;
      });
    },
    [wrap],
  );

  const getDiagnostics = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<string>("yk_get_diagnostics", { serial });
      });
    },
    [wrap],
  );

  // ── PIV Actions ──────────────────────────────────────────────────────

  const fetchPivCerts = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<PivSlotInfo[]>("yk_piv_list_certs", {
          serial,
        });
        setPivSlots(result);
        return result;
      });
    },
    [wrap],
  );

  const getPivSlot = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invoke<PivSlotInfo>("yk_piv_get_slot", { serial, slot });
      });
    },
    [wrap],
  );

  const pivGenerateKey = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      algorithm: PivAlgorithm,
      pinPolicy: PinPolicy,
      touchPolicy: TouchPolicy,
    ) => {
      return wrap(async () => {
        const result = await invoke<string>("yk_piv_generate_key", {
          serial,
          slot,
          algorithm,
          pinPolicy,
          touchPolicy,
        });
        return result;
      });
    },
    [wrap],
  );

  const pivSelfSignCert = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      subject: string,
      validDays: number,
    ) => {
      return wrap(async () => {
        return await invoke<PivCertificate>("yk_piv_self_sign_cert", {
          serial,
          slot,
          subject,
          validDays,
        });
      });
    },
    [wrap],
  );

  const pivGenerateCsr = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      params: CsrParams,
    ) => {
      return wrap(async () => {
        return await invoke<string>("yk_piv_generate_csr", {
          serial,
          slot,
          params,
        });
      });
    },
    [wrap],
  );

  const pivImportCert = useCallback(
    async (serial: number | undefined, slot: PivSlot, pem: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_import_cert", { serial, slot, pem });
      });
    },
    [wrap],
  );

  const pivImportKey = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      keyPem: string,
      pinPolicy: PinPolicy,
      touchPolicy: TouchPolicy,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_import_key", {
          serial,
          slot,
          keyPem,
          pinPolicy,
          touchPolicy,
        });
      });
    },
    [wrap],
  );

  const pivExportCert = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invoke<string>("yk_piv_export_cert", { serial, slot });
      });
    },
    [wrap],
  );

  const pivDeleteCert = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_delete_cert", { serial, slot });
      });
    },
    [wrap],
  );

  const pivDeleteKey = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_delete_key", { serial, slot });
      });
    },
    [wrap],
  );

  const pivAttest = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invoke<AttestationResult>("yk_piv_attest", {
          serial,
          slot,
        });
      });
    },
    [wrap],
  );

  const pivChangePin = useCallback(
    async (serial: number | undefined, oldPin: string, newPin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_change_pin", {
          serial,
          oldPin,
          newPin,
        });
      });
    },
    [wrap],
  );

  const pivChangePuk = useCallback(
    async (serial: number | undefined, oldPuk: string, newPuk: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_change_puk", {
          serial,
          oldPuk,
          newPuk,
        });
      });
    },
    [wrap],
  );

  const pivChangeMgmtKey = useCallback(
    async (
      serial: number | undefined,
      current: string,
      newKey: string,
      keyType: ManagementKeyType,
      protect: boolean,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_change_mgmt_key", {
          serial,
          current,
          newKey,
          keyType,
          protect,
        });
      });
    },
    [wrap],
  );

  const pivUnblockPin = useCallback(
    async (serial: number | undefined, puk: string, newPin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_unblock_pin", {
          serial,
          puk,
          newPin,
        });
      });
    },
    [wrap],
  );

  const pivGetPinStatus = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<PivPinStatus>("yk_piv_get_pin_status", {
          serial,
        });
        setPivPinStatus(result);
        return result;
      });
    },
    [wrap],
  );

  const pivReset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<void>("yk_piv_reset", { serial });
      });
    },
    [wrap],
  );

  const pivSign = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      data: string,
      algorithm: PivAlgorithm,
    ) => {
      return wrap(async () => {
        return await invoke<string>("yk_piv_sign", {
          serial,
          slot,
          data,
          algorithm,
        });
      });
    },
    [wrap],
  );

  // ── FIDO2 Actions ────────────────────────────────────────────────────

  const fetchFido2Info = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<Fido2DeviceInfo>("yk_fido2_info", {
          serial,
        });
        setFido2Info(result);
        return result;
      });
    },
    [wrap],
  );

  const fetchFido2Credentials = useCallback(
    async (serial: number | undefined, pin: string) => {
      return wrap(async () => {
        const result = await invoke<Fido2Credential[]>(
          "yk_fido2_list_credentials",
          { serial, pin },
        );
        setFido2Credentials(result);
        return result;
      });
    },
    [wrap],
  );

  const fido2DeleteCredential = useCallback(
    async (serial: number | undefined, credId: string, pin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_fido2_delete_credential", {
          serial,
          credId,
          pin,
        });
      });
    },
    [wrap],
  );

  const fido2SetPin = useCallback(
    async (serial: number | undefined, newPin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_fido2_set_pin", { serial, newPin });
      });
    },
    [wrap],
  );

  const fido2ChangePin = useCallback(
    async (serial: number | undefined, oldPin: string, newPin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_fido2_change_pin", {
          serial,
          oldPin,
          newPin,
        });
      });
    },
    [wrap],
  );

  const fido2GetPinStatus = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<Fido2PinStatus>("yk_fido2_pin_status", {
          serial,
        });
        setFido2PinStatus(result);
        return result;
      });
    },
    [wrap],
  );

  const fido2Reset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<void>("yk_fido2_reset", { serial });
      });
    },
    [wrap],
  );

  const fido2ToggleAlwaysUv = useCallback(
    async (serial: number | undefined, enable: boolean, pin: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_fido2_toggle_always_uv", {
          serial,
          enable,
          pin,
        });
      });
    },
    [wrap],
  );

  const fido2ListRps = useCallback(
    async (serial: number | undefined, pin: string) => {
      return wrap(async () => {
        return await invoke<string[]>("yk_fido2_list_rps", { serial, pin });
      });
    },
    [wrap],
  );

  // ── OATH Actions ─────────────────────────────────────────────────────

  const fetchOathAccounts = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<OathAccount[]>("yk_oath_list", { serial });
        setOathAccounts(result);
        return result;
      });
    },
    [wrap],
  );

  const oathAddAccount = useCallback(
    async (
      serial: number | undefined,
      issuer: string,
      name: string,
      secret: string,
      oathType: OathType,
      algorithm: OathAlgorithm,
      digits: number,
      period: number,
      touch: boolean,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_oath_add", {
          serial,
          issuer,
          name,
          secret,
          oathType,
          algorithm,
          digits,
          period,
          touch,
        });
      });
    },
    [wrap],
  );

  const oathDeleteAccount = useCallback(
    async (serial: number | undefined, credId: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_oath_delete", { serial, credId });
      });
    },
    [wrap],
  );

  const oathRenameAccount = useCallback(
    async (
      serial: number | undefined,
      oldId: string,
      newIssuer: string,
      newName: string,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_oath_rename", {
          serial,
          oldId,
          newIssuer,
          newName,
        });
      });
    },
    [wrap],
  );

  const oathCalculate = useCallback(
    async (serial: number | undefined, credId: string) => {
      return wrap(async () => {
        return await invoke<OathCode>("yk_oath_calculate", { serial, credId });
      });
    },
    [wrap],
  );

  const oathCalculateAll = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<Record<string, OathCode>>(
          "yk_oath_calculate_all",
          { serial },
        );
        setOathCodes(result);
        return result;
      });
    },
    [wrap],
  );

  const oathSetPassword = useCallback(
    async (serial: number | undefined, password: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_oath_set_password", {
          serial,
          password,
        });
      });
    },
    [wrap],
  );

  const oathReset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<void>("yk_oath_reset", { serial });
      });
    },
    [wrap],
  );

  // ── OTP Actions ──────────────────────────────────────────────────────

  const fetchOtpInfo = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invoke<
          [OtpSlotConfig | null, OtpSlotConfig | null]
        >("yk_otp_info", { serial });
        setOtpSlots(result);
        return result;
      });
    },
    [wrap],
  );

  const otpConfigureYubico = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      publicId: string,
      privateId: string,
      key: string,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_configure_yubico", {
          serial,
          slot,
          publicId,
          privateId,
          key,
        });
      });
    },
    [wrap],
  );

  const otpConfigureChalResp = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      key: string,
      touch: boolean,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_configure_chalresp", {
          serial,
          slot,
          key,
          touch,
        });
      });
    },
    [wrap],
  );

  const otpConfigureStatic = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      password: string,
      layout: string,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_configure_static", {
          serial,
          slot,
          password,
          layout,
        });
      });
    },
    [wrap],
  );

  const otpConfigureHotp = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      key: string,
      digits: number,
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_configure_hotp", {
          serial,
          slot,
          key,
          digits,
        });
      });
    },
    [wrap],
  );

  const otpDeleteSlot = useCallback(
    async (serial: number | undefined, slot: OtpSlot) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_delete", { serial, slot });
      });
    },
    [wrap],
  );

  const otpSwapSlots = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<void>("yk_otp_swap", { serial });
      });
    },
    [wrap],
  );

  // ── Config Actions ───────────────────────────────────────────────────

  const setInterfaces = useCallback(
    async (
      serial: number | undefined,
      usb: YubiKeyInterface[],
      nfc: YubiKeyInterface[],
    ) => {
      return wrap(async () => {
        return await invoke<void>("yk_config_set_interfaces", {
          serial,
          usb,
          nfc,
        });
      });
    },
    [wrap],
  );

  const lockConfig = useCallback(
    async (serial: number | undefined, lockCode: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_config_lock", { serial, lockCode });
      });
    },
    [wrap],
  );

  const unlockConfig = useCallback(
    async (serial: number | undefined, lockCode: string) => {
      return wrap(async () => {
        return await invoke<void>("yk_config_unlock", { serial, lockCode });
      });
    },
    [wrap],
  );

  const fetchConfig = useCallback(async () => {
    return wrap(async () => {
      const result = await invoke<YubiKeyConfig>("yk_get_config");
      setConfig(result);
      return result;
    });
  }, [wrap]);

  const updateConfig = useCallback(
    async (newConfig: YubiKeyConfig) => {
      return wrap(async () => {
        await invoke<void>("yk_update_config", { config: newConfig });
        setConfig(newConfig);
      });
    },
    [wrap],
  );

  // ── Audit Actions ────────────────────────────────────────────────────

  const fetchAuditLog = useCallback(
    async (limit: number) => {
      return wrap(async () => {
        const result = await invoke<YubiKeyAuditEntry[]>("yk_audit_log", {
          limit,
        });
        setAuditEntries(result);
        return result;
      });
    },
    [wrap],
  );

  const exportAudit = useCallback(async () => {
    return wrap(async () => {
      return await invoke<string>("yk_audit_export");
    });
  }, [wrap]);

  const clearAudit = useCallback(async () => {
    return wrap(async () => {
      await invoke<void>("yk_audit_clear");
      setAuditEntries([]);
    });
  }, [wrap]);

  // ── Management Actions ───────────────────────────────────────────────

  const factoryResetAll = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<void>("yk_factory_reset_all", { serial });
      });
    },
    [wrap],
  );

  const exportDeviceReport = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invoke<string>("yk_export_report", { serial });
      });
    },
    [wrap],
  );

  // ── Mount Effect ─────────────────────────────────────────────────────

  useEffect(() => {
    listDevices();
  }, [listDevices]);

  // ── Return ───────────────────────────────────────────────────────────

  return {
    // State
    devices,
    selectedDevice,
    pivSlots,
    pivPinStatus,
    fido2Info,
    fido2Credentials,
    fido2PinStatus,
    oathAccounts,
    oathCodes,
    otpSlots,
    config,
    auditEntries,
    loading,
    error,
    activeTab,

    // Device
    listDevices,
    getDeviceInfo,
    waitForDevice,
    getDiagnostics,

    // PIV
    fetchPivCerts,
    getPivSlot,
    pivGenerateKey,
    pivSelfSignCert,
    pivGenerateCsr,
    pivImportCert,
    pivImportKey,
    pivExportCert,
    pivDeleteCert,
    pivDeleteKey,
    pivAttest,
    pivChangePin,
    pivChangePuk,
    pivChangeMgmtKey,
    pivUnblockPin,
    pivGetPinStatus,
    pivReset,
    pivSign,

    // FIDO2
    fetchFido2Info,
    fetchFido2Credentials,
    fido2DeleteCredential,
    fido2SetPin,
    fido2ChangePin,
    fido2GetPinStatus,
    fido2Reset,
    fido2ToggleAlwaysUv,
    fido2ListRps,

    // OATH
    fetchOathAccounts,
    oathAddAccount,
    oathDeleteAccount,
    oathRenameAccount,
    oathCalculate,
    oathCalculateAll,
    oathSetPassword,
    oathReset,

    // OTP
    fetchOtpInfo,
    otpConfigureYubico,
    otpConfigureChalResp,
    otpConfigureStatic,
    otpConfigureHotp,
    otpDeleteSlot,
    otpSwapSlots,

    // Config
    setInterfaces,
    lockConfig,
    unlockConfig,
    fetchConfig,
    updateConfig,

    // Audit
    fetchAuditLog,
    exportAudit,
    clearAudit,

    // Management
    factoryResetAll,
    exportDeviceReport,

    // Tab
    setActiveTab,
  };
}
