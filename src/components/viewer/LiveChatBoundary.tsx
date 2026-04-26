import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number;
}

/**
 * Dedicated error boundary for the Live Chat region.
 *
 * Goals:
 *  - LiveChat must NEVER take down the whole Live page.
 *  - If a dependency (e.g. `useLiveQuiz`, realtime channel, JSON parsing) throws,
 *    the chat area shows a friendly fallback inside the chat shell instead of
 *    disappearing or crashing the parent.
 *  - User can retry without reloading the entire page.
 */
class LiveChatBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorKey: 0 };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.warn("[LiveChatBoundary] caught error:", error?.message, info?.componentStack);
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, errorKey: s.errorKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 rounded-lg border border-border/40 bg-card/40 p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Live chat sedang tidak tersedia
          </p>
          <p className="text-xs text-muted-foreground">
            Terjadi gangguan sementara pada layanan obrolan. Streaming dan fitur lain tetap berjalan.
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition"
          >
            Coba lagi
          </button>
        </div>
      );
    }

    // `key` forces a clean remount of children after retry, clearing any stuck state.
    return <React.Fragment key={this.state.errorKey}>{this.props.children}</React.Fragment>;
  }
}

export default LiveChatBoundary;
