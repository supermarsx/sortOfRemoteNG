import React, { useId, useState } from "react";
import { Select } from "../../ui/forms";
import type { HttpApplicationProfile } from "../../../utils/connection/httpApplicationProfiles";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../../../utils/connection/httpAutoMfa";
import type { Mgr } from "./types";
import { useVaultTotpChoices } from "../../../hooks/security/useVaultTotpChoices";

/** Draft-only explicit consent; never computes a code or copies an authenticator seed. */
export default function AutomaticMfaSection({
  mgr,
  profile,
}: {
  mgr: Mgr;
  profile: HttpApplicationProfile;
}) {
  const id = useId();
  const vault = mgr.formData.credentialSource?.kind === "vault";
  const vaultChoices = useVaultTotpChoices(mgr.formData);
  const configs = vault ? [] : (mgr.formData.totpConfigs ?? []);
  const challenges = profile.totpChallenges ?? [];
  let configuration: ReturnType<typeof normalizeHttpAutoMfa> | undefined;
  let invalid = false;
  try {
    configuration = normalizeHttpAutoMfa(mgr.formData.httpAutoMfa);
  } catch {
    invalid = true;
  }
  const [authenticator, setAuthenticator] = useState(() => {
    const index = configs.findIndex(
      (item) => item.id && item.id === configuration?.totpConfigId,
    );
    return index < 0 ? "" : String(index);
  });
  const [challengeId, setChallengeId] = useState(
    configuration?.challengeId ?? challenges[0]?.id ?? "",
  );
  let origin: string | null = null;
  try {
    origin = getHttpAutoMfaOrigin({
      protocol: mgr.formData.protocol!,
      hostname: mgr.formData.hostname ?? "",
      port: mgr.formData.port!,
    });
  } catch {
    /* A malformed or non-HTTPS target cannot receive consent. */
  }
  const selected =
    authenticator === "" ? undefined : configs[Number(authenticator)];
  const vaultId =
    mgr.formData.credentialSource?.kind === "vault"
      ? mgr.formData.credentialSource.totpId
      : undefined;
  const selectedVault = vaultChoices.entries.find(
    (entry) => entry.id === vaultId,
  );
  const challenge = challenges.find((item) => item.id === challengeId);
  const disable = () =>
    mgr.setFormData((previous) => ({
      ...previous,
      httpAutoMfa: { version: 1, enabled: false },
    }));
  const enable = () => {
    if (
      !(vault ? selectedVault : selected) ||
      !challenge ||
      !origin ||
      mgr.formData.httpVerifySsl === false
    )
      return;
    const expectedOrigin = origin;
    mgr.setFormData((previous) => {
      if (
        previous.httpApplication?.id !== profile.id ||
        previous.httpApplication.invalid ||
        previous.httpVerifySsl === false
      )
        return previous;
      const currentConfigs = previous.totpConfigs ?? [];
      if (
        vault
          ? previous.credentialSource?.kind !== "vault" ||
            mgr.formData.credentialSource?.kind !== "vault" ||
            previous.credentialSource.credentialId !==
              mgr.formData.credentialSource.credentialId ||
            previous.credentialSource.totpId !== selectedVault?.id
          : previous.credentialSource?.kind === "vault" ||
            currentConfigs[Number(authenticator)] !== selected
      )
        return previous;
      try {
        if (
          getHttpAutoMfaOrigin({
            protocol: previous.protocol!,
            hostname: previous.hostname ?? "",
            port: previous.port!,
          }) !== expectedOrigin
        )
          return previous;
      } catch {
        return previous;
      }
      if (vault && selectedVault)
        return {
          ...previous,
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: selectedVault.id,
            challengeId: challenge.id,
            origin: expectedOrigin,
          },
        };
      if (!selected) return previous;
      const stableId =
        selected.id &&
        currentConfigs.filter((item) => item.id === selected.id).length === 1
          ? selected.id
          : crypto.randomUUID();
      return {
        ...previous,
        totpConfigs: currentConfigs.map((item, index) =>
          index === Number(authenticator) ? { ...item, id: stableId } : item,
        ),
        httpAutoMfa: {
          version: 1,
          enabled: true,
          totpConfigId: stableId,
          challengeId: challenge.id,
          origin: expectedOrigin,
        },
      };
    });
  };
  return (
    <section
      aria-label="Automatic two-factor authentication"
      className="max-w-2xl space-y-3 rounded border border-[var(--color-border)] p-3"
    >
      <h4 className="text-sm font-medium">
        Automatic authenticator codes — optional
      </h4>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Off by default. Explicitly link an existing connection authenticator to
        one reviewed challenge and HTTPS origin. Save the connection to apply
        consent. Only a transient code is sent; no seed, recovery code, or
        remembered-device option is supplied. A rejected submission is not
        retried automatically.
      </p>
      {invalid && (
        <p role="alert" className="text-sm text-error">
          The saved automatic 2FA configuration is invalid. Disable it, then
          review the authenticator and origin before enabling again.
        </p>
      )}
      {!challenges.length ? (
        <p className="text-sm text-[var(--color-textSecondary)]">
          This application's MFA form is not supported for automatic codes. Use
          the website's interactive challenge and the session's 2FA Codes panel
          for manual copying. Passkeys, push approval, SSO and authenticator
          enrollment remain manual.
        </p>
      ) : (
        <>
          {!vault && !configs.length && (
            <p className="text-sm text-[var(--color-textSecondary)]">
              Configure an authenticator under Protocol → Recovery → 2FA / TOTP
              first. Use a secret already enrolled with this website; this does
              not enroll or reset an account.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-auth`} className="mb-1 block text-sm">
                {vault ? "Vault authenticator" : "Connection authenticator"}
              </label>
              <Select
                id={`${id}-auth`}
                value={vault ? (vaultId ?? "") : authenticator}
                disabled={
                  vault && (!vaultChoices.available || vaultChoices.loading)
                }
                onChange={(value) => {
                  if (vault) {
                    if (
                      value &&
                      !vaultChoices.entries.some((entry) => entry.id === value)
                    )
                      return;
                    mgr.setFormData((previous) => {
                      if (previous.credentialSource?.kind !== "vault")
                        return previous;
                      if (
                        previous.credentialSource.totpId ===
                        (value || undefined)
                      )
                        return previous;
                      const { totpId: _previousTotp, ...reference } =
                        previous.credentialSource;
                      return {
                        ...previous,
                        credentialSource: value
                          ? { ...reference, totpId: value }
                          : reference,
                        httpAutoMfa: { version: 1, enabled: false },
                      };
                    });
                    return;
                  }
                  setAuthenticator(value);
                  disable();
                }}
                options={[
                  { value: "", label: "Choose an authenticator" },
                  ...(vault
                    ? vaultChoices.entries.map((entry) => ({
                        value: entry.id,
                        label: entry.label,
                      }))
                    : configs.map((item, index) => ({
                        value: String(index),
                        label:
                          [item.issuer, item.account]
                            .filter(Boolean)
                            .join(" — ") || `Authenticator ${index + 1}`,
                      }))),
                ]}
                variant="form"
              />
            </div>
            <div>
              <label htmlFor={`${id}-challenge`} className="mb-1 block text-sm">
                Reviewed 2FA challenge
              </label>
              <Select
                id={`${id}-challenge`}
                value={challengeId}
                onChange={(value) => {
                  setChallengeId(value);
                  disable();
                }}
                options={challenges.map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
                variant="form"
              />
            </div>
          </div>
          {vault && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              Uses only the selected owning-vault authenticator. Local
              authenticators are ignored; no seed is copied into this
              connection.
            </p>
          )}
          {vaultChoices.error && vault && (
            <p role="alert" className="text-xs text-error">
              {vaultChoices.error}
            </p>
          )}
          <p className="text-xs text-[var(--color-textMuted)]">
            Allowed login paths: {challenge?.paths.join(", ") ?? "none"}. Custom
            paths or changed forms remain manual. CAPTCHA, external identity
            providers and security keys are not automated.
          </p>
          <p className="text-xs break-all">
            HTTPS origin:{" "}
            {origin ?? "Set a valid HTTPS host and port before enabling."}
          </p>
          {mgr.formData.httpVerifySsl === false && (
            <p className="text-sm text-warning">
              Enable SSL certificate verification in Security before enabling
              automatic codes. Disabling verification is not supported for
              automatic 2FA.
            </p>
          )}
          {configuration?.enabled && (
            <p role="status" className="text-sm">
              Automatic codes enabled in this draft for {configuration.origin}.
              {configuration.origin !== origin &&
                " The address changed: codes are blocked until you explicitly enable again for the new origin."}
            </p>
          )}
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={
              invalid ||
              !(vault ? selectedVault : selected) ||
              !challenge ||
              !origin ||
              mgr.formData.httpVerifySsl === false
            }
            onClick={enable}
          >
            Enable automatic codes for this origin
          </button>
        </>
      )}
      {(invalid || configuration?.enabled) && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={disable}
        >
          Disable automatic codes
        </button>
      )}
    </section>
  );
}
