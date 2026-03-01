import React from "react";
import { Mgr, RDPClientHeaderProps, btnDefault, btnDisabled } from "./helpers";

const ConnectionControls: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => (
  <>
    <button
      onClick={p.handleReconnect}
      className={mgr.canReconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canReconnect}
      title="Reconnect"
    >
      <RefreshCw size={14} />
    </button>
    <button
      onClick={p.handleDisconnect}
      className={mgr.canDisconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canDisconnect}
      title="Disconnect"
    >
      <Unplug size={14} />
    </button>
    <button
      onClick={p.handleSignOut}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      title="Sign out remote session"
    >
      <LogOut size={14} />
    </button>
    <button
      onClick={() => mgr.setShowRebootConfirm(true)}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      title="Reboot remote machine"
    >
      <Power size={14} />
    </button>
  </>
);

export default ConnectionControls;
