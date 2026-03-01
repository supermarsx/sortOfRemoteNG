import React from "react";

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

interface OptionListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const OptionList: React.FC<OptionListProps> = ({
  children,
  className,
  ...rest
}) => (
  <div className={cx("sor-option-list", className)} {...rest}>
    {children}
  </div>
);

interface OptionGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  label?: React.ReactNode;
  labelClassName?: string;
}

export const OptionGroup: React.FC<OptionGroupProps> = ({
  children,
  label,
  className,
  labelClassName,
  ...rest
}) => (
  <section className={cx("sor-option-group", className)} {...rest}>
    {label && (
      <div className={cx("sor-option-group-label", labelClassName)}>
        {label}
      </div>
    )}
    {children}
  </section>
);

interface OptionItemButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  compact?: boolean;
  selected?: boolean;
  divider?: boolean;
}

export const OptionItemButton: React.FC<OptionItemButtonProps> = ({
  children,
  className,
  compact = false,
  selected = false,
  divider = false,
  disabled = false,
  ...rest
}) => (
  <button
    className={cx(
      "sor-option-item",
      "sor-option-item-interactive",
      compact && "sor-option-item-compact",
      selected && "sor-option-item-selected",
      divider && "sor-option-item-divider",
      disabled && "sor-option-item-disabled",
      className,
    )}
    disabled={disabled}
    {...rest}
  >
    {children}
  </button>
);

interface OptionEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const OptionEmptyState: React.FC<OptionEmptyStateProps> = ({
  children,
  className,
  ...rest
}) => (
  <div className={cx("sor-option-empty", className)} {...rest}>
    {children}
  </div>
);

export default OptionList;
