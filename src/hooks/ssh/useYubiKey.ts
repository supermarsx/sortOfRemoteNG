import { useState, useCallback, useEffect, useRef } from "react";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { describeYubiKeyError } from "../../utils/security/yubiKeyErrors";
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
  const mounted = useRef(true);
  const epoch = useRef(0);
  const pending = useRef(0);
  const deviceEpoch = useRef(0);
  const listInFlight = useRef<Promise<YubiKeyDevice[] | undefined> | null>(
    null,
  );
  const superseded = useRef(new Error("superseded"));
  const configRef = useRef<YubiKeyConfig | null>(null);
  const [readiness, setReadiness] = useState<
    "detecting" | "ready" | "unavailable" | "error"
  >("detecting");
  const invokeCurrent = useCallback(
    async <T>(command: string, args?: InvokeArgs): Promise<T> => {
      const started = epoch.current;
      const deviceStarted = deviceEpoch.current;
      const scoped = ![
        "yk_get_config",
        "yk_update_config",
        "yk_audit_log",
        "yk_audit_export",
        "yk_audit_clear",
        "yk_list_devices",
      ].includes(command);
      if (!mounted.current) throw superseded.current;
      let result: T;
      try {
        result =
          args === undefined
            ? await invoke<T>(command)
            : await invoke<T>(command, args);
      } catch (error) {
        if (
          !mounted.current ||
          epoch.current !== started ||
          (scoped && deviceEpoch.current !== deviceStarted)
        )
          throw superseded.current;
        throw error;
      }
      if (
        !mounted.current ||
        epoch.current !== started ||
        (scoped && deviceEpoch.current !== deviceStarted)
      )
        throw superseded.current;
      return result;
    },
    [],
  );
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
    async <T>(
      fn: () => Promise<T>,
      initialization = false,
    ): Promise<T | undefined> => {
      if (!mounted.current) return undefined;
      const started = epoch.current;
      pending.current++;
      setLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        if (
          err !== superseded.current &&
          mounted.current &&
          epoch.current === started
        ) {
          const failure = describeYubiKeyError(err);
          setError(failure.message);
          if (failure.kind === "unavailable") setReadiness("unavailable");
          else if (initialization) setReadiness("error");
        }
        return undefined;
      } finally {
        if (mounted.current && epoch.current === started) {
          pending.current--;
          setLoading(pending.current > 0);
        }
      }
    },
    [],
  );

  // ── Device Actions ───────────────────────────────────────────────────

  const clearDeviceState = useCallback(() => {
    deviceEpoch.current++;
    setSelectedDevice(null);
    setPivSlots([]);
    setPivPinStatus(null);
    setFido2Info(null);
    setFido2Credentials([]);
    setFido2PinStatus(null);
    setOathAccounts([]);
    setOathCodes({});
    setOtpSlots([null, null]);
  }, []);

  const selectedRef = useRef(selectedDevice);
  selectedRef.current = selectedDevice;
  const listDevices = useCallback(() => {
    if (listInFlight.current) return listInFlight.current;
    setReadiness("detecting");
    const task = wrap(async () => {
      const result = await invokeCurrent<YubiKeyDevice[]>("yk_list_devices");
      if (!Array.isArray(result)) throw new Error("Invalid device response");
      setDevices(result);
      if (
        selectedRef.current &&
        !result.some((device) => device.serial === selectedRef.current?.serial)
      )
        clearDeviceState();
      setReadiness("ready");
      return result;
    }, true);
    listInFlight.current = task;
    void task.finally(() => {
      if (listInFlight.current === task) listInFlight.current = null;
    });
    return task;
  }, [wrap, invokeCurrent, clearDeviceState]);

  const getDeviceInfo = useCallback(
    async (serial?: number) => {
      clearDeviceState();
      return wrap(async () => {
        const result = await invokeCurrent<YubiKeyDevice>(
          "yk_get_device_info",
          {
            serial,
          },
        );
        setSelectedDevice(result);
        return result;
      });
    },
    [wrap, invokeCurrent, clearDeviceState],
  );

  const waitForDevice = useCallback(
    async (timeout: number) => {
      clearDeviceState();
      return wrap(async () => {
        const result = await invokeCurrent<YubiKeyDevice | null>(
          "yk_wait_for_device",
          {
            timeoutMs: timeout,
          },
        );
        setSelectedDevice(result);
        return result;
      });
    },
    [wrap, invokeCurrent, clearDeviceState],
  );

  const getDiagnostics = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<Record<string, string>>(
          "yk_get_diagnostics",
          { serial },
        );
      });
    },
    [wrap, invokeCurrent],
  );

  // ── PIV Actions ──────────────────────────────────────────────────────

  const fetchPivCerts = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<PivSlotInfo[]>("yk_piv_list_certs", {
          serial,
        });
        setPivSlots(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const getPivSlot = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invokeCurrent<PivSlotInfo>("yk_piv_get_slot", {
          serial,
          slot,
        });
      });
    },
    [wrap, invokeCurrent],
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
        const result = await invokeCurrent<PivSlotInfo>("yk_piv_generate_key", {
          serial,
          slot,
          algo: algorithm,
          pinPolicy,
          touchPolicy,
        });
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const pivSelfSignCert = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      subject: string,
      validDays: number,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<PivCertificate>("yk_piv_self_sign_cert", {
          serial,
          slot,
          subject,
          validDays,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivGenerateCsr = useCallback(
    async (serial: number | undefined, slot: PivSlot, params: CsrParams) => {
      return wrap(async () => {
        return await invokeCurrent<string>("yk_piv_generate_csr", {
          serial,
          slot,
          params,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivImportCert = useCallback(
    async (serial: number | undefined, slot: PivSlot, pem: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_import_cert", {
          serial,
          slot,
          pem,
        });
      });
    },
    [wrap, invokeCurrent],
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
        return await invokeCurrent<boolean>("yk_piv_import_key", {
          serial,
          slot,
          keyPem,
          pinPolicy,
          touchPolicy,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivExportCert = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invokeCurrent<string>("yk_piv_export_cert", {
          serial,
          slot,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivDeleteCert = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_delete_cert", {
          serial,
          slot,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivDeleteKey = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_delete_key", {
          serial,
          slot,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivAttest = useCallback(
    async (serial: number | undefined, slot: PivSlot) => {
      return wrap(async () => {
        return await invokeCurrent<AttestationResult>("yk_piv_attest", {
          serial,
          slot,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivChangePin = useCallback(
    async (serial: number | undefined, oldPin: string, newPin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_change_pin", {
          serial,
          oldPin,
          newPin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivChangePuk = useCallback(
    async (serial: number | undefined, oldPuk: string, newPuk: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_change_puk", {
          serial,
          oldPuk,
          newPuk,
        });
      });
    },
    [wrap, invokeCurrent],
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
        return await invokeCurrent<boolean>("yk_piv_change_mgmt_key", {
          serial,
          current,
          newKey,
          keyType,
          protect,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivUnblockPin = useCallback(
    async (serial: number | undefined, puk: string, newPin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_unblock_pin", {
          serial,
          puk,
          newPin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivGetPinStatus = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<PivPinStatus>(
          "yk_piv_get_pin_status",
          {
            serial,
          },
        );
        setPivPinStatus(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const pivReset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_piv_reset", { serial });
      });
    },
    [wrap, invokeCurrent],
  );

  const pivSign = useCallback(
    async (
      serial: number | undefined,
      slot: PivSlot,
      data: string,
      algorithm: PivAlgorithm,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<string>("yk_piv_sign", {
          serial,
          slot,
          data,
          algo: algorithm,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  // ── FIDO2 Actions ────────────────────────────────────────────────────

  const fetchFido2Info = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<Fido2DeviceInfo>("yk_fido2_info", {
          serial,
        });
        setFido2Info(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const fetchFido2Credentials = useCallback(
    async (serial: number | undefined, pin: string) => {
      return wrap(async () => {
        const result = await invokeCurrent<Fido2Credential[]>(
          "yk_fido2_list_credentials",
          { serial, pin },
        );
        setFido2Credentials(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2DeleteCredential = useCallback(
    async (serial: number | undefined, credId: string, pin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_fido2_delete_credential", {
          serial,
          credentialId: credId,
          pin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2SetPin = useCallback(
    async (serial: number | undefined, newPin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_fido2_set_pin", {
          serial,
          newPin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2ChangePin = useCallback(
    async (serial: number | undefined, oldPin: string, newPin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_fido2_change_pin", {
          serial,
          oldPin,
          newPin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2GetPinStatus = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<Fido2PinStatus>(
          "yk_fido2_pin_status",
          {
            serial,
          },
        );
        setFido2PinStatus(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2Reset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_fido2_reset", { serial });
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2ToggleAlwaysUv = useCallback(
    async (serial: number | undefined, enable: boolean, pin: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_fido2_toggle_always_uv", {
          serial,
          enable,
          pin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const fido2ListRps = useCallback(
    async (serial: number | undefined, pin: string) => {
      return wrap(async () => {
        return await invokeCurrent<string[]>("yk_fido2_list_rps", {
          serial,
          pin,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  // ── OATH Actions ─────────────────────────────────────────────────────

  const fetchOathAccounts = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<OathAccount[]>("yk_oath_list", {
          serial,
        });
        setOathAccounts(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
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
        return await invokeCurrent<boolean>("yk_oath_add", {
          serial,
          issuer,
          name,
          secret,
          oathType,
          algo: algorithm,
          digits,
          period,
          touch,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const oathDeleteAccount = useCallback(
    async (serial: number | undefined, credId: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_oath_delete", {
          serial,
          credentialId: credId,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const oathRenameAccount = useCallback(
    async (
      serial: number | undefined,
      oldId: string,
      newIssuer: string,
      newName: string,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_oath_rename", {
          serial,
          oldId,
          newIssuer,
          newName,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const oathCalculate = useCallback(
    async (serial: number | undefined, credId: string) => {
      return wrap(async () => {
        return await invokeCurrent<OathCode>("yk_oath_calculate", {
          serial,
          credentialId: credId,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const oathCalculateAll = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<[OathAccount, OathCode][]>(
          "yk_oath_calculate_all",
          { serial },
        );
        const codes = Object.fromEntries(
          result.map(([account, code]) => [account.credential_id, code]),
        );
        setOathCodes(codes);
        return codes;
      });
    },
    [wrap, invokeCurrent],
  );

  const oathSetPassword = useCallback(
    async (serial: number | undefined, password: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_oath_set_password", {
          serial,
          password,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const oathReset = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_oath_reset", { serial });
      });
    },
    [wrap, invokeCurrent],
  );

  // ── OTP Actions ──────────────────────────────────────────────────────

  const fetchOtpInfo = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<
          [OtpSlotConfig | null, OtpSlotConfig | null]
        >("yk_otp_info", { serial });
        setOtpSlots(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
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
        return await invokeCurrent<boolean>("yk_otp_configure_yubico", {
          serial,
          slot,
          publicId,
          privateId,
          key,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const otpConfigureChalResp = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      key: string,
      touch: boolean,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_otp_configure_chalresp", {
          serial,
          slot,
          key,
          touch,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const otpConfigureStatic = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      password: string,
      layout: string,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_otp_configure_static", {
          serial,
          slot,
          password,
          layout,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const otpConfigureHotp = useCallback(
    async (
      serial: number | undefined,
      slot: OtpSlot,
      key: string,
      digits: number,
    ) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_otp_configure_hotp", {
          serial,
          slot,
          key,
          digits,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const otpDeleteSlot = useCallback(
    async (serial: number | undefined, slot: OtpSlot) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_otp_delete", { serial, slot });
      });
    },
    [wrap, invokeCurrent],
  );

  const otpSwapSlots = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_otp_swap", { serial });
      });
    },
    [wrap, invokeCurrent],
  );

  // ── Config Actions ───────────────────────────────────────────────────

  const setInterfaces = useCallback(
    async (
      serial: number | undefined,
      usb: YubiKeyInterface[],
      nfc: YubiKeyInterface[],
    ) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_config_set_interfaces", {
          serial,
          usb,
          nfc,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const lockConfig = useCallback(
    async (serial: number | undefined, lockCode: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_config_lock", {
          serial,
          lockCode,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const unlockConfig = useCallback(
    async (serial: number | undefined, lockCode: string) => {
      return wrap(async () => {
        return await invokeCurrent<boolean>("yk_config_unlock", {
          serial,
          lockCode,
        });
      });
    },
    [wrap, invokeCurrent],
  );

  const fetchConfig = useCallback(async () => {
    return wrap(async () => {
      const result = await invokeCurrent<YubiKeyConfig>("yk_get_config");
      configRef.current = result;
      setConfig(result);
      return result;
    });
  }, [wrap, invokeCurrent]);

  const updateConfig = useCallback(
    async (newConfig: YubiKeyConfig) => {
      return wrap(async () => {
        await invokeCurrent<void>("yk_update_config", { config: newConfig });
        const pathChanged =
          configRef.current?.ykman_path !== newConfig.ykman_path;
        configRef.current = newConfig;
        setConfig(newConfig);
        if (pathChanged) {
          clearDeviceState();
          setDevices([]);
          setReadiness("unavailable");
        }
        return true;
      });
    },
    [wrap, invokeCurrent, clearDeviceState],
  );

  // ── Audit Actions ────────────────────────────────────────────────────

  const fetchAuditLog = useCallback(
    async (limit: number) => {
      return wrap(async () => {
        const result = await invokeCurrent<YubiKeyAuditEntry[]>(
          "yk_audit_log",
          {
            limit,
          },
        );
        setAuditEntries(result);
        return result;
      });
    },
    [wrap, invokeCurrent],
  );

  const exportAudit = useCallback(async () => {
    return wrap(async () => {
      return await invokeCurrent<string>("yk_audit_export");
    });
  }, [wrap, invokeCurrent]);

  const clearAudit = useCallback(async () => {
    return wrap(async () => {
      await invokeCurrent<void>("yk_audit_clear");
      setAuditEntries([]);
    });
  }, [wrap, invokeCurrent]);

  // ── Management Actions ───────────────────────────────────────────────

  const factoryResetAll = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<Record<string, string>>(
          "yk_factory_reset_all",
          { serial },
        );
      });
    },
    [wrap, invokeCurrent],
  );

  const exportDeviceReport = useCallback(
    async (serial?: number) => {
      return wrap(async () => {
        return await invokeCurrent<string>("yk_export_report", { serial });
      });
    },
    [wrap, invokeCurrent],
  );

  // ── Mount Effect ─────────────────────────────────────────────────────

  useEffect(() => {
    mounted.current = true;
    const mountedEpoch = epoch.current;
    void listDevices();
    return () => {
      mounted.current = false;
      epoch.current = mountedEpoch + 1;
      pending.current = 0;
      listInFlight.current = null;
    };
  }, [listDevices]);

  // ── Return ───────────────────────────────────────────────────────────

  return {
    readiness,
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

    // Error
    clearError: () => setError(null),
  };
}
