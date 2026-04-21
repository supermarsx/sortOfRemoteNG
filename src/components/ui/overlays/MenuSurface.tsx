import React, { CSSProperties, useEffect, useRef } from "react";
import { cx } from "../lib/cx";

const MENU_SELECTOR = '[role="menu"]';
const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
  "button:not([disabled]):not([role])",
  "[href]:not([role])",
  '[tabindex]:not([tabindex="-1"]):not([role])',
].join(", ");

const isVisible = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
};

const getOwningMenu = (
  element: HTMLElement | null,
  fallback: HTMLElement,
): HTMLElement => {
  if (!element) return fallback;
  return element.closest<HTMLElement>(MENU_SELECTOR) ?? fallback;
};

const getMenuItems = (menu: HTMLElement | null): HTMLElement[] => {
  if (!menu) return [];

  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter(
    (element) => element.closest<HTMLElement>(MENU_SELECTOR) === menu && isVisible(element),
  );
};

const syncRovingState = (
  items: HTMLElement[],
  activeElement: HTMLElement | null,
): HTMLElement | null => {
  if (items.length === 0) return null;

  const fallback = items[0] ?? null;
  const active = activeElement && items.includes(activeElement) ? activeElement : fallback;

  for (const item of items) {
    if (!item.hasAttribute("role")) {
      item.setAttribute("role", "menuitem");
    }
    item.tabIndex = item === active ? 0 : -1;
  }

  return active;
};

const getSubmenuForTrigger = (trigger: HTMLElement): HTMLElement | null => {
  const controlledMenuId = trigger.getAttribute("aria-controls");
  if (controlledMenuId) {
    const controlledMenu = document.getElementById(controlledMenuId);
    if (controlledMenu) return controlledMenu;
  }

  return trigger
    .closest<HTMLElement>(".sor-menu-submenu")
    ?.querySelector<HTMLElement>(".sor-menu-submenu-panel") ?? null;
};

const openSubmenu = (trigger: HTMLElement): HTMLElement | null => {
  const submenu = getSubmenuForTrigger(trigger);
  if (!submenu) return null;

  trigger.closest<HTMLElement>(".sor-menu-submenu")?.setAttribute("data-submenu-open", "true");
  trigger.setAttribute("aria-expanded", "true");
  return submenu;
};

const closeSubmenu = (submenu: HTMLElement): HTMLElement | null => {
  const triggerId = submenu.getAttribute("aria-labelledby");
  if (!triggerId) return null;

  const trigger = document.getElementById(triggerId);
  if (!(trigger instanceof HTMLElement)) return null;

  trigger.closest<HTMLElement>(".sor-menu-submenu")?.setAttribute("data-submenu-open", "false");
  trigger.setAttribute("aria-expanded", "false");
  trigger.focus();
  return trigger;
};

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
  ariaLabel?: string;
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
  ariaLabel,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Clamp menu position to viewport after it renders
  useEffect(() => {
    if (!isOpen || !menuRef.current || !position) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = position.x;
    let y = position.y;
    if (x + rect.width > vw - 4) x = Math.max(4, vw - rect.width - 4);
    if (y + rect.height > vh - 4) y = Math.max(4, vh - rect.height - 4);
    if (x !== position.x) el.style.left = `${x}px`;
    if (y !== position.y) el.style.top = `${y}px`;
  });

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

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const frame = requestAnimationFrame(() => {
      const items = getMenuItems(menuRef.current);
      const first = syncRovingState(items, items[0] ?? null);
      (first ?? menuRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen || !position) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rootMenu = menuRef.current;
    if (!rootMenu) return;

    const active = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const currentMenu = getOwningMenu(active, rootMenu);
    const items = getMenuItems(currentMenu);
    if (items.length === 0) return;

    const currentIndex = active ? items.indexOf(active) : -1;

    const focusAt = (index: number) => {
      const wrapped = (index + items.length) % items.length;
      const next = syncRovingState(items, items[wrapped] ?? null);
      next?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case "ArrowRight": {
        if (!active || active.getAttribute("aria-haspopup") !== "menu") break;
        event.preventDefault();
        const submenu = openSubmenu(active);
        if (!submenu) break;
        requestAnimationFrame(() => {
          const submenuItems = getMenuItems(submenu);
          const first = syncRovingState(submenuItems, submenuItems[0] ?? null);
          (first ?? submenu)?.focus();
        });
        break;
      }
      case "ArrowLeft": {
        if (currentMenu === rootMenu) break;
        event.preventDefault();
        closeSubmenu(currentMenu);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      ref={menuRef}
      className={cx("sor-menu-surface fixed z-[9999]", className)}
      style={{ left: position.x, top: position.y, ...style }}
      data-testid={dataTestId}
      tabIndex={-1}
      role="menu"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
};

export default MenuSurface;
