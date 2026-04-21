import { useState, useEffect } from 'react';

export function useSplashScreen(
  isLoading: boolean,
  progress: number,
  status: string,
  onLoadComplete?: () => void,
) {
  const [shouldShow, setShouldShow] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (!isLoading && progress >= 100) {
      setFadeOut(true);
      const timeout = setTimeout(() => {
        setShouldShow(false);
        onLoadComplete?.();
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [isLoading, progress, onLoadComplete]);

  return {
    progress,
    status,
    shouldShow,
    fadeOut,
  };
}
