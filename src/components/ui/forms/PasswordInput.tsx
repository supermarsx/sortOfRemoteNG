import React, { useState, useRef, useEffect, useCallback, useMemo, InputHTMLAttributes } from 'react';
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
export const PasswordInput: React.FC<PasswordInputProps> = ({
  revealable,
  isSaved,
  className,
  style,
  ...rest
}) => {
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

  // ── Custom mask character via CSS ─────────────────────────────
  // Browsers use -webkit-text-security for the mask glyph.
  // A custom character requires replacing the value with a masked
  // string when not visible.  For simplicity we use CSS when the
  // mask is one of the well-known values, and fall back to a visual
  // overlay approach for custom characters.
  const maskChar = pr.maskCharacter;
  const useCustomMask = !visible && !!maskChar;

  const mergedStyle = useMemo(() => {
    if (!useCustomMask) return style;
    // Use -webkit-text-security: none and render the mask ourselves
    return {
      ...style,
      WebkitTextSecurity: 'none',
      color: 'transparent',
      caretColor: 'var(--color-text)',
    } as React.CSSProperties;
  }, [useCustomMask, style]);

  // Build the masked overlay text
  const maskedOverlay = useCustomMask && typeof rest.value === 'string'
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
};

export default PasswordInput;
