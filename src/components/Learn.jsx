import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { CONCEPTS, GROUPS } from '../lib/glossary.js';
import { commonErrors } from '../lib/errors.js';
import monaco from '../lib/monaco.js';
import Icon from './Icon.jsx';

function Code({ code }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    if (ref.current) ref.current.textContent = code;
    monaco.editor.colorize(code, 'java', { tabSize: 4 }).then((html) => {
      if (alive && ref.current) ref.current.innerHTML = html;
    });
    return () => { alive = false; };
  }, [code]);
  return (
    <pre className="learn-code">
      <code ref={ref} />
    </pre>
  );
}

export default function Learn() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const project = useStore((s) => s.project);
  const hasKey = useStore((s) => s.info.tutor.hasKey);
  const [id, setId] = useState(CONCEPTS[0].id);
  const concept = CONCEPTS.find((c) => c.id === id);
  const [title, text] = concept[lang] || concept.de;
  const groups = Object.keys(GROUPS.de);
  const errors = commonErrors(lang);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('learn.title')}</h1>
            <p>{t('learn.sub')}</p>
          </div>
        </div>
        <div className="learn-grid">
          <nav className="card learn-list" aria-label={t('learn.title')}>
            {groups.map((g) => (
              <div key={g}>
                <div className="learn-group">{GROUPS[lang]?.[g] || GROUPS.de[g]}</div>
                {CONCEPTS.filter((c) => c.group === g).map((c) => (
                  <button key={c.id} className="learn-item" aria-current={c.id === id} onClick={() => setId(c.id)}>
                    <span>{(c[lang] || c.de)[0]}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div>
            <article className="card learn-detail">
              <h2>{title}</h2>
              <p>{text}</p>
              <Code code={concept.code} />
              <div className="action-row">
                <button
                  className="btn btn-sm"
                  disabled={!project || !hasKey}
                  title={!project ? t('learn.needProject') : undefined}
                  onClick={() => {
                    A.go('project');
                    A.askTutor(t('tutor.prompt.concept', { concept: title }));
                  }}
                >
                  <Icon name="tutor" />
                  {t('learn.ask')}
                </button>
                {!project && <span className="muted">{t('learn.needProject')}</span>}
              </div>
            </article>
            <section className="err-list">
              <h2 className="section-title">{t('learn.errors')}</h2>
              <div className="card">
                {errors.map((e) => (
                  <div className="err-row" key={e.id}>
                    <div>
                      <h3>{e.title}</h3>
                      <code>{e.message}</code>
                    </div>
                    <div>
                      <p>{e.explain}</p>
                      <p className="fix">{e.fix}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
