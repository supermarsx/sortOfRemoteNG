import React from "react";
import { Mgr, btnActive, btnDefault, SEND_KEY_OPTIONS } from "./helpers";

const SendKeysPopover: React.FC<{
  mgr: Mgr;
  handleSendKeys: (combo: string) => void;
}> = ({ mgr, handleSendKeys }) => (
  <div ref={mgr.sendKeysRef} className="relative">
    <button
      onClick={() => mgr.setShowSendKeys(!mgr.showSendKeys)}
      className={mgr.showSendKeys ? btnActive : btnDefault}
      title="Send key combination"
    >
      <Keyboard size={14} />
    </button>
    <PopoverSurface
      isOpen={mgr.showSendKeys}
      onClose={() => mgr.setShowSendKeys(false)}
      anchorRef={mgr.sendKeysRef}
      className="sor-popover-panel w-48 overflow-hidden"
      dataTestId="rdp-send-keys-popover"
    >
      <OptionList>
        <OptionGroup label="Send Key Sequence">
          {SEND_KEY_OPTIONS.map((item) => (
            <OptionItemButton
              key={item.id}
              onClick={() => {
                handleSendKeys(item.id);
                mgr.setShowSendKeys(false);
              }}
              disabled={!mgr.isConnected}
              className="text-xs"
            >
              {item.label}
            </OptionItemButton>
          ))}
        </OptionGroup>
      </OptionList>
    </PopoverSurface>
  </div>
);

export default SendKeysPopover;
