import { Component, type ReactNode } from 'react'

export class FeatureErrorBoundary extends Component<
  {
    readonly children: ReactNode
    readonly fallback: ReactNode
  },
  { readonly failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
