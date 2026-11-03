import { useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT, relativeDay } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import Icon from './Icon.jsx';

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

export default function Home() {
  const t = useT();
  const info = useStore((s) => s.info);
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState('');
  const recent = settings.recent || [];
  const missing = new Set(info.missingRecent || []);
  const model = info.tutor.models?.find((m) => m.id === settings.model);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('home.title')}</h1>
            <p>{t('home.sub')}</p>
          </div>
        </div>
        <div className="home-grid">
          <div className="home-main">
            {recent.length > 0 && (
              <section>
                <h2 className="section-title">{t('home.recent')}</h2>
                <div className="card recent">
                  {recent.map((r) => {
                    const gone = missing.has(r.dir);
                    return (
                      <div key={r.dir} className={'recent-row' + (gone ? ' gone' : '')}>
                        <button className="recent-open" onClick={() => A.openRecent(r.dir)} disabled={gone}>
                          <Icon name="folder" />
                          <span className="recent-text">
                            <span className="name">{r.name}</span>
                            <span className="path">{r.dir}</span>
                          </span>
                          <span className="muted when">{gone ? t('home.missing') : t('home.openedAt', { when: relativeDay(settings.lang, r.opened) })}</span>
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

            <section>
              <h2 className="section-title">{t('home.start')}</h2>
              <div className="home-actions">
                <form
                  className="card action-card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim()) A.createProject(name.trim());
                  }}
                >
                  <h3>{t('home.new')}</h3>
                  <div className="new-row">
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('home.newPlaceholder')} aria-label={t('home.newName')} />
                    <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
                      <Icon name="plus" />
                      {t('home.create')}
                    </button>
                  </div>
                  <p className="muted">{t('home.newHint')}</p>
                </form>
                <div className="card action-card drop-card">
                  <h3>{t('home.open')}</h3>
                  <div className="new-row">
                    <button className="btn" onClick={A.openDialog}>
                      <Icon name="folderOpen" />
                      {t('home.openButton')}
                    </button>
                    <button className="btn btn-quiet" onClick={A.openZip}>{t('zip.openShort')}</button>
                  </div>
                  <p className="muted">{t('home.openHint')}</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="section-title">{t('home.examples')}</h2>
              <div className="examples">
                {info.examples.map((ex) => (
                  <button key={ex} className="card example" onClick={() => A.openExample(ex)}>
                    <MiniDiagram name={ex} />
                    <span className="example-text">
                      <span className="example-name">{ex}</span>
                      <span className="muted">{t('home.example.' + ex)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="home-aside">
            <div className="card side-card">
              <h2>{t('home.status')}</h2>
              <div className="status-row">
                <span className={'status-dot' + (info.jdk ? '' : ' bad')} />
                <div>
                  <div>{info.jdk ? t('home.javaFound', { version: info.jdk.version }) : t('home.javaMissing')}</div>
                  <div className="muted small" title={info.jdk ? info.jdk.home : ''}>{info.jdk ? `${info.jdk.source} · ${info.jdk.home}` : t('home.javaMissingText')}</div>
                  {!info.jdk && (
                    <div className="action-row" style={{ marginTop: 8 }}>
                      <button className="btn btn-sm" onClick={() => api.openExternal('https://adoptium.net/temurin/releases/')}>
                        {t('home.javaDownload')}
                        <Icon name="external" />
                      </button>
                      <button className="btn btn-sm btn-quiet" onClick={() => A.go('settings')}>{t('home.javaChoose')}</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="status-row">
                <span className={'status-dot' + (info.tutor.hasKey && !settings.aiOff ? '' : ' off')} />
                <div>
                  <div>{settings.aiOff ? t('home.aiOff') : info.tutor.hasKey ? t('home.tutorReady', { model: model ? model.label : settings.model }) : t('home.tutorMissing')}</div>
                  {(settings.aiOff || !info.tutor.hasKey) && <button className="link small" onClick={() => A.go('settings')}>{settings.aiOff ? t('home.aiOn') : t('home.tutorSetup')}</button>}
                </div>
              </div>
            </div>
            <div className="card side-card">
              <h2>{t('home.quick')}</h2>
              <ol className="quick-steps">
                <li>{t('home.quick1')}</li>
                <li>{t('home.quick2')}</li>
                <li>{t('home.quick3')}</li>
                <li>{t('home.quick4')}</li>
              </ol>
              <button className="link small" onClick={() => setState({ shortcuts: true })}>{t('home.shortcuts')}</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
