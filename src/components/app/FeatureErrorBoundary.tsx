import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface FeatureErrorBoundaryProps extends React.PropsWithChildren {
  boundaryKey?: string | number;
  title?: string;
  message?: string;
}

interface FeatureErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class FeatureErrorBoundary extends React.Component<FeatureErrorBoundaryProps, FeatureErrorBoundaryState> {
  state: FeatureErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): FeatureErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[FeatureErrorBoundary] Panel render failed:', error, errorInfo);
  }

  componentDidUpdate(prevProps: FeatureErrorBoundaryProps) {
    if (
      this.state.hasError
      && prevProps.boundaryKey !== this.props.boundaryKey
    ) {
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const title = this.props.title ?? 'Panel crashed';
    const message = this.props.message ?? 'This view hit a render error. You can retry without restarting the app.';

    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-6">
        <div className="w-full max-w-lg rounded-xl border border-error/30 bg-error/5 p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-error/10 text-error">
            <AlertTriangle size={24} />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-[var(--color-text)]">{title}</h3>
          <p className="mb-4 text-sm text-[var(--color-textSecondary)]">{message}</p>
          {this.state.errorMessage && (
            <pre className="mb-4 whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left text-xs text-[var(--color-textSecondary)]">
              {this.state.errorMessage}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-primary/90"
          >
            <RotateCcw size={14} />
            Retry Panel
          </button>
        </div>
      </div>
    );
  }
}

export default FeatureErrorBoundary;