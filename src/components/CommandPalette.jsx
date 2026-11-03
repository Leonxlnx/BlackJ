import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, getState, setState } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { CONCEPTS } from '../lib/glossary.js';
import Icon from './Icon.jsx';

/** Scores how well `q` matches `text` as an in-order subsequence; 0 = no match. */
function score(q, text) {
  if (!q) return 1;
  const s = text.toLowerCase();
  const query = q.toLowerCase();
  const direct = s.indexOf(query);
  if (direct >= 0) return 1000 - direct * 2 - s.length * 0.1;
  let i = 0;
  let last = -1;
  let gaps = 0;
  for (const ch of query) {
    const at = s.indexOf(ch, i);
    if (at < 0) return 0;
    if (last >= 0) gaps += at - last - 1;
    last = at;
    i = at + 1;
  }
  return 500 - gaps * 4 - s.length * 0.1;
}

/** Ctrl+P: jump to any class, run any command, look up any concept. */
export default function CommandPalette() {
  const t = useT();
  const palette = useStore((s) => s.palette);
  const files = useStore((s) => s.files);
  const project = useStore((s) => s.project);
  const lang = useStore((s) => s.settings.lang);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (palette) {
      setQ(palette.mode === 'commands' ? '>' : '');
      setSel(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
  }, [palette]);

  const items = useMemo(() => {
    if (!palette) return [];
    const s = getState();
    const model = project ? A.modelOf(files) : null;
    const cmds = [];
    const cmd = (label, run, hint, icon) => cmds.push({ kind: 'cmd', label, run, hint, icon });
    if (project) {
      cmd(t('ws.compile'), A.compile, 'Strg+K', 'build');
      for (const c of model.list.filter((x) => x.hasMain)) cmd(`${t('ws.runMain')}: ${c.simple}`, () => A.runMain(c.fileClass), 'F5', 'play');
      cmd(t('ws.newClass'), () => A.openDialogBox({ type: 'newClass' }), 'Strg+N', 'plus');
      cmd(t('diagram.newPackage'), () => A.openDialogBox({ type: 'newPackage' }), '', 'folder');
      if (model.list.some((c) => c.isTest)) cmd(t('tests.runAll'), () => A.runTests({ all: true }), '', 'check');
      cmd(t('pad.open'), () => setState({ dock: 'pad' }), '', 'terminal');
      cmd(t('lib.title'), () => A.openDialogBox({ type: 'library' }), '', 'book');
      cmd(t('jar.title'), () => A.openDialogBox({ type: 'jar' }), '', 'save');
      cmd(t('zip.export'), () => A.exportZip(), '', 'save');
      cmd(t('ws.reset'), A.stopProgram, '', 'reset');
      if (!s.settings.aiOff) cmd(t('ai.write'), () => setState({ aiPrompt: { at: Date.now() } }), 'Strg+I', 'tutor');
      cmd(t('menu.readme'), A.openReadme, '', 'file');
      cmd(t('ws.reveal'), () => window.blackj.project.reveal(), '', 'folderOpen');
    }
    cmd(t('nav.projects'), () => A.go('home'), '', 'folder');
    cmd(t('home.openButton'), A.openDialog, '', 'folderOpen');
    cmd(t('zip.open'), A.openZip, '', 'folderOpen');
    cmd(t('nav.learn'), () => A.go('learn'), '', 'book');
    cmd(t('nav.settings'), () => A.go('settings'), '', 'gear');
    cmd(s.settings.theme === 'dark' ? t('palette.light') : t('palette.dark'), () => A.updateSettings({ theme: s.settings.theme === 'dark' ? 'light' : 'dark' }), '', 'sun');
    cmd(s.settings.lang === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten', () => A.updateSettings({ lang: s.settings.lang === 'de' ? 'en' : 'de' }), '', 'globe');

    const query = q.startsWith('>') ? q.slice(1).trim() : q.trim();
    const onlyCmds = q.startsWith('>');
    const out = [];
    for (const c of cmds) {
      const sc = score(query, c.label);
      if (sc) out.push({ ...c, sc: sc + (onlyCmds ? 0 : -50) });
    }
    if (!onlyCmds && project) {
      for (const c of model.list) {
        const sc = score(query, c.simple) || score(query, c.fileClass);
        if (sc) out.push({ kind: 'class', label: c.simple, hint: c.pkg || c.file, sc: sc + 20, icon: 'file', run: () => { if (c.pkg !== s.pkg) A.enterPackage(c.pkg); A.openClass(c.fileClass); setState({ selectedClass: c.fileClass }); } });
        if (query.length >= 2) {
          for (const m of c.methods) {
            const ms = score(query, m.name);
            if (ms > 600) out.push({ kind: 'member', label: `${c.simple}.${m.name}()`, hint: m.returnType, sc: ms - 100, icon: 'code', run: () => A.openClass(c.fileClass, m.line) });
          }
        }
      }
    }
    if (!onlyCmds && query.length >= 2) {
      for (const c of CONCEPTS) {
        const title = (c[lang] || c.de)[0];
        const sc = score(query, title);
        if (sc > 400) out.push({ kind: 'concept', label: title, hint: t('nav.learn'), sc: sc - 150, icon: 'book', run: () => { setState({ learnConcept: c.id }); A.go('learn'); } });
      }
    }
    return out.sort((a, b) => b.sc - a.sc).slice(0, 40);
  }, [palette, q, files, project, lang]);

  if (!palette) return null;
  const run = (it) => {
    A.closePalette();
    it.run();
  };
  return (
    <div className="overlay palette-overlay" onPointerDown={(e) => e.target === e.currentTarget && A.closePalette()}>
      <div className="palette" role="dialog" aria-label={t('palette.placeholder')}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder={t('palette.hint')}
            spellCheck="false"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(items.length - 1, v + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
              else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel]); }
              else if (e.key === 'Escape') A.closePalette();
            }}
          />
        </div>
        <div className="palette-list" role="listbox">
          {items.length === 0 && <div className="palette-empty">{t('palette.noResults')}</div>}
          {items.map((it, i) => (
            <button key={it.kind + it.label + i} className={'palette-item' + (i === sel ? ' sel' : '')} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              <Icon name={it.icon || 'file'} />
              <span className="pi-label">{it.label}</span>
              <span className="pi-hint">{it.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
