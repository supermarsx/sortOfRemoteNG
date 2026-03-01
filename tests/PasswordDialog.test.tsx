import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PasswordDialog } from '../src/components/security/PasswordDialog';

describe('PasswordDialog', () => {
  it('shows validation message for short passwords', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <PasswordDialog isOpen mode="unlock" onSubmit={onSubmit} onCancel={onCancel} />,
    );

    const input = screen.getByPlaceholderText('Enter password');
    fireEvent.change(input, { target: { value: 'abc' } });
    const form = input.closest('form')!;
    fireEvent.submit(form);

    expect(
      screen.getByText('Password must be at least 4 characters'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

