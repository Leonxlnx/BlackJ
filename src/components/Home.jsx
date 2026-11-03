import { useState } from 'react';
import { useStore } from '../store.js';
import { useT, relativeDay } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import Icon from './Icon.jsx';

// Small drawings of each example's class diagram: boxes and inheritance arrows.
const MINI = {
  Tiere: { boxes: [['Tier', 70, 6], ['Hund', 14, 46], ['Katze', 126, 46], ['Gehege', 196, 6], ['Zoo', 252, 46]], arrows: [[44, 46, 96, 26], [152, 46, 104, 26]] },
  Bankkonto: { boxes: [['Konto', 70, 24], ['KontoTest', 170, 24]], arrows: [] },
  Bibliothek: { boxes: [['medien', 20, 6], ['Bibliothek', 110, 6], ['Start', 200, 6], ['Test', 110, 46]], arrows: [] },
};

function MiniDiagram({ name }) {
  const d = MINI[name];
  if (!d) return null;
  return (
    <svg className="mini-diagram" viewBox="0 0 320 74" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
      {d.arrows.map(([x1, y1, x2, y2], i) => (
        <g key={i}>
          <path d={`M${x1} ${y1} L${x2} ${y2}`} />
          <path d={`M${x2} ${y2} l-5 2 l2 -5 z`} />
        </g>
      ))}
      {d.boxes.map(([label, x, y]) => (
        <g key={label}>
          <rect x={x} y={y} width="60" height="22" rx="3" />
          <text x={x + 30} y={y + 15} textAnchor="middle">{label}</text>
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
            <div className="home-actions">
              <form
                className="card action-card"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) A.createProject(name.trim());
                }}
              >
                <h2>{t('home.new')}</h2>
                <label className="field">
                  <span className="field-label">{t('home.newName')}</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('home.newPlaceholder')} />
                </label>
                <div className="action-row">
                  <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
                    <Icon name="plus" />
                    {t('home.create')}
                  </button>
                </div>
              </form>
              <div className="card action-card">
                <h2>{t('home.open')}</h2>
                <p>{t('home.openHint')}</p>
                <div className="action-row">
                  <button className="btn" onClick={A.openDialog}>
                    <Icon name="folderOpen" />
                    {t('home.open')}
                  </button>
                </div>
              </div>
            </div>

            <section>
              <h2 className="section-title">{t('home.examples')}</h2>
              <div className="examples">
                {info.examples.map((ex) => (
                  <button key={ex} className="card example" onClick={() => A.openExample(ex)}>
                    <h3>
                      {ex}
                      <Icon name="send" width="15" height="15" />
                    </h3>
                    <MiniDiagram name={ex} />
                    <span className="muted">{t('home.example.' + ex)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="section-title">{t('home.recent')}</h2>
              <div className="card recent">
                {recent.length === 0 && <p className="muted" style={{ padding: '10px 20px' }}>{t('home.recentEmpty')}</p>}
                {recent.map((r) => (
                  <button key={r.dir} className="recent-row" onClick={() => A.openRecent(r.dir)}>
                    <span style={{ minWidth: 0 }}>
                      <span className="name">{r.name}</span>
                      <span className="path" style={{ display: 'block' }}>{r.dir}</span>
                    </span>
                    <span className="muted">{t('home.openedAt', { when: relativeDay(settings.lang, r.opened) })}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside>
            <div className="card side-card">
              <h2>{t('home.java')}</h2>
              {info.jdk ? (
                <>
                  <div className="status-line">
                    <span className="status-dot" />
                    <span>{t('home.javaFound', { version: info.jdk.version })}</span>
                  </div>
                  <dl className="kv">
                    <dt>{t('home.javaFrom', { source: '' }).trim()}</dt>
                    <dd>{info.jdk.source}</dd>
                    <dt>JDK</dt>
                    <dd title={info.jdk.home}>{info.jdk.home}</dd>
                  </dl>
                </>
              ) : (
                <>
                  <div className="status-line">
                    <span className="status-dot bad" />
                    <span>{t('home.javaMissing')}</span>
                  </div>
                  <p className="dim">{t('home.javaMissingText')}</p>
                  <div className="action-row">
                    <button className="btn btn-sm" onClick={() => api.openExternal('https://adoptium.net/temurin/releases/')}>
                      {t('home.javaDownload')}
                      <Icon name="external" />
                    </button>
                    <button className="btn btn-sm btn-quiet" onClick={() => A.go('settings')}>{t('home.javaChoose')}</button>
                  </div>
                </>
              )}
            </div>
            <div className="card side-card">
              <h2>{t('home.tutor')}</h2>
              <div className="status-line">
                <span className={'status-dot' + (info.tutor.hasKey ? '' : ' off')} />
                <span>{info.tutor.hasKey ? t('home.tutorReady', { model: model ? model.label : settings.model }) : t('home.tutorMissing')}</span>
              </div>
              {!info.tutor.hasKey && (
                <div className="action-row">
                  <button className="btn btn-sm" onClick={() => A.go('settings')}>{t('home.tutorSetup')}</button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
