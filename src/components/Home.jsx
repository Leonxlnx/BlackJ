import { useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT, relativeDay } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import Icon from './Icon.jsx';

// Small drawings of each example's class diagram at a fixed 1:1 scale on a 176px world, so the
// text is always 11px. Boxes are placed by their centre x and a row (0 top, 1 bottom, 0.5 middle);
// inheritance is drawn as a tree: one hollow triangle under the parent, one bus to the children.
const MINI = {
  Tiere: { boxes: [['Tier', 'gibLaut()', 64, 0, 'abstract'], ['Gehege', 'anzahl()', 147, 0], ['Hund', 'gibLaut()', 34, 1], ['Katze', 'leben', 96, 1], ['Zoo', 'main()', 150, 1]], arrows: [['Hund', 'Tier'], ['Katze', 'Tier']] },
  Bankkonto: { boxes: [['Konto', 'einzahlen()', 45, 0.5], ['KontoTest', '«Test»', 131, 0.5]], arrows: [] },
  Bibliothek: { boxes: [['medien', 'Buch, Film', 36, 0, 'pkg'], ['Bibliothek', 'aufnehmen()', 127, 0], ['Start', 'main()', 36, 1], ['BibliothekTest', '«Test»', 127, 1]], arrows: [] },
};
/** "Java einrichten": downloads a JDK into BlackJ's folder, with its progress in place of the button. */
export function JdkInstall() {
  const t = useT();
  const job = useStore((s) => s.jdkInstall);
  if (!job) return <button className="btn btn-sm btn-primary" data-tour="jdk-install" onClick={A.installJdk}><Icon name="download" />{t('jdk.install')}</button>;
  const pct = job.phase === 'download' && job.total ? Math.round((job.received / job.total) * 100) : null;
  return <span className="muted jdk-progress" role="status">{job.phase === 'unpack' ? t('jdk.unpack') : pct != null ? t('jdk.download', { pct }) : t('jdk.lookup')}</span>;
}

const ROW = (r) => 12 + r * 58;
const BOX_H = 38;

function MiniDiagram({ name }) {
  const d = MINI[name];
  if (!d) return null;
  const at = Object.fromEntries(d.boxes.map(([n, , x, r]) => [n, { x, y: ROW(r) }]));
  const parents = [...new Set(d.arrows.map(([, to]) => to))];
  return (
    <div className="mini-diagram" aria-hidden="true">
      <div className="mini-world">
        {parents.length > 0 && (
          <svg width="176" height="116">
            {parents.map((p) => {
              const kids = d.arrows.filter(([, to]) => to === p).map(([from]) => at[from]);
              const px = at[p].x;
              const tip = at[p].y + BOX_H;
              const base = tip + 7;
              const bus = Math.round((base + Math.min(...kids.map((k) => k.y))) / 2);
              const xs = [px, ...kids.map((k) => k.x)];
              const d1 = `M${px} ${base}V${bus}M${Math.min(...xs)} ${bus}H${Math.max(...xs)}` + kids.map((k) => `M${k.x} ${bus}V${k.y}`).join('');
              return (
                <g key={p}>
                  <path d={d1} />
                  <path className="head" d={`M${px} ${tip}L${px - 4.5} ${base}H${px + 4.5}Z`} />
                </g>
              );
            })}
          </svg>
        )}
        {d.boxes.map(([label, member, x, r, kind]) => (
          <div key={label} className={'mini-box' + (kind ? ' ' + kind : '')} style={{ left: x, top: ROW(r) }}>
            <b>{label}</b>
            <span>{member}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Creating a project: just a name; Enter creates it, Escape closes. */
function NewProject({ onClose }) {
  const t = useT();
  const [name, setName] = useState('');
  return (
    <form
      className="new-project"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) A.createProject(name.trim());
      }}
    >
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} placeholder={t('home.newPlaceholder')} aria-label={t('home.newName')} />
      <button className="btn btn-primary btn-lg" type="submit" disabled={!name.trim()}>{t('home.create')}</button>
      <button className="icon-btn" type="button" aria-label={t('common.cancel')} onClick={onClose}><Icon name="close" /></button>
    </form>
  );
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Home() {
  const t = useT();
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const [creating, setCreating] = useState(false);
  const lang = settings.lang;
  const recent = settings.recent || [];
  const missing = new Set(info.missingRecent || []);
  const current = recent[0] && !missing.has(recent[0].dir) ? recent[0] : null;
  const list = (current ? recent.slice(1) : recent).slice(0, 4);
  // A day per row only when the rows were opened on different days.
  const days = list.map((r) => (missing.has(r.dir) ? null : relativeDay(lang, r.opened)));
  const showDays = new Set(days.filter(Boolean)).size > 1;
  // Two projects with the same name are told apart by their folder, unless it is BlackJ's own.
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  const parentDir = (dir) => dir.replace(/[\\/][^\\/]+[\\/]?$/, '');
  const parentOf = (r) => {
    const same = list.filter((x) => x.name === r.name);
    if (same.length < 2 || new Set(same.map((x) => norm(parentDir(x.dir)))).size < 2) return '';
    if (info.projectsDir && norm(parentDir(r.dir)) === norm(info.projectsDir)) return '';
    return parentDir(r.dir).split(/[\\/]/).filter(Boolean).pop() || '';
  };
  const exercises = info.exercises || [];
  const done = settings.exercisesDone || [];
  const solved = exercises.filter((x) => done.includes(x.id)).length;
  const nextExercise = exercises.find((x) => !done.includes(x.id)) || exercises[0];
  // Three rows around the next exercise, so the card shows where you are in the list.
  const nextAt = Math.max(0, exercises.indexOf(nextExercise));
  const from = Math.max(0, Math.min(nextAt - (solved > 0 ? 1 : 0), exercises.length - 3));
  const window3 = exercises.slice(from, from + 3);
  const allDone = exercises.length > 0 && solved === exercises.length;
  const when = current ? relativeDay(lang, current.opened) : '';

  const exerciseCard = exercises.length > 0 && (
    <section className="card ex-card" aria-label={t('exercise.title')}>
      <div className="ex-head">
        <button className="card-label" onClick={() => { setState({ learnFocus: 'exercises' }); A.go('learn'); }}>{t('exercise.title')}</button>
        <span className="ex-count">{solved}/{exercises.length}</span>
      </div>
      <div className="ex-bar" role="progressbar" aria-valuemin={0} aria-valuemax={exercises.length} aria-valuenow={solved}>
        <span style={{ width: `${(solved / exercises.length) * 100}%` }} />
      </div>
      <ul className="ex-list">
        {window3.map((x) => {
          const isDone = done.includes(x.id);
          return (
            <li key={x.id}>
              <button className={'ex-item' + (x === nextExercise && !allDone ? ' next' : '')} onClick={() => A.openExercise(x.id)}>
                <span className={'ex-dot' + (isDone ? ' done' : '')} />
                <span>{x.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="text-link" onClick={() => A.openExercise(nextExercise.id)}>
        {allDone ? t('home.exAllDone') : solved === 0 ? t('home.exStart') : t('home.exContinue')}
        <Icon name="send" />
      </button>
    </section>
  );

  const examplesCard = (
    <section className={'card list-card examples-card' + (list.length ? ' full' : '')} aria-label={t('home.examples')}>
      <div className="card-head">{t('home.examples')}</div>
      <div className="examples">
        {info.examples.map((ex) => (
          <button key={ex} className="example" onClick={() => A.openExample(ex)}>
            <MiniDiagram name={ex} />
            <span className="example-name">{ex}</span>
            <span className="example-meta">{t('home.example.' + ex)}</span>
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="page home">
      <div className="page-inner">
        <header className="home-hero">
          {current && <div className="hero-label">{t('home.openedAgo', { when, When: capital(when) })}</div>}
          <h1 className="hero-title">{current ? t('home.continue', { name: current.name }) : t('home.hello')}</h1>
          <div className="hero-actions">
            {current ? (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => A.openRecent(current.dir)}>{t('home.openShort')}</button>
                <button className="btn btn-lg" onClick={() => setCreating(true)}>{t('home.new')}</button>
              </>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>{t('home.new')}</button>
            )}
            <button
              className={'btn btn-lg' + (current ? ' btn-quiet' : '')}
              title={t('home.openHint')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                A.openMenu({
                  x: r.left,
                  y: r.bottom + 6,
                  items: [
                    { label: t('home.importFolder'), icon: 'folderOpen', onClick: A.openDialog },
                    { label: t('home.importZip'), icon: 'file', onClick: A.openZip },
                  ],
                });
              }}
            >
              {t('home.import')}
              <Icon name="chevron" />
            </button>
          </div>
          {creating && <NewProject onClose={() => setCreating(false)} />}
        </header>

        {!info.jdk && (
          <div className="card home-alert">
            <span className="status-dot bad" />
            <span className="grow">{t('home.javaMissing')}</span>
            <JdkInstall />
            <button className="btn btn-sm btn-quiet" onClick={() => A.go('settings')}>{t('home.javaPick')}</button>
          </div>
        )}

        <div className={'home-grid' + (list.length ? '' : ' no-recent')}>
          {list.length > 0 ? (
            <>
              <section className="card list-card" aria-label={t('home.recentShort')}>
                <div className="card-head">{t('home.recentShort')}</div>
                <ul className="recent-list">
                  {list.map((r, i) => {
                    const gone = missing.has(r.dir);
                    return (
                      <li key={r.dir} className={'recent-tile' + (gone ? ' gone' : '')}>
                        <button className="recent-open" onClick={() => A.openRecent(r.dir)} disabled={gone} title={r.dir}>
                          <span className="recent-name">
                            {r.name}
                            {parentOf(r) && <span className="recent-parent">{parentOf(r)}</span>}
                          </span>
                          {(gone || showDays) && <span className="recent-when">{gone ? t('home.missing') : days[i]}</span>}
                        </button>
                        <button className="icon-btn recent-remove" aria-label={t('home.removeRecent')} title={t('home.removeRecent')} onClick={() => A.removeRecent(r.dir)}>
                          <Icon name="close" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
              {exerciseCard}
              {examplesCard}
            </>
          ) : (
            <>
              {examplesCard}
              {exerciseCard}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
