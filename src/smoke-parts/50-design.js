// Design area (1.10): the icon family, the tactile controls in both themes, the model picker and the
// polished pages. Screenshots: design-*.png
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IconSheet, ControlGallery } from '../components/DesignGallery.jsx';
import { ICON_NAMES, ICON_ALIASES } from '../components/Icon.jsx';

// Every icon name the app asks for, read from the sources: name="x", name={'x'}, icon: 'x', icon="x".
const SOURCES = import.meta.glob(['../components/*.jsx', '../*.js'], { query: '?raw', import: 'default', eager: true });
function usedIconNames() {
  const used = new Map();
  const re = /<Icon\s+name=(?:"([a-zA-Z]+)"|\{'([a-zA-Z]+)'\})|\bicon(?::\s*|=)['"]([a-zA-Z]+)['"]/g;
  for (const [file, text] of Object.entries(SOURCES)) {
    for (let m; (m = re.exec(text));) {
      const n = m[1] || m[2] || m[3];
      if (!used.has(n)) used.set(n, file.replace(/^.*\//, ''));
    }
  }
  return used;
}

export default async function ({ step, shot, until, A, getState, setState, log }) {
  const theme0 = getState().settings.theme;
  const mount = (Comp) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(createElement(Comp));
    return () => {
      root.unmount();
      host.remove();
    };
  };

  await step('design: icon contact sheet at 16 and 24 px, dark and light; every name the app uses exists', async () => {
    const known = new Set([...ICON_NAMES, ...Object.keys(ICON_ALIASES)]);
    const missing = [...usedIconNames()].filter(([n]) => !known.has(n)).map(([n, f]) => `${n} (${f})`);
    if (missing.length) await log('     icons asked for but not drawn: ' + missing.join(', '));
    const off = mount(IconSheet);
    try {
      await until(() => document.querySelectorAll('.icon-sheet .ish-cell').length === ICON_NAMES.length * 2, 3000, 'sheet');
      const empty = [...document.querySelectorAll('.ish-dark .ish-cell')].filter((c) => !c.querySelector('svg.s24').children.length).map((c) => c.textContent);
      if (empty.length) throw new Error('icons without drawing: ' + empty.join(', '));
      await shot('design-01-icons');
    } finally {
      off();
    }
    // Only the design area's own files must not ask for icons that are not there.
    const mine = missing.filter((m) => /\((Settings|Home|Rail|Menu|CommandPalette|Learn|ShortcutsDialog|TitleBar|ModelPicker|DesignGallery)\.jsx\)/.test(m));
    if (mine.length) throw new Error('missing icons: ' + mine.join(', '));
  });

  await step('design: tactile controls in dark and light, compact model picker picks a model', async () => {
    const off = mount(ControlGallery);
    try {
      await until(() => document.querySelector('.ctl-gallery .mp-pop .mp-row'), 3000, 'gallery');
      await shot('design-02-controls-dark');
      await A.updateSettings({ theme: 'light' });
      await shot('design-03-controls-light');
      document.querySelector('.ctl-gallery .mp-pop .mp-row[data-family="haiku"]').click();
      await until(() => !document.querySelector('.ctl-gallery .mp-pop'), 2000, 'popover stayed open');
      const label = document.querySelector('.ctl-gallery .mp-trigger').textContent;
      if (!/Haiku/.test(label)) throw new Error('trigger shows ' + label);
      if (document.querySelector('.ctl-gallery .mp-opt[aria-checked="true"]').dataset.family !== 'haiku') throw new Error('full picker did not follow');
      document.querySelector('.ctl-gallery .mp-trigger').click();
      await until(() => document.querySelector('.ctl-gallery .mp-pop'), 2000, 'popover did not open');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await until(() => !document.querySelector('.ctl-gallery .mp-pop'), 2000, 'popover did not close outside');
    } finally {
      off();
      await A.updateSettings({ theme: theme0 });
    }
  });

  await step('design: settings with the model picker (choose Sonnet, then back)', async () => {
    const model0 = getState().settings.model;
    A.go('settings');
    try {
      await until(() => document.querySelectorAll('.mp .mp-opt').length === 3, 5000, 'no model picker in settings');
      if (!document.querySelector('[data-tour="settings:model"] .mp')) throw new Error('model row lost its tour target');
      document.querySelector('[data-tour="settings:model"]').scrollIntoView({ block: 'center' });
      await shot('design-04-settings-model');
      document.querySelector('.mp-opt[data-family="sonnet"]').click();
      await until(() => /sonnet/.test(getState().settings.model), 3000, 'model not chosen');
      await until(() => document.querySelector('.mp-opt[data-family="sonnet"]').getAttribute('aria-checked') === 'true', 2000, 'card not checked');
      await A.updateSettings({ model: model0, theme: 'light' });
      document.querySelector('.page').scrollTo({ top: 0 });
      await shot('design-05-settings-light');
    } finally {
      await A.updateSettings({ model: model0, theme: theme0 });
    }
  });

  await step('design: palette with icon tiles and keys, shortcuts as keycaps', async () => {
    A.go('project');
    A.openPalette();
    await until(() => document.querySelectorAll('.palette-item .pi-ico svg').length > 3 && document.querySelector('.palette-foot kbd'), 4000, 'palette');
    await shot('design-06-palette');
    A.closePalette();
    setState({ shortcuts: true });
    await until(() => document.querySelectorAll('.sc-keys kbd').length > 12, 3000, 'shortcuts');
    await shot('design-07-shortcuts');
    setState({ shortcuts: false });
  });

  await step('design: workspace, home and learn in dark and light', async () => {
    try {
      A.go('project');
      await until(() => document.querySelector('.class-card'), 5000, 'workspace');
      await shot('design-08-ws-dark');
      await A.updateSettings({ theme: 'light' });
      await shot('design-09-ws-light');
      A.go('home');
      await until(() => document.querySelector('.home-hero'), 3000, 'home');
      await shot('design-10-home-light');
      await A.updateSettings({ theme: 'dark' });
      await shot('design-11-home-dark');
      A.go('learn');
      await until(() => document.querySelector('.learn-detail'), 3000, 'learn');
      await shot('design-12-learn');
    } finally {
      await A.updateSettings({ theme: theme0 });
      A.go('project');
    }
  });
}
