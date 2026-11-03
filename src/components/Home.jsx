import { useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT, relativeDay } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import Icon, { Mark } from './Icon.jsx';

// Small drawings of each example's class diagram: boxes, and inheritance arrows from child to parent.
const MINI = {
  Tiere: { boxes: [['Tier', 92, 6], ['Hund', 30, 58], ['Katze', 154, 58], ['Gehege', 216, 6], ['Zoo', 216, 58]], arrows: [['Hund', 'Tier'], ['Katze', 'Tier']] },
  Bankkonto: { boxes: [['Konto', 60, 32], ['KontoTest', 170, 32]], arrows: [] },
  Bibliothek: { boxes: [['medien', 30, 6, 'pkg'], ['Bibliothek', 122, 6], ['Start', 214, 6], ['Test', 122, 58]], arrows: [] },
};
const BW = 70;
const BH = 24;

function MiniDiagram({ name }) {
  const d = MINI[name];
  if (!d) return null;
  const at = Object.fromEntries(d.boxes.map(([n, x, y]) => [n, { x, y }]));
  return (
    <svg className="mini-diagram" viewBox="0 0 300 90" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {d.arrows.map(([from, to]) => {
        const a = at[from];
        const b = at[to];
        const x1 = a.x + BW / 2;
        const y1 = a.y;
        const x2 = b.x + BW / 2;
        const y2 = b.y + BH;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const p = (s) => `${x2 - 8 * Math.cos(ang + s)} ${y2 - 8 * Math.sin(ang + s)}`;
        return (
          <g key={from}>
            <path d={`M${x1} ${y1} L${x2 - 7 * Math.cos(ang)} ${y2 - 7 * Math.sin(ang)}`} />
            <path className="head" d={`M${x2} ${y2} L${p(0.5)} L${p(-0.5)} Z`} />
          </g>
        );
      })}
      {d.boxes.map(([label, x, y, kind]) => (
        <g key={label} className={kind === 'pkg' ? 'pkg' : ''}>
          <rect x={x} y={y} width={BW} height={BH} rx={kind === 'pkg' ? 2 : 4} />
          <text x={x + BW / 2} y={y + 16} textAnchor="middle">{label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Creating a project: just a name; Enter creates it, Escape closes. */
function NewProject({ onClose }) {
  const t = useT();
  const [name, setName] = useState('');
  return (
    <form
      className="card new-project"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) A.createProject(name.trim());
      }}
    >
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} placeholder={t('home.newPlaceholder')} aria-label={t('home.newName')} />
      <button className="btn btn-primary" type="submit" disabled={!name.trim()}>{t('home.create')}</button>
      <button className="icon-btn" type="button" aria-label={t('common.cancel')} onClick={onClose}><Icon name="close" /></button>
    </form>
  );
}

export default function Home() {
  const t = useT();
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const [creating, setCreating] = useState(false);
  const recent = (settings.recent || []).slice(0, 6);
  const missing = new Set(info.missingRecent || []);
  const exercises = info.exercises || [];
  const done = settings.exercisesDone || [];
  const solved = exercises.filter((x) => done.includes(x.id)).length;
  const nextExercise = exercises.find((x) => !done.includes(x.id)) || exercises[0];

  return (
    <div className="page home">
      <div className="page-inner">
        <header className="home-hero">
          <Mark className="hero-mark" />
          <h1 className="wordmark">BlackJ</h1>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {t('home.new')}
            </button>
            <button className="btn btn-lg" onClick={A.openDialog}>
              <Icon name="folderOpen" />
              {t('home.openShort')}
            </button>
            <button className="btn btn-lg btn-quiet" onClick={A.openZip}>ZIP</button>
          </div>
        </header>
        {creating && <NewProject onClose={() => setCreating(false)} />}

        {!info.jdk && (
          <div className="card home-alert">
            <span className="status-dot bad" />
            <span className="grow">{t('home.javaMissing')}</span>
            <button className="btn btn-sm btn-primary" onClick={() => api.openExternal('https://adoptium.net/temurin/releases/')}>
              {t('home.javaDownload')}
              <Icon name="external" />
            </button>
            <button className="btn btn-sm btn-quiet" onClick={() => A.go('settings')}>{t('home.javaChoose')}</button>
          </div>
        )}

        {recent.length > 0 && (
          <section className="home-section">
            <h2 className="home-label">{t('home.recent')}</h2>
            <div className="recent-grid">
              {recent.map((r) => {
                const gone = missing.has(r.dir);
                return (
                  <div key={r.dir} className={'card lift recent-tile' + (gone ? ' gone' : '')}>
                    <button className="recent-open" onClick={() => A.openRecent(r.dir)} disabled={gone} title={r.dir}>
                      <span className="tile-badge" aria-hidden="true">{(r.name || '?').trim()[0].toUpperCase()}</span>
                      <span className="tile-text">
                        <span className="tile-name">{r.name}</span>
                        <span className="tile-meta">{gone ? t('home.missing') : relativeDay(settings.lang, r.opened)}</span>
                      </span>
                    </button>
                    <button className="icon-btn recent-remove" aria-label={t('home.removeRecent')} title={t('home.removeRecent')} onClick={() => A.removeRecent(r.dir)}>
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="home-split">
          <section className="home-section">
            <h2 className="home-label">{t('home.examples')}</h2>
            <div className="examples">
              {info.examples.map((ex) => (
                <button key={ex} className="card lift example" onClick={() => A.openExample(ex)}>
                  <MiniDiagram name={ex} />
                  <span className="example-text">
                    <span className="example-name">{ex}</span>
                    <span className="tile-meta">{t('home.example.' + ex)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {exercises.length > 0 && (
            <section className="home-section">
              <h2 className="home-label">{t('exercise.title')}</h2>
              <div className="card ex-card">
                <div className="ex-count">
                  <span className="ex-big">{solved}</span>
                  <span className="ex-of">/ {exercises.length}</span>
                </div>
                <div className="ex-bar" role="progressbar" aria-valuemin={0} aria-valuemax={exercises.length} aria-valuenow={solved}>
                  <span style={{ width: `${(solved / exercises.length) * 100}%` }} />
                </div>
                <div className="ex-next">{solved === exercises.length ? t('home.exAllDone') : nextExercise.title}</div>
                <div className="ex-actions">
                  <button className="btn btn-primary" onClick={() => A.openExercise(nextExercise.id)}>
                    <Icon name="play" />
                    {solved === 0 ? t('home.exStart') : t('home.exContinue')}
                  </button>
                  <button className="btn btn-quiet" onClick={() => { setState({ learnFocus: 'exercises' }); A.go('learn'); }}>{t('home.exAll')}</button>
                </div>
              </div>
            </section>
          )}
        </div>

        <footer className="home-status">
          <span className="status-chip">
            <span className={'status-dot' + (info.jdk ? '' : ' bad')} />
            {info.jdk ? `Java ${info.jdk.version}` : t('home.javaMissing')}
          </span>
          <button className="status-chip" onClick={() => A.go('settings')}>
            <span className={'status-dot' + (info.tutor.hasKey && !settings.aiOff ? '' : ' off')} />
            {settings.aiOff ? t('home.aiOff') : info.tutor.hasKey ? t('home.aiReady') : t('home.aiNoKey')}
          </button>
          <button className="status-chip" onClick={() => setState({ shortcuts: true })}>
            <kbd>F1</kbd>
            {t('home.shortcutsShort')}
          </button>
        </footer>
      </div>
    </div>
  );
}
