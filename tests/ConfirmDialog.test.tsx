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

  it('renders custom title', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Custom Title"
        message="Test message"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('renders default title when not provided', () => {
    render(
      <ConfirmDialog
        isOpen
        message="Test message"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Confirmation')).toBeInTheDocument();
  });

  it('renders custom confirm text', () => {
    render(
      <ConfirmDialog
        isOpen
        message="Test message"
        confirmText="Yes, Delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Yes, Delete')).toBeInTheDocument();
  });

  it('renders custom cancel text', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Test message"
        cancelText="No, Go Back"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('No, Go Back')).toBeInTheDocument();
  });

  it('applies danger variant styling', () => {
    render(
      <ConfirmDialog
        isOpen
        message="Delete item?"
        variant="danger"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText('OK');
    expect(confirmButton).toHaveClass('bg-red-600');
  });

  it('applies warning variant styling', () => {
    render(
      <ConfirmDialog
        isOpen
        message="Warning message"
        variant="warning"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText('OK');
    expect(confirmButton).toHaveClass('bg-yellow-600');
  });

  it('applies default variant styling', () => {
    render(
      <ConfirmDialog
        isOpen
        message="Regular message"
        variant="default"
        onConfirm={() => {}}
      />,
    );
    const confirmButton = screen.getByText('OK');
    expect(confirmButton).toHaveClass('bg-blue-600');
  });

  it('does not render when closed', () => {
    render(
      <ConfirmDialog
        isOpen={false}
        message="Should not see this"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText('Should not see this')).not.toBeInTheDocument();
  });

  it('handles Enter key press to confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Press Enter to confirm"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalled();
  });

  it('handles Escape key press to cancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        message="Press Escape to cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('handles backdrop click to cancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        isOpen
        message="Click backdrop to cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalled();
    }
  });

  it('combines all custom props correctly', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete Confirmation"
        message="Are you sure you want to delete this item?"
        confirmText="Yes, Delete It"
        cancelText="No, Keep It"
        variant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    
    expect(screen.getByText('Delete Confirmation')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this item?')).toBeInTheDocument();
    expect(screen.getByText('Yes, Delete It')).toBeInTheDocument();
    expect(screen.getByText('No, Keep It')).toBeInTheDocument();
    
    const confirmButton = screen.getByText('Yes, Delete It');
    expect(confirmButton).toHaveClass('bg-red-600');
    
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalled();
  });
});