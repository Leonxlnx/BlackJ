import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { useT } from '../i18n.js';
import * as A from '../actions.js';

export function valueText(v) {
  if (!v) return '';
  if (v.kind === 'string') return JSON.stringify(v.text);
  if (v.kind === 'null') return 'null';
  if (v.kind === 'object' || v.kind === 'array') return v.text || (v.length != null ? `${v.type} (${v.length})` : v.type);
  return v.text;
}

/**
 * The live inspector: the fields of the selected object, updated after every method call.
 * Object values drill down; the trail at the top leads back.
 */
export default function InspectorPanel() {
  const t = useT();
  const inspect = useStore((s) => s.inspect);
  const tick = useStore((s) => s.inspectTick);
  const objects = useStore((s) => s.bench.objects);
  const [data, setData] = useState(null);
  const [stack, setStack] = useState([]);

  useEffect(() => {
    setStack(inspect ? [{ ref: inspect.ref, label: inspect.trail[0], isClass: inspect.isClass }] : []);
  }, [inspect && inspect.ref, inspect && inspect.isClass]);

  const top = stack[stack.length - 1];
  useEffect(() => {
    let alive = true;
    if (!top) {
      setData(null);
      return undefined;
    }
    (top.isClass ? A.inspectClass(top.ref) : A.inspect(top.ref)).then((d) => alive && setData(d));
    return () => { alive = false; };
  }, [top && top.ref, tick, objects]);

  if (!inspect || !top) {
    return (
      <div className="side-body">
        <div className="side-empty">
          <p>{t('inspect.empty')}</p>
        </div>
      </div>
    );
  }
  const drill = (val, label) => setStack((s) => [...s, { ref: val.handle, label }]);
  const cell = (val, label) => {
    if (val && (val.kind === 'object' || val.kind === 'array') && val.handle) {
      return <button className="ref-btn" onClick={() => drill(val, label)}>{valueText(val)}</button>;
    }
    return <span className={val && val.kind === 'string' ? 'v-str' : val && val.kind === 'null' ? 'v-null' : 'v-num'}>{valueText(val)}</span>;
  };
  const rows = data && !data.error ? data.fields || [] : [];
  const items = data && !data.error ? data.items : null;
  const isHandle = String(top.ref).startsWith('#');

  return (
    <div className="side-body inspector">
      <div className="insp-head">
        <div className="insp-trail">
          {stack.map((s, i) => (
            <span key={i} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">›</span>}
              <button className="crumb" onClick={() => setStack((st) => st.slice(0, i + 1))} disabled={i === stack.length - 1}>{s.label}</button>
            </span>
          ))}
        </div>
        <div className="insp-type">{data && !data.error ? (top.isClass ? t('inspect.class', { name: data.type }) : data.type) : ''}</div>
        {data && data.value && data.value.text && !top.isClass && <div className="insp-tostring mono">{data.value.text}</div>}
      </div>
      {!data ? (
        <p className="muted pad-16">…</p>
      ) : data.error ? (
        <p className="field-error pad-16">{data.error}</p>
      ) : (
        <div className="insp-scroll">
          {items ? (
            <>
              <h3 className="insp-group">{t('inspect.items')} <span className="muted">{data.length}</span></h3>
              <table className="inspect-table">
                <tbody>
                  {items.map((it) => (
                    <tr key={it.name}>
                      <td className="fname">{it.name}</td>
                      <td className="fval">{cell(it.value, it.name)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > items.length && <p className="muted">{t('inspect.more', { n: data.length - items.length })}</p>}
            </>
          ) : (
            <>
              {!top.isClass && <h3 className="insp-group">{t('inspect.fields')}</h3>}
              {!top.isClass && rows.length === 0 && <p className="muted">{t('inspect.noFields')}</p>}
              {rows.length > 0 && (
                <table className="inspect-table">
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.declaredIn + f.name}>
                        <td className="fname">
                          {f.name}
                          <span className="ftype">{f.type}</span>
                        </td>
                        <td className="fval">{cell(f.value, f.name)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.statics && data.statics.length > 0 && (
                <>
                  <h3 className="insp-group">{t('inspect.statics')}</h3>
                  <table className="inspect-table">
                    <tbody>
                      {data.statics.map((f) => (
                        <tr key={f.name}>
                          <td className="fname">
                            {f.name}
                            <span className="ftype">{f.type}</span>
                          </td>
                          <td className="fval">{cell(f.value, f.name)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {top.isClass && (!data.statics || !data.statics.length) && <p className="muted">{t('inspect.noStatics')}</p>}
            </>
          )}
          {isHandle && (
            <div className="action-row insp-actions">
              <button className="btn btn-sm" onClick={() => A.storeOnBench(top.ref)}>{t('result.toBench')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
