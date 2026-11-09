import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore, setState, getState } from '../store.js';
import { useT, formatNumber, formatCost } from '../i18n.js';
import A from '../panels.js';
import { api } from '../api.js';
import monaco from '../lib/monaco.js';
import { waitingForStudent, toolLabel } from '../agent.js';
import Icon from './Icon.jsx';
import ModelPicker from './ModelPicker.jsx';
import ToggleRow from './ToggleRow.jsx';
import { ToolRows, DiffCard, ContextChips, BuildCard, PlanCard, ShotLightbox, Checkpoint, groupParts } from './AgentParts.jsx';

/** 42 s, 1:05 min: how long a turn has been working (or worked). */
function duration(ms) {
  const secs = Math.max(0, Math.round(ms / 1000));
  return secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} min`;
}

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
    // `Hund`, `Hund.java`, `tiere/Hund.java` in a finished answer: a chip that opens the file.
    if (final) {
      const byName = new Map();
      for (const f of Object.values(getState().files)) {
        const simple = String(f.className || '').split('.').pop();
        for (const k of [f.className, simple, f.name, f.name.split('/').pop()]) if (k && !byName.has(k)) byName.set(k, f.name);
      }
      for (const code of el.querySelectorAll('code')) {
        if (code.closest('pre')) continue;
        const file = byName.get(code.textContent.trim());
        if (!file) continue;
        code.classList.add('md-file');
        code.dataset.file = file;
        code.tabIndex = 0;
        code.setAttribute('role', 'link');
        code.title = file;
      }
    }
  }, [html, final]);
  const openCode = (code) => {
    const file = code.dataset.file;
    if (getState().files[file]) A.openFile(file);
  };
  const onClick = (e) => {
    const chip = e.target.closest('code.md-file');
    if (chip) {
      openCode(chip);
      return;
    }
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
  const onKeyDown = (e) => {
    const chip = e.key === 'Enter' && e.target.closest && e.target.closest('code.md-file');
    if (chip) openCode(chip);
  };
  return <div className="md" ref={ref} onClick={onClick} onKeyDown={onKeyDown} dangerouslySetInnerHTML={{ __html: html }} />;
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
      {canStore && <ToggleRow checked={keep} onChange={setKeep} label={t('tutor.keyRemember')} hint={t('tutor.keyRememberHint')} />}
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

/** While a turn runs: what the tutor does right now (the running step by name), which step, and for how long. */
function LiveStatus({ turn, t, build, stopping }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const time = duration(Date.now() - (turn.startedAt || Date.now()));
  const tool = [...(turn.parts || [])].reverse().find((p) => p.type === 'tool' && p.status === 'running' && p.name !== 'update_plan');
  // The running step's row above already names what it does: then only which step and how long.
  const named = !stopping && turn.phase === 'tool' && !!tool;
  const what = stopping ? t('agent.live.stopping')
    : turn.phase === 'thinking' || !turn.phase ? t(build && !(turn.parts || []).length ? 'build.starting' : 'agent.live.thinking')
      : turn.phase === 'tool' ? (tool ? toolLabel(tool, t) : t('agent.live.tool')) : t('agent.live.writing');
  const step = t('agent.live.step', { n: turn.step || 1 });
  const parts = named ? [step.charAt(0).toUpperCase() + step.slice(1)] : [what, ...(turn.step > 1 ? [step] : [])];
  if (Date.now() - (turn.startedAt || Date.now()) >= 1000) parts.push(time);
  return (
    <div className="msg-meta live-status" role="status" data-stopping={stopping || null}>
      <span className="live-dot" aria-hidden="true" />
      <span className="live-what">{parts.join(' · ')}</span>
    </div>
  );
}

/** "Kurzer Hänger – geht in 4 s weiter.": the countdown of an automatic resume after a hiccup. */
function RetryIn({ at, t }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return <span className="ag-retry">{t('agent.retrying', { s: secs })}</span>;
}

function Meta({ turn, t, lang, showCosts, last, waiting, build }) {
  const lines = [];
  if (waiting) lines.push(<div key="w" className="msg-meta">{t('agent.waiting')}</div>);
  if (turn.status === 'done' && (turn.empty || !(turn.parts || []).some((p) => (p.type === 'text' && p.text.trim()) || p.type !== 'text'))) {
    lines.push(
      <div key="n" className="msg-meta msg-error">
        {t('agent.empty')}{' '}
        {last && <button className="link" onClick={A.retryLast}>{t('tutor.retry')}</button>}
      </div>,
    );
  }
  // A stopped turn that worked with tools says so in its footer ("Gestoppt nach …").
  const worked = (turn.parts || []).some((p) => p.type === 'tool' && p.name !== 'update_plan');
  if (turn.status === 'aborted' && !(worked && turn.endedAt)) lines.push(<div key="a" className="msg-meta">{t('tutor.aborted')}</div>);
  if (turn.status === 'refusal') lines.push(<div key="r" className="msg-meta">{t('tutor.refusal')}</div>);
  if (turn.status === 'error' && turn.retryAt && last) {
    // It goes on by itself in a moment: a quiet line, not an error.
    lines.push(
      <div key="e" className="msg-meta">
        <RetryIn at={turn.retryAt} t={t} />{' '}
        <button className="link" onClick={turn.partial ? A.continueLast : A.retryLast}>{t('agent.retryNow')}</button>
      </div>,
    );
  } else if (turn.status === 'error') {
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
      build && last ? (
        <div key="l" className="build-more">
          <span className="msg-meta">{t('build.limit')}</span>
          <button className="btn btn-sm btn-primary" onClick={() => A.askTutor(t('build.continuePrompt'))}>{t('build.continue')}</button>
        </div>
      ) : (
        <div key="l" className="msg-meta">
          {t('agent.limit')}{' '}
          {last && <button className="link" onClick={() => A.askTutor(t('tutor.continuePrompt'))}>{t('agent.continue')}</button>}
        </div>
      ),
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
  // How long it took and how many steps, quietly, for turns that worked with tools.
  const tools = (turn.parts || []).filter((p) => p.type === 'tool' && p.name !== 'update_plan').length;
  const ended = turn.endedAt && turn.startedAt && (turn.status === 'done' || turn.status === 'aborted');
  const usage = turn.status === 'done' && showCosts && turn.usage
    ? { input: formatNumber(lang, turn.usage.input), output: formatNumber(lang, turn.usage.output), cost: formatCost(lang, turn.cost || 0), steps: turn.steps }
    : null;
  if ((ended && tools) || usage) {
    lines.push(
      <div key="f" className="msg-meta ag-foot">
        {ended && tools > 0 && (
          <>
            {/* Under a second, the time says nothing: just "Fertig" or "Gestoppt". */}
            <span>{turn.endedAt - turn.startedAt < 1000 ? t(turn.status === 'aborted' ? 'agent.foot.stoppedQuick' : 'agent.foot.doneQuick') : t(turn.status === 'aborted' ? 'agent.foot.stopped' : 'agent.foot.done', { time: duration(turn.endedAt - turn.startedAt) })}</span>
            <span> · {tools === 1 ? t('agent.foot.steps1') : t('agent.foot.steps', { n: tools })}</span>
          </>
        )}
        {/* Only the price, and only while the answer is hovered or focused; the tokens are in the tooltip. */}
        {usage && <span className="msg-cost" title={turn.steps > 1 ? t('tutor.usageSteps', usage) : t('tutor.usage', usage)}>{ended && tools ? ' · ' : ''}≈ {usage.cost}</span>}
      </div>,
    );
  }
  return lines;
}

function Turn({ turn, next, t, lang, showCosts, last, proposals, build, busy, stopping, onShot }) {
  if (turn.role === 'user') {
    const cp = next && next.role === 'assistant' && next.checkpoint;
    return (
      <div className="msg-user">
        <div className="bubble">{turn.text}</div>
        {turn.ctx && <div className="msg-ctx">{t('tutor.context', { file: turn.ctx })}</div>}
        {cp && <Checkpoint turnId={next.id} restoredAt={next.restoredAt} busy={busy} />}
      </div>
    );
  }
  const parts = turn.parts || [];
  const groups = groupParts(parts, { build });
  const running = ['waiting', 'thinking', 'working'].includes(turn.status);
  const lastPart = parts[parts.length - 1];
  const waiting = running && Object.values(proposals).some((p) => p.turnId === turn.id && p.status === 'pending');
  return (
    <div className="msg-ai" data-running={running || null}>
      {turn.plan && turn.plan.length > 0 && <PlanCard plan={turn.plan} live={running} />}
      {groups.map((g) => {
        if (g.type === 'text') return g.text ? <Markdown key={g.key} text={g.text} final={!running} t={t} /> : null;
        if (g.type === 'tools') return <ToolRows key={g.key} parts={g.parts} turnId={turn.id} running={running} onShot={onShot} />;
        if (g.type === 'diff') return <DiffCard key={g.key} id={g.proposalId} />;
        return null;
      })}
      {turn.status === 'working' && lastPart && lastPart.type === 'text' && <span className="cursor-blink" aria-hidden="true" />}
      {running && !waiting && <LiveStatus turn={turn} t={t} build={build} stopping={stopping && last} />}
      {build && !running && <BuildCard turnId={turn.id} onShot={onShot} />}
      <Meta turn={turn} t={t} lang={lang} showCosts={showCosts} last={last} waiting={waiting} build={build} />
    </div>
  );
}

/** Up to three ways to start, the ones that fit what is open right now. */
function Starters({ send, t, build }) {
  if (build) {
    return (
      <div className="quick">
        {['build.idea.blocks', 'build.idea.snake', 'build.idea.calc', 'build.idea.library'].map((k) => <button key={k} onClick={() => send(t(k))}>{t(k)}</button>)}
      </div>
    );
  }
  return <TutorStarters send={send} t={t} />;
}

function TutorStarters({ send, t }) {
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
  const [shot, setShot] = useState(null);
  const [stopping, setStopping] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pendingOnly = chat.busy && waitingForStudent();
  const build = chat.mode === 'build';
  const openShot = (id, list) => setShot({ id, list, at: Date.now() });

  // Stop shows at once; the turn ends a moment later, when the main process has stopped it.
  useEffect(() => {
    if (!chat.busy) setStopping(false);
  }, [chat.busy]);
  const stop = () => {
    setStopping(true);
    A.stopTutor();
  };

  // The chat follows the newest output while it is scrolled to the end; scrolled up to read, it
  // stays put. A new message always brings it back to the end.
  const stickRef = useRef(true);
  const turnCount = chat.turns.length;
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);
  useEffect(() => {
    stickRef.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnCount]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    // Screenshots load after they are drawn and make the chat taller.
    const onLoad = () => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener('load', onLoad, true);
    return () => el.removeEventListener('load', onLoad, true);
  }, [hasKey]);
  const onChatScroll = (e) => {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

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
          {[['hints', 'bulb'], ['explain', 'explain'], ['build', 'blocks']].map(([m, icon]) => (
            <button key={m} aria-pressed={chat.mode === m} onClick={() => chat.mode !== m && A.setTutorMode(m)}><Icon name={icon} />{t('tutor.mode.' + m)}</button>
          ))}
        </div>
        <button className="btn btn-sm btn-quiet tutor-new" onClick={A.newChat} disabled={!chat.turns.length} data-tour="new-chat" title={t('tutor.newChat')} aria-label={t('tutor.newChat')}>
          <Icon name="chat" />
          <span className="tutor-new-label">{t('tutor.newChat')}</span>
        </button>
      </div>
      )}
      {!hasKey ? (
        <div className="chat">
          <Setup />
        </div>
      ) : (
        <>
          <div className="chat" ref={listRef} onScroll={onChatScroll}>
            {chat.turns.length === 0 && (
              <>
                {build && <h3 className="build-title">{t('build.title')}</h3>}
                <p className="muted">{t('tutor.empty.' + chat.mode)}</p>
                <Starters send={send} t={t} build={build} />
              </>
            )}
            {chat.turns.map((turn, i) => (
              <Turn
                key={turn.id}
                turn={turn}
                next={chat.turns[i + 1]}
                t={t}
                lang={settings.lang}
                showCosts={settings.showCosts}
                last={i === chat.turns.length - 1}
                proposals={proposals}
                build={build}
                busy={chat.busy}
                stopping={stopping}
                onShot={openShot}
              />
            ))}
          </div>
          <ShotLightbox view={shot} onClose={() => setShot(null)} />
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
                    } else if (e.key === 'Escape' && chat.busy && !stopping) {
                      e.preventDefault();
                      stop();
                    }
                  }}
                  placeholder={t(build ? 'build.placeholder' : 'tutor.placeholder')}
                  aria-label={t(build ? 'build.placeholder' : 'tutor.placeholder')}
                />
                {chat.busy && !(pendingOnly && text.trim()) ? (
                  <button type="button" className="send-btn stop" data-stopping={stopping || null} onClick={stop} disabled={stopping} aria-label={t('tutor.stop')} title={t('tutor.stop') + ' (Esc)'}>
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
              <ModelPicker compact placement="top" value={settings.model} models={models} showPrices={!!settings.showCosts} onChange={(id) => A.updateSettings({ model: id })} />
              {chat.busy && <span className="composer-hint">{t('agent.stopHint')}</span>}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
