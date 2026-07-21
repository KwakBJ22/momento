import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

/** Prevent full-app white screen on mobile runtime errors. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message || "알 수 없는 오류가 발생했어요." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div style={{ padding: "2rem 1.25rem", maxWidth: 480, margin: "0 auto", fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: "1.25rem", color: "#3d3530" }}>화면을 불러오지 못했어요</h1>
          <p style={{ color: "#8a7a6e", lineHeight: 1.5 }}>{this.state.message}</p>
          <button
            type="button"
            style={{
              marginTop: "1rem",
              minHeight: 48,
              padding: "0.75rem 1.25rem",
              border: 0,
              borderRadius: 12,
              background: "#b48c6e",
              color: "#fff",
              fontWeight: 700,
            }}
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
