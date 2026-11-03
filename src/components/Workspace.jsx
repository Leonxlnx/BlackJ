import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import A, { PANEL } from '../panels.js';
import { PANELS, POPPABLE, minSize, zoneOf, previewRect } from '../lib/layout.js';
import Diagram from './Diagram.jsx';
import EditorPanel from './EditorPanel.jsx';
import Dock from './Dock.jsx';
import Tutor from './Tutor.jsx';
import InspectorPanel from './InspectorPanel.jsx';
import PopOut from './PopOut.jsx';
import Icon from './Icon.jsx';

const reducedMotion = () => !!document.documentElement.dataset.smoke || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The 8px gap between two panels of a split. Dragging it resizes both (straight on the DOM while
 * the pointer moves, stored when it lets go), arrow keys move it by 16px (Shift: 64px), and a
 * double-click gives the split its first sizes back.
 */
function Splitter({ node, a, b }) {
  const t = useT();
  const row = node.dir === 'row';
  const [dragging, setDragging] = useState(false);
  const measure = (el) => {
    const prev = el.previousElementSibling;
    const next = el.nextElementSibling;
    const axis = row ? 'width' : 'height';
    const min = (x) => Math.max(44, parseFloat(getComputedStyle(x)[row ? 'minWidth' : 'minHeight']) || 0);
    return { prev, next, pa: prev.getBoundingClientRect()[axis], pb: next.getBoundingClientRect()[axis], minA: min(prev), minB: min(next) };
  };
  const apply = (m, delta) => {
    const total = m.pa + m.pb;
    const pa = Math.max(m.minA, Math.min(total - m.minB, m.pa + delta));
    const w = node.sizes[a] + node.sizes[b];
    const ga = (w * pa) / total;
    m.prev.style.flexGrow = String(ga);
    m.next.style.flexGrow = String(w - ga);
    const sizes = [...node.sizes];
    sizes[a] = ga;
    sizes[b] = w - ga;
    return sizes;
  };
  const share = Math.round((node.sizes[a] / (node.sizes[a] + node.sizes[b])) * 100);
  return (
    <div
      className={'splitter' + (row ? '' : ' v') + (dragging ? ' dragging' : '')}
      role="separator"
      tabIndex={0}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-label={t('layout.resize')}
      aria-valuenow={share}
      aria-valuemin={0}
      aria-valuemax={100}
      title={t('layout.resizeHint')}
      data-split={node.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const m = measure(el);
        // The folded-in dock opens as soon as its edge is pulled.
        if (m.prev.dataset.fixed || m.next.dataset.fixed) setState({ dockCollapsed: false });
        const start = row ? e.clientX : e.clientY;
        let sizes = null;
        try {
          el.setPointerCapture(e.pointerId);
        } catch { /* a synthetic pointer (smoke test) cannot be captured */ }
        setDragging(true);
        document.documentElement.classList.add(row ? 'resizing-x' : 'resizing-y');
        const move = (ev) => {
          sizes = apply(m, (row ? ev.clientX : ev.clientY) - start);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          document.documentElement.classList.remove('resizing-x', 'resizing-y');
          setDragging(false);
          if (sizes) A.setSplitSizes(node.id, sizes);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => A.resetSplit(node.id)}
      onKeyDown={(e) => {
        const keys = row ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
        if (!keys[e.key]) return;
        e.preventDefault();
        const m = measure(e.currentTarget);
        if (m.prev.dataset.fixed || m.next.dataset.fixed) setState({ dockCollapsed: false });
        A.setSplitSizes(node.id, apply(m, keys[e.key] * (e.shiftKey ? 64 : 16)));
      }}
    />
  );
}

/** Where a panel sits in the layout. The panel itself lives in its own element (host), which moves
    between slots, so rearranging never restarts the editor or the tutor. */
function Slot({ host }) {
  return <div className="ws-slot" ref={(el) => { if (el && host.parentNode !== el) el.appendChild(host); }} />;
}

export function SidePanel() {
  const t = useT();
  const aiOff = useStore((s) => !!s.settings.aiOff);
  const side = useStore((s) => (s.settings.aiOff ? 'inspect' : s.side));
  return (
    <section className="panel side" aria-label={aiOff ? t('inspect.panel') : t('tutor.title')}>
      <div className="panel-head">
        <div className="tabs" role="tablist">
          {!aiOff && (
            <button className="tab" role="tab" data-tour="side-tab:tutor" aria-selected={side !== 'inspect'} onClick={() => setState({ side: 'tutor' })}>
              <span className="tab-label">{t('tutor.title')}</span>
            </button>
          )}
          <button className="tab" role="tab" data-tour="side-tab:inspect" aria-selected={side === 'inspect'} onClick={() => setState({ side: 'inspect' })}>
            <span className="tab-label">{t('inspect.panel')}</span>
          </button>
        </div>
        <span className="grow" />
        <PopOut panel="side" />
        {!PANEL && (
          <button className="icon-btn" title={t('common.close')} aria-label={t('common.close')} onClick={A.toggleTutor}>
            <Icon name="close" />
          </button>
        )}
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
  const layout = useStore((s) => s.layout);
  const dockCollapsed = useStore((s) => s.dockCollapsed);
  const model = useMemo(() => A.modelOf(files), [files]);
  const bodyRef = useRef(null);
  const previewRef = useRef(null);
  const ghostRef = useRef(null);
  const hosts = useRef({});
  const flip = useRef(null);
  const startDrag = useRef(null);

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

  // Layout follows the space we really have: on small school screens the side panel floats over
  // the editor as a drawer.
  const [size, setSize] = useState({ w: 1400, h: 820 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const drawer = size.w < 1240;
  useEffect(() => {
    setState(drawer ? { tutorOpen: false, drawer } : { drawer });
  }, [drawer]);

  const docked = (p) => !layout.detached.includes(p) && (p !== 'side' || tutorOpen);
  const inTree = (p) => docked(p) && !(p === 'side' && drawer);
  const inTreeRef = useRef(inTree);
  inTreeRef.current = inTree;
  const hostOf = (p) => {
    if (!hosts.current[p]) {
      const el = document.createElement('div');
      el.className = 'ws-host';
      el.dataset.panel = p;
      el.addEventListener('pointerdown', (e) => startDrag.current(e, p));
      hosts.current[p] = el;
    }
    return hosts.current[p];
  };

  // ---------------------------------------------------------------- dragging a panel by its head

  const dropAt = (panel, x, y) => {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return POPPABLE.includes(panel) ? { out: true } : null;
    const b = bodyRef.current.getBoundingClientRect();
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null;
    // Close to an edge of the whole workspace: the panel takes the full width or height there.
    const edges = [['left', x - b.left], ['right', b.right - x], ['top', y - b.top], ['bottom', b.bottom - y]].sort((p, q) => p[1] - q[1]);
    if (edges[0][1] < 20) return { target: 'root', zone: edges[0][0], rect: previewRect(b, edges[0][0], 0.28) };
    for (const p of PANELS) {
      if (p === panel || !inTreeRef.current(p) || !hosts.current[p]) continue;
      const r = hosts.current[p].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const zone = zoneOf(r, x, y);
        // The preview sits below the target's head, so its edge never runs through the head's controls.
        const head = hosts.current[p].querySelector('.panel-head');
        const hh = head ? Math.min(head.offsetHeight, r.height / 3) : 0;
        const body = { left: r.left, right: r.right, width: r.width, top: r.top + hh, bottom: r.bottom, height: r.height - hh };
        return { target: p, zone, rect: previewRect(body, zone) };
      }
    }
    return null;
  };
  const showDrop = (panel, ev, drop) => {
    const ghost = ghostRef.current;
    const pv = previewRef.current;
    ghost.textContent = drop && drop.out ? t('panel.popOut') : A.panelTitle(panel);
    ghost.style.transform = `translate(${Math.round(ev.clientX + 14)}px, ${Math.round(ev.clientY + 14)}px)`;
    ghost.classList.add('on');
    if (drop && drop.rect) {
      const b = bodyRef.current.getBoundingClientRect();
      // 6px inside the cell, so the dashed edge keeps clear of the panel's own edge.
      const i = 6;
      pv.style.transform = `translate(${Math.round(drop.rect.left - b.left + i)}px, ${Math.round(drop.rect.top - b.top + i)}px)`;
      pv.style.width = Math.max(0, Math.round(drop.rect.width - 2 * i)) + 'px';
      pv.style.height = Math.max(0, Math.round(drop.rect.height - 2 * i)) + 'px';
      pv.classList.add('on');
    } else pv.classList.remove('on');
  };
  startDrag.current = (e, panel) => {
    if (e.button !== 0 || PANEL) return;
    const head = e.target.closest('.panel-head');
    if (!head || !e.currentTarget.contains(head)) return;
    if (e.target.closest('input, textarea, select, .icon-btn, .btn, .seg, .tab-close, .link, [data-nodrag]')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let on = false;
    let drop = null;
    const host = hosts.current[panel];
    const move = (ev) => {
      if (!on) {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
        on = true;
        try {
          head.setPointerCapture(e.pointerId);
        } catch { /* synthetic pointer */ }
        document.documentElement.classList.add('moving-panel');
        host.classList.add('lifted');
      }
      drop = dropAt(panel, ev.clientX, ev.clientY);
      showDrop(panel, ev, drop);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!on) return;
      document.documentElement.classList.remove('moving-panel');
      host.classList.remove('lifted');
      ghostRef.current.classList.remove('on');
      previewRef.current.classList.remove('on');
      // The click that ends the drag is not a click on the tab it started on.
      const swallow = (c) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      if (!drop || ev.type === 'pointercancel') return;
      if (drop.out) {
        A.popOut(panel, { x: ev.screenX, y: ev.screenY });
        return;
      }
      const from = {};
      for (const p of PANELS) if (hosts.current[p] && hosts.current[p].isConnected) from[p] = hosts.current[p].getBoundingClientRect();
      from[panel] = drop.rect;
      flip.current = { from, moved: panel };
      A.movePanelTo(panel, drop.target, drop.zone);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // After a drop every panel glides from where it was to its new place; the moved one fades in
  // where the preview showed it.
  useLayoutEffect(() => {
    const f = flip.current;
    flip.current = null;
    if (!f || reducedMotion()) return;
    for (const p of PANELS) {
      const el = hosts.current[p];
      const from = f.from[p];
      if (!el || !from || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      const dx = from.left - r.left;
      const dy = from.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) < 1 && p !== f.moved) continue;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, opacity: p === f.moved ? 0.5 : 1 }, { transform: 'none', opacity: 1 }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
  }, [layout.tree]);

  // ---------------------------------------------------------------- rendering the tree

  const renderNode = (node) => {
    if (node.panel) return inTree(node.panel) ? <Slot key={'p:' + node.panel} host={hostOf(node.panel)} /> : null;
    const kids = node.children.map((c, i) => ({ c, i, el: renderNode(c) })).filter((k) => k.el);
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0].el;
    const out = [];
    kids.forEach((k, j) => {
      const key = k.c.id || k.c.panel;
      if (j) out.push(<Splitter key={'s:' + key} node={node} a={kids[j - 1].i} b={k.i} />);
      const min = minSize(k.c, inTree);
      // A folded-in dock keeps just its head.
      const fixed = k.c.panel === 'dock' && dockCollapsed && node.dir === 'col';
      out.push(
        <div
          key={'c:' + key}
          className="ws-cell"
          data-fixed={fixed ? '1' : undefined}
          style={{ flex: fixed ? '0 0 44px' : `${node.sizes[k.i]} 1 0px`, minWidth: node.dir === 'row' ? min.w : undefined, minHeight: node.dir === 'col' && !fixed ? min.h : undefined }}
        >
          {k.el}
        </div>,
      );
    });
    return (
      <div key={node.id} className={'ws-split ' + node.dir} data-split={node.id}>
        {out}
      </div>
    );
  };

  const content = { diagram: <Diagram model={model} />, editor: <EditorPanel />, dock: <Dock />, side: <SidePanel /> };
  return (
    <div className="ws">
      {project.readOnly && <div className="ws-banner">{t('ws.readOnly')}</div>}
      <div className="ws-body" ref={bodyRef}>
        {renderNode(layout.tree)}
        {tutorOpen && drawer && docked('side') && (
          <>
            <div className="drawer-scrim" onPointerDown={A.toggleTutor} />
            <div className="side-drawer" style={{ width: Math.max(320, Math.min(440, Math.round(size.w * 0.6))) }}>
              <Slot host={hostOf('side')} />
            </div>
          </>
        )}
        <div className="ws-drop" ref={previewRef} aria-hidden="true" />
      </div>
      <div className="ws-ghost" ref={ghostRef} aria-hidden="true" />
      {PANELS.filter(docked).map((p) => createPortal(content[p], hostOf(p), p))}
    </div>
  );
}
