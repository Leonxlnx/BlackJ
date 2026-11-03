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
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        A.toggleTutor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Layout follows the space we really have: on small school screens the side panel floats
  // over the editor as a drawer, and the stored widths shrink so the editor keeps 360px.
  const [size, setSize] = useState({ w: 1400, h: 820 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const drawer = size.w < 1240;
  const dockCollapsed = useStore((s) => s.dockCollapsed);
  useEffect(() => {
    if (drawer) setState({ tutorOpen: false });
  }, [drawer]);
  const sideW = Math.min(tutorW, Math.round(size.w * (drawer ? 0.6 : 0.32)));
  const mainW = size.w - (tutorOpen && !drawer ? sideW + 12 : 0);
  const dW = Math.max(240, Math.min(diagramW, Math.round(mainW * 0.45), mainW - 12 - 400));
  const dH = dockCollapsed ? 44 : Math.max(140, Math.min(dockH, Math.round(size.h * 0.36)));

  return (
    <div className="ws">
      {project.readOnly && <div className="ws-banner">{t('ws.readOnly')}</div>}
      <div className="ws-body" ref={bodyRef} style={{ gridTemplateColumns: tutorOpen && !drawer ? `minmax(0,1fr) 12px ${sideW}px` : 'minmax(0,1fr)' }}>
        <div className="ws-cols" style={{ gridTemplateRows: `minmax(0,1fr) 12px ${dH}px` }}>
          <div className="ws-cols" style={{ gridTemplateColumns: `${dW}px 12px minmax(0,1fr)` }}>
            <Diagram model={model} />
            <Splitter onDrag={(dx) => setDiagramW(() => Math.max(240, dW + dx))} />
            <EditorPanel model={model} />
          </div>
          <Splitter vertical onDrag={(dy) => { if (dockCollapsed) setState({ dockCollapsed: false }); setDockH(() => Math.max(140, dH - dy)); }} />
          <Dock model={model} />
        </div>
        {tutorOpen && !drawer && (
          <>
            <Splitter onDrag={(dx) => setTutorW(() => Math.min(680, Math.max(300, sideW - dx)))} />
            <SidePanel />
          </>
        )}
        {tutorOpen && drawer && (
          <>
            <div className="drawer-scrim" onPointerDown={A.toggleTutor} />
            <div className="side-drawer" style={{ width: Math.max(320, sideW) }}>
              <SidePanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
