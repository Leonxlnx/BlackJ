import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import Icon from './Icon.jsx';
import '../styles/design.css';

// Each Claude family: its glyph and how deep and how fast it works, on a scale of three.
const FAMILIES = {
  opus: { icon: 'gem', depth: 3, speed: 1 },
  sonnet: { icon: 'feather', depth: 2, speed: 2 },
  haiku: { icon: 'blossom', depth: 1, speed: 3 },
};

/** 'claude-opus-5-5' -> 'opus' (Sonnet when the id says nothing). */
export function familyOf(id) {
  const m = /(opus|sonnet|haiku)/i.exec(String(id || ''));
  return m ? m[1].toLowerCase() : 'sonnet';
}
/** 'Claude Opus 5.5' -> 'Opus 5.5'. */
export const shortModelName = (label) => String(label || '').replace(/^Claude\s+/i, '');

function Meter({ value, label }) {
  return (
    <span className="mp-meter" role="img" aria-label={`${label} ${value}/3`} title={label}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= value ? 'on' : ''} />)}
    </span>
  );
}

function usePrice() {
  const t = useT();
  const lang = useStore((s) => s.settings.lang);
  const nf = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: 2 });
  return (m) => (m.input == null ? null : { short: t('mp.price', { input: nf.format(m.input), output: nf.format(m.output) }), long: t('mp.priceLong', { input: nf.format(m.input), output: nf.format(m.output) }) });
}

/** Move focus between the options with the arrow keys (radio group and list alike). */
function arrowFocus(e, selector) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return false;
  const items = [...e.currentTarget.querySelectorAll(selector)];
  const i = items.indexOf(document.activeElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  items[next]?.focus();
  return true;
}

/**
 * The model picker. Full: three tactile cards side by side (settings). Compact: a small key that
 * opens a list above or below it (chat composer). Prices stay quiet; depth and speed are meters.
 *   <ModelPicker value={id} onChange={(id) => …} models={info.tutor.models} compact placement="top" />
 */
export default function ModelPicker({ value, onChange, models, compact = false, placement = 'bottom', align = 'start', showPrices = true, disabled = false, defaultOpen = false, className = '' }) {
  const t = useT();
  const price = usePrice();
  const list = models || [];
  const current = list.find((m) => m.id === value) || list[0];
  const [open, setOpen] = useState(!!defaultOpen);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const blur = () => setOpen(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', blur);
    // Focus the chosen row so the arrow keys start there.
    const sel = ref.current && ref.current.querySelector('.mp-row[aria-selected="true"]');
    if (sel && !defaultOpen) sel.focus();
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);

  if (!current) return null;
  const pick = (id) => {
    if (id !== value) onChange(id);
    setOpen(false);
  };

  if (!compact) {
    return (
      <div className={'mp ' + className} role="radiogroup" aria-label={t('mp.label')} onKeyDown={(e) => arrowFocus(e, '.mp-opt')}>
        {list.map((m) => {
          const fam = familyOf(m.id);
          const f = FAMILIES[fam];
          const p = showPrices && price(m);
          const on = m.id === current.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className="mp-opt" data-family={fam} disabled={disabled} onClick={() => pick(m.id)}>
              <span className="mp-top">
                <span className="mp-glyph"><Icon name={f.icon} /></span>
                <span className="mp-check" aria-hidden="true"><Icon name="check" /></span>
              </span>
              <span className="mp-name">{shortModelName(m.label)}</span>
              <span className="mp-desc">{t('mp.' + fam)}</span>
              <span className="mp-foot">
                <span className="mp-scale"><span>{t('mp.depth')}</span><Meter value={f.depth} label={t('mp.depth')} /></span>
                <span className="mp-scale"><span>{t('mp.speed')}</span><Meter value={f.speed} label={t('mp.speed')} /></span>
                {p && <span className="mp-price" title={p.long}>{p.short}</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  const fam = familyOf(current.id);
  return (
    <div className={'mp-compact ' + className} ref={ref}>
      <button
        type="button"
        className={'mp-trigger' + (open ? ' open' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('mp.label') + ': ' + current.label}
        title={current.label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
      >
        <Icon name={FAMILIES[fam].icon} />
        <span className="mp-trigger-name">{shortModelName(current.label)}</span>
        <Icon name="chevron" className="mp-chev" />
      </button>
      {open && (
        <div
          className={`mp-pop ${placement === 'top' ? 'up' : 'down'} ${align === 'end' ? 'end' : 'start'}`}
          role="listbox"
          aria-label={t('mp.label')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); ref.current?.querySelector('.mp-trigger')?.focus(); return; }
            arrowFocus(e, '.mp-row');
          }}
        >
          <div className="mp-pop-head" aria-hidden="true">
            <span>{t('mp.label')}</span>
            <span>{t('mp.depth')}</span>
            <span>{t('mp.speed')}</span>
          </div>
          {list.map((m) => {
            const f2 = familyOf(m.id);
            const f = FAMILIES[f2];
            const p = showPrices && price(m);
            const on = m.id === current.id;
            return (
              <button key={m.id} type="button" role="option" aria-selected={on} className="mp-row" data-family={f2} onClick={() => pick(m.id)}>
                <span className="mp-glyph sm"><Icon name={f.icon} /></span>
                <span className="mp-row-text">
                  <b>{shortModelName(m.label)}</b>
                  <span>{t('mp.' + f2)}{p ? <em title={p.long}> · {p.short}</em> : null}</span>
                </span>
                <Meter value={f.depth} label={t('mp.depth')} />
                <Meter value={f.speed} label={t('mp.speed')} />
                <span className="mp-row-check" aria-hidden="true">{on && <Icon name="check" />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
