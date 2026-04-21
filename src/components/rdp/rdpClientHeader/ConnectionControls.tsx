import React from "react";
import { Mgr, RDPClientHeaderProps, btnDefault, btnDisabled } from "./helpers";
import { LogOut, Power, RefreshCw, Unplug } from "lucide-react";

const ConnectionControls: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => (
  <>
    <button
      onClick={p.handleReconnect}
      className={mgr.canReconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canReconnect}
      data-tooltip="Reconnect"
    >
      <RefreshCw size={14} />
    </button>
    <button
      onClick={p.handleDisconnect}
      className={mgr.canDisconnect ? btnDefault : btnDisabled}
      disabled={!mgr.canDisconnect}
      data-tooltip="Disconnect"
    >
      <Unplug size={14} />
    </button>
    <button
      onClick={p.handleSignOut}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      data-tooltip="Sign out remote session"
    >
      <LogOut size={14} />
    </button>
    <button
      onClick={() => mgr.setShowRebootConfirm(true)}
      className={mgr.isConnected ? btnDefault : btnDisabled}
      disabled={!mgr.isConnected}
      data-tooltip="Reboot remote machine"
    >
      <Power size={14} />
    </button>
  </>
);

export default ConnectionControls;
