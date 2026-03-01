import { WebTerminalMgr } from "./types";

function HostKeyPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.keyPopupRef}>
      <button
        type="button"
        onClick={() => mgr.setShowKeyPopup((v) => !v)}
        className="app-bar-button p-2"
        data-tooltip="Host key info"
        aria-label="Host key info"
      >
        <Fingerprint size={14} />
      </button>
      {mgr.showKeyPopup && (
        <CertificateInfoPopup
          type="ssh"
          host={mgr.session.hostname}
          port={mgr.connection?.port || 22}
          currentIdentity={mgr.hostKeyIdentity ?? undefined}
          trustRecord={getStoredIdentity(
            mgr.session.hostname,
            mgr.connection?.port || 22,
            "ssh",
            mgr.connection?.id,
          )}
          connectionId={mgr.connection?.id}
          triggerRef={mgr.keyPopupRef}
          onClose={() => mgr.setShowKeyPopup(false)}
        />
      )}
    </div>
  );
}

export default HostKeyPopover;
