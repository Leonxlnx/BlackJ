import { useMemo, useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import A from '../panels.js';
import { toolLabel, isWriteTool, canUndo } from '../agent.js';
import { lineDiff } from '../lib/diff.js';
import Icon from './Icon.jsx';

const MAX_ROWS = 12;

/** One line per tool call: a small state dot, what the tutor does, and how it went. */
export function ToolRows({ parts, turnId, tail = false }) {
  const t = useT();
  const tour = useStore((s) => s.tour);
  const [open, setOpen] = useState(false);
  // A long build shows its latest steps (where it is now); otherwise the first ones.
  const cut = parts.length > 4 && !open;
  const shown = cut ? (tail ? parts.slice(-3) : parts.slice(0, 3)) : parts;
  const more = cut && (
    <button className="link" onClick={() => setOpen(true)}>{t('agent.more', { n: parts.length - shown.length })}</button>
  );
  return (
    <div className="agent-steps">
      {tail && more}
      {shown.map((p) => {
        const live = tour && tour.callId === p.callId && tour.mode === 'tour';
        const summary = live ? t('tour.count', { i: tour.index + 1, n: tour.steps.length }) : p.summary;
        const replay = p.name === 'show_tutorial' && p.status === 'done' && !live && p.input && p.input.steps;
        return (
          <div key={p.callId} className={'agent-step' + (replay ? ' wrap' : '')} data-status={p.status}>
            <span className="state-dot" />
            <span className="label" title={toolLabel(p, t) + (summary ? ' · ' + summary : '')}>
              {/* A finished tutorial is one short line: how it ended, and the replay link. */}
              {replay && summary ? summary : toolLabel(p, t)}
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
          </div>
        );
      })}
      {!tail && more}
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
export function BuildCard({ turnId }) {
  const t = useT();
  const proposals = useStore((s) => s.agent.proposals);
  const files = useStore((s) => s.files);
  const compile = useStore((s) => s.compile);
  const running = useStore((s) => s.bench.state === 'running' || s.bench.state === 'waiting');
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
