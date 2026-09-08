import { Key } from "lucide-react";
import {
  Card,
  SettingsSectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

export default function KeyDerivationSection() {
  return (
    <div className="space-y-4" data-setting-key="keyDerivationIterations">
      <SettingsSectionHeader
        icon={<Key className="w-4 h-4 text-primary" />}
        title="Key derivation (read-only)"
      />
      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          Native master-password protection uses Argon2id. Database passwords
          use PBKDF2-SHA256 with parameters stored in each versioned database
          envelope. Export password defaults are separate and are configured
          below. Legacy iteration and benchmark preferences do not configure
          these formats or re-encrypt existing data.
        </p>
      </Card>
    </div>
  );
}
