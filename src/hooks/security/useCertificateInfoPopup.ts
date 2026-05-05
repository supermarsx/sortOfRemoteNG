import { useState, useCallback } from 'react';
import type { CertIdentity, SshHostKeyIdentity, TrustRecord, TrustRecordType } from '../../utils/auth/trustStore';
import { isCertificateTrustRecordType, updateTrustRecordNickname } from '../../utils/auth/trustStore';

const TRUST_TYPE_LABELS: Record<
  TrustRecordType,
  { informationTitle: string; identityLower: string }
> = {
  https: { informationTitle: 'HTTPS Certificate Information', identityLower: 'HTTPS certificate' },
  certificate: { informationTitle: 'General Certificate Information', identityLower: 'general certificate' },
  rdp: { informationTitle: 'RDP Certificate Information', identityLower: 'RDP certificate' },
  ssh: { informationTitle: 'Host Key Information', identityLower: 'host key' },
  tls: { informationTitle: 'Legacy TLS Certificate Information', identityLower: 'legacy TLS certificate' },
};

export function useCertificateInfoPopup(
  type: TrustRecordType,
  host: string,
  port: number,
  currentIdentity: CertIdentity | SshHostKeyIdentity | undefined,
  trustRecord: TrustRecord | undefined,
  connectionId: string | undefined,
) {
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(trustRecord?.nickname ?? '');
  const [savedNick, setSavedNick] = useState(trustRecord?.nickname ?? '');

  const isCertificateType = isCertificateTrustRecordType(type);
  const typeLabels = TRUST_TYPE_LABELS[type];
  const identity = currentIdentity ?? trustRecord?.identity;

  const isCertIdentity = useCallback(
    (id: CertIdentity | SshHostKeyIdentity): id is CertIdentity =>
      'issuer' in id || 'validFrom' in id || 'serial' in id,
    [],
  );

  const isExpiringSoon = useCallback((id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    const daysLeft = (new Date(id.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysLeft > 0 && daysLeft <= 5;
  }, []);

  const isExpired = useCallback((id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    return new Date(id.validTo).getTime() < Date.now();
  }, []);

  const getTrustStatus = useCallback(() => {
    if (!trustRecord) return { label: 'Unknown', color: 'text-[var(--color-textSecondary)]', icon: 'ShieldAlert' as const };
    if (currentIdentity && trustRecord.identity.fingerprint !== currentIdentity.fingerprint) {
      return { label: 'Changed!', color: 'text-red-400', icon: 'ShieldAlert' as const };
    }
    if (trustRecord.userApproved) {
      return { label: 'Trusted', color: 'text-green-400', icon: 'ShieldCheck' as const };
    }
    return { label: 'Remembered', color: 'text-blue-400', icon: 'Shield' as const };
  }, [trustRecord, currentIdentity]);

  const saveNickname = useCallback(
    (nick: string) => {
      updateTrustRecordNickname(host, port, type, nick, connectionId);
      setSavedNick(nick);
      setEditingNick(false);
    },
    [host, port, type, connectionId],
  );

  const startEditing = useCallback(() => {
    setNickDraft(savedNick);
    setEditingNick(true);
  }, [savedNick]);

  const cancelEditing = useCallback(() => {
    setNickDraft(savedNick);
    setEditingNick(false);
  }, [savedNick]);

  return {
    editingNick,
    nickDraft,
    setNickDraft,
    savedNick,
    isCertificateType,
    typeLabels,
    identity,
    isCertIdentity,
    isExpiringSoon,
    isExpired,
    getTrustStatus,
    saveNickname,
    startEditing,
    cancelEditing,
  };
}
