import React, { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { useSettings } from "../../../../contexts/SettingsContext";
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
} from "../../../../types/security/passwordPolicy";
import {
  generatePolicyPassword,
  normalizePasswordPolicy,
  validateNewPassword,
} from "../../../../utils/security/passwordPolicy";
import {
  Card,
  SettingsSectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

export default function PasswordPolicySection() {
  const { settings, settingsReady, updateSettings } = useSettings();
  let invalidPolicy = false;
  try {
    normalizePasswordPolicy(settings.passwordPolicy);
  } catch {
    invalidPolicy = true;
  }
  const [draft, setDraft] = useState<PasswordPolicy>(() => {
    try {
      return normalizePasswordPolicy(settings.passwordPolicy);
    } catch {
      return { ...DEFAULT_PASSWORD_POLICY };
    }
  });
  const [minimum, setMinimum] = useState(String(draft.minLength));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState("");
  const ready = settingsReady === true;
  const access = useRef({ ready, policy: settings.passwordPolicy, epoch: 0 });
  if (
    access.current.ready !== ready ||
    access.current.policy !== settings.passwordPolicy
  )
    access.current = {
      ready,
      policy: settings.passwordPolicy,
      epoch: access.current.epoch + 1,
    };
  useEffect(
    () => () => {
      access.current.epoch++;
    },
    [],
  );
  useEffect(() => {
    if (!ready) setGenerated("");
  }, [ready]);
  const apply = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    setGenerated("");
    try {
      if (!/^\d+$/.test(minimum))
        throw new Error("Choose a whole-number minimum from 4 to 128.");
      const next = normalizePasswordPolicy({
        ...draft,
        minLength: Number(minimum),
      });
      await updateSettings({ passwordPolicy: next });
      setDraft(next);
      setMessage("Password policy saved. Existing passwords are unchanged.");
    } catch {
      setMessage(
        "Password policy was not saved. Unlock storage, check the minimum (4–128), and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setGenerated("");
    setMessage(null);
    const epoch = access.current.epoch;
    try {
      const password = generatePolicyPassword(settings.passwordPolicy);
      await validateNewPassword(password, "generator");
      if (!access.current.ready || access.current.epoch !== epoch) return;
      setGenerated(password);
    } catch {
      setMessage(
        "Unable to generate a password matching the saved policy. Unlock storage or save the policy and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-4"
      data-setting-key="passwordPolicy"
      aria-label="Local password policy"
    >
      <SettingsSectionHeader
        icon={<KeyRound className="w-4 h-4 text-primary" />}
        title="Local password policy"
      />
      <Card>
        {invalidPolicy && (
          <p role="alert" className="text-xs text-warning">
            The saved password policy is invalid. New-password operations are
            blocked. Review the values below and explicitly Apply to replace it.
          </p>
        )}
        <p className="text-xs text-textSecondary">
          Applies to newly created or changed application/database protection
          passwords and encrypted exports. Existing passwords still unlock and
          import unchanged; remote account passwords are unaffected. Database
          minimum: 4 characters; application and portable master-key export
          minimum: 8, even when disabled. Ordinary file exports keep their
          existing password-strength settings when this policy is off.
        </p>
        <fieldset disabled={!ready || busy} className="space-y-3">
          <Toggle
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
            label="Enforce additional password requirements"
          />
          <label className="flex items-center justify-between gap-4 text-sm">
            Minimum length
            <input
              aria-label="Password policy minimum length"
              type="number"
              min={4}
              max={128}
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              className="sor-form-input"
              style={{ width: "6rem" }}
            />
          </label>
          {(
            [
              ["requireUppercase", "Require uppercase (A–Z)"],
              ["requireLowercase", "Require lowercase (a–z)"],
              ["requireDigit", "Require digits (0–9)"],
              ["requireSymbol", "Require ASCII punctuation"],
            ] as const
          ).map(([key, label]) => (
            <Toggle
              key={key}
              checked={draft[key]}
              onChange={(value) => setDraft({ ...draft, [key]: value })}
              label={label}
            />
          ))}
          <p className="text-xs text-textSecondary">
            Length counts Unicode characters. These composition rules are not a
            password-strength guarantee. Apply changes before generating.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              onClick={() => void apply()}
            >
              Apply password policy
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              onClick={() => void generate()}
            >
              Generate using saved policy
            </button>
          </div>
        </fieldset>
        {!ready && (
          <p role="status" className="text-xs">
            Unlock and load settings to manage password policy.
          </p>
        )}
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
        {generated && ready && (
          <label className="block text-xs">
            Generated password (not saved or copied)
            <input
              className="sor-form-input font-mono"
              readOnly
              value={generated}
              aria-label="Generated policy password"
            />
            <button
              type="button"
              className="sor-btn sor-btn-secondary mt-2"
              onClick={() => setGenerated("")}
            >
              Clear generated password
            </button>
          </label>
        )}
      </Card>
    </section>
  );
}
