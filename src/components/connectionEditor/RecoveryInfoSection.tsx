import React, { useState } from 'react';
import { LifeBuoy, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { Connection, RecoveryInfo } from '../../types/connection/connection';
import { Textarea } from '../ui/forms';

interface RecoveryInfoSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const RecoveryInfoSection: React.FC<RecoveryInfoSectionProps> = ({ formData, setFormData }) => {
  const [expanded, setExpanded] = useState(false);
  const [showSeed, setShowSeed] = useState(false);

  if (formData.isGroup) return null;

  const info = formData.recoveryInfo ?? {};

  const updateInfo = (patch: Partial<RecoveryInfo>) => {
    const merged = { ...info, ...patch };
    // Clean empty strings
    const cleaned: RecoveryInfo = {};
    if (merged.phone?.trim()) cleaned.phone = merged.phone.trim();
    if (merged.alternativeEmail?.trim()) cleaned.alternativeEmail = merged.alternativeEmail.trim();
    if (merged.alternativePhone?.trim()) cleaned.alternativePhone = merged.alternativePhone.trim();
    if (merged.alternativeEquipment?.trim()) cleaned.alternativeEquipment = merged.alternativeEquipment.trim();
    if (merged.seedPhrase?.trim()) cleaned.seedPhrase = merged.seedPhrase.trim();
    setFormData(prev => ({
      ...prev,
      recoveryInfo: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    }));
  };

  const filledCount = [info.phone, info.alternativeEmail, info.alternativePhone, info.alternativeEquipment, info.seedPhrase]
    .filter(v => v && v.trim()).length;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="sor-settings-row"
      >
        <div className="flex items-center space-x-2">
          <LifeBuoy size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            Recovery Information
          </span>
          {filledCount > 0 && (
            <span className="sor-micro-badge">
              {filledCount} field{filledCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-[var(--color-textSecondary)]" /> : <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-textMuted)]">
            Store recovery contact details and seed phrases for this connection's account.
          </p>

          <div className="sor-recovery-grid">
            {/* Phone */}
            <label className="sor-form-label-xs" htmlFor="recovery-phone">
              Recovery Phone
            </label>
            <input
              id="recovery-phone"
              type="tel"
              value={info.phone ?? ''}
              onChange={(e) => updateInfo({ phone: e.target.value })}
              placeholder="+1 (555) 123-4567"
              className="sor-form-input-sm w-full"
            />

            {/* Alternative Email */}
            <label className="sor-form-label-xs" htmlFor="recovery-email">
              Alternative Email
            </label>
            <input
              id="recovery-email"
              type="email"
              value={info.alternativeEmail ?? ''}
              onChange={(e) => updateInfo({ alternativeEmail: e.target.value })}
              placeholder="recovery@example.com"
              className="sor-form-input-sm w-full"
            />

            {/* Alternative Phone */}
            <label className="sor-form-label-xs" htmlFor="recovery-alt-phone">
              Alternative Phone
            </label>
            <input
              id="recovery-alt-phone"
              type="tel"
              value={info.alternativePhone ?? ''}
              onChange={(e) => updateInfo({ alternativePhone: e.target.value })}
              placeholder="+1 (555) 987-6543"
              className="sor-form-input-sm w-full"
            />

            {/* Alternative Equipment */}
            <label className="sor-form-label-xs" htmlFor="recovery-equipment">
              Alternative Equipment
            </label>
            <input
              id="recovery-equipment"
              type="text"
              value={info.alternativeEquipment ?? ''}
              onChange={(e) => updateInfo({ alternativeEquipment: e.target.value })}
              placeholder="Hardware key, backup device, etc."
              className="sor-form-input-sm w-full"
            />
          </div>

          {/* Seed Phrase */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="sor-form-label-xs mb-0" htmlFor="recovery-seed">
                Recovery Seed Phrase
              </label>
              <button
                type="button"
                onClick={() => setShowSeed(!showSeed)}
                className="p-0.5 text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
                title={showSeed ? 'Hide seed phrase' : 'Show seed phrase'}
              >
                {showSeed ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <Textarea
              id="recovery-seed"
              value={info.seedPhrase ?? ''}
              onChange={(e) => updateInfo({ seedPhrase: e.target.value })}
              placeholder="Enter recovery seed phrase words"
              className={`sor-form-textarea-sm w-full h-16 font-mono resize-none ${!showSeed && info.seedPhrase ? 'blur-sm hover:blur-none focus:blur-none' : ''}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default RecoveryInfoSection;
