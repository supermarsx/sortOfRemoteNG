import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders and confirms action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog isOpen message="Confirm?" onConfirm={onConfirm} />);
    expect(screen.getByText('Confirm?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('handles cancel action', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Are you sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
