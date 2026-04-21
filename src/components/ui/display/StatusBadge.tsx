import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const STATUS_MAP = {
  success: { bg: 'bg-success/10 text-success', icon: CheckCircle2 },
  error: { bg: 'bg-error/10 text-error', icon: XCircle },
  warning: { bg: 'bg-warning/10 text-warning', icon: AlertTriangle },
  info: { bg: 'bg-primary/10 text-primary', icon: Info },
} as const;

export type StatusBadgeStatus = keyof typeof STATUS_MAP;

export interface StatusBadgeProps {
  /** Semantic status determines color and default icon */
  status: StatusBadgeStatus;
  /** Badge label text */
  label: string;
  /** Override the default icon */
  icon?: React.ReactNode;
  /** Additional className */
  className?: string;
}

/**
 * Colored status pill with icon.
 * Replaces 6+ duplicate StatusBadge definitions across the codebase.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  icon,
  className,
}) => {
  const { bg, icon: DefaultIcon } = STATUS_MAP[status];
  return (
    <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', bg, className)}>
      {icon ?? <DefaultIcon className="w-3 h-3" />}
      {label}
    </span>
  );
};
