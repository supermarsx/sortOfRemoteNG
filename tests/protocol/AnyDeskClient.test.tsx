import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnyDeskClient } from '../../src/components/protocol/AnyDeskClient';

const mockConnectionContext = vi.hoisted(() => ({
  state: { connections: [] as any[] },
  dispatch: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: () => mockConnectionContext,
}));

import { invoke } from '@tauri-apps/api/core';

describe('AnyDeskClient', () => {
  const session = {
    id: 'session-1',
    connectionId: 'conn-1',
    name: 'Workstation',
    status: 'connected',
    startTime: new Date('2026-03-30T12:00:00.000Z'),
    protocol: 'anydesk',
    hostname: '123456789',
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionContext.state.connections = [
      {
        id: 'conn-1',
        name: 'Workstation',
        hostname: '123456789',
        password: 'secret',
      },
    ];
  });

  it('launches AnyDesk through the backend and stores the backend session id', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'launch_anydesk') return 'backend-1';
      if (command === 'get_anydesk_session') {
        return {
          id: 'backend-1',
          anydesk_id: '123456789',
          connected: true,
          start_time: '2026-03-30T12:00:00.000Z',
          password: null,
        };
      }

      return null;
    });

    render(<AnyDeskClient session={session} />);

    fireEvent.click(screen.getByText('Launch AnyDesk'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('launch_anydesk', {
        anydeskId: '123456789',
        password: 'secret',
      });
    });

    expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SESSION',
      payload: expect.objectContaining({
        id: 'session-1',
        backendSessionId: 'backend-1',
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Managed session active')).toBeInTheDocument();
    });
  });

  it('disconnects a managed AnyDesk session', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'get_anydesk_session') {
        return {
          id: 'backend-1',
          anydesk_id: '123456789',
          connected: true,
          start_time: '2026-03-30T12:00:00.000Z',
          password: null,
        };
      }

      return null;
    });

    render(
      <AnyDeskClient
        session={{
          ...session,
          backendSessionId: 'backend-1',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeEnabled();
    });

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('disconnect_anydesk', { sessionId: 'backend-1' });
    });

    expect(mockConnectionContext.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_SESSION',
      payload: expect.objectContaining({
        id: 'session-1',
        status: 'disconnected',
        backendSessionId: undefined,
      }),
    });
  });
});