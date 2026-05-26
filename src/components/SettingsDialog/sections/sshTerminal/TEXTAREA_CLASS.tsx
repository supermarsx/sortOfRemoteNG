import type { SectionProps } from "./types";

import React from "react";
import { Zap } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";
import { Select, Textarea } from "../../../ui/forms";

const TEXTAREA_CLASS =
  "w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary";

/* ── Known OpenSSH algorithm names, ordered modern → legacy ──── */

interface SuggestionGroup {
  label: string;
  values: string[];
}

const CIPHER_SUGGESTIONS: SuggestionGroup[] = [
  {
    label: "Modern",
    values: [
      "chacha20-poly1305@openssh.com",
      "aes256-gcm@openssh.com",
      "aes128-gcm@openssh.com",
      "aes256-ctr",
      "aes192-ctr",
      "aes128-ctr",
    ],
  },
  {
    label: "Legacy",
    values: ["aes256-cbc", "aes192-cbc", "aes128-cbc", "3des-cbc"],
  },
];

const MAC_SUGGESTIONS: SuggestionGroup[] = [
  {
    label: "Modern (encrypt-then-MAC)",
    values: [
      "hmac-sha2-256-etm@openssh.com",
      "hmac-sha2-512-etm@openssh.com",
      "umac-128-etm@openssh.com",
      "umac-64-etm@openssh.com",
    ],
  },
  {
    label: "Standard",
    values: [
      "hmac-sha2-256",
      "hmac-sha2-512",
      "umac-128@openssh.com",
      "umac-64@openssh.com",
    ],
  },
  { label: "Legacy", values: ["hmac-sha1", "hmac-md5"] },
];

const KEX_SUGGESTIONS: SuggestionGroup[] = [
  {
    label: "Modern",
    values: [
      "sntrup761x25519-sha512@openssh.com",
      "curve25519-sha256",
      "curve25519-sha256@libssh.org",
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
    ],
  },
  {
    label: "Diffie-Hellman",
    values: [
      "diffie-hellman-group16-sha512",
      "diffie-hellman-group18-sha512",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group14-sha256",
    ],
  },
  {
    label: "Legacy",
    values: ["diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
  },
];

const HOSTKEY_SUGGESTIONS: SuggestionGroup[] = [
  {
    label: "Modern",
    values: [
      "ssh-ed25519",
      "ssh-ed25519-cert-v01@openssh.com",
      "rsa-sha2-512",
      "rsa-sha2-512-cert-v01@openssh.com",
      "rsa-sha2-256",
      "rsa-sha2-256-cert-v01@openssh.com",
    ],
  },
  {
    label: "ECDSA",
    values: [
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
    ],
  },
  { label: "Legacy", values: ["ssh-rsa", "ssh-dss"] },
];

/* ── Suggestion picker (append-to-textarea) ──────────────────── */

const ADD_PLACEHOLDER = "__placeholder__";

const AddSuggestion: React.FC<{
  groups: SuggestionGroup[];
  existing: string[];
  onAdd: (value: string) => void;
}> = ({ groups, existing, onAdd }) => {
  const options: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }> = [{ value: ADD_PLACEHOLDER, label: "+ Add known value…" }];
  for (const g of groups) {
    options.push({
      value: `__group__${g.label}`,
      label: `— ${g.label} —`,
      disabled: true,
    });
    for (const v of g.values) {
      options.push({
        value: v,
        label: existing.includes(v) ? `${v} ✓` : v,
        disabled: existing.includes(v),
      });
    }
  }
  return (
    <Select
      value={ADD_PLACEHOLDER}
      onChange={(v: string) => {
        if (v === ADD_PLACEHOLDER) return;
        if (v.startsWith("__group__")) return;
        if (existing.includes(v)) return;
        onAdd(v);
      }}
      options={options}
      variant="form-sm"
      className="w-48"
      aria-label="Add known value"
    />
  );
};

/* ── Section ─────────────────────────────────────────────────── */

interface PreferredField {
  field:
    | "preferredCiphers"
    | "preferredMACs"
    | "preferredKeyExchanges"
    | "preferredHostKeyAlgorithms";
  tKey: string;
  fallback: string;
  placeholder: string;
  rows: number;
  suggestions: SuggestionGroup[];
}

const FIELDS: PreferredField[] = [
  {
    field: "preferredCiphers",
    tKey: "settings.sshTerminal.preferredCiphers",
    fallback: "Preferred Ciphers",
    placeholder: "One cipher per line",
    rows: 4,
    suggestions: CIPHER_SUGGESTIONS,
  },
  {
    field: "preferredMACs",
    tKey: "settings.sshTerminal.preferredMACs",
    fallback: "Preferred MACs",
    placeholder: "One MAC per line",
    rows: 3,
    suggestions: MAC_SUGGESTIONS,
  },
  {
    field: "preferredKeyExchanges",
    tKey: "settings.sshTerminal.preferredKEX",
    fallback: "Preferred Key Exchanges",
    placeholder: "One key exchange per line",
    rows: 4,
    suggestions: KEX_SUGGESTIONS,
  },
  {
    field: "preferredHostKeyAlgorithms",
    tKey: "settings.sshTerminal.preferredHostKeys",
    fallback: "Preferred Host Key Algorithms",
    placeholder: "One algorithm per line",
    rows: 4,
    suggestions: HOSTKEY_SUGGESTIONS,
  },
];

const AdvancedSSHSection: React.FC<SectionProps> = ({ cfg, up, t }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Zap className="w-4 h-4 text-primary" />}
      title={t("settings.sshTerminal.advancedSSH", "Advanced SSH Options")}
    />
    <Card>
      <p className="text-xs text-[var(--color-textSecondary)]">
        {t(
          "settings.sshTerminal.advancedSSHDesc",
          "Configure preferred encryption ciphers, MACs, key exchanges, and host key algorithms. Items are tried in order of preference.",
        )}
      </p>

      <div className="space-y-4">
        {FIELDS.map(({ field, tKey, fallback, placeholder, rows, suggestions }) => {
          const values = cfg[field] as string[];
          return (
            <div key={field}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-sm text-[var(--color-textSecondary)]">
                  {t(tKey, fallback)}
                </label>
                <AddSuggestion
                  groups={suggestions}
                  existing={values}
                  onAdd={(v) => up({ [field]: [...values, v] } as any)}
                />
              </div>
              <Textarea
                value={values.join("\n")}
                onChange={(v) =>
                  up({ [field]: v.split("\n").filter(Boolean) } as any)
                }
                rows={rows}
                className={TEXTAREA_CLASS}
                placeholder={placeholder}
              />
            </div>
          );
        })}
      </div>
    </Card>
  </div>
);

export { AdvancedSSHSection };
export default TEXTAREA_CLASS;
