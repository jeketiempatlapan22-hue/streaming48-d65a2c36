import React from "react";

interface Props {
  /** Component children to render. */
  children: React.ReactNode;
  /** Optional fallback. Default = null (silent failure). */
  fallback?: React.ReactNode;
  /** Optional name for logging — helps identify which section failed. */
  name?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Lightweight error boundary for non-critical UI sections.
 *
 * Use to wrap individual sub-regions (chat, polls, quiz, lineup, etc.) so that
 * a failure inside one component does NOT take down the whole page. The page-level
 * `ErrorBoundary` (in App.tsx) remains as the outermost safety net.
 *
 * Default fallback is `null` — the section silently disappears instead of
 * showing a scary "Terjadi Kesalahan" screen for non-critical features.
 */
class SectionBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.warn(`[SectionBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export default SectionBoundary;
