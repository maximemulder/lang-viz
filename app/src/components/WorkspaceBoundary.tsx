import { Component, type ReactNode } from 'react'

export class WorkspaceBoundary extends Component<
  { readonly name: string; readonly children: ReactNode; readonly onRetry?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <div className="workspace-error" role="alert">
        <h2>Unable to open {this.props.name}</h2>
        <p>{this.state.error.message}</p>
        {this.props.onRetry && (
          <button
            type="button"
            onClick={() => {
              this.props.onRetry?.()
              this.setState({ error: null })
            }}
          >
            Retry {this.props.name}
          </button>
        )}
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
