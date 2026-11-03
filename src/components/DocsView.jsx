import { useT } from '../i18n.js';
import A from '../panels.js';

const sig = (m, ctor) => `${ctor ? '' : m.returnType + ' '}${m.name}(${m.params.map((p) => `${p.type} ${p.name}`).join(', ')})`;

/** BlueJ's "Documentation" view: what other classes see of this class, with its Javadoc. */
export default function DocsView({ info }) {
  const t = useT();
  if (!info) return null;
  const visible = (m) => m.visibility === 'public' || m.visibility === 'protected';
  const ctors = info.ctors.filter(visible);
  const methods = info.methods.filter(visible);
  const fields = info.fields.filter(visible);
  const kind = info.kind === 'interface' ? 'interface' : info.kind === 'enum' ? 'enum' : info.kind === 'abstract' ? 'abstract class' : 'class';
  const Member = ({ m, ctor }) => (
    <div className="doc-member">
      <button className="doc-sig mono" onClick={() => A.openClass(info.fileClass, m.line)}>{sig(m, ctor)}</button>
      {m.doc && m.doc.text ? <p>{m.doc.text}</p> : <p className="muted">{t('docs.none')}</p>}
      {m.params.length > 0 && m.doc && Object.keys(m.doc.params).length > 0 && (
        <dl className="doc-params">
          {m.params.map((p) => (
            <div key={p.name}>
              <dt className="mono">{p.name}</dt>
              <dd>{m.doc.params[p.name] || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      {m.doc && m.doc.returns && <p className="doc-returns"><span className="muted">{t('docs.returns')}</span> {m.doc.returns}</p>}
    </div>
  );
  return (
    <div className="docs-view">
      <div className="doc-head">
        <div className="muted mono">{info.pkg ? info.pkg + '.' : ''}{kind}</div>
        <h2>{info.simple}</h2>
        {(info.extends.length > 0 || info.implements.length > 0) && (
          <div className="muted mono">
            {info.extends.length > 0 && `extends ${info.extends.join(', ')}`} {info.implements.length > 0 && `implements ${info.implements.join(', ')}`}
          </div>
        )}
        {info.doc && info.doc.text ? <p>{info.doc.text}</p> : <p className="muted">{t('docs.noClass')}</p>}
      </div>
      {ctors.length > 0 && (
        <section>
          <h3>{t('docs.ctors')}</h3>
          {ctors.map((m, i) => <Member key={i} m={m} ctor />)}
        </section>
      )}
      {methods.length > 0 && (
        <section>
          <h3>{t('docs.methods')}</h3>
          {methods.map((m, i) => <Member key={i} m={m} />)}
        </section>
      )}
      {fields.length > 0 && (
        <section>
          <h3>{t('docs.fields')}</h3>
          {fields.map((f) => (
            <div className="doc-member" key={f.name}>
              <span className="doc-sig mono">{f.type} {f.name}</span>
              {f.doc && f.doc.text && <p>{f.doc.text}</p>}
            </div>
          ))}
        </section>
      )}
      {info.kind === 'enum' && info.constants.length > 0 && (
        <section>
          <h3>{t('docs.constants')}</h3>
          <p className="mono">{info.constants.join(', ')}</p>
        </section>
      )}
    </div>
  );
}
