import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

// Catches render-time throws anywhere below it so a single malformed response or
// component bug shows a recoverable fallback instead of a blank white screen.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Server-side logging hook lands here later; for now keep it in the console.
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-ink">
          <h1 className="font-display text-2xl">Something went sideways.</h1>
          <p className="max-w-sm text-sm text-ink-muted">
            A part of the app failed to load. Reloading usually fixes it — your data is safe.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-transform duration-200 ease-atelier active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
