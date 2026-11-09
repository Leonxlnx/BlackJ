import { useStore, setState } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import Icon from './Icon.jsx';

const GROUPS = [
  ['shortcuts.general', [['ctrl P', 'shortcuts.palette'], ['ctrl shift P', 'shortcuts.commands'], ['F1', 'shortcuts.help'], ['ctrl shift L', 'shortcuts.side']]],
  // Two balanced columns (CSS columns): general and editor on the left, the rest on the right.
  ['shortcuts.editor', [
    ['ctrl I', 'ai.write'], ['Tab', 'shortcuts.acceptAi'], ['ctrl space', 'shortcuts.suggest'], ['ctrl .', 'editor.ctx.quickFix'],
    ['shift Alt F', 'editor.format'], ['ctrl H', 'shortcuts.find'], ['ctrl #', 'shortcuts.comment'], ['ctrl shift D', 'editor.ctx.duplicate'],
  ]],
  ['shortcuts.project', [['ctrl K', 'ws.compile'], ['F5', 'ws.runMain'], ['shift F5', 'ws.stop'], ['ctrl N', 'ws.newClass'], ['ctrl S', 'editor.save']]],
  ['shortcuts.debug', [['F9', 'debug.breakpoint'], ['F8', 'debug.continue'], ['F10', 'debug.over'], ['F11', 'debug.into'], ['shift F11', 'debug.out']]],
  ['shortcuts.code', [['F12', 'editor.ctx.definition'], ['shift F12', 'editor.ctx.references'], ['F2', 'editor.ctx.rename']]],
];

/** F1: every keyboard shortcut on one card. */
export default function ShortcutsDialog() {
  const t = useT();
  const open = useStore((s) => s.shortcuts);
  const lang = useStore((s) => s.settings.lang);
  if (!open) return null;
  const close = () => setState({ shortcuts: false });
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
        <div className="dialog-head">
          <div className="dialog-title-row">
            <span className="set-ico" aria-hidden="true"><Icon name="keyboard" /></span>
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
                  <span className="sc-keys">{formatKeys(lang, keys).split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
