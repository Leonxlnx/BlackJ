import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore, setState } from '../store.js';
import { useT, formatNumber, formatCost } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import monaco from '../lib/monaco.js';
import Icon from './Icon.jsx';

marked.setOptions({ gfm: true, breaks: false });

function Markdown({ text, final, t }) {
  const ref = useRef(null);
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const code of el.querySelectorAll('pre > code')) {
      const pre = code.parentElement;
      if (pre.parentElement.classList.contains('code-block')) continue;
      const raw = code.textContent;
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      const head = document.createElement('div');
      head.className = 'code-block-head';
      for (const [action, label, icon] of [['insert', t('tutor.insert'), 'M19 5v7a3 3 0 0 1-3 3H6 M10 11l-4 4 4 4'], ['copy', t('tutor.copy'), 'M8 8h11v11H8z M5 15V5h10']]) {
        const b = document.createElement('button');
        b.className = 'btn btn-sm btn-quiet';
        b.dataset.action = action;
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"/></svg>`;
        b.append(label);
        head.append(b);
      }
      pre.replaceWith(wrap);
      wrap.append(head, pre);
      wrap.dataset.code = raw;
      if (final && (/language-java/.test(code.className) || !code.className)) {
        monaco.editor.colorize(raw, 'java', { tabSize: 4 }).then((colored) => {
          code.innerHTML = colored;
        });
      }
    }
  }, [html, final]);
  const onClick = (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const code = b.closest('.code-block').dataset.code.replace(/\n$/, '');
    if (b.dataset.action === 'insert') A.insertCode(code);
    else {
      navigator.clipboard.writeText(code);
      b.lastChild.textContent = t('tutor.copied');
      setTimeout(() => { b.lastChild.textContent = t('tutor.copy'); }, 1400);
    }
  };
  return <div className="md" ref={ref} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Setup() {
  const t = useT();
  const remember = useStore((s) => s.settings.rememberKey);
  const canStore = useStore((s) => s.info.tutor.canStore);
  const [key, setKey] = useState('');
  const [keep, setKeep] = useState(remember);
  const [error, setError] = useState(null);
  return (
    <form
      className="setup"
      onSubmit={async (e) => {
        e.preventDefault();
        const err = await A.setApiKey(key, keep && canStore);
        if (err) setError(err);
      }}
    >
      <h3>{t('tutor.setupTitle')}</h3>
      <p>{t('tutor.setupText')}</p>
      <label className="field">
        <span className="field-label">{t('tutor.keyLabel')}</span>
        <input className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('tutor.keyPlaceholder')} autoComplete="off" spellCheck="false" />
      </label>
      {canStore && (
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>
            {t('tutor.keyRemember')}
            <span className="field-hint" style={{ display: 'block' }}>{t('tutor.keyRememberHint')}</span>
          </span>
        </label>
      )}
      {error && <div className="field-error">{error}</div>}
      <div className="action-row">
        <button className="btn btn-primary" type="submit" disabled={!key.trim()}>{t('tutor.keySave')}</button>
      </div>
      <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => api.openExternal('https://platform.claude.com/settings/keys')}>
        {t('tutor.keyGet')}
      </button>
    </form>
  );
}

function Turn({ turn, t, lang, showCosts, last }) {
  if (turn.role === 'user') {
    return (
      <div className="msg-user">
        <div className="msg-who">{t('tutor.you')}</div>
        <div className="bubble">{turn.text}</div>
        {turn.ctx && <div className="msg-ctx">{t('tutor.context', { file: turn.ctx })}</div>}
      </div>
    );
  }
  const busy = turn.status === 'waiting' || turn.status === 'thinking';
  return (
    <div className="msg-ai">
      <div className="msg-who">{t('tutor.title')}{busy && <span>· {t('tutor.thinking')}</span>}</div>
      {turn.text && <Markdown text={turn.text + (turn.status === 'writing' ? '' : '')} final={turn.status === 'done'} t={t} />}
      {turn.status === 'writing' && <span className="cursor-blink" aria-hidden="true" />}
      {turn.status === 'aborted' && <div className="msg-meta">{t('tutor.aborted')}</div>}
      {turn.status === 'refusal' && <div className="msg-meta">{t('tutor.refusal')}</div>}
      {turn.status === 'error' && (
        <div className="msg-meta msg-error">
          {t('tutor.err.' + turn.error.code, { message: turn.error.message })}
          {last && (
            <>
              {' '}
              <button className="link" onClick={A.retryLast}>{t('tutor.retry')}</button>
            </>
          )}
        </div>
      )}
      {turn.status === 'done' && showCosts && turn.usage && (
        <div className="msg-meta">{t('tutor.usage', { input: formatNumber(lang, turn.usage.input), output: formatNumber(lang, turn.usage.output), cost: formatCost(lang, turn.cost) })}</div>
      )}
    </div>
  );
}

export default function Tutor() {
  const t = useT();
  const hasKey = useStore((s) => s.info.tutor.hasKey);
  const chat = useStore((s) => s.chat);
  const settings = useStore((s) => s.settings);
  const activeTab = useStore((s) => s.activeTab);
  const compileState = useStore((s) => s.compile.state);
  const models = useStore((s) => s.info.tutor.models || []);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const model = models.find((m) => m.id === settings.model);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);

  const send = (q) => {
    const v = (q ?? text).trim();
    if (!v) return;
    A.askTutor(v);
    setText('');
  };

  return (
    <div className="side-body tutor">
      <div className="tutor-sub">
        <div className="seg" role="group" aria-label="Modus">
          {['hints', 'explain'].map((m) => (
            <button key={m} aria-pressed={chat.mode === m} onClick={() => chat.mode !== m && A.setTutorMode(m)}>{t('tutor.mode.' + m)}</button>
          ))}
        </div>
        <button className="btn btn-sm btn-quiet" onClick={A.newChat} disabled={!chat.turns.length}>
          <Icon name="plus" />
          {t('tutor.newChat')}
        </button>
      </div>
      {!hasKey ? (
        <div className="chat">
          <Setup />
        </div>
      ) : (
        <>
          <div className="chat" ref={listRef}>
            {chat.turns.length === 0 && (
              <>
                <p className="muted">{t('tutor.empty.' + chat.mode)}</p>
                <div className="quick">
                  {activeTab && <button onClick={() => send(t('tutor.quick.file'))}>{t('tutor.quick.file')}</button>}
                  {compileState === 'errors' && <button onClick={() => send(t('tutor.quick.errors'))}>{t('tutor.quick.errors')}</button>}
                  <button onClick={() => send(t('tutor.quick.next'))}>{t('tutor.quick.next')}</button>
                </div>
              </>
            )}
            {chat.turns.map((turn, i) => (
              <Turn key={turn.id} turn={turn} t={t} lang={settings.lang} showCosts={settings.showCosts} last={i === chat.turns.length - 1} />
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              className="textarea"
              rows={Math.min(6, Math.max(2, text.split('\n').length))}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t('tutor.placeholder')}
              aria-label={t('tutor.placeholder')}
            />
            <div className="composer-row">
              <button type="button" className="ctx-toggle" aria-pressed={settings.sendContext} onClick={() => A.updateSettings({ sendContext: !settings.sendContext })}>
                <span className="box" />
                {settings.sendContext && activeTab ? t('tutor.context', { file: activeTab }) : t('tutor.contextOff')}
              </button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{model ? model.label.replace('Claude ', '') : ''}</span>
              {chat.busy ? (
                <button type="button" className="btn btn-sm" onClick={A.stopTutor}>
                  <Icon name="stop" />
                  {t('tutor.stop')}
                </button>
              ) : (
                <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
                  <Icon name="send" />
                  {t('tutor.send')}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
