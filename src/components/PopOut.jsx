import { useT } from '../i18n.js';
import A, { PANEL } from '../panels.js';
import { api } from '../api.js';
import Icon from './Icon.jsx';

/** The head button that moves a panel into a window of its own (only in the main window). */
export default function PopOut({ panel }) {
  const t = useT();
  if (PANEL || !api.panel) return null;
  return (
    <button className="icon-btn popout-btn" data-nodrag aria-label={t('panel.popOut')} title={t('panel.popOut')} onClick={() => A.popOut(panel)}>
      <Icon name="external" />
    </button>
  );
}
