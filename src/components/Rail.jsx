import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import Icon from './Icon.jsx';

function RailButton({ icon, label, active, onClick }) {
  return (
    <button className="rail-btn" aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <Icon name={icon} />
      <span className="tip">{label}</span>
    </button>
  );
}

export default function Rail({ view }) {
  const t = useT();
  const project = useStore((s) => s.project);
  return (
    <nav className="rail" aria-label="BlackJ">
      <div className="rail-group">
        <RailButton icon="folder" label={t('nav.projects')} active={view === 'home'} onClick={() => A.go('home')} />
        {project && <RailButton icon="grid" label={`${t('nav.workspace')}: ${project.name}`} active={view === 'project'} onClick={() => A.go('project')} />}
        <RailButton icon="book" label={t('nav.learn')} active={view === 'learn'} onClick={() => A.go('learn')} />
      </div>
      <div className="rail-spacer" />
      <RailButton icon="gear" label={t('nav.settings')} active={view === 'settings'} onClick={() => A.go('settings')} />
    </nav>
  );
}
