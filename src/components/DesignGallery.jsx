// Contact sheets for the smoke run: every icon (16 and 24 px, dark and light) and every control in
// its states. Only the smoke part of the design area renders these; the app never does.
import { useState } from 'react';
import { useStore } from '../store.js';
import Icon, { ICON_NAMES, Select } from './Icon.jsx';
import ModelPicker from './ModelPicker.jsx';

export function IconSheet() {
  const half = (cls, title) => (
    <section className={cls}>
      <h2>{title}</h2>
      <div className="ish-grid">
        {ICON_NAMES.map((n) => (
          <div className="ish-cell" key={n}>
            <div>
              <Icon name={n} className="s16" />
              <Icon name={n} className="s24" />
            </div>
            <span>{n}</span>
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <div className="icon-sheet" data-sheet="icons">
      {half('ish-dark', 'dark · 16 / 24')}
      {half('ish-light', 'light · 16 / 24')}
    </div>
  );
}

export function ControlGallery() {
  const models = useStore((s) => s.info.tutor.models);
  const [model, setModel] = useState(models[1] ? models[1].id : models[0].id);
  const [mode, setMode] = useState('hints');
  const [on, setOn] = useState(true);
  return (
    <div className="ctl-gallery" data-sheet="controls">
      <section className="card">
        <h3>Buttons</h3>
        <div className="ctl-row">
          <button className="btn btn-primary"><Icon name="build" />Kompilieren</button>
          <button className="btn btn-primary pressed"><Icon name="build" />gedrückt</button>
          <button className="btn"><Icon name="play" />main starten</button>
          <button className="btn pressed"><Icon name="play" />gedrückt</button>
          <button className="btn btn-quiet"><Icon name="reset" />Zurücksetzen</button>
          <button className="btn btn-quiet pressed">gedrückt</button>
          <button className="btn" disabled>Aus</button>
        </div>
        <div className="ctl-row">
          <button className="btn btn-sm"><Icon name="stop" />Stopp</button>
          <button className="btn btn-lg btn-primary"><Icon name="plus" />Neues Projekt</button>
          <button className="icon-btn"><Icon name="plus" /></button>
          <button className="icon-btn" aria-pressed="true"><Icon name="details" /></button>
          <button className="icon-btn pressed"><Icon name="link" /></button>
          <button className="icon-btn"><Icon name="more" /></button>
        </div>
      </section>
      <section className="card">
        <h3>Segmente, Schalter, Tasten</h3>
        <div className="ctl-row">
          <div className="seg">
            {[['hints', 'bulb', 'Tipps'], ['explain', 'explain', 'Erklären'], ['build', 'blocks', 'Bauen']].map(([v, ic, label]) => (
              <button key={v} aria-pressed={mode === v} onClick={() => setMode(v)}><Icon name={ic} />{label}</button>
            ))}
          </div>
          <div className="seg">
            <button aria-pressed="true">Quelltext</button>
            <button aria-pressed="false">Dokumentation</button>
          </div>
        </div>
        <div className="ctl-row">
          <button className="switch" role="switch" aria-checked={on} onClick={() => setOn(!on)} />
          <button className="switch" role="switch" aria-checked={!on} onClick={() => setOn(!on)} />
          <kbd>Strg</kbd><kbd>K</kbd><kbd>F5</kbd>
          <button className="chip" aria-pressed="true">String</button>
          <button className="chip">Math</button>
        </div>
      </section>
      <section className="card">
        <h3>Eingaben</h3>
        <div className="ctl-row">
          <input className="input" placeholder="Name der Klasse" style={{ width: 220 }} />
          <span style={{ width: 160 }}><Select value="de" onChange={() => {}}><option value="de">Deutsch</option><option value="en">English</option></Select></span>
        </div>
        <div className="tabs" style={{ height: 36 }}>
          <button className="tab" aria-selected="true">Objekte</button>
          <button className="tab" aria-selected="false">Konsole</button>
          <button className="tab" aria-selected="false">Code Pad</button>
        </div>
      </section>
      <section className="card">
        <h3>Menü und Meldung</h3>
        <div className="ctl-row" style={{ alignItems: 'flex-start' }}>
          <div className="menu has-icons" role="menu">
            <button className="menu-item"><Icon name="play" width="14" height="14" />main starten</button>
            <button className="menu-item"><Icon name="flask" width="14" height="14" />Tests ausführen</button>
            <div className="menu-sep" />
            <button className="menu-item danger"><Icon name="trash" width="14" height="14" />Löschen</button>
          </div>
          <div className="toast" role="status">Kompiliert</div>
        </div>
      </section>
      <section className="card" style={{ gridColumn: '1 / -1' }}>
        <h3>Modell</h3>
        <ModelPicker value={model} onChange={setModel} models={models} />
        <div style={{ height: 250, display: 'flex', alignItems: 'flex-start' }}>
          <ModelPicker value={model} onChange={setModel} models={models} compact defaultOpen />
        </div>
      </section>
    </div>
  );
}
