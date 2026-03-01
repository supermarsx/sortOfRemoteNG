import { useState, useEffect, useCallback } from 'react';

export function useSplashScreen(
  isLoading: boolean,
  onLoadComplete?: () => void,
) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');
  const [shouldShow, setShouldShow] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (isLoading) {
      const statuses = [
        'Loading settings...',
        'Initializing theme...',
        'Preparing workspace...',
        'Loading connections...',
        'Almost ready...',
      ];

      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.random() * 15 + 5;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);
        }
        setProgress(Math.min(currentProgress, 100));
        const statusIndex = Math.min(
          Math.floor((currentProgress / 100) * statuses.length),
          statuses.length - 1,
        );
        setStatus(statuses[statusIndex]);
      }, 200);

      return () => clearInterval(interval);
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading && progress >= 100) {
      setFadeOut(true);
      const timeout = setTimeout(() => {
        setShouldShow(false);
        onLoadComplete?.();
      }, 500);
      return () => clearTimeout(timeout);
    } else if (!isLoading) {
      setProgress(100);
      setStatus('Ready!');
    }
  }, [isLoading, progress, onLoadComplete]);

  return {
    progress,
    status,
    shouldShow,
    fadeOut,
  };
}
