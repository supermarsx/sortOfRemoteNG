import React from 'react';
import { X, type LucideIcon } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface DialogHeaderProps {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Tailwind text-color class for the icon, e.g. "text-amber-400" */
  iconColor?: string;
  /** Tailwind bg class for the icon pill (standard variant only), e.g. "bg-amber-500/20" */
  iconBg?: string;
  /** Dialog title */
  title: React.ReactNode;
  /** Small subtitle rendered below the title */
  subtitle?: React.ReactNode;
  /** Inline badge/chip rendered after the title, e.g. a count */
  badge?: React.ReactNode;
  /** "standard" = icon pill + text-lg title; "compact" = bare icon + text-sm title */
  variant?: 'standard' | 'compact';
  /** Makes the header sticky at the top with z-index */
  sticky?: boolean;
  /** Slot for action buttons placed before the close button */
  actions?: React.ReactNode;
  /** Close handler; omit to hide the close button */
  onClose?: () => void;
  /** Additional className on the outer wrapper */
  className?: string;
}

export const DialogHeader: React.FC<DialogHeaderProps> = ({
  icon: Icon,
  iconColor = 'text-blue-400',
  iconBg = 'bg-blue-500/20',
  title,
  subtitle,
  badge,
  variant = 'standard',
  sticky = false,
  actions,
  onClose,
  className,
}) => {
  const isCompact = variant === 'compact';

  return (
    <div
      className={cx(
        'flex items-center justify-between border-b border-[var(--color-border)]',
        isCompact ? 'px-5 py-3 bg-[var(--color-surface)]/60' : 'px-5 py-4',
        sticky && 'sticky top-0 z-10 bg-[var(--color-surface)]',
        className,
      )}
    >
      <div className={cx('flex items-center', isCompact ? 'gap-3' : 'space-x-3')}>
        {isCompact ? (
          <Icon size={18} className={iconColor} />
        ) : (
          <div className={cx('p-2 rounded-lg', iconBg)}>
            <Icon size={18} className={iconColor} />
          </div>
        )}
        {subtitle ? (
          <div>
            <h2
              className={cx(
                'font-semibold text-[var(--color-text)]',
                isCompact ? 'text-sm' : 'text-lg',
              )}
            >
              {title}
            </h2>
            <p className="text-xs text-[var(--color-textSecondary)]">{subtitle}</p>
          </div>
        ) : (
          <h2
            className={cx(
              'font-semibold text-[var(--color-text)]',
              isCompact ? 'text-sm' : 'text-lg',
            )}
          >
            {title}
          </h2>
        )}
        {badge && (
          <span className="text-sm text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>
      {(actions || onClose) && (
        <div className="flex items-center gap-2">
          {actions}
          {onClose && (
            <button
              onClick={onClose}
              className={cx(
                'transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]',
                isCompact
                  ? 'p-1.5 hover:bg-[var(--color-border)] rounded'
                  : 'p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg',
              )}
              aria-label="Close"
            >
              <X size={isCompact ? 16 : 18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
