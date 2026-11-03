import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore, setState, getState } from '../store.js';
import { useT, formatNumber, formatCost } from '../i18n.js';
import A from '../panels.js';
import { api } from '../api.js';
import monaco from '../lib/monaco.js';
import { waitingForStudent } from '../agent.js';
import Icon from './Icon.jsx';
import { ToolRows, DiffCard, ContextChips, groupParts } from './AgentParts.jsx';

marked.setOptions({ gfm: true, breaks: false });

function Markdown({ text, final, t }) {
  const ref = useRef(null);
  // Parsing and sanitising a long answer is not free: only when its text changed.
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '')), [text]);
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
    // A link never replaces the window: web links open in the browser (main allows only a few
    // sites), a link to a project file opens it in the editor, anything else does nothing.
    const a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (/^https:\/\//i.test(href)) api.openExternal(href);
      else {
        let name = href.replace(/^\.?\//, '').split(/[?#]/)[0];
        try {
          name = decodeURIComponent(name);
        } catch { /* keep it as written */ }
        const file = Object.keys(getState().files).find((n) => n === name || n.endsWith('/' + name));
        if (file) A.openFile(file);
      }
      return;
    }
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
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('tutor.keyPlaceholder')} autoComplete="off" spellCheck="false" />
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

function Meta({ turn, t, lang, showCosts, last, waiting }) {
  const lines = [];
  if (waiting) lines.push(<div key="w" className="msg-meta">{t('agent.waiting')}</div>);
  if (turn.status === 'aborted') lines.push(<div key="a" className="msg-meta">{t('tutor.aborted')}</div>);
  if (turn.status === 'refusal') lines.push(<div key="r" className="msg-meta">{t('tutor.refusal')}</div>);
  if (turn.status === 'error') {
    const full = turn.error.code === 'chatFull';
    lines.push(
      <div key="e" className="msg-meta msg-error">
        {t('tutor.err.' + turn.error.code, { message: turn.error.message })}
        {last && !full && (
          <>
            {' '}
            <button className="link" onClick={turn.partial ? A.continueLast : A.retryLast}>{t('tutor.retry')}</button>
          </>
        )}
        {full && (
          <>
            {' '}
            <button className="link" onClick={A.newChat}>{t('tutor.newChat')}</button>
          </>
        )}
      </div>,
    );
  }
  if (turn.status === 'done' && turn.limit) {
    lines.push(
      <div key="l" className="msg-meta">
        {t('agent.limit')}{' '}
        {last && <button className="link" onClick={() => A.askTutor(t('tutor.continuePrompt'))}>{t('agent.continue')}</button>}
      </div>,
    );
  }
  if (turn.status === 'done' && (turn.long || turn.full) && last) {
    lines.push(
      <div key="g" className="msg-meta">
        {turn.full ? t('tutor.err.chatFull') : t('tutor.long')}{' '}
        <button className="link" onClick={A.newChat}>{t('tutor.newChat')}</button>
      </div>,
    );
  }
  if (turn.status === 'done' && showCosts && turn.usage) {
    // Only the price, and only while the answer is hovered or focused; the tokens are in the tooltip.
    const p = { input: formatNumber(lang, turn.usage.input), output: formatNumber(lang, turn.usage.output), cost: formatCost(lang, turn.cost || 0), steps: turn.steps };
    lines.push(<div key="u" className="msg-meta msg-cost" title={turn.steps > 1 ? t('tutor.usageSteps', p) : t('tutor.usage', p)}>≈ {p.cost}</div>);
  }
  return lines;
}

function Turn({ turn, t, lang, showCosts, last, proposals }) {
  if (turn.role === 'user') {
    return (
      <div className="msg-user">
        <div className="bubble">{turn.text}</div>
        {turn.ctx && <div className="msg-ctx">{t('tutor.context', { file: turn.ctx })}</div>}
      </div>
    );
  }
  const parts = turn.parts || [];
  const groups = groupParts(parts);
  const running = ['waiting', 'thinking', 'working'].includes(turn.status);
  const lastPart = parts[parts.length - 1];
  const waiting = running && Object.values(proposals).some((p) => p.turnId === turn.id && p.status === 'pending');
  return (
    <div className="msg-ai">
      {running && !parts.length && <div className="msg-meta">{t('tutor.thinking')}</div>}
      {groups.map((g) => {
        if (g.type === 'text') return g.text ? <Markdown key={g.key} text={g.text} final={!running} t={t} /> : null;
        if (g.type === 'tools') return <ToolRows key={g.key} parts={g.parts} turnId={turn.id} />;
        if (g.type === 'diff') return <DiffCard key={g.key} id={g.proposalId} />;
        return null;
      })}
      {turn.status === 'working' && lastPart && lastPart.type === 'text' && <span className="cursor-blink" aria-hidden="true" />}
      <Meta turn={turn} t={t} lang={lang} showCosts={showCosts} last={last} waiting={waiting} />
    </div>
  );
}

/** Up to three ways to start, the ones that fit what is open right now. */
function Starters({ send, t }) {
  const compileState = useStore((s) => s.compile.state);
  const exception = useStore((s) => !!s.exception);
  const exercise = useStore((s) => s.project && s.project.exercise && !(s.settings.exercisesDone || []).includes(s.project.exercise));
  const file = useStore((s) => (s.activeTab && s.activeTab !== '#readme' && s.files[s.activeTab] ? A.simpleName(s.files[s.activeTab].className) : null));
  const list = [
    compileState === 'errors' && t('tutor.quick.errors'),
    exception && t('tutor.start.exception'),
    exercise && t('tutor.start.exercise'),
    file && t('tutor.start.file', { name: file }),
    t('tutor.start.tour'),
    t('tutor.quick.next'),
  ].filter(Boolean).slice(0, 3);
  return (
    <div className="quick">
      {list.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}
    </div>
  );
}

export default function Tutor() {
  const t = useT();
  const hasKey = useStore((s) => s.info.tutor.hasKey);
  const chat = useStore((s) => s.chat);
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.info.tutor.models || []);
  const proposals = useStore((s) => s.agent.proposals);
  const draft = useStore((s) => s.tutorDraft);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const model = models.find((m) => m.id === settings.model);
  const pendingOnly = chat.busy && waitingForStudent();

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);

  // A question asked while the tutor was busy waits here until the student sends it.
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    setState({ tutorDraft: null });
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }, [draft]);

  const send = (q) => {
    const v = (q ?? text).trim();
    if (!v) return;
    if (chat.busy) {
      // Only waiting for a decision on a change: stop the turn (the card stays) and send this.
      if (!waitingForStudent()) return;
      A.sendAfterStop(v);
      setText('');
      return;
    }
    A.askTutor(v);
    setText('');
  };

  return (
    <div className="side-body tutor">
      {hasKey && (
      <div className="tutor-sub">
        <div className="seg" role="group" aria-label={t('a11y.mode')} data-tour="tutor-mode">
          {['hints', 'explain'].map((m) => (
            <button key={m} aria-pressed={chat.mode === m} onClick={() => chat.mode !== m && A.setTutorMode(m)}>{t('tutor.mode.' + m)}</button>
          ))}
        </div>
        <button className="btn btn-sm btn-quiet" onClick={A.newChat} disabled={!chat.turns.length} data-tour="new-chat">
          {t('tutor.newChat')}
        </button>
      </div>
      )}
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
                <Starters send={send} t={t} />
              </>
            )}
            {chat.turns.map((turn, i) => (
              <Turn key={turn.id} turn={turn} t={t} lang={settings.lang} showCosts={settings.showCosts} last={i === chat.turns.length - 1} proposals={proposals} />
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="composer-box with-chips" data-tour="composer">
              <ContextChips />
              <div className="composer-line">
                <textarea
                  ref={inputRef}
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
                {chat.busy && !(pendingOnly && text.trim()) ? (
                  <button type="button" className="send-btn stop" onClick={A.stopTutor} aria-label={t('tutor.stop')} title={t('tutor.stop')}>
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button type="submit" className="send-btn" disabled={!text.trim()} aria-label={t('tutor.send')} title={t('tutor.send')}>
                    <Icon name="arrowUp" />
                  </button>
                )}
              </div>
            </div>
            <div className="composer-row">
              <span className="composer-model">{model ? model.label.replace('Claude ', '') : ''}</span>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
