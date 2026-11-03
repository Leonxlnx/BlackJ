import { useState } from 'react';
import { useStore, setState, toast } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';
import { api } from '../api.js';
import Icon, { Select } from './Icon.jsx';

function Switch({ checked, onChange, label }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

function Row({ title, desc, children, stack }) {
  return (
    <div className={'set-row' + (stack ? ' stack' : '')}>
      <div>
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, text, children }) {
  return (
    <section className="set-section">
      <div className="set-label">
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <div className="card set-panel">{children}</div>
    </section>
  );
}

export default function Settings() {
  const t = useT();
  const s = useStore((st) => st.settings);
  const info = useStore((st) => st.info);
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState(null);
  const [replacing, setReplacing] = useState(false);
  const set = (patch) => A.updateSettings(patch);
  const tutor = info.tutor;

  const chooseJdk = async () => {
    const r = await api.chooseJdk();
    if (r.ok) setState((st) => ({ info: { ...st.info, jdk: r.result.jdk, jdks: r.result.jdks }, settings: { ...st.settings, jdkPath: r.result.jdk.home } }));
    else if (r.error.code === 'noJdk') toast(A.errorText({ kind: 'app', code: 'noJdk' }), 'bad');
  };
  const autoJdk = async () => {
    const r = await api.autoJdk();
    setState((st) => ({ info: { ...st.info, jdk: r.jdk || st.info.jdk, jdks: r.jdks || st.info.jdks }, settings: { ...st.settings, jdkPath: null } }));
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{t('settings.title')}</h1>
          </div>
        </div>

        <Section title={t('settings.look')} text={t('settings.lookText')}>
          <Row title={t('settings.lang')}>
            <Select value={s.lang} onChange={(v) => set({ lang: v })} aria-label={t('settings.lang')}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </Select>
          </Row>
          <Row title={t('settings.theme')}>
            <div className="seg">
              {['dark', 'light'].map((v) => (
                <button key={v} aria-pressed={s.theme === v} onClick={() => set({ theme: v })}>{t('settings.theme.' + v)}</button>
              ))}
            </div>
          </Row>
          <Row title={t('settings.fontSize')}>
            <div className="seg">
              {[12, 13, 14, 16, 18].map((v) => (
                <button key={v} aria-pressed={s.fontSize === v} onClick={() => set({ fontSize: v })}>{v}</button>
              ))}
            </div>
          </Row>
        </Section>

        <Section title={t('settings.editor')} text={t('settings.editorText')}>
          <Row title={t('settings.hoverHelp')} desc={t('settings.hoverHelpText')}>
            <Switch checked={s.hoverHelp} onChange={(v) => set({ hoverHelp: v })} label={t('settings.hoverHelp')} />
          </Row>
          <Row title={t('settings.autosave')} desc={t('settings.autosaveText')}>
            <Switch checked={s.autosave} onChange={(v) => set({ autosave: v })} label={t('settings.autosave')} />
          </Row>
          <Row title={t('settings.details')} desc={t('settings.detailsText')}>
            <Switch checked={s.diagramDetails} onChange={(v) => set({ diagramDetails: v })} label={t('settings.details')} />
          </Row>
          <Row title={t('settings.scopeColors')} desc={t('settings.scopeColorsText')}>
            <Switch checked={s.scopeColors} onChange={(v) => set({ scopeColors: v })} label={t('settings.scopeColors')} />
          </Row>
          <Row title={t('settings.clearConsole')} desc={t('settings.clearConsoleText')}>
            <Switch checked={!!s.clearConsoleOnCall} onChange={(v) => set({ clearConsoleOnCall: v })} label={t('settings.clearConsole')} />
          </Row>
          {!s.aiOff && (
            <Row title={t('settings.aiInline')} desc={t('settings.aiInlineText')}>
              <Switch checked={s.aiInline} onChange={(v) => set({ aiInline: v })} label={t('settings.aiInline')} />
            </Row>
          )}
        </Section>

        <Section title={t('settings.java')} text={t('settings.javaText')}>
          <Row title={t('settings.javaCurrent')} desc={info.jdk ? `Java ${info.jdk.version} · ${info.jdk.source}` : t('home.javaMissing')}>
            <div className="action-row">
              {s.jdkPath && <button className="btn btn-sm btn-quiet" onClick={autoJdk}>{t('settings.javaAuto')}</button>}
              <button className="btn btn-sm" onClick={chooseJdk}>
                <Icon name="folderOpen" />
                {t('settings.javaChoose')}
              </button>
            </div>
          </Row>
          <Row title={t('settings.javaFound')} stack>
            <div className="jdk-list">
              {(info.jdks || []).map((j) => (
                <div className="jdk-row" key={j.home}>
                  <span className={'status-dot' + (info.jdk && info.jdk.home === j.home ? '' : ' off')} />
                  <span className="home" title={j.home}>{j.home}</span>
                  <span className="muted">Java {j.version} · {j.source}</span>
                </div>
              ))}
            </div>
            <p className="field-hint">{t('settings.javaPortable')}</p>
          </Row>
        </Section>

        <Section title={t('settings.tutor')} text={t('settings.tutorText')}>
          <Row title={t('settings.aiOff')} desc={t('settings.aiOffText')}>
            <Switch checked={!!s.aiOff} onChange={(v) => set({ aiOff: v })} label={t('settings.aiOff')} />
          </Row>
          {!s.aiOff && (
            <>
              <Row title={t('settings.key')} desc={tutor.hasKey ? (tutor.stored ? t('settings.keyStored') : t('settings.keySession')) : t('settings.keyNone')} stack={!tutor.hasKey || replacing}>
                {tutor.hasKey && !replacing ? (
                  <div className="action-row">
                    <button className="btn btn-sm btn-quiet" onClick={() => setReplacing(true)}>{t('settings.keyReplace')}</button>
                    <button className="btn btn-sm btn-danger" onClick={A.forgetApiKey}>{t('settings.keyForget')}</button>
                  </div>
                ) : (
                  <form
                    className="key-row"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const err = await A.setApiKey(key, s.rememberKey && tutor.canStore);
                      if (err) setKeyError(err);
                      else {
                        setKey('');
                        setReplacing(false);
                      }
                    }}
                  >
                    <input className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('tutor.keyPlaceholder')} aria-label={t('settings.key')} autoComplete="off" />
                    <button className="btn btn-primary" type="submit" disabled={!key.trim()}>{t('tutor.keySave')}</button>
                  </form>
                )}
                {keyError && <div className="field-error">{keyError}</div>}
              </Row>
              {tutor.canStore && (
                <Row title={t('tutor.keyRemember')} desc={t('tutor.keyRememberHint')}>
                  <Switch checked={s.rememberKey} onChange={(v) => set({ rememberKey: v })} label={t('tutor.keyRemember')} />
                </Row>
              )}
              <Row title={t('settings.model')} desc={(() => { const m = tutor.models.find((x) => x.id === s.model); return m ? t('settings.modelPrice', { input: m.input, output: m.output }) : ''; })()}>
                <Select value={s.model} onChange={(v) => set({ model: v })} aria-label={t('settings.model')}>
                  {tutor.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </Row>
              <Row title={t('settings.mode')}>
                <div className="seg">
                  {['hints', 'explain'].map((v) => (
                    <button key={v} aria-pressed={s.tutorMode === v} onClick={() => set({ tutorMode: v })}>{t('tutor.mode.' + v)}</button>
                  ))}
                </div>
              </Row>
              <Row title={t('settings.sendContext')} desc={t('settings.sendContextText')}>
                <Switch checked={s.sendContext} onChange={(v) => set({ sendContext: v })} label={t('settings.sendContext')} />
              </Row>
              <Row title={t('settings.showCosts')} desc={t('settings.showCostsText')}>
                <Switch checked={s.showCosts} onChange={(v) => set({ showCosts: v })} label={t('settings.showCosts')} />
              </Row>
            </>
          )}
        </Section>

        <Section title={t('settings.about')} text={t('settings.aboutText', { version: info.version })}>
          <Row title="BlackJ" desc={`Version ${info.version}`}>
            <button className="btn btn-sm btn-quiet" onClick={() => api.openExternal('https://www.bluej.org')}>
              bluej.org
              <Icon name="external" />
            </button>
          </Row>
        </Section>
      </div>
    </div>
  );
}
