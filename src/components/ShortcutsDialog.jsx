import { useStore, setState } from '../store.js';
import { useT } from '../i18n.js';
import Icon from './Icon.jsx';

const GROUPS = [
  ['shortcuts.general', [['Strg P', 'shortcuts.palette'], ['Strg Umschalt P', 'shortcuts.commands'], ['F1', 'shortcuts.help'], ['Strg Umschalt L', 'shortcuts.side']]],
  ['shortcuts.project', [['Strg K', 'ws.compile'], ['F5', 'ws.runMain'], ['Strg N', 'ws.newClass'], ['Strg S', 'editor.save']]],
  ['shortcuts.editor', [['Strg I', 'ai.write'], ['Tab', 'shortcuts.acceptAi'], ['Strg Leertaste', 'shortcuts.suggest'], ['Umschalt Alt F', 'editor.format'], ['Strg F', 'shortcuts.find'], ['Strg /', 'shortcuts.comment']]],
  ['shortcuts.debug', [['F9', 'debug.breakpoint'], ['F8', 'debug.continue'], ['F10', 'debug.over'], ['F11', 'debug.into'], ['Umschalt F11', 'debug.out']]],
];

/** F1: every keyboard shortcut on one card. */
export default function ShortcutsDialog() {
  const t = useT();
  const open = useStore((s) => s.shortcuts);
  const lang = useStore((s) => s.settings.lang);
  const keyName = (k) => (lang === 'en' ? { Strg: 'Ctrl', Umschalt: 'Shift', Leertaste: 'Space' }[k] || k : k);
  if (!open) return null;
  const close = () => setState({ shortcuts: false });
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
        <div className="dialog-head">
          <div>
            <h2>{t('shortcuts.title')}</h2>
          </div>
          <button className="icon-btn" aria-label={t('common.close')} onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body shortcuts">
          {GROUPS.map(([title, rows]) => (
            <section key={title}>
              <h3>{t(title)}</h3>
              {rows.map(([keys, label]) => (
                <div className="sc-row" key={label}>
                  <span>{t(label)}</span>
                  <span className="sc-keys">{keys.split(' ').map((k) => <kbd key={k}>{keyName(k)}</kbd>)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
