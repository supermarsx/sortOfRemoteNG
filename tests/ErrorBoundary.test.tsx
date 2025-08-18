import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

const Bomb: React.FC = () => {
  throw new Error('Boom');
};

describe('ErrorBoundary', () => {
  it('renders fallback UI when child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Safe</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });
});
