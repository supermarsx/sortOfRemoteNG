import React from "react";
import { X } from "lucide-react";
import { PopoverSurface } from "./PopoverSurface";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

interface ToolbarPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  dataTestId?: string;
}

export const ToolbarPopover: React.FC<ToolbarPopoverProps> = ({
  isOpen,
  onClose,
  anchorRef,
  children,
  className,
  dataTestId,
}) => (
  <PopoverSurface
    isOpen={isOpen}
    onClose={onClose}
    anchorRef={anchorRef}
    className={cx("sor-toolbar-popup", className)}
    dataTestId={dataTestId}
  >
    {children}
  </PopoverSurface>
);

interface ToolbarPopoverHeaderProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  titleClassName?: string;
  showCloseButton?: boolean;
}

export const ToolbarPopoverHeader: React.FC<ToolbarPopoverHeaderProps> = ({
  title,
  icon,
  actions,
  onClose,
  className,
  titleClassName,
  showCloseButton = true,
}) => (
  <div className={cx("sor-toolbar-popover-header", className)}>
    <div className="sor-toolbar-popover-title-group">
      {icon}
      <h3 className={cx("sor-toolbar-popover-title", titleClassName)}>
        {title}
      </h3>
    </div>
    <div className="sor-toolbar-popover-actions">
      {actions}
      {showCloseButton && onClose && (
        <button
          onClick={onClose}
          className="sor-toolbar-popover-action-btn"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  </div>
);

export default ToolbarPopover;
