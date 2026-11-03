import { useStore, setState } from '../store.js';
import { useT, formatKeys } from '../i18n.js';
import Icon from './Icon.jsx';

const GROUPS = [
  ['shortcuts.general', [['ctrl P', 'shortcuts.palette'], ['ctrl shift P', 'shortcuts.commands'], ['F1', 'shortcuts.help'], ['ctrl shift L', 'shortcuts.side']]],
  ['shortcuts.project', [['ctrl K', 'ws.compile'], ['F5', 'ws.runMain'], ['ctrl N', 'ws.newClass'], ['ctrl S', 'editor.save']]],
  ['shortcuts.editor', [['ctrl I', 'ai.write'], ['Tab', 'shortcuts.acceptAi'], ['ctrl space', 'shortcuts.suggest'], ['shift Alt F', 'editor.format'], ['ctrl H', 'shortcuts.find'], ['ctrl #', 'shortcuts.comment']]],
  ['shortcuts.debug', [['F9', 'debug.breakpoint'], ['F8', 'debug.continue'], ['F10', 'debug.over'], ['F11', 'debug.into'], ['shift F11', 'debug.out']]],
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
                  <span className="sc-keys"><kbd>{formatKeys(lang, keys)}</kbd></span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
