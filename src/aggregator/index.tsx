import { Component, type ReactNode } from 'react';
import { AggregatePage } from './AggregatePage';

/** 화면에서 예상 못 한 오류가 나도 빈 화면 대신 안내를 보여 준다 */
class Guard extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-8">
        <p className="font-bold text-err-ink">취합 화면에서 문제가 생겼어요.</p>
        <p className="text-sub">{this.state.error.message}</p>
        <button type="button" className="rounded-btn border border-line-strong px-3 py-1.5" onClick={() => this.setState({ error: undefined })}>처음부터 다시</button>
      </div>
    );
  }
}

export function AggregatorRoot({ formId }: { formId?: string }) {
  return <Guard><AggregatePage key={formId ?? ''} formId={formId} /></Guard>;
}
