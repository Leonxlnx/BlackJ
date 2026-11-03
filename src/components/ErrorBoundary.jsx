import { Component } from 'react';
import { translate } from '../i18n.js';
import { getState } from '../store.js';

/** If a part of the interface crashes, show what happened instead of a blank window. Files are saved. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('BlackJ UI error', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const lang = getState().settings.lang;
    const t = (k) => translate(lang, k);
    return (
      <div className="crash">
        <h2>{t('crash.title')}</h2>
        <p className="dim">{t('crash.text')}</p>
        <pre className="crash-msg">{String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error)).split('\n').slice(0, 6).join('\n')}</pre>
        <div className="action-row">
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>{t('crash.retry')}</button>
          <button className="btn btn-quiet" onClick={() => window.location.reload()}>{t('crash.reload')}</button>
        </div>
      </div>
    );
  }
}
