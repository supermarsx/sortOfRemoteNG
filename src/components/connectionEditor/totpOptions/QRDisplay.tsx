import React from "react";

const QRDisplay: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.qrDataUrl) return null;
  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 flex flex-col items-center space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mgr.qrDataUrl}
        alt="TOTP QR Code"
        className="w-40 h-40 rounded"
      />
      <p className="text-[10px] text-[var(--color-textSecondary)]">
        Scan with your authenticator app
      </p>
      <button
        type="button"
        onClick={() => mgr.setQrDataUrl(null)}
        className="text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
};

export default QRDisplay;
