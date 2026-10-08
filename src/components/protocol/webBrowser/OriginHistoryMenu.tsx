import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MenuSurface } from "../../ui/overlays/MenuSurface";
import OriginHistoryList from "./OriginHistoryList";
import type { OriginPageMenuController } from "../../../hooks/protocol/useOriginPageMenu";

export default function OriginHistoryMenu({
  direction,
  controller,
  canOpen,
  eligible,
  assertOwner,
  onOverlayChange,
}: {
  direction: "back" | "forward";
  controller: OriginPageMenuController;
  canOpen: boolean;
  eligible: boolean;
  assertOwner: () => void;
  onOverlayChange: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const close = () => {
    setPosition(null);
    onOverlayChange(false);
  };
  useLayoutEffect(() => {
    if (!eligible) {
      setPosition(null);
      onOverlayChange(false);
    }
    return () => onOverlayChange(false);
  }, [eligible, onOverlayChange]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="sor-btn px-0.5 py-1.5 shrink-0"
        aria-label={direction === "back" ? "Back history" : "Forward history"}
        aria-haspopup="menu"
        aria-expanded={!!position}
        disabled={!canOpen && !position}
        onClick={() => {
          if (position) {
            close();
            return;
          }
          try {
            assertOwner();
          } catch {
            return;
          }
          const box = trigger.current?.getBoundingClientRect();
          if (!box) return;
          onOverlayChange(true);
          setPosition({ x: box.left, y: box.bottom + 4 });
          void controller.refreshHistory();
        }}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <MenuSurface
        isOpen={!!position && eligible}
        position={position}
        onClose={close}
        ignoreRefs={[trigger]}
        ariaLabel={`${direction} history`}
        className="w-80 max-w-[calc(100vw-1rem)]"
      >
        <OriginHistoryList
          controller={controller}
          direction={direction}
          onJump={(index) => {
            close();
            controller.jump(index);
          }}
        />
      </MenuSurface>
    </>
  );
}
