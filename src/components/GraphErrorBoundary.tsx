import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GraphErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[GraphErrorBoundary] Component error caught:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[320px] flex flex-col items-center justify-center p-6 bg-[var(--canvas-bg)] rounded-xl border border-[var(--border)] text-center space-y-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--coral-s)] text-[var(--coral)]">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              {this.props.fallbackTitle || 'Ownership Graph Rendering Notice'}
            </h3>
            <p className="text-xs text-[var(--ink2)] max-w-md mt-1 font-mono-code">
              {this.state.error?.message || 'An unexpected error occurred while rendering the interactive canvas.'}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--ink)] bg-[var(--panel)] border border-[var(--border)] rounded-lg hover:bg-[var(--neutral-fill)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Canvas View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
