import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ConnectionTree } from '../src/components/ConnectionTree';
import { ConnectionProvider, useConnections } from '../src/contexts/ConnectionContext';
import { Connection } from '../src/types/connection';

const mockConnections: Connection[] = [
  {
    id: 'group1',
    name: 'Group 1',
    protocol: 'rdp',
    hostname: '',
    port: 0,
    isGroup: true,
    expanded: false,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: 'item1',
    name: 'Item 1',
    protocol: 'rdp',
    hostname: 'host',
    port: 3389,
    parentId: 'group1',
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

function InitConnections({ connections }: { connections: Connection[] }) {
  const { dispatch } = useConnections();
  React.useEffect(() => {
    dispatch({ type: 'SET_CONNECTIONS', payload: connections });
  }, [connections, dispatch]);
  return <ConnectionTree onConnect={() => {}} onEdit={() => {}} onDelete={() => {}} />;
}

describe('ConnectionTree', () => {
  it('toggles group expansion when clicking the toggle button', async () => {
    render(
      <ConnectionProvider>
        <InitConnections connections={mockConnections} />
      </ConnectionProvider>
    );

    expect(screen.queryByText('Item 1')).toBeNull();

    const groupRow = screen.getByText('Group 1').closest('.group') as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole('button')[0];

    fireEvent.click(toggleButton);

    expect(await screen.findByText('Item 1')).toBeInTheDocument();
  });

  it('selects an item when clicked', async () => {
    let selectedId: string | null = null;
    const Observer = () => {
      const { state } = useConnections();
      React.useEffect(() => {
        selectedId = state.selectedConnection?.id ?? null;
      }, [state.selectedConnection]);
      return null;
    };

    render(
      <ConnectionProvider>
        <Observer />
        <InitConnections connections={mockConnections} />
      </ConnectionProvider>
    );

    const groupRow = screen.getByText('Group 1').closest('.group') as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole('button')[0];
    fireEvent.click(toggleButton);

    const itemRow = screen.getByText('Item 1');
    fireEvent.click(itemRow);

    expect(selectedId).toBe('item1');
  });

  it('duplicates a connection when Duplicate is clicked', async () => {
    render(
      <ConnectionProvider>
        <InitConnections connections={mockConnections} />
      </ConnectionProvider>
    );

    const groupRow = screen.getByText('Group 1').closest('.group') as HTMLElement;
    const toggleButton = within(groupRow).getAllByRole('button')[0];
    fireEvent.click(toggleButton);

    const itemGroup = screen.getByText('Item 1').closest('.group') as HTMLElement;
    const menuButton = within(itemGroup).getAllByRole('button')[1];
    fireEvent.click(menuButton);

    const duplicateButton = screen.getByText('Duplicate');
    fireEvent.click(duplicateButton);

    expect(await screen.findAllByText('Item 1')).toHaveLength(2);
  });
});
