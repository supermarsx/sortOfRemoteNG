import React, { CSSProperties, useEffect, useRef } from "react";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export interface MenuSurfacePosition {
  x: number;
  y: number;
}

interface MenuSurfaceProps {
  isOpen: boolean;
  onClose?: () => void;
  position: MenuSurfacePosition | null;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  closeOnEscape?: boolean;
  closeOnOutside?: boolean;
  dataTestId?: string;
  ignoreRefs?: Array<React.RefObject<HTMLElement | null>>;
}

export const MenuSurface: React.FC<MenuSurfaceProps> = ({
  isOpen,
  onClose,
  position,
  children,
  className,
  style,
  closeOnEscape = true,
  closeOnOutside = true,
  dataTestId,
  ignoreRefs = [],
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !onClose || !closeOnOutside) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target || null)) return;
      const shouldIgnore = ignoreRefs.some((ref) =>
        ref.current?.contains(target || null),
      );
      if (shouldIgnore) return;
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onClose, closeOnOutside, ignoreRefs]);

  useEffect(() => {
    if (!isOpen || !onClose || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen || !position) return null;

  return (
    <div
      ref={menuRef}
      className={cx("sor-menu-surface fixed z-[9999]", className)}
      style={{ left: position.x, top: position.y, ...style }}
      data-testid={dataTestId}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
};

export default MenuSurface;
