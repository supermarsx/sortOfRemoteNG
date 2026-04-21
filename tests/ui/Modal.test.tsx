import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from '../../src/components/ui/overlays/Modal';

describe('Modal', () => {
  it('renders dialog semantics and traps focus within the panel', async () => {
    render(
      <div>
        <button>Before</button>
        <Modal isOpen onClose={() => {}}>
          <div>
            <button>First action</button>
            <button>Last action</button>
          </div>
        </Modal>
        <button>After</button>
      </div>,
    );

    const dialog = screen.getByRole('dialog');
    const first = screen.getByText('First action');
    const last = screen.getByText('Last action');

    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await waitFor(() => {
      expect(first).toHaveFocus();
    });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('closes on escape when enabled', () => {
    const onClose = vi.fn();

    render(
      <Modal isOpen onClose={onClose}>
        <button>Dismiss</button>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});