import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    const status = (error as unknown as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      window.location.href = '/login';
    }
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-brand-bg gap-4 p-8 text-center">
          <div className="text-6xl font-bold text-destructive">!</div>
          <h1 className="text-2xl font-semibold text-dark">Something went wrong</h1>
          <p className="text-brand-muted max-w-md">{this.state.error?.message ?? 'An error occurred. Please try again.'}</p>
          <Button onClick={this.handleReset}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
