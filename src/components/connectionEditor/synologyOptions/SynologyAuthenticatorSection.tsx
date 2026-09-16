import React, { useEffect, useRef, useState } from "react";
import type { Connection } from "../../../types/connection/connection";
import type { TOTPConfig } from "../../../types/settings/settings";
import type { TotpAlgorithm } from "../../../types/totp";
import {
  isSynologyFileConnection,
  isValidSynologyOtpAuthenticatorId,
  normalizeSynologySettings,
} from "../../../types/protocols/synology";
import { resolveHttpBasicCredentials } from "../../../utils/auth/httpCredentials";
import { parseOtpauthUri } from "../../../utils/auth/totpImport";
import {
  resolveLocalSynologyAuthenticator,
  SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES,
  SYNOLOGY_TOTP_PERIOD_RANGE,
  SYNOLOGY_TOTP_SECRET_MAX_LENGTH,
} from "../../../utils/synology/synologyAuthenticator";
import { useVaultTotpChoices } from "../../../hooks/security/useVaultTotpChoices";
import { totpApi } from "../../../hooks/totp/useTOTP";
import { PasswordInput, Select } from "../../ui/forms";

const ADD = "add";
const UNAVAILABLE = "unavailable";
const ALGORITHMS: Record<string, TOTPConfig["algorithm"]> = {
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
};

type Draft = Pick<TOTPConfig, "secret" | "digits" | "period" | "algorithm"> & {
  issuer?: string;
  account?: string;
};

/** Unpadded RFC 4648 Base32 of at least 80 bits; spaces and dashes are allowed. */
function normalizeBase32(value: string): string | null {
  const secret = value.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  return secret.length >= 16 &&
    secret.length <= SYNOLOGY_TOTP_SECRET_MAX_LENGTH &&
    /^[A-Z2-7]+$/.test(secret) &&
    ![1, 3, 6].includes(secret.length % 8)
    ? secret
    : null;
}

/** Messages never echo the input: it is an authenticator seed. */
function parseAuthenticatorSecret(
  input: string,
  fallback: Pick<TOTPConfig, "digits" | "period" | "algorithm">,
): Draft | string {
  const value = input.trim().replace(/^otpauth:/i, "otpauth:");
  if (!value.startsWith("otpauth://")) {
    const secret = normalizeBase32(value);
    return secret
      ? { ...fallback, secret }
      : "Enter the authenticator secret as Base32 (letters A–Z and digits 2–7, at least 16 characters) or paste an otpauth://totp/ link.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "The otpauth:// link is malformed. Copy the link again or enter the Base32 secret.";
  }
  if (url.hostname.toLowerCase() !== "totp")
    return "Only time-based (otpauth://totp/) links can answer DSM code challenges. HOTP and Steam links are not supported.";
  const digits = url.searchParams.get("digits") ?? "6";
  const period = url.searchParams.get("period") ?? "30";
  const algorithm =
    ALGORITHMS[
      (url.searchParams.get("algorithm") ?? "SHA1")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
    ];
  const parsed = parseOtpauthUri(value);
  const secret = parsed ? normalizeBase32(parsed.secret) : null;
  if (
    !secret ||
    !/^(6|8)$/.test(digits) ||
    !/^\d{2,3}$/.test(period) ||
    Number(period) < SYNOLOGY_TOTP_PERIOD_RANGE.min ||
    Number(period) > SYNOLOGY_TOTP_PERIOD_RANGE.max ||
    !algorithm
  )
    return "This otpauth:// link has an unsupported secret, digit count, period or algorithm. Use 6 or 8 digits, a 15–120 second period and SHA-1, SHA-256 or SHA-512.";
  const known = (text?: string) =>
    text && text !== "Unknown" ? text : undefined;
  return {
    secret,
    digits: Number(digits),
    period: Number(period),
    algorithm,
    issuer: known(parsed?.issuer),
    account: known(parsed?.account),
  };
}

/** Local credentials only; the saved settings keep just the reference, never the seed. */
function withAuthenticatorReference(
  previous: Partial<Connection>,
  id: string | undefined,
  totpConfigs = previous.totpConfigs,
): Partial<Connection> {
  if (
    !isSynologyFileConnection(previous) ||
    previous.credentialSource?.kind === "vault" ||
    (id !== undefined && !isValidSynologyOtpAuthenticatorId(id))
  )
    return previous;
  try {
    const current = normalizeSynologySettings(previous.synologySettings);
    delete current.otpAuthenticatorId;
    return {
      ...previous,
      ...(totpConfigs ? { totpConfigs } : {}),
      synologySettings: id ? { ...current, otpAuthenticatorId: id } : current,
    };
  } catch {
    // Do not repair malformed saved settings through this selector.
    return previous;
  }
}

const authenticatorLabel = (config: TOTPConfig, index: number) =>
  [config.issuer, config.account].filter(Boolean).join(" — ") ||
  `Authenticator ${index + 1}`;

export default function SynologyAuthenticatorSection({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const vault = formData.credentialSource?.kind === "vault";
  return (
    <section
      data-testid="synology-authenticator-section"
      aria-label="Two-factor authentication"
      className="max-w-2xl space-y-2 rounded border border-[var(--color-border)] p-3"
    >
      <h4 className="text-sm font-medium">
        Two-factor authentication — automatic one-time codes
      </h4>
      {vault ? (
        <VaultAuthenticator formData={formData} setFormData={setFormData} />
      ) : (
        <LocalAuthenticator formData={formData} setFormData={setFormData} />
      )}
    </section>
  );
}

function VaultAuthenticator({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const choices = useVaultTotpChoices(formData);
  const totpId =
    formData.credentialSource?.kind === "vault"
      ? (formData.credentialSource.totpId ?? "")
      : "";
  let localReference = false;
  try {
    localReference = !!normalizeSynologySettings(formData.synologySettings)
      .otpAuthenticatorId;
  } catch {
    /* SynologyOptions reports malformed settings. */
  }
  const stale =
    !!totpId &&
    !choices.loading &&
    !choices.entries.some((entry) => entry.id === totpId);
  return (
    <>
      <p className="text-xs text-[var(--color-textSecondary)]">
        When DSM asks for a code, the app generates one from the vault
        entry&apos;s authenticator and submits it once. This is the same choice
        as General → Credential source → Vault authenticator for login
        challenges; changing it turns off website automatic codes until they are
        enabled again.
      </p>
      <label className="block text-sm">
        Vault authenticator
        <Select
          label="NAS API authenticator"
          variant="form"
          value={totpId}
          disabled={!choices.available || choices.loading}
          placeholder={
            choices.loading ? "Loading vault authenticators…" : undefined
          }
          options={[
            { value: "", label: "None — enter codes manually" },
            ...(stale
              ? [
                  {
                    value: totpId,
                    label: "Saved vault authenticator unavailable",
                    disabled: true,
                  },
                ]
              : []),
            ...choices.entries.map((entry) => ({
              value: entry.id,
              label: entry.label,
            })),
          ]}
          onChange={(value) => {
            if (value && !choices.entries.some((entry) => entry.id === value))
              return;
            setFormData((previous) => {
              if (previous.credentialSource?.kind !== "vault") return previous;
              if (previous.credentialSource.totpId === (value || undefined))
                return previous;
              const { totpId: _previousTotp, ...reference } =
                previous.credentialSource;
              return {
                ...previous,
                credentialSource: value
                  ? { ...reference, totpId: value }
                  : reference,
                // Website consent is bound to the previous authenticator id.
                ...(previous.httpAutoMfa
                  ? { httpAutoMfa: { version: 1 as const, enabled: false } }
                  : {}),
              };
            });
          }}
        />
      </label>
      {!choices.available ? (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Open and unlock the owning database to choose the vault entry&apos;s
          authenticator.
        </p>
      ) : choices.error ? (
        <p role="alert" className="text-xs text-error">
          {choices.error}
        </p>
      ) : !choices.loading && !choices.entries.length ? (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Add the DSM authenticator&apos;s secret to this entry in Settings →
          Security → Database credential vault, then Reload.
        </p>
      ) : stale ? (
        <p role="alert" className="text-xs text-warning">
          The saved vault authenticator is no longer in this entry. Choose
          another one; until then DSM codes are entered manually.
        </p>
      ) : null}
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={!choices.available || choices.loading}
        onClick={choices.reload}
      >
        Reload authenticators
      </button>
      {localReference && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          A connection-local authenticator is also saved for the NAS API. It is
          ignored while vault credentials are selected.
        </p>
      )}
    </>
  );
}

function LocalAuthenticator({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const configs = formData.totpConfigs ?? [];
  let reference: string | undefined;
  let writable = true;
  try {
    reference = normalizeSynologySettings(
      formData.synologySettings,
    ).otpAuthenticatorId;
  } catch {
    writable = false;
  }
  const matches = reference
    ? configs.flatMap((config, index) =>
        config.id === reference ? [index] : [],
      )
    : [];
  const selectedIndex = matches.length === 1 ? matches[0] : -1;
  const resolved = resolveLocalSynologyAuthenticator(formData);
  const ready = resolved.kind === "ready" ? resolved.config : null;
  const websiteId = formData.httpAutoMfa?.totpConfigId;
  const websiteMatch =
    !reference &&
    !!websiteId &&
    isValidSynologyOtpAuthenticatorId(websiteId) &&
    configs.filter((config) => config.id === websiteId).length === 1;

  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState("");
  const [digits, setDigits] = useState(6);
  const [period, setPeriod] = useState(30);
  const [algorithm, setAlgorithm] = useState<TOTPConfig["algorithm"]>("sha1");
  const [addError, setAddError] = useState("");
  const [check, setCheck] = useState<
    | { id: string; code: string; expires: number }
    | { id: string; failed: true }
    | null
  >(null);
  const attempt = useRef(0);
  useEffect(() => {
    if (!check || !("code" in check)) return;
    const timer = setTimeout(
      () => setCheck(null),
      Math.max(0, check.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [check]);
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  const resetAddForm = () => {
    setSecret("");
    setDigits(6);
    setPeriod(30);
    setAlgorithm("sha1");
    setAddError("");
    setAdding(false);
  };
  const save = () => {
    const draft = parseAuthenticatorSecret(secret, {
      digits,
      period,
      algorithm,
    });
    if (typeof draft === "string") {
      setAddError(draft);
      return;
    }
    const id = crypto.randomUUID();
    const credentials = resolveHttpBasicCredentials({
      ...formData,
      authType: "basic",
    });
    const config: TOTPConfig = {
      id,
      secret: draft.secret,
      issuer: draft.issuer ?? "Synology DSM",
      account:
        draft.account ||
        credentials?.username ||
        formData.hostname ||
        "DSM account",
      digits: draft.digits,
      period: draft.period,
      algorithm: draft.algorithm,
      createdAt: new Date().toISOString(),
    };
    setFormData((previous) => {
      const current = previous.totpConfigs ?? [];
      if (current.some((item) => item.id === id)) return previous;
      return withAuthenticatorReference(previous, id, [...current, config]);
    });
    // The seed now lives only in the draft connection's totpConfigs.
    resetAddForm();
  };
  const checkCode = async () => {
    if (!ready) return;
    const run = ++attempt.current;
    const id = ready.id;
    const periodMs = ready.period * 1000;
    // Expire with the window the request started in; a boundary crossing hides early.
    const expires = (Math.floor(Date.now() / periodMs) + 1) * periodMs;
    try {
      const code = await totpApi.computeCode(
        ready.secret,
        ready.algorithm.toUpperCase() as TotpAlgorithm,
        ready.digits,
        ready.period,
      );
      if (run !== attempt.current) return;
      if (!/^\d{6,8}$/.test(code)) throw new Error();
      setCheck({ id, code, expires });
    } catch {
      if (run === attempt.current) setCheck({ id, failed: true });
    }
  };

  const value = !reference
    ? ""
    : selectedIndex >= 0
      ? String(selectedIndex)
      : UNAVAILABLE;
  const shown = check && ready?.id === check.id ? check : null;
  return (
    <>
      <p className="text-xs text-[var(--color-textSecondary)]">
        When DSM asks for a code, the app generates one from the selected
        authenticator and submits it once. Choose the authenticator enrolled for
        this DSM account or add its secret. The secret is stored with this
        connection&apos;s credentials like the DSM password, is listed under
        Protocol → Recovery → 2FA / TOTP, and database exports remove it.
      </p>
      <label className="block text-sm">
        Authenticator
        <Select
          label="NAS API authenticator"
          variant="form"
          value={value}
          disabled={!writable}
          options={[
            { value: "", label: "None — enter codes manually" },
            ...(value === UNAVAILABLE
              ? [
                  {
                    value: UNAVAILABLE,
                    label: "Saved authenticator unavailable",
                    disabled: true,
                  },
                ]
              : []),
            ...configs.map((config, index) => ({
              value: String(index),
              label: authenticatorLabel(config, index),
            })),
            { value: ADD, label: "Add authenticator secret" },
          ]}
          onChange={(next) => {
            attempt.current += 1;
            setCheck(null);
            if (next === ADD) {
              setAdding(true);
              return;
            }
            if (next === "") {
              setFormData((previous) =>
                withAuthenticatorReference(previous, undefined),
              );
              return;
            }
            const index = Number(next);
            const chosen = configs[index];
            if (!chosen) return;
            const fresh = crypto.randomUUID();
            setFormData((previous) => {
              const current = previous.totpConfigs ?? [];
              if (current[index] !== chosen) return previous;
              // Legacy or duplicated ids get a unique stable reference.
              const stableId =
                chosen.id &&
                isValidSynologyOtpAuthenticatorId(chosen.id) &&
                current.filter((item) => item.id === chosen.id).length === 1
                  ? chosen.id
                  : fresh;
              if (stableId === chosen.id)
                return withAuthenticatorReference(previous, stableId, current);
              const next = withAuthenticatorReference(
                previous,
                stableId,
                current.map((item, position) =>
                  position === index ? { ...item, id: stableId } : item,
                ),
              );
              // Website consent named the old, ambiguous id; re-identifying one
              // copy must not silently arm it for the other.
              return next !== previous &&
                chosen.id &&
                previous.httpAutoMfa?.totpConfigId === chosen.id
                ? {
                    ...next,
                    httpAutoMfa: { version: 1 as const, enabled: false },
                  }
                : next;
            });
          }}
        />
      </label>
      {!writable && (
        <p role="alert" className="text-xs text-error">
          The saved Synology settings are invalid. Review them before choosing
          an authenticator.
        </p>
      )}
      {resolved.kind === "unavailable" && (
        <p role="alert" className="text-xs text-warning">
          {SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES[resolved.reason]} Until
          then DSM codes are entered manually.
        </p>
      )}
      {websiteMatch && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() =>
            setFormData((previous) => {
              const current = previous.totpConfigs ?? [];
              if (
                previous.httpAutoMfa?.totpConfigId !== websiteId ||
                current.filter((item) => item.id === websiteId).length !== 1 ||
                previous.synologySettings?.otpAuthenticatorId
              )
                return previous;
              return withAuthenticatorReference(previous, websiteId);
            })
          }
        >
          Use the website&apos;s authenticator
        </button>
      )}
      {ready && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() => void checkCode()}
        >
          Check code
        </button>
      )}
      {shown &&
        ("code" in shown ? (
          <p role="status" className="text-sm">
            Current code{" "}
            <span
              className="font-mono"
              data-testid="synology-authenticator-code"
            >
              {shown.code}
            </span>
            . Compare it with your authenticator app; it disappears when this
            {` ${ready!.period}-second`} window ends.
          </p>
        ) : (
          <p role="alert" className="text-xs text-error">
            A code couldn&apos;t be generated from this authenticator. Check the
            secret and its settings.
          </p>
        ))}
      {adding && (
        <div className="space-y-2 rounded border border-[var(--color-border)] p-3">
          <label className="block space-y-1 text-sm">
            Authenticator secret
            <PasswordInput
              aria-label="Authenticator secret"
              className="sor-form-input font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="Base32 secret or otpauth://totp/… link"
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value);
                setAddError("");
              }}
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer">Advanced settings</summary>
            <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
              Used for a Base32 secret; an otpauth:// link carries its own. DSM
              uses 6 digits, 30 seconds and SHA-1.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Select
                label="Authenticator digits"
                variant="form"
                value={String(digits)}
                options={[
                  { value: "6", label: "6 digits" },
                  { value: "8", label: "8 digits" },
                ]}
                onChange={(next) => setDigits(next === "8" ? 8 : 6)}
              />
              <Select
                label="Authenticator period"
                variant="form"
                value={String(period)}
                options={[15, 30, 60].map((seconds) => ({
                  value: String(seconds),
                  label: `${seconds} seconds`,
                }))}
                onChange={(next) => setPeriod(Number(next))}
              />
              <Select
                label="Authenticator algorithm"
                variant="form"
                value={algorithm}
                options={[
                  { value: "sha1", label: "SHA-1" },
                  { value: "sha256", label: "SHA-256" },
                  { value: "sha512", label: "SHA-512" },
                ]}
                onChange={(next) =>
                  setAlgorithm(ALGORITHMS[next.toUpperCase()] ?? "sha1")
                }
              />
            </div>
          </details>
          {addError && (
            <p role="alert" className="text-xs text-error">
              {addError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              disabled={!writable || !secret.trim()}
              onClick={save}
            >
              Save authenticator
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              onClick={resetAddForm}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
