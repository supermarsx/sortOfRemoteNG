import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, Theme, ColorScheme } from '../../types/settings';
import { ThemeManager } from '../../utils/themeManager';

const formatLabel = (value: string): string =>
  value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export { formatLabel };

export function useThemeSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const { t } = useTranslation();
  const themeManager = ThemeManager.getInstance();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);
  const cssHighlightRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    setThemes(themeManager.getAvailableThemes());
    setSchemes(themeManager.getAvailableColorSchemes());
  }, [themeManager]);

  const schemeOptions = useMemo(() => {
    const accent = settings.primaryAccentColor || '#3b82f6';
    return schemes.map((scheme) => ({
      value: scheme,
      label: formatLabel(scheme),
      color:
        scheme === 'custom'
          ? accent
          : (themeManager.getColorSchemeConfig(scheme)?.primary ?? '#3b82f6'),
    }));
  }, [schemes, settings.primaryAccentColor, themeManager]);

  const handleAccentChange = useCallback(
    (value: string) => {
      updateSettings({
        primaryAccentColor: value,
        colorScheme: 'custom',
      });
    },
    [updateSettings],
  );

  const escapeHtml = useCallback((value: string) => {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }, []);

  const highlightCss = useCallback(
    (code: string) => {
      let html = escapeHtml(code);
      html = html.replace(/\/\*[\s\S]*?\*\//g, '<span class="css-token-comment">$&</span>');
      html = html.replace(
        /(^|\n)(\s*)([^\n{}]+)(\s*\{)/g,
        '$1$2<span class="css-token-selector">$3</span>$4',
      );
      html = html.replace(
        /([a-zA-Z-]+)(\s*):/g,
        '<span class="css-token-property">$1</span>$2:',
      );
      html = html.replace(/:(\s*)([^;\n}]+)/g, ':$1<span class="css-token-value">$2</span>');
      return html;
    },
    [escapeHtml],
  );

  const highlightedCss = useMemo(
    () => highlightCss(settings.customCss || ''),
    [highlightCss, settings.customCss],
  );

  const handleCssScroll = useCallback(
    (event: React.UIEvent<HTMLTextAreaElement>) => {
      if (!cssHighlightRef.current) return;
      cssHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
      cssHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    },
    [],
  );

  const opacityValue = Number(settings.windowTransparencyOpacity ?? 1);

  return {
    t,
    themes,
    schemes,
    cssHighlightRef,
    schemeOptions,
    handleAccentChange,
    highlightedCss,
    handleCssScroll,
    opacityValue,
  };
}
