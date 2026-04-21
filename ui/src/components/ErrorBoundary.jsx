import { Component } from "react";

/**
 * Top-level error boundary — catches render errors and shows a fallback
 * instead of a white screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center", color: "#c9d1d9" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#8b949e", maxWidth: 500, margin: "0.5rem auto 1rem" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <p style={{ color: "#8b949e", fontSize: "0.85rem" }}>
            If this keeps happening, try refreshing the page or restarting the server.
          </p>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1.5rem",
              background: "#238636",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
