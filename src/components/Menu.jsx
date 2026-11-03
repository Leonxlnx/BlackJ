import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { formatKeys } from '../i18n.js';
import * as A from '../actions.js';
import Icon from './Icon.jsx';

export default function Menu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const lang = useStore((s) => s.settings.lang);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const y = menu.y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : menu.y;
    setPos({ x: Math.max(8, x), y });
    const first = ref.current.querySelector('.menu-item:not(:disabled)');
    if (first) first.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) A.closeMenu();
    };
    const t = setTimeout(() => {
      window.addEventListener('pointerdown', close);
      window.addEventListener('blur', A.closeMenu);
      window.addEventListener('resize', A.closeMenu);
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', A.closeMenu);
      window.removeEventListener('resize', A.closeMenu);
    };
  }, [menu]);

  if (!menu) return null;
  // When some rows have an icon, the others keep an empty slot so all labels share one left edge.
  const hasIcons = menu.items.some((it) => it.icon);
  const onKey = (e) => {
    const items = [...ref.current.querySelectorAll('.menu-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className={'menu' + (hasIcons ? ' has-icons' : '')} role="menu" ref={ref} style={{ left: pos ? pos.x : menu.x, top: pos ? pos.y : menu.y, visibility: pos ? 'visible' : 'hidden' }} onKeyDown={onKey}>
      {menu.items.map((it, i) => {
        if (it.type === 'sep') return i > 0 ? <div key={i} className="menu-sep" /> : null;
        if (it.type === 'label') return <div key={i} className="menu-label">{it.text}</div>;
        if (it.type === 'note') return <div key={i} className="menu-note">{it.text}</div>;
        return (
          <button
            key={i}
            className={'menu-item' + (it.danger ? ' danger' : '')}
            role="menuitem"
            data-tour={it.tour ? 'menu:' + it.tour : undefined}
            disabled={it.disabled}
            onClick={() => {
              A.closeMenu();
              it.onClick && it.onClick();
            }}
          >
            {it.icon ? <Icon name={it.icon} width="14" height="14" /> : hasIcons && <span className="menu-ico" />}
            {it.label}
            {it.keys ? <kbd className="menu-hint">{formatKeys(lang, it.keys)}</kbd> : it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
