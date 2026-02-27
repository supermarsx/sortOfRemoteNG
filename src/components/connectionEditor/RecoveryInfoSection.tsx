import React, { useState } from 'react';
import { LifeBuoy, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { Connection, RecoveryInfo } from '../../types/connection';

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
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <LifeBuoy size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">
            Recovery Information
          </span>
          {filledCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded-full">
              {filledCount} field{filledCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Store recovery contact details and seed phrases for this connection's account.
          </p>

          {/* Phone */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              Recovery Phone
            </label>
            <input
              type="tel"
              value={info.phone ?? ''}
              onChange={(e) => updateInfo({ phone: e.target.value })}
              placeholder="+1 (555) 123-4567"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
            />
          </div>

          {/* Alternative Email */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              Alternative Email
            </label>
            <input
              type="email"
              value={info.alternativeEmail ?? ''}
              onChange={(e) => updateInfo({ alternativeEmail: e.target.value })}
              placeholder="recovery@example.com"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
            />
          </div>

          {/* Alternative Phone */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              Alternative Phone
            </label>
            <input
              type="tel"
              value={info.alternativePhone ?? ''}
              onChange={(e) => updateInfo({ alternativePhone: e.target.value })}
              placeholder="+1 (555) 987-6543"
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
            />
          </div>

          {/* Alternative Equipment */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
              Alternative Equipment
            </label>
            <input
              type="text"
              value={info.alternativeEquipment ?? ''}
              onChange={(e) => updateInfo({ alternativeEquipment: e.target.value })}
              placeholder="Hardware key, backup device, etc."
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
            />
          </div>

          {/* Seed Phrase */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                Recovery Seed Phrase
              </label>
              <button
                type="button"
                onClick={() => setShowSeed(!showSeed)}
                className="p-0.5 text-gray-500 hover:text-white transition-colors"
                title={showSeed ? 'Hide seed phrase' : 'Show seed phrase'}
              >
                {showSeed ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
            <textarea
              value={info.seedPhrase ?? ''}
              onChange={(e) => updateInfo({ seedPhrase: e.target.value })}
              placeholder="Enter recovery seed phrase words"
              className={`w-full h-16 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono placeholder-gray-500 resize-none ${!showSeed && info.seedPhrase ? 'blur-sm hover:blur-none focus:blur-none' : ''}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default RecoveryInfoSection;
