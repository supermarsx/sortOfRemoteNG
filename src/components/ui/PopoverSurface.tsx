import React, { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

type PopoverAlign = "start" | "center" | "end";

interface PopoverSurfaceProps {
  isOpen: boolean;
  onClose?: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  offset?: number;
  align?: PopoverAlign;
  closeOnEscape?: boolean;
  closeOnOutside?: boolean;
  viewportPadding?: number;
  dataTestId?: string;
}

interface PopoverPosition {
  top: number;
  left: number;
  visible: boolean;
}

export const PopoverSurface: React.FC<PopoverSurfaceProps> = ({
  isOpen,
  onClose,
  anchorRef,
  children,
  className,
  style,
  offset = 8,
  align = "end",
  closeOnEscape = true,
  closeOnOutside = true,
  viewportPadding = 4,
  dataTestId,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    visible: false,
  });

  const updatePosition = () => {
    if (!isOpen) return;
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const anchorRect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;

    let left = anchorRect.right - width;
    if (align === "start") left = anchorRect.left;
    if (align === "center") left = anchorRect.left + anchorRect.width / 2 - width / 2;

    let top = anchorRect.bottom + offset;

    if (left < viewportPadding) left = viewportPadding;
    if (left + width > window.innerWidth - viewportPadding) {
      left = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
    }

    if (top + height > window.innerHeight - viewportPadding) {
      const above = anchorRect.top - height - offset;
      if (above >= viewportPadding) {
        top = above;
      } else {
        top = Math.max(viewportPadding, window.innerHeight - height - viewportPadding);
      }
    }

    setPosition({ top, left, visible: true });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    setPosition((current) => ({ ...current, visible: false }));
    const raf = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, align, offset, viewportPadding]);

  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => updatePosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, align, offset, viewportPadding]);

  useEffect(() => {
    if (!isOpen || !onClose || !closeOnOutside) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target || null)) return;
      if (anchorRef.current?.contains(target || null)) return;
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onClose, closeOnOutside, anchorRef]);

  useEffect(() => {
    if (!isOpen || !onClose || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className={cx("fixed z-[9999]", className)}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? "visible" : "hidden",
        ...style,
      }}
      data-testid={dataTestId}
    >
      {children}
    </div>,
    document.body,
  );
};

export default PopoverSurface;
