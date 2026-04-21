import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../src/utils/storage/indexedDbService', () => ({
  IndexedDbService: {
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/utils/settings/settingsManager', () => ({
  SettingsManager: {
    getInstance: () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { useRecoverySettings } from '../../src/hooks/settings/useRecoverySettings';

describe('useRecoverySettings', () => {
  it('returns expected shape', () => {
    const { result } = renderHook(() => useRecoverySettings());

    expect(result.current.confirmAction).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(typeof result.current.handleSoftRestart).toBe('function');
    expect(typeof result.current.handleHardRestart).toBe('function');
    expect(typeof result.current.setConfirmAction).toBe('function');
    expect(result.current.confirmActions).toBeDefined();
  });

  it('confirmActions contains deleteData, deleteAll, and resetSettings', () => {
    const { result } = renderHook(() => useRecoverySettings());

    expect(result.current.confirmActions).toHaveProperty('deleteData');
    expect(result.current.confirmActions).toHaveProperty('deleteAll');
    expect(result.current.confirmActions).toHaveProperty('resetSettings');
    expect(result.current.confirmActions.deleteData.danger).toBe(true);
    expect(result.current.confirmActions.deleteAll.danger).toBe(true);
    expect(result.current.confirmActions.resetSettings.danger).toBe(false);
  });

  it('setConfirmAction updates confirmAction state', () => {
    const { result } = renderHook(() => useRecoverySettings());

    act(() => {
      result.current.setConfirmAction('deleteData');
    });

    expect(result.current.confirmAction).toBe('deleteData');

    act(() => {
      result.current.setConfirmAction(null);
    });

    expect(result.current.confirmAction).toBeNull();
  });

  it('handleHardRestart calls invoke for restart_app', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { result } = renderHook(() => useRecoverySettings());

    await act(async () => {
      await result.current.handleHardRestart();
    });

    expect(invoke).toHaveBeenCalledWith('restart_app');
  });
});
