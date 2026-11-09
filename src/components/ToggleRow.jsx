import '../styles/fix.css';

/** A label (with a hint below) and the tactile switch from Settings: no stock checkbox anywhere. */
export default function ToggleRow({ checked, onChange, label, hint }) {
  return (
    <div className="toggle-row">
      <div className="toggle-row-text" onClick={() => onChange(!checked)}>
        <div className="toggle-row-title">{label}</div>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <button type="button" className="switch" role="switch" aria-checked={!!checked} aria-label={label} onClick={() => onChange(!checked)} />
    </div>
  );
}
