import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, getState } from '../store.js';
import { useT } from '../i18n.js';
import A, { WIN } from '../panels.js';
import { isAssignable, simpleName } from '../model.js';
import monaco from '../lib/monaco.js';
import { valueText } from './InspectorPanel.jsx';
import Icon, { Select } from './Icon.jsx';

const remembered = new Map();
const simple = (type) => type.replace(/<.*>/, '').split('.').pop();

function Dialog({ title, sub, wide, xwide, children, footer, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('input:not([type=checkbox]), select, textarea, button.btn-primary');
    if (el) el.focus();
  }, []);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '') + (xwide ? ' xwide' : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

function sourceDoc(model, dialog) {
  const { method, cls, kind } = dialog;
  const decl = method.declaringClass || cls;
  const owner = model.byName[decl] || model.byName[cls] || model.list.find((c) => c.simple === simpleName(decl));
  if (!owner) return null;
  const pool = kind === 'new' ? owner.ctors : owner.methods;
  const hit = pool.find((m) => (kind === 'new' || m.name === method.name) && m.params.length === method.params.length && m.params.every((p, i) => simple(p.type) === simple(method.params[i].type)));
  return hit && hit.doc;
}

/** "Erzeugt einen neuen Hund." under "Neues Objekt · new Hund(…)" says nothing new, so it is left out. */
function restatesTitle(text, sname, kind) {
  if (kind !== 'new') return false;
  const plain = text.trim().replace(/[.!]+$/, '').toLowerCase();
  const n = sname.toLowerCase();
  const words = plain.split(/\s+/);
  return words.includes(n) && words.every((w) => w === n || FILLER.has(w));
}
const FILLER = new Set(['erzeugt', 'erstellt', 'konstruktor', 'für', 'fuer', 'creates', 'create', 'constructs', 'constructor', 'for', 'ein', 'eine', 'einen', 'a', 'an', 'the', 'neue', 'neuen', 'neues', 'neuer', 'new', 'objekt', 'object', 'der', 'klasse', 'of', 'class']);

function CallDialog({ dialog }) {
  const t = useT();
  const files = useStore((s) => s.files);
  const objects = useStore((s) => s.bench.objects);
  const recording = useStore((s) => s.recording);
  const model = useMemo(() => A.modelOf(files), [files]);
  const { kind, cls, target, method } = dialog;
  const memoKey = cls + '|' + method.key;
  const doc = sourceDoc(model, dialog);
  const sname = simpleName(cls);
  const suggestName = () => {
    const base = sname[0].toLowerCase() + sname.slice(1);
    for (let i = 1; ; i++) if (!objects.some((o) => o.name === base + i)) return base + i;
  };
  // Library types (List, Object, Comparable …) are not in the model: any object may fit, the bench checks.
  const fits = (o, type) => o.className && (isAssignable(model, o.className, type) || !model.list.some((c) => c.simple === simple(type)));
  const [name, setName] = useState(kind === 'new' ? suggestName() : '');
  const [args, setArgs] = useState(() => remembered.get(memoKey) || method.params.map((p) => {
    if (p.category === 'boolean') return { kind: 'text', text: 'false' };
    if (p.category === 'object') {
      const match = objects.find((o) => fits(o, p.type));
      return match ? { kind: 'ref', name: match.name } : { kind: 'text', text: 'null' };
    }
    if (p.category === 'enum') {
      const e = model.list.find((c) => c.simple === simple(p.type));
      return { kind: 'text', text: e && e.constants[0] ? e.constants[0] : '' };
    }
    return { kind: 'text', text: '' };
  }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setArg = (i, v) => setArgs((a) => a.map((x, j) => (j === i ? v : x)));
  // Empty arguments show as their parameter name in grey instead of invalid Java ("", dangling commas).
  const paramLabel = (p) => (/^arg\d+$/.test(p.name) ? simple(p.type) : p.name);
  const shownArgs = args.map((a, i) => (a.kind === 'text' && !String(a.text ?? '').trim() ? { kind: 'ref', name: '\u0000' + i + '\u0000' } : a));
  const statementText = A.statementFor({ kind: kind === 'new' ? 'new' : 'call', cls, target, method, args: shownArgs, name });
  const statement = statementText.split(/\u0000(\d+)\u0000/).map((part, i) => (i % 2 ? <span key={i} className="ph">{paramLabel(method.params[Number(part)])}</span> : part));
  const title = kind === 'new' ? t('call.title.new') : t('call.title.call');
  const sub = kind === 'new' ? `new ${sname}(…)` : `${kind === 'static' ? sname : target}.${method.name}(…)`;

  const submit = async (e) => {
    e && e.preventDefault();
    setBusy(true);
    setError(null);
    remembered.set(memoKey, args);
    const self = getState().dialog;
    const r = kind === 'new' ? await A.createObject(cls, method, args, name) : await A.callMethod({ target, cls, method, args });
    setBusy(false);
    if (r.error) setError(r.error);
    else if (getState().dialog === self) A.closeDialog();
  };

  return (
    <Dialog
      title={title}
      sub={sub}
      onClose={A.closeDialog}
      footer={
        <>
          {recording && <span className="rec-pill"><span className="rec-dot" />{t('record.short')}</span>}
          <span className="grow" />
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('call.cancel')}</button>
          <button className="btn btn-primary" data-tour="dialog:confirm" onClick={submit} disabled={busy}>
            {kind === 'new' ? t('call.create') : t('call.run')}
          </button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'contents' }}>
        {doc && doc.text && !restatesTitle(doc.text, sname, kind) && <p className="doc">{doc.text}</p>}
        {kind === 'new' && (
          <label className="field" data-tour="dialog:name">
            <span className="field-label">{t('call.objectName')}</span>
            <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} spellCheck="false" />
          </label>
        )}
        {method.params.length === 0 && kind !== 'new' && <p className="muted">{t('call.noParams')}</p>}
        {method.params.map((p, i) => {
          const a = args[i];
          const paramDoc = doc && doc.params && doc.params[p.name];
          let control;
          if (p.category === 'boolean') {
            control = (
              <div className="seg">
                {['true', 'false'].map((v) => (
                  <button type="button" key={v} aria-pressed={a.text === v} onClick={() => setArg(i, { kind: 'text', text: v })}>{v}</button>
                ))}
              </div>
            );
          } else if (p.category === 'object') {
            const fitting = objects.filter((o) => fits(o, p.type));
            control = (
              <Select value={a.kind === 'ref' ? a.name : 'null'} onChange={(v) => setArg(i, v === 'null' ? { kind: 'text', text: 'null' } : { kind: 'ref', name: v })}>
                {fitting.map((o) => <option key={o.name} value={o.name}>{o.name} : {o.type}</option>)}
                <option value="null">{t('call.null')}</option>
              </Select>
            );
          } else if (p.category === 'enum' && model.list.find((c) => c.simple === simple(p.type))) {
            const e = model.list.find((c) => c.simple === simple(p.type));
            control = (
              <Select value={a.text} onChange={(v) => setArg(i, { kind: 'text', text: v })}>
                {e.constants.map((c) => <option key={c} value={c}>{simple(p.type)}.{c}</option>)}
              </Select>
            );
          } else {
            control = <input className="input mono" value={a.text} onChange={(e) => setArg(i, { kind: 'text', text: e.target.value })} placeholder={t('call.hint.' + p.category)} spellCheck="false" />;
          }
          const noMatch = p.category === 'object' && !objects.some((o) => fits(o, p.type));
          return (
            <div className="field" key={i} data-tour={'dialog:arg:' + i}>
              <span className="field-label">
                {/^arg\d+$/.test(p.name) ? simple(p.type) : p.name}
                <span className="type">{p.type}</span>
              </span>
              {control}
              <span className="field-hint">{noMatch ? t('call.noMatching', { type: simple(p.type) }) : paramDoc || t('call.hint.' + p.category)}</span>
            </div>
          );
        })}
        <div className="statement">
          <div className="label">{t('call.statement')}</div>
          <code>{statement}</code>
        </div>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function ResultDialog({ dialog }) {
  const t = useT();
  const recording = useStore((s) => s.recording);
  const { result, label } = dialog;
  const v = result.value;
  const isRef = v && (v.kind === 'object' || v.kind === 'array') && v.handle;
  // The value as Java source, for "record as assertion" while a test is being recorded.
  const literal = v.kind === 'string' ? JSON.stringify(v.text) : v.kind === 'prim' ? v.text : v.kind === 'null' ? 'null' : null;
  return (
    <Dialog
      title={t('result.title')}
      sub={label}
      onClose={A.closeDialog}
      footer={
        <>
          {recording && literal != null && (
            <button className="btn btn-quiet" onClick={() => { A.recordAssertion(label, literal); A.closeDialog(); }}>
              <span className="rec-dot" />
              {t('record.assert')}
            </button>
          )}
          <span className="grow" />
          {isRef && <button className="btn btn-quiet" onClick={() => { A.showInspector(v.handle, label); A.closeDialog(); }}>{t('result.inspect')}</button>}
          {isRef && <button className="btn" onClick={() => A.storeOnBench(v.handle)}>{t('result.toBench')}</button>}
          <button className="btn btn-primary" data-tour="dialog:confirm" onClick={A.closeDialog}>{t('result.close')}</button>
        </>
      }
    >
      <div>
        <div className={'result-value ' + (v.kind === 'string' ? 'v-str' : '')}>{valueText(v)}</div>
        <div className="result-type">{result.type}</div>
      </div>
    </Dialog>
  );
}

function DiffDialog({ dialog }) {
  const t = useT();
  const theme = useStore((s) => s.settings.theme);
  const hostRef = useRef(null);
  const modRef = useRef(null);
  // A change the tutor proposes: the buttons decide it; closing only closes the dialog.
  const proposal = dialog.proposalId || null;
  useEffect(() => {
    const original = monaco.editor.createModel(dialog.original, 'java');
    const modified = monaco.editor.createModel(dialog.modified, 'java');
    modRef.current = modified;
    const ed = monaco.editor.createDiffEditor(hostRef.current, {
      automaticLayout: true,
      theme: 'blackj-' + theme,
      renderSideBySide: true,
      originalEditable: false,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      stickyScroll: { enabled: false },
      glyphMargin: false,
      lineDecorationsWidth: 8,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      scrollbar: { useShadows: false, verticalScrollbarSize: 10 },
    });
    ed.setModel({ original, modified });
    const changes = setTimeout(() => {
      const c = ed.getLineChanges();
      if (c && c[0]) ed.getModifiedEditor().revealLineInCenter(c[0].modifiedStartLineNumber || 1);
    }, 200);
    return () => {
      clearTimeout(changes);
      ed.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [dialog]);
  return (
    <Dialog
      xwide
      title={t('diff.title')}
      sub={`${simpleName(dialog.file.replace(/\.java$/, '').split('/').join('.'))}.java` + (dialog.instruction && !proposal ? ` · „${dialog.instruction.slice(0, 80)}“` : '')}
      onClose={A.closeDialog}
      footer={
        <>
          {dialog.explanation && <span className="diff-expl">{dialog.explanation}</span>}
          <span className="grow" />
          {proposal ? (
            <>
              <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={() => A.rejectProposal(proposal)}>{t('agent.diff.reject')}</button>
              <button className="btn btn-primary" data-tour="dialog:confirm" onClick={() => A.acceptProposal(proposal, modRef.current.getValue())}>{t('agent.diff.accept')}</button>
            </>
          ) : (
            <>
              <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('diff.reject')}</button>
              <button className="btn btn-primary" data-tour="dialog:confirm" onClick={() => A.applyDiff(dialog.file, modRef.current.getValue())}>
                {t('diff.accept')}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="diff-host" ref={hostRef} />
    </Dialog>
  );
}

const KINDS = ['class', 'abstract', 'interface', 'enum', 'main', 'test', 'empty'];

function NewClassDialog() {
  const t = useT();
  const files = useStore((s) => s.files);
  const pkg = useStore((s) => s.pkg);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('class');
  const [error, setError] = useState(null);
  const trimmed = name.trim();
  const valid = /^[A-Za-z_$][\w$]*$/.test(trimmed);
  const exists = files[(pkg ? pkg.split('.').join('/') + '/' : '') + trimmed + '.java'];
  const suggestion = valid && /^[a-z]/.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : null;
  const submit = async (e) => {
    e && e.preventDefault();
    if (!valid || exists) return;
    const err = await A.newClass(kind === 'test' && !trimmed.endsWith('Test') ? trimmed + 'Test' : trimmed, kind);
    if (err) setError(err);
  };
  return (
    <Dialog
      title={t('newClass.title')}
      sub={pkg ? `package ${pkg}` : null}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('common.cancel')}</button>
          <button className="btn btn-primary" data-tour="dialog:confirm" onClick={submit} disabled={!valid || !!exists}>
            {t('newClass.create')}
          </button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <label className="field">
          <span className="field-label">{t('newClass.name')}</span>
          <input className="input" data-tour="dialog:name" value={name} onChange={(e) => setName(e.target.value)} spellCheck="false" aria-invalid={!!trimmed && (!valid || !!exists)} aria-describedby="nc-hint" />
          <span className="field-hint" id="nc-hint">
            {exists ? t('err.exists') : suggestion ? t('newClass.lowercase', { suggestion }) : trimmed && !valid ? t('err.invalidName') : t('newClass.nameHint')}
          </span>
        </label>
        <div className="field">
          <span className="field-label">{t('newClass.kind')}</span>
          <div className="kind-grid">
            {KINDS.map((k) => (
              <button type="button" key={k} className="kind-opt" aria-pressed={kind === k} onClick={() => setKind(k)}>
                <span className="kind-name">{t('newClass.kind.' + k)}</span>
                <span className="kind-desc">{t('newClass.desc.' + k)}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <div className="field-error" role="alert">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function NewPackageDialog() {
  const t = useT();
  const pkg = useStore((s) => s.pkg);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const valid = /^[a-z_$][\w$]*$/.test(name.trim());
  const submit = async (e) => {
    e && e.preventDefault();
    if (!valid) return;
    const err = await A.newPackage(name.trim());
    if (err) setError(err);
  };
  return (
    <Dialog
      title={t('newPackage.title')}
      sub={pkg ? `in ${pkg}` : null}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('common.cancel')}</button>
          <button className="btn btn-primary" data-tour="dialog:confirm" onClick={submit} disabled={!valid}>{t('newClass.create')}</button>
        </>
      }
    >
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <label className="field">
          <span className="field-label">{t('newPackage.name')}</span>
          <input className="input mono" data-tour="dialog:name" value={name} onChange={(e) => setName(e.target.value)} spellCheck="false" />
          <span className="field-hint">{t('newPackage.hint')}</span>
        </label>
        {error && <div className="field-error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function JarDialog() {
  const t = useT();
  const files = useStore((s) => s.files);
  const mains = useMemo(() => A.modelOf(files).list.filter((c) => c.hasMain), [files]);
  const [main, setMain] = useState(mains[0] ? mains[0].fileClass : '');
  const [src, setSrc] = useState(true);
  return (
    <Dialog
      title={t('jar.title')}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('common.cancel')}</button>
          <button className="btn btn-primary" data-tour="dialog:confirm" onClick={() => A.exportJar(main || null, src)}>
            {t('jar.export')}
          </button>
        </>
      }
    >
      <p className="dim">{t('jar.text')}</p>
      <div className="field">
        <span className="field-label">{t('jar.main')}</span>
        <Select value={main} onChange={setMain}>
          <option value="">{t('jar.noMain')}</option>
          {mains.map((c) => <option key={c.fileClass} value={c.fileClass}>{c.fileClass}</option>)}
        </Select>
      </div>
      <label className="check">
        <input type="checkbox" checked={src} onChange={(e) => setSrc(e.target.checked)} />
        <span>{t('jar.includeSource')}</span>
      </label>
    </Dialog>
  );
}

const LIBRARY_SUGGESTIONS = ['Math', 'String', 'Integer', 'Character', 'StringBuilder', 'ArrayList', 'HashMap', 'Random', 'Arrays', 'LocalDate'];

const paramList = (m) => m.params.map((p) => (/^arg\d+$/.test(p.name) ? p.type : `${p.type} ${p.name}`)).join(', ');

/**
 * BlueJ's "Use Library Class", and the methods of a library object on the bench:
 * one searchable list instead of a menu with seventy entries.
 */
function LibraryDialog({ dialog }) {
  const t = useT();
  const objectMode = !!dialog.target;
  const [name, setName] = useState(dialog.cls || '');
  const [desc, setDesc] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const filterRef = useRef(null);

  const load = async (cls) => {
    setBusy(true);
    setError(null);
    const r = await A.describeLibrary(cls);
    setBusy(false);
    if (r.error) {
      setDesc(null);
      setError(r.error);
      return;
    }
    setDesc(r.desc);
    setFilter('');
    setTimeout(() => filterRef.current && filterRef.current.focus(), 0);
  };
  useEffect(() => {
    if (dialog.cls) load(dialog.cls);
  }, []);

  const q = filter.trim().toLowerCase();
  const match = (m) => !q || m.name.toLowerCase().includes(q) || paramList(m).toLowerCase().includes(q);
  const sname = desc ? simpleName(desc.name) : '';
  const sections = !desc
    ? []
    : objectMode
      ? [{ key: 'methods', label: t('lib.methods'), items: desc.methods.filter((m) => !m.static && !m.abstract && match(m)).map((m) => ({ kind: 'method', m })) }]
      : [
          { key: 'ctors', label: t('lib.ctors'), items: desc.constructors.filter(match).map((m) => ({ kind: 'new', m })) },
          { key: 'statics', label: t('lib.statics'), items: desc.methods.filter((m) => m.static && match(m)).map((m) => ({ kind: 'static', m })) },
        ];
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const pick = ({ kind, m }) => A.openDialogBox({ type: 'call', kind, cls: desc.name, target: objectMode ? dialog.target : undefined, method: m });

  return (
    <Dialog
      wide
      title={objectMode ? t('lib.objectTitle', { name: dialog.target }) : t('lib.title')}
      sub={objectMode ? dialog.typeLabel : desc ? desc.name : t('lib.sub')}
      onClose={A.closeDialog}
    >
      {!objectMode && (
        <form
          className="lib-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) load(name);
          }}
        >
          <label className="field">
            <span className="field-label">{t('lib.class')}</span>
            <span className="lib-row">
              <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="java.util.Random" spellCheck="false" autoComplete="off" />
              <button className="btn" type="submit" disabled={busy || !name.trim()}>{t('lib.load')}</button>
            </span>
          </label>
          <div className="lib-chips" aria-label={t('lib.examples')}>
            {LIBRARY_SUGGESTIONS.map((s) => (
              <button type="button" key={s} className="chip" aria-pressed={sname === s} onClick={() => { setName(s); load(s); }}>{s}</button>
            ))}
          </div>
        </form>
      )}
      {error && <div className="field-error" role="alert">{error}</div>}
      {busy && !desc && <p className="muted">{t('lib.loading')}</p>}
      {desc && (
        <>
          <input ref={filterRef} className="input lib-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('lib.filter')} spellCheck="false" aria-label={t('lib.filter')} />
          <div className="lib-list">
            {total === 0 && <p className="muted">{q ? t('lib.none') : objectMode ? t('lib.noMethods') : t('lib.noStatics', { name: sname })}</p>}
            {sections.filter((s) => s.items.length).map((s) => (
              <section key={s.key}>
                <h3 className="lib-head">{s.label}<span className="count">{s.items.length}</span></h3>
                {s.items.map((it) => (
                  <button key={it.kind + it.m.key} className="lib-item" onClick={() => pick(it)}>
                    <span className="sig">
                      {it.kind === 'new' ? <><span className="ret">new </span>{sname}</> : it.m.name}({paramList(it.m)})
                    </span>
                    {it.kind !== 'new' && <span className="lib-ret">{it.m.returnType}</span>}
                    {it.m.inherited && <span className="lib-from">{simpleName(it.m.declaringClass)}</span>}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
      {!desc && !busy && !error && <p className="dim">{t('lib.text')}</p>}
    </Dialog>
  );
}

function RecordDialog({ dialog }) {
  const t = useT();
  const [name, setName] = useState('test');
  const valid = /^[a-z_$][\w$]*$/i.test(name.trim());
  return (
    <Dialog
      title={t('record.title')}
      sub={simpleName(dialog.cls)}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('common.cancel')}</button>
          <button className="btn btn-primary" data-tour="dialog:confirm" disabled={!valid} onClick={() => A.startRecording(dialog.cls, name.trim())}>
            <span className="rec-dot" />
            {t('record.start')}
          </button>
        </>
      }
    >
      <p className="dim">{t('record.text')}</p>
      <label className="field">
        <span className="field-label">{t('record.method')}</span>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} spellCheck="false" />
      </label>
    </Dialog>
  );
}

function DeleteDialog({ dialog }) {
  const t = useT();
  return (
    <Dialog
      title={t('delete.title', { name: simpleName(dialog.cls) })}
      onClose={A.closeDialog}
      footer={
        <>
          <button className="btn btn-quiet" data-tour="dialog:cancel" onClick={A.closeDialog}>{t('common.cancel')}</button>
          <button className="btn btn-danger" onClick={() => A.deleteClass(dialog.cls)}>
            {t('delete.confirm')}
          </button>
        </>
      }
    >
      <p className="dim">{t('delete.text', { file: A.fileOfClass(dialog.cls) })}</p>
    </Dialog>
  );
}

export default function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  // With pop-out windows open, a dialog shows in the window the student is working in.
  const here = useStore((s) => (s.activeWin || 'main') === WIN);
  useEffect(() => {
    if (here && dialog && dialog.type === 'inspect') {
      A.showInspector(dialog.ref, dialog.trail ? dialog.trail[0] : dialog.ref);
      A.closeDialog();
    }
  }, [dialog, here]);
  if (!dialog || !here) return null;
  if (dialog.type === 'call') return <CallDialog key={dialog.cls + dialog.method.key + (dialog.target || '')} dialog={dialog} />;
  if (dialog.type === 'result') return <ResultDialog dialog={dialog} />;
  if (dialog.type === 'diff') return <DiffDialog dialog={dialog} />;
  if (dialog.type === 'newClass') return <NewClassDialog />;
  if (dialog.type === 'newPackage') return <NewPackageDialog />;
  if (dialog.type === 'jar') return <JarDialog />;
  if (dialog.type === 'record') return <RecordDialog dialog={dialog} />;
  if (dialog.type === 'library') return <LibraryDialog key={(dialog.target || '') + (dialog.cls || '')} dialog={dialog} />;
  if (dialog.type === 'delete') return <DeleteDialog dialog={dialog} />;
  return null;
}
