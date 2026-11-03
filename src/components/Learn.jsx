import { useEffect, useRef, useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { CONCEPTS, GROUPS } from '../lib/glossary.js';
import { commonErrors } from '../lib/errors.js';
import monaco from '../lib/monaco.js';
import Icon, { Why } from './Icon.jsx';

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
  const aiOff = useStore((s) => !!s.settings.aiOff);
  const exercises = useStore((s) => s.info.exercises || []);
  const done = useStore((s) => s.settings.exercisesDone || []);
  const focus = useStore((s) => s.learnFocus);
  useEffect(() => {
    if (focus !== 'exercises') return;
    setState({ learnFocus: null });
    const el = document.getElementById('exercises');
    if (el) el.scrollIntoView({ block: 'start' });
  }, [focus]);
  // The palette (Ctrl+P) opens a concept by setting learnConcept.
  const id = useStore((s) => (CONCEPTS.some((c) => c.id === s.learnConcept) ? s.learnConcept : CONCEPTS[0].id));
  const setId = (next) => {
    setState({ learnConcept: next });
    const page = document.querySelector('.page');
    if (page && page.scrollTop > 120) page.scrollTo({ top: 0 });
  };
  const [filter, setFilter] = useState('');
  const concept = CONCEPTS.find((c) => c.id === id);
  const [title, text] = concept[lang] || concept.de;
  const groups = Object.keys(GROUPS.de);
  const errors = commonErrors(lang);
  const q = filter.trim().toLowerCase();
  const shown = CONCEPTS.filter((c) => !q || (c[lang] || c.de).join(' ').toLowerCase().includes(q));
  const at = CONCEPTS.indexOf(concept);
  const prev = CONCEPTS[at - 1];
  const next = CONCEPTS[at + 1];
  const name = (c) => (c[lang] || c.de)[0];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('learn.title')}</h1>
          </div>
        </div>
        <div className="learn-grid">
          <nav className="card learn-list" aria-label={t('learn.title')}>
            <div className="learn-filter">
              <Icon name="search" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && shown[0]) setId(shown[0].id);
                  if (e.key === 'Escape') setFilter('');
                }}
                placeholder={t('learn.filter')}
                aria-label={t('learn.filter')}
                spellCheck="false"
              />
            </div>
            <div className="learn-scroll">
              {groups.map((g) => {
                const items = shown.filter((c) => c.group === g);
                if (!items.length) return null;
                return (
                  <div key={g}>
                    <div className="learn-group">{GROUPS[lang]?.[g] || GROUPS.de[g]}</div>
                    {items.map((c) => (
                      <button key={c.id} className="learn-item" aria-current={c.id === id} onClick={() => setId(c.id)}>
                        <span>{name(c)}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {!shown.length && <div className="learn-group">{t('learn.noMatch')}</div>}
            </div>
          </nav>
          <div>
            <article className="card learn-detail">
              <h2>{title}</h2>
              <p>{text}</p>
              <Code code={concept.code} />
              {!aiOff && hasKey && project && (
                <div className="action-row">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      A.go('project');
                      A.askTutor(t('tutor.prompt.concept', { concept: title }));
                    }}
                  >
                    <Icon name="tutor" />
                    {t('learn.ask')}
                  </button>
                </div>
              )}
              <div className="learn-pager">
                {prev ? (
                  <button className="learn-step" onClick={() => setId(prev.id)}>
                    <span className="muted small">{t('learn.prev')}</span>
                    <span>{name(prev)}</span>
                  </button>
                ) : <span />}
                {next && (
                  <button className="learn-step next" onClick={() => setId(next.id)}>
                    <span className="muted small">{t('learn.next')}</span>
                    <span>{name(next)}</span>
                  </button>
                )}
              </div>
            </article>
            {exercises.length > 0 && (
              <section className="err-list" id="exercises">
                <div className="card">
                  <div className="card-head">
                    {t('exercise.title')}
                    <span className="card-head-aside">{t('exercise.hint')}</span>
                  </div>
                  {exercises.map((ex) => {
                    const solved = done.includes(ex.id);
                    return (
                      <div className="ex-row" key={ex.id}>
                        <span className="ex-n">{ex.n}</span>
                        <div className="ex-text">
                          <h3>{ex.title}</h3>
                          <span className="muted">{ex.topic}</span>
                        </div>
                        {solved && <span className="pill pill-pos">{t('exercise.done')}</span>}
                        <button className={'btn btn-sm' + (solved ? ' btn-quiet' : '')} onClick={() => A.openExercise(ex.id)}>
                          {solved ? t('exercise.again') : t('exercise.start')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="err-list">
              <div className="card">
                <div className="card-head">{t('learn.errors')}</div>
                {errors.map((e) => (
                  <div className="err-row" key={e.id}>
                    <div>
                      <h3>{e.title}</h3>
                      <code>{e.message}</code>
                    </div>
                    <div>
                      <p className="fix">{e.fix}</p>
                      <Why>{e.explain}</Why>
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
