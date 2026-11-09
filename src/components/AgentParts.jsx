import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import A from '../panels.js';
import { toolLabel, isWriteTool, canUndo, fileOfPart, toolKind } from '../agent.js';
import { lineDiff } from '../lib/diff.js';
import Icon from './Icon.jsx';
import '../styles/agent.css';

const MAX_ROWS = 12;

// ------------------------------------------------------------------ glyphs
// The agent's own small marks, drawn on the same 24px grid as Icon.jsx (1.6 stroke, round ends,
// one soft tinted area). Each says what kind of work a step is.

const tint = { fill: 'currentColor', stroke: 'none', style: { opacity: 'var(--ico-tint, 0.2)' } };
const dot = (x, y, r = 1.1) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />;
const GLYPHS = {
  // reading: a page with a lens resting on its corner
  read: <><path d="M12.5 20.5H6.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h6.8L18 8.2v3.3" /><path d="M13 3.7V8.5h4.8M8 9.5h3M8 12.5h4" /><circle {...tint} cx="16.4" cy="16.6" r="3.1" /><circle cx="16.4" cy="16.6" r="3.1" /><path d="M18.7 18.9l2 2" /></>,
  // writing: a nib that leaves a line
  write: <><path {...tint} d="M15.1 4.6l4.3 4.3-8.7 8.7-5.2.9.9-5.2z" /><path d="M15.1 4.6l4.3 4.3-8.7 8.7-5.2.9.9-5.2zM13 6.7l4.3 4.3" /><path d="M13.5 20.5h6" /></>,
  // compiling: a hammer striking a spark
  compile: <><rect {...tint} x="10" y="7.3" width="8" height="4.4" rx="1.3" transform="rotate(45 14 9.5)" /><rect x="10" y="7.3" width="8" height="4.4" rx="1.3" transform="rotate(45 14 9.5)" /><path d="M12.4 11.1L5.2 18.3" /><path d="M18.7 14v2.2M18.7 18.6v2.2M15.4 17.4h2.2M19.8 17.4H22" /></>,
  // running: play with two motion ticks
  run: <><path {...tint} d="M9 6.9v10.2a1.2 1.2 0 0 0 1.8 1l8.3-5.1a1.2 1.2 0 0 0 0-2L10.8 5.9A1.2 1.2 0 0 0 9 6.9z" /><path d="M9 6.9v10.2a1.2 1.2 0 0 0 1.8 1l8.3-5.1a1.2 1.2 0 0 0 0-2L10.8 5.9A1.2 1.2 0 0 0 9 6.9z" /><path d="M3.75 9.5H6M3.75 14.5H6" /></>,
  // tests: a shield with a tick
  test: <><path {...tint} d="M12 3.5l7 2.6v5.2c0 4.3-3 7.6-7 9.2-4-1.6-7-4.9-7-9.2V6.1z" /><path d="M12 3.5l7 2.6v5.2c0 4.3-3 7.6-7 9.2-4-1.6-7-4.9-7-9.2V6.1z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.4" /></>,
  // looking at the program: a window with an eye in it
  look: <><rect {...tint} x="3" y="4.5" width="18" height="4" rx="1.5" /><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M3 8.5h18" />{dot(5.6, 6.5, 0.7)}{dot(7.6, 6.5, 0.7)}<path d="M7.5 14.2s1.8-2.9 4.5-2.9 4.5 2.9 4.5 2.9-1.8 2.9-4.5 2.9-4.5-2.9-4.5-2.9z" />{dot(12, 14.2, 1.15)}</>,
  // play-testing: a d-pad with a pressed arrow
  play: <><path d="M9.6 3.8h4.8v5.8h5.8v4.8h-5.8v5.8H9.6v-5.8H3.8V9.6h5.8z" /><path {...tint} d="M14.4 9.6h5.8v4.8h-5.8z" /><path d="M16.4 10.6l1.6 1.4-1.6 1.4" />{dot(12, 12, 1.1)}</>,
  // the plan: a list with a tick on the first line
  plan: <><rect {...tint} x="3.5" y="4.5" width="5" height="5" rx="1.5" /><path d="M4.6 7l1.3 1.3 2.3-2.5" /><rect x="3.5" y="14.5" width="5" height="5" rx="1.5" /><path d="M11.5 7h9M11.5 17h9M11.5 11h5.5" /></>,
  // pointing at the interface: a ring with crosshair ticks
  point: <><circle cx="12" cy="12" r="7" /><circle {...tint} cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  // back to a checkpoint: an arc running back to a diamond marker
  rewind: <><path d="M8.2 7.2A7 7 0 1 1 5.3 14" /><path d="M8.6 3.6L8.2 7.2l3.5.6" /><path {...tint} d="M12 9.8l2.2 2.2-2.2 2.2-2.2-2.2z" /><path d="M12 9.8l2.2 2.2-2.2 2.2-2.2-2.2z" /></>,
  // a screenshot: a frame with a sun and a hill
  shot: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path {...tint} d="M3.5 16.5l5-4.5 4 3.5 3-2.5 5 4V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 16.5l5-4.5 4 3.5 3-2.5 5 4" /><circle cx="15.5" cy="9.5" r="1.4" /></>,
};

export function Glyph({ kind, className = '' }) {
  return (
    <svg className={'ag-glyph ' + className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[kind] || GLYPHS.point}
    </svg>
  );
}

/** A checklist mark: an empty ring, a ring filling up (in progress), or a filled disc with a tick. */
function PlanMark({ status }) {
  return (
    <svg className="ag-mark" data-status={status} viewBox="0 0 16 16" aria-hidden="true">
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="6.5" className="fill" />
          <path d="M5.2 8.2l1.9 1.9 3.8-4" className="tick" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="5.75" className="ring" />
          {status === 'in_progress' && <path d="M8 2.25A5.75 5.75 0 0 1 13.75 8" className="arc" />}
          {status === 'in_progress' && <circle cx="8" cy="8" r="2" className="core" />}
        </>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------ the live plan

/** The checklist the tutor keeps with update_plan: pinned at the top of a running turn. */
export function PlanCard({ plan, live }) {
  const t = useT();
  const done = plan.filter((x) => x.status === 'done').length;
  const [open, setOpen] = useState(null);
  const expanded = live || (open ?? done < plan.length);
  return (
    <section className={'ag-plan' + (live ? ' live' : '')} aria-label={t('agent.plan.title')} data-done={done === plan.length}>
      <button type="button" className="ag-plan-head" aria-expanded={expanded} onClick={() => !live && setOpen(!expanded)} tabIndex={live ? -1 : 0}>
        <Glyph kind="plan" />
        <span className="ag-plan-title">{t('agent.plan.title')}</span>
        <span className="ag-track" aria-hidden="true"><i style={{ width: `${(done / plan.length) * 100}%` }} /></span>
        <span className="ag-plan-count">{t('agent.plan.progress', { done, n: plan.length })}</span>
        {!live && <Icon name="chevron" className="ag-chev" />}
      </button>
      {expanded && (
        <ol className="ag-plan-list">
          {plan.map((it, i) => (
            <li key={i} data-status={it.status}>
              <PlanMark status={it.status} />
              <span className="ag-plan-text">{it.text}</span>
              <span className="sr-only"> ({t('agent.plan.status.' + it.status)})</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ screenshots

/** The screenshots one tool call took, as small thumbnails; a click enlarges them. */
export function ShotStrip({ ids, onOpen }) {
  const t = useT();
  const shots = useStore((s) => s.agentShots) || {};
  const list = (ids || []).filter((id) => shots[id]);
  if (!list.length) return null;
  return (
    <div className="ag-shots">
      {list.map((id) => {
        const s = shots[id];
        return (
          <button key={id} type="button" className="ag-shot" data-shot={id} onClick={() => onOpen && onOpen(id, list)} title={t('agent.shot.open')} aria-label={`${t('agent.shot.open')}: ${s.title || ''} ${s.label || ''}`}>
            <img src={'data:image/png;base64,' + s.png} alt="" draggable="false" style={{ aspectRatio: `${s.width} / ${s.height}` }} />
            {s.label && <span className="ag-shot-label">{s.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One screenshot large, over everything: arrows go through the pictures of that strip, Esc closes. */
export function ShotLightbox({ view, onClose }) {
  const t = useT();
  const shots = useStore((s) => s.agentShots) || {};
  const list = view ? view.list.filter((id) => shots[id]) : [];
  const [at, setAt] = useState(0);
  // Playing runs through the pictures in a loop, so a play-test reads like a short clip.
  const [playing, setPlaying] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => {
    if (!playing || list.length < 2) return undefined;
    const id = setInterval(() => setAt((i) => (i + 1) % list.length), 700);
    return () => clearInterval(id);
  }, [playing, list.length]);
  useEffect(() => {
    if (!view) return undefined;
    setPlaying(false);
    setAt(Math.max(0, list.indexOf(view.id)));
    const prev = document.activeElement;
    setTimeout(() => closeRef.current && closeRef.current.focus(), 0);
    return () => {
      if (prev && prev.focus) prev.focus();
    };
  }, [view]);
  useEffect(() => {
    if (!view) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false);
        setAt((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setPlaying(false);
        setAt((i) => Math.min(list.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [view, list.length]);
  if (!view || !list.length) return null;
  const id = list[Math.min(at, list.length - 1)];
  const s = shots[id];
  return createPortal(
    <div className="ag-lightbox" role="dialog" aria-modal="true" aria-label={s.title || t('agent.shot.open')} onClick={onClose}>
      <figure className="ag-lightbox-fig" onClick={(e) => e.stopPropagation()}>
        <div className="ag-lightbox-img">
          <img src={'data:image/png;base64,' + s.png} alt={s.title || ''} draggable="false" />
        </div>
        <figcaption title={t('agent.shot.hint')}>
          <Glyph kind="look" />
          <span className="ag-lb-title">{s.title || '—'}</span>
          <span className="ag-lb-meta">{s.width}×{s.height}{s.label ? ' · ' + s.label : ''}</span>
          <span className="grow" />
          {list.length > 1 && (
            <span className="ag-lb-nav">
              <button type="button" className="ag-key" data-act="play" aria-pressed={playing} aria-label={t(playing ? 'agent.shot.pause' : 'agent.shot.play')} title={t(playing ? 'agent.shot.pause' : 'agent.shot.play')} onClick={() => setPlaying((v) => !v)}>
                <Icon name={playing ? 'pause' : 'play'} />
              </button>
              <button type="button" className="ag-key" aria-label={t('agent.shot.prev')} disabled={at === 0} onClick={() => { setPlaying(false); setAt((i) => i - 1); }}><Icon name="chevron" className="left" /></button>
              <span className="ag-lb-count">{t('agent.shot.count', { i: at + 1, n: list.length })}</span>
              <button type="button" className="ag-key" aria-label={t('agent.shot.next')} disabled={at >= list.length - 1} onClick={() => { setPlaying(false); setAt((i) => i + 1); }}><Icon name="chevron" className="right" /></button>
            </span>
          )}
          <button type="button" className="ag-key" ref={closeRef} aria-label={t('agent.shot.close')} title={t('agent.shot.close')} onClick={onClose}><Icon name="close" /></button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ tool steps

/** The file a step is about, as a chip that opens it in the editor. */
function FileChip({ path, name }) {
  const exists = useStore((s) => !!s.files[path]);
  return (
    <button type="button" className="file-chip" disabled={!exists} onClick={() => A.openFile(path)} title={path}>
      {name}
    </button>
  );
}

function ToolRow({ p, turnId, onShot }) {
  const t = useT();
  const tour = useStore((s) => s.tour);
  const live = tour && tour.callId === p.callId && tour.mode === 'tour';
  const summary = live ? t('tour.count', { i: tour.index + 1, n: tour.steps.length }) : p.summary;
  const replay = p.name === 'show_tutorial' && p.status === 'done' && !live && p.input && p.input.steps;
  const label = toolLabel(p, t);
  const file = fileOfPart(p);
  // The label names the file ("Liest Hund.java") or its class ("Legt Hund an"): that word becomes the chip.
  const base = file ? file.split('/').pop() : '';
  const name = base && label.includes(base) ? base : base.replace(/\.java$/, '');
  const at = name ? label.indexOf(name) : -1;
  return (
    <>
      <div className={'agent-step' + (replay ? ' wrap' : '')} data-status={p.status} data-kind={toolKind(p.name)}>
        <span className="as-mark">
          <Glyph kind={toolKind(p.name)} />
        </span>
        <span className="label" title={label + (summary ? ' · ' + summary : '')}>
          {/* A finished tutorial is one short line: how it ended, and the replay link. */}
          {replay && summary ? summary : at >= 0 ? <>{label.slice(0, at)}<FileChip path={file} name={name} />{label.slice(at + name.length)}</> : label}
          {summary && !replay ? <span className="sum"> · {summary}</span> : null}
          {/* The replay link flows with the text, so a long summary wraps instead of being cut. */}
          {replay && (
            <>
              <span className="sum"> · </span>
              <button className="link" onClick={() => A.startTour({ title: p.input.title, steps: p.input.steps, callId: p.callId, turnId })}>
                {t('tour.replay')}
              </button>
            </>
          )}
        </span>
        <span className="as-state" aria-hidden="true" />
      </div>
      {p.shots && p.shots.length > 0 && <ShotStrip ids={p.shots} onOpen={onShot} />}
    </>
  );
}

/** "3 gelesen · 2 geändert · kompiliert · 2 Bilder": what a group of steps did, in a few words. */
function groupSummary(parts, t) {
  const count = (kind) => parts.filter((p) => toolKind(p.name) === kind && p.status !== 'cancelled').length;
  const shots = parts.reduce((n, p) => n + (p.shots ? p.shots.length : 0), 0);
  const out = [];
  if (count('read')) out.push(t('agent.group.read', { n: count('read') }));
  if (count('write')) out.push(t('agent.group.write', { n: count('write') }));
  if (count('compile')) out.push(t('agent.group.compile'));
  if (count('run') + count('test')) out.push(t('agent.group.run', { n: count('run') + count('test') }));
  if (shots) out.push(t('agent.group.look', { n: shots }));
  return out.join(' · ');
}

/**
 * A run of tool calls between two pieces of text. Short runs are plain rows; longer ones get a
 * header with what they did, open while the turn works (latest rows first in view) and folded
 * once it is done. Screenshots stay visible when folded.
 */
export function ToolRows({ parts, turnId, running = false, onShot }) {
  const t = useT();
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(false);
  const collapsible = parts.length > 3;
  const active = running && parts.some((p) => p.status === 'running' || p.status === 'streaming');
  const expanded = !collapsible || (open ?? active);
  const errors = parts.filter((p) => p.status === 'error').length;
  const tail = running && parts.length > 5 && !all;
  const shown = expanded ? (tail ? parts.slice(-4) : parts) : [];
  const folded = !expanded ? parts.flatMap((p) => p.shots || []) : [];
  const kinds = [...new Set(parts.map((p) => toolKind(p.name)))].slice(0, 3);
  return (
    <div className="agent-steps" data-collapsible={collapsible || null} data-open={expanded}>
      {collapsible && (
        <button type="button" className="ag-group-head" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>
          <span className="ag-stack" aria-hidden="true">{kinds.map((k) => <Glyph key={k} kind={k} />)}</span>
          <span className="ag-group-title">{t('agent.group.steps', { n: parts.length })}</span>
          <span className="ag-group-sum">{groupSummary(parts, t)}</span>
          {errors > 0 && <span className="ag-group-err">{t('agent.group.errors', { n: errors })}</span>}
          {active && <span className="ag-spinner" aria-hidden="true" />}
          <Icon name="chevron" className="ag-chev" />
        </button>
      )}
      {expanded && tail && (
        <button className="link ag-earlier" onClick={() => setAll(true)}>{t('agent.more', { n: parts.length - shown.length })}</button>
      )}
      {expanded && (
        <div className="ag-rows">
          {shown.map((p) => <ToolRow key={p.callId} p={p} turnId={turnId} onShot={onShot} />)}
        </div>
      )}
      {folded.length > 0 && <ShotStrip ids={folded} onOpen={onShot} />}
    </div>
  );
}

// ------------------------------------------------------------------ checkpoints

/**
 * Under a student's message whose turn changed files: back to how every file was before it.
 * Asks first, with how many files change.
 */
export function Checkpoint({ turnId, restoredAt, busy }) {
  const t = useT();
  const [ask, setAsk] = useState(null);
  const [working, setWorking] = useState(false);
  const open = async () => {
    const p = await A.checkpointPreview(turnId);
    setAsk(!p || p.error ? { error: (p && p.error) || 'gone' } : { n: p.change.length + p.create.length + p.remove.length });
  };
  const go = async () => {
    setWorking(true);
    const r = await A.restoreCheckpoint(turnId);
    setWorking(false);
    setAsk(r && r.error ? { error: r.error } : null);
  };
  if (!ask) {
    return (
      <div className="ag-cp">
        <button type="button" className="ag-cp-btn" data-act="checkpoint" onClick={open} disabled={busy} title={t('agent.cp.hint')}>
          <Glyph kind="rewind" />
          <span>{restoredAt ? t('agent.cp.done') : t('agent.cp.label')}</span>
        </button>
      </div>
    );
  }
  const n = ask.n || 0;
  return (
    <div className="ag-cp open" role="group" aria-label={t('agent.cp.hint')}>
      <div className="ag-cp-card">
        <Glyph kind="rewind" />
        <div className="ag-cp-text">
          <b>{ask.error ? (ask.error === 'busy' ? t('tutor.err.busy') : t('agent.cp.gone')) : t('agent.cp.confirm')}</b>
          {!ask.error && <span>{n === 0 ? t('agent.cp.none') : n === 1 ? t('agent.cp.files1') : t('agent.cp.files', { n })}</span>}
        </div>
        <div className="ag-cp-actions">
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAsk(null)}>{t('agent.cp.cancel')}</button>
          {!ask.error && n > 0 && <button type="button" className="btn btn-sm btn-primary" data-act="restore" disabled={working} onClick={go}>{t('agent.cp.do')}</button>}
        </div>
      </div>
    </div>
  );
}

const fileName = (path) => String(path || '').split('/').pop();

/** A change the tutor proposes (or made): the changed lines, and what the student can do with it. */
export function DiffCard({ id }) {
  const t = useT();
  const p = useStore((s) => s.agent.proposals[id]);
  const proposals = useStore((s) => s.agent.proposals);
  const diff = useMemo(() => (p && p.kind !== 'delete' ? lineDiff(p.before, p.after) : null), [p && p.before, p && p.after, p && p.kind]);
  if (!p) return null;
  const rows = diff ? diff.rows : [];
  const waiting = p.status === 'pending' || p.status === 'open';
  const compare = () => setState({ dialog: { type: 'diff', proposalId: id, file: p.file, original: p.before, modified: p.after } });
  return (
    <div className="agent-diff" data-status={p.status} data-tour="proposal">
      <div className="agent-diff-head">
        <span className="name">{fileName(p.file)}</span>
        {p.kind === 'create' && <span className="tag">{t('agent.diff.new')}</span>}
        {p.kind === 'delete' && <span className="tag">{t('agent.diff.delete')}</span>}
        {diff && <span className="stat">+{diff.added} −{diff.removed}</span>}
      </div>
      {p.kind === 'delete' ? (
        <div className="agent-diff-text">{t('agent.diff.deleteText')}</div>
      ) : (
        <div className="agent-diff-body">
          {rows.slice(0, MAX_ROWS).map((r, i) => (
            <div key={i} className={'dl ' + (r.type === 'ctx' ? '' : r.type)}>{r.type === 'gap' ? '⋯' : (r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  ') + r.text}</div>
          ))}
          {rows.length > MAX_ROWS && <button className="link" onClick={compare}>{t('agent.diff.showAll')}</button>}
        </div>
      )}
      <div className="agent-diff-foot">
        {waiting ? (
          <>
            <button className="btn btn-sm btn-primary" data-act="accept" data-tour="proposal-accept" disabled={!!p.busy} onClick={() => A.acceptProposal(id)}>{t('agent.diff.accept')}</button>
            <button className="btn btn-sm btn-quiet" data-act="reject" disabled={!!p.busy} onClick={() => A.rejectProposal(id)}>{t('agent.diff.reject')}</button>
            <span className="grow" />
            {p.kind !== 'delete' && <button className="link" onClick={compare}>{t('agent.diff.view')}</button>}
          </>
        ) : p.status === 'applied' ? (
          <>
            <span>{t('agent.diff.applied')}</span>
            <span className="grow" />
            {canUndo(p, proposals) && <button className="btn btn-sm btn-quiet" data-act="undo" onClick={() => A.undoChange(id)}>{t('agent.diff.undo')}</button>}
          </>
        ) : (
          <>
            <span>{t('agent.diff.status.' + p.status)}</span>
            {p.status === 'accepted' && canUndo(p, proposals) && (
              <>
                <span className="grow" />
                <button className="btn btn-sm btn-quiet" data-act="undo" onClick={() => A.undoChange(id)}>{t('agent.diff.undo')}</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** What goes along with the next message; each chip can be left out once. */
export function ContextChips() {
  const t = useT();
  const sendContext = useStore((s) => s.settings.sendContext);
  // A string snapshot: the chips are rebuilt from the store on every change.
  const chips = JSON.parse(useStore((s) => JSON.stringify(A.contextChips(s))));
  if (!sendContext) return <div className="ctx-chips"><span className="ctx-off">{t('tutor.contextOff')}</span></div>;
  const visible = chips.filter((c) => !c.hidden);
  if (!visible.length) return null;
  return (
    <div className="ctx-chips">
      {visible.map((c) => (
        <span key={c.key} className="ctx-chip" title={c.label}>
          <span>{c.label}</span>
          <button type="button" className="ctx-chip-x" aria-label={t('chip.remove')} title={t('chip.remove')} onClick={() => A.hideChip(c.key, c.value)}>
            <Icon name="close" />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * What a build made: each file once with its lines added and removed, whether it compiles, and
 * the two things to do next: start the program, or take the whole build back.
 */
export function BuildCard({ turnId, onShot }) {
  const t = useT();
  const proposals = useStore((s) => s.agent.proposals);
  const files = useStore((s) => s.files);
  const compile = useStore((s) => s.compile);
  const running = useStore((s) => s.bench.state === 'running' || s.bench.state === 'waiting');
  // The turn's screenshots, newest last: the card shows the last one as "what you built".
  const shotIds = useStore((s) => {
    const turn = s.chat.turns.find((x) => x.id === turnId);
    return turn ? (turn.parts || []).flatMap((p) => p.shots || []).join(',') : '';
  });
  const shotMap = useStore((s) => s.agentShots) || {};
  const turnShots = shotIds ? shotIds.split(',').filter((id) => shotMap[id]) : [];
  const preview = turnShots.length ? shotMap[turnShots[turnShots.length - 1]] : null;
  const changes = Object.values(proposals)
    .filter((p) => p.turnId === turnId && p.kind !== 'delete' && ['applied', 'accepted', 'undone'].includes(p.status))
    .sort((a, b) => (a.appliedAt || 0) - (b.appliedAt || 0));
  const rows = useMemo(() => {
    const byFile = new Map();
    for (const p of changes) {
      const e = byFile.get(p.file) || { file: p.file, before: p.before, created: false };
      byFile.set(p.file, { ...e, after: p.after, created: e.created || p.kind === 'create', undone: p.status === 'undone' });
    }
    return [...byFile.values()].map((e) => ({ ...e, diff: lineDiff(e.before, e.after) }));
  }, [changes.map((p) => p.id + p.status).join()]);
  if (!rows.length) return null;
  const undone = rows.every((r) => r.undone);
  const model = A.modelOf(files);
  const touched = rows.map((r) => files[r.file] && files[r.file].className).filter(Boolean);
  const main = touched.find((c) => model.byName[c] && model.byName[c].hasMain) || (model.list.find((c) => c.hasMain) || {}).fileClass;
  const stale = rows.some((r) => files[r.file] && compile.snapshot && compile.snapshot[r.file] !== files[r.file].content);
  const state = compile.state === 'errors' ? 'bad' : compile.state === 'ok' && !stale ? 'ok' : 'stale';
  return (
    <div className="build-card" data-status={undone ? 'undone' : state}>
      {preview && !undone && (
        <button type="button" className="build-shot" onClick={() => onShot && onShot(turnShots[turnShots.length - 1], turnShots)} title={t('build.preview')} aria-label={t('build.preview')}>
          <img src={'data:image/png;base64,' + preview.png} alt={preview.title || ''} draggable="false" style={{ aspectRatio: `${preview.width} / ${preview.height}` }} />
          <span className="build-shot-cap"><Glyph kind="look" />{preview.title || ''}<span className="grow" />{preview.width}×{preview.height}</span>
        </button>
      )}
      <div className="build-head">
        <span className="name">{undone ? t('build.undone') : t(rows.length === 1 ? 'build.done1' : 'build.done', { n: rows.length })}</span>
        {!undone && <span className={'state-dot ' + state} />}
        {!undone && <span className="muted">{t('build.state.' + state)}</span>}
      </div>
      <div className="build-files">
        {rows.map((r) => (
          <button key={r.file} className="build-file" disabled={r.undone || !files[r.file]} onClick={() => A.openFile(r.file)}>
            <span className="name">{fileName(r.file)}</span>
            {r.created && <span className="tag">{t('agent.diff.new')}</span>}
            <span className="stat">+{r.diff.added} −{r.diff.removed}</span>
          </button>
        ))}
      </div>
      {!undone && (
        <div className="build-foot">
          {main && (
            <button className="btn btn-sm btn-primary" data-tour="build-run" disabled={running} onClick={() => A.runMain(main)}>
              <Icon name="play" />
              {t('build.run', { name: A.simpleName(main) })}
            </button>
          )}
          {state === 'bad' && <button className="btn btn-sm" onClick={() => A.askTutor(t('build.fixPrompt'))}>{t('build.fix')}</button>}
          <span className="grow" />
          <button className="btn btn-sm btn-quiet" onClick={() => A.undoTurn(turnId)}>{t('build.undoAll')}</button>
        </div>
      )}
    </div>
  );
}

/** The parts of an assistant turn in order: text, groups of tool rows, change cards. */
export function groupParts(parts, { build = false } = {}) {
  const out = [];
  for (const p of parts) {
    // A build writes many files at once: one row per file, and the summary card at the end.
    if (build && p.type === 'diff') continue;
    // The checklist has its own card at the top of the turn.
    if (p.type === 'tool' && p.name === 'update_plan') continue;
    if (p.type === 'tool') {
      // The change card is the row; a write that failed before it became a card keeps its row.
      if (!build && isWriteTool(p.name) && p.input && (p.status === 'running' || parts.some((q) => q.type === 'diff' && q.proposalId === 'p' + p.callId))) continue;
      const last = out[out.length - 1];
      if (last && last.type === 'tools') last.parts.push(p);
      else out.push({ type: 'tools', parts: [p], key: 'g' + p.callId });
    } else out.push({ ...p, key: p.type === 'diff' ? p.proposalId : 'x' + out.length });
  }
  return out;
}
