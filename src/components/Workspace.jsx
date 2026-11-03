import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import Diagram from './Diagram.jsx';
import EditorPanel from './EditorPanel.jsx';
import Dock from './Dock.jsx';
import Tutor from './Tutor.jsx';
import InspectorPanel from './InspectorPanel.jsx';
import Icon from './Icon.jsx';

function load(key, fallback) {
  try {
    const v = Number(localStorage.getItem('blackj.' + key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function store(key, v) {
  try { localStorage.setItem('blackj.' + key, String(Math.round(v))); } catch { /* private mode */ }
}

function Splitter({ vertical, onDrag }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={'splitter' + (vertical ? ' v' : '') + (dragging ? ' dragging' : '')}
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      onPointerDown={(e) => {
        e.preventDefault();
        setDragging(true);
        let last = vertical ? e.clientY : e.clientX;
        const move = (ev) => {
          const cur = vertical ? ev.clientY : ev.clientX;
          onDrag(cur - last);
          last = cur;
        };
        const up = () => {
          setDragging(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

function SidePanel() {
  const t = useT();
  const side = useStore((s) => s.side);
  const inspect = useStore((s) => s.inspect);
  return (
    <section className="panel side" aria-label={t('tutor.title')}>
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={side !== 'inspect'} onClick={() => setState({ side: 'tutor' })}>
            <span className="tab-label">{t('tutor.title')}</span>
          </button>
          <button className="tab" role="tab" aria-selected={side === 'inspect'} onClick={() => setState({ side: 'inspect' })}>
            <span className="tab-label">{t('inspect.panel')}</span>
            {inspect && <span className="count">{inspect.trail[0]}</span>}
          </button>
        </div>
        <span className="grow" />
        <button className="icon-btn" title={t('common.close')} aria-label={t('common.close')} onClick={A.toggleTutor}>
          <Icon name="close" />
        </button>
      </div>
      {side === 'inspect' ? <InspectorPanel /> : <Tutor />}
    </section>
  );
}

export default function Workspace() {
  const t = useT();
  const project = useStore((s) => s.project);
  const files = useStore((s) => s.files);
  const tutorOpen = useStore((s) => s.tutorOpen);
  const model = useMemo(() => A.modelOf(files), [files]);
  const bodyRef = useRef(null);

  const [diagramW, setDiagramW] = useState(() => load('diagramW', 500));
  const [tutorW, setTutorW] = useState(() => load('tutorW', 380));
  const [dockH, setDockH] = useState(() => load('dockH', 260));
  useEffect(() => store('diagramW', diagramW), [diagramW]);
  useEffect(() => store('tutorW', tutorW), [tutorW]);
  useEffect(() => store('dockH', dockH), [dockH]);

  useEffect(() => {
    const fit = () => {
      const el = bodyRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setDiagramW((v) => Math.min(Math.max(280, v), Math.max(280, w - (tutorOpen ? tutorW + 12 : 0) - 380)));
      setDockH((v) => Math.min(Math.max(150, v), Math.max(150, h - 240)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [tutorOpen, tutorW]);

  return (
    <div className="ws">
      {project.readOnly && <div className="ws-banner">{t('ws.readOnly')}</div>}
      <div className="ws-body" ref={bodyRef} style={{ gridTemplateColumns: tutorOpen ? `minmax(0,1fr) 12px ${tutorW}px` : 'minmax(0,1fr)' }}>
        <div className="ws-cols" style={{ gridTemplateRows: `minmax(0,1fr) 12px ${dockH}px` }}>
          <div className="ws-cols" style={{ gridTemplateColumns: `${diagramW}px 12px minmax(0,1fr)` }}>
            <Diagram model={model} />
            <Splitter onDrag={(dx) => setDiagramW((v) => Math.max(280, v + dx))} />
            <EditorPanel model={model} />
          </div>
          <Splitter vertical onDrag={(dy) => setDockH((v) => Math.max(150, v - dy))} />
          <Dock model={model} />
        </div>
        {tutorOpen && (
          <>
            <Splitter onDrag={(dx) => setTutorW((v) => Math.min(680, Math.max(300, v - dx)))} />
            <SidePanel />
          </>
        )}
      </div>
    </div>
  );
}
