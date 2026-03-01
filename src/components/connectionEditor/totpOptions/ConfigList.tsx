import ConfigEditRow from "./ConfigEditRow";
import ConfigRow from "./ConfigRow";
import React from "react";

const ConfigList: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <>
    {mgr.configs.length === 0 && !mgr.showAddForm && (
      <p className="text-xs text-[var(--color-textMuted)] text-center py-2">
        No 2FA configurations. Add one to enable TOTP for this connection.
      </p>
    )}
    {mgr.configs.map((cfg) =>
      mgr.editingSecret === cfg.secret ? (
        <ConfigEditRow key={cfg.secret} mgr={mgr} />
      ) : (
        <ConfigRow key={cfg.secret} cfg={cfg} mgr={mgr} />
      ),
    )}
  </>
);

export default ConfigList;
