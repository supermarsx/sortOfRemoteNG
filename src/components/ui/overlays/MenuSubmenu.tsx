import React, { useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export default function MenuSubmenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const panelId = useId();
  return (
    <div
      className="sor-menu-submenu"
      data-submenu-open={open ? "true" : "false"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        role="menuitem"
        className="sor-menu-item"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
          requestAnimationFrame(() =>
            panel.current
              ?.querySelector<HTMLElement>(
                '[role="menuitem"]:not([disabled]),button:not([disabled])',
              )
              ?.focus(),
          );
        }}
      >
        {icon}
        {label}
        <ChevronRight size={12} className="ml-auto opacity-50" />
      </button>
      <div
        ref={panel}
        id={panelId}
        role="menu"
        className="sor-menu-submenu-panel"
        aria-labelledby={id}
        tabIndex={-1}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        {children}
      </div>
    </div>
  );
}
