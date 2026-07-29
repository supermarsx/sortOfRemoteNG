import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CertIdentity, SshHostKeyIdentity, TrustRecord, TrustRecordType } from '../../utils/auth/trustStore';
import { isCertificateTrustRecordType, updateTrustRecordNickname } from '../../utils/auth/trustStore';

export function useCertificateInfoPopup(
  type: TrustRecordType,
  host: string,
  port: number,
  currentIdentity: CertIdentity | SshHostKeyIdentity | undefined,
  trustRecord: TrustRecord | undefined,
  connectionId: string | undefined,
) {
  const { t } = useTranslation();
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(trustRecord?.nickname ?? '');
  const [savedNick, setSavedNick] = useState(trustRecord?.nickname ?? '');

  const isCertificateType = isCertificateTrustRecordType(type);
  const typeLabels: Record<
    TrustRecordType,
    { informationTitle: string; identityLower: string }
  > = {
    https: {
      informationTitle: t('certificateInfo.type.https.informationTitle', {
        defaultValue: 'HTTPS Certificate Information',
      }),
      identityLower: t('certificateInfo.type.https.identityLower', {
        defaultValue: 'HTTPS certificate',
      }),
    },
    certificate: {
      informationTitle: t(
        'certificateInfo.type.certificate.informationTitle',
        {
          defaultValue: 'General Certificate Information',
        },
      ),
      identityLower: t('certificateInfo.type.certificate.identityLower', {
        defaultValue: 'general certificate',
      }),
    },
    rdp: {
      informationTitle: t('certificateInfo.type.rdp.informationTitle', {
        defaultValue: 'RDP Certificate Information',
      }),
      identityLower: t('certificateInfo.type.rdp.identityLower', {
        defaultValue: 'RDP certificate',
      }),
    },
    ssh: {
      informationTitle: t('certificateInfo.type.ssh.informationTitle', {
        defaultValue: 'Host Key Information',
      }),
      identityLower: t('certificateInfo.type.ssh.identityLower', {
        defaultValue: 'host key',
      }),
    },
    tls: {
      informationTitle: t('certificateInfo.type.tls.informationTitle', {
        defaultValue: 'Legacy TLS Certificate Information',
      }),
      identityLower: t('certificateInfo.type.tls.identityLower', {
        defaultValue: 'legacy TLS certificate',
      }),
    },
  };
  const selectedTypeLabels = typeLabels[type];
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
    if (!trustRecord) return {
      label: t('certificateInfo.status.unknown', {
        defaultValue: 'Unknown',
      }),
      color: 'text-[var(--color-textSecondary)]',
      icon: 'ShieldAlert' as const,
    };
    if (currentIdentity && trustRecord.identity.fingerprint !== currentIdentity.fingerprint) {
      return {
        label: t('certificateInfo.status.changed', {
          defaultValue: 'Changed!',
        }),
        color: 'text-red-400',
        icon: 'ShieldAlert' as const,
      };
    }
    if (trustRecord.userApproved) {
      return {
        label: t('certificateInfo.status.trusted', {
          defaultValue: 'Trusted',
        }),
        color: 'text-green-400',
        icon: 'ShieldCheck' as const,
      };
    }
    return {
      label: t('certificateInfo.status.remembered', {
        defaultValue: 'Remembered',
      }),
      color: 'text-blue-400',
      icon: 'Shield' as const,
    };
  }, [trustRecord, currentIdentity, t]);

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
    typeLabels: selectedTypeLabels,
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
