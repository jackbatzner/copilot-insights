import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div role="alert" className="notice error">
      <h2>This view could not be displayed</h2>
      <p>The app may have updated while this tab was open. Reload the app to fetch the current view. Your URL filters are preserved.</p>
      <button onClick={() => window.location.reload()}>Reload app</button>
    </div>;
    return this.props.children;
  }
}
