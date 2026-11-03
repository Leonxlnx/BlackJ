import { useMemo, useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import A from '../panels.js';
import { toolLabel, isWriteTool, canUndo } from '../agent.js';
import { lineDiff } from '../lib/diff.js';
import Icon from './Icon.jsx';

const MAX_ROWS = 12;

/** One line per tool call: a small state dot, what the tutor does, and how it went. */
export function ToolRows({ parts, turnId }) {
  const t = useT();
  const tour = useStore((s) => s.tour);
  const [open, setOpen] = useState(false);
  const shown = parts.length > 4 && !open ? parts.slice(0, 3) : parts;
  return (
    <div className="agent-steps">
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
      {shown.length < parts.length && (
        <button className="link" onClick={() => setOpen(true)}>{t('agent.more', { n: parts.length - shown.length })}</button>
      )}
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

/** The parts of an assistant turn in order: text, groups of tool rows, change cards. */
export function groupParts(parts) {
  const out = [];
  for (const p of parts) {
    if (p.type === 'tool') {
      // The change card is the row; a write that failed before it became a card keeps its row.
      if (isWriteTool(p.name) && p.input && (p.status === 'running' || parts.some((q) => q.type === 'diff' && q.proposalId === 'p' + p.callId))) continue;
      const last = out[out.length - 1];
      if (last && last.type === 'tools') last.parts.push(p);
      else out.push({ type: 'tools', parts: [p], key: 'g' + p.callId });
    } else out.push({ ...p, key: p.type === 'diff' ? p.proposalId : 'x' + out.length });
  }
  return out;
}
