import React, { forwardRef, useState, useRef, useEffect, useCallback, useMemo, InputHTMLAttributes } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useSettings } from '../../../contexts/SettingsContext';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Override the global password-reveal enabled setting for this field.
   * When `false`, the eye icon is never shown regardless of global setting.
   */
  revealable?: boolean;
  /**
   * Marks this field as containing a previously saved password.
   * When `lockSavedPasswords` is enabled globally, the eye icon is
   * replaced with a lock and reveal is blocked.
   */
  isSaved?: boolean;
}

/**
 * Drop-in replacement for `<input type="password" />` that adds a
 * configurable show/hide eye icon. Behaviour is governed by the global
 * `passwordReveal` settings (mode, autoHideSeconds, showByDefault,
 * maskCharacter, lockSavedPasswords, etc.) but can be overridden
 * per-instance via the `revealable` and `isSaved` props.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({
  revealable,
  isSaved,
  className,
  style,
  ...rest
}, ref) => {
  const { settings } = useSettings();
  const pr = settings.passwordReveal ?? {
    enabled: true,
    mode: 'toggle' as const,
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
    maskCharacter: '',
    lockSavedPasswords: false,
  };

  const isRevealable = revealable ?? pr.enabled;
  const isLocked = !!(isSaved && pr.lockSavedPasswords);
  const canReveal = isRevealable && !isLocked;

  const [visible, setVisible] = useState(pr.showByDefault && canReveal);
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, []);

  // Reset visibility when global settings change or lock state changes
  useEffect(() => {
    if (!canReveal) setVisible(false);
  }, [canReveal]);

  const startAutoHide = useCallback(() => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    if (pr.autoHideSeconds > 0) {
      autoHideTimer.current = setTimeout(() => {
        setVisible(false);
      }, pr.autoHideSeconds * 1000);
    }
  }, [pr.autoHideSeconds]);

  // ── Toggle mode handlers ──────────────────────────────────────
  const handleToggleClick = useCallback(() => {
    if (pr.mode !== 'toggle' || isLocked) return;
    const next = !visible;
    setVisible(next);
    if (next) {
      startAutoHide();
    } else if (autoHideTimer.current) {
      clearTimeout(autoHideTimer.current);
    }
  }, [pr.mode, visible, startAutoHide, isLocked]);

  // ── Hold mode handlers ────────────────────────────────────────
  const handlePointerDown = useCallback(() => {
    if (pr.mode !== 'hold' || isLocked) return;
    setVisible(true);
  }, [pr.mode, isLocked]);

  const handlePointerUp = useCallback(() => {
    if (pr.mode !== 'hold') return;
    setVisible(false);
  }, [pr.mode]);

  // Shared handler for mouse/pointer events on the button
  const buttonHandlers =
    pr.mode === 'hold' && !isLocked
      ? {
          onPointerDown: handlePointerDown,
          onPointerUp: handlePointerUp,
          onPointerLeave: handlePointerUp,
          onPointerCancel: handlePointerUp,
        }
      : {
          onClick: handleToggleClick,
        };

  // ── Locked: hide real character count ─────────────────────────
  // When locked, we replace the displayed value with a fixed-length
  // placeholder so the actual password length is not leaked.
  const LOCKED_PLACEHOLDER = '••••••••••';
  const hasValue = typeof rest.value === 'string' && rest.value.length > 0;
  const showLockedPlaceholder = isLocked && hasValue && !visible;

  // ── Custom mask character via CSS ─────────────────────────────
  const maskChar = pr.maskCharacter;
  const useCustomMask = !visible && !showLockedPlaceholder && !!maskChar;

  const mergedStyle = useMemo(() => {
    if (showLockedPlaceholder) {
      // Hide the real value entirely — we render a fixed overlay instead
      return { ...style, color: 'transparent', caretColor: 'transparent' } as React.CSSProperties;
    }
    if (!useCustomMask) return style;
    return {
      ...style,
      WebkitTextSecurity: 'none',
      color: 'transparent',
      caretColor: 'var(--color-text)',
    } as React.CSSProperties;
  }, [useCustomMask, showLockedPlaceholder, style]);

  // Build the masked overlay text
  const maskedOverlay = showLockedPlaceholder
    ? (maskChar || '•').repeat(LOCKED_PLACEHOLDER.length)
    : useCustomMask && typeof rest.value === 'string'
      ? maskChar.repeat(rest.value.length)
      : null;

  const showButton = isRevealable || isLocked;
  const IconComponent = isLocked ? Lock : visible ? EyeOff : Eye;
  const iconOpacity = isLocked
    ? 'opacity-40'
    : !visible && pr.maskIcon
      ? 'opacity-30'
      : 'opacity-60';

  return (
    <div className="relative w-full">
      <input
        {...rest}
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={`${className ?? ''} ${showButton ? 'pr-9' : ''}`}
        style={mergedStyle}
      />
      {/* Custom mask character overlay */}
      {maskedOverlay != null && (
        <div
          className="absolute inset-0 flex items-center pointer-events-none overflow-hidden"
          style={{
            paddingLeft: 'inherit',
            paddingRight: showButton ? '2.25rem' : undefined,
          }}
        >
          <span
            className="text-[var(--color-text)] font-mono text-sm truncate"
            style={{
              paddingLeft: (rest as any).style?.paddingLeft ?? '0.75rem',
              letterSpacing: '0.1em',
            }}
          >
            {maskedOverlay}
          </span>
        </div>
      )}
      {showButton && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={isLocked ? 'Password locked' : visible ? 'Hide password' : 'Show password'}
          title={isLocked ? 'Saved passwords are locked (change in Settings → Security)' : undefined}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded
            text-[var(--color-textSecondary)] hover:text-[var(--color-text)] focus:outline-none transition-colors
            ${iconOpacity} ${isLocked ? 'cursor-not-allowed' : ''}`}
          {...(isLocked ? {} : buttonHandlers)}
        >
          <IconComponent size={16} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';

export default PasswordInput;
