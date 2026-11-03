// One outline icon set, 24px grid, 1.5px stroke, drawn for BlackJ.
const P = {
  folder: <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5h-7.2L10.5 5H4.5A1.5 1.5 0 0 0 3 6.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M7 5.5v13l11-6.5z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  build: <><path d="M4 20l9-9" /><path d="M14.5 3.5l6 6-3 3-6-6z" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></>,
  tutor: <><path d="M5 17.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5z" /><path d="M9 9h6M9 12h4" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  grid: <><rect x="4" y="4" width="7" height="6" rx="1" /><rect x="13" y="14" width="7" height="6" rx="1" /><path d="M7.5 10v4.5a1.5 1.5 0 0 0 1.5 1.5h4" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  more: <><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></>,
  send: <path d="M5 12h12M12 6l6 6-6 6" />,
  copy: <><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15" /></>,
  insert: <><path d="M19 5v7a3 3 0 0 1-3 3H6" /><path d="M10 11l-4 4 4 4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minus: <path d="M5 12h14" />,
  layers: <><path d="M12 4l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  save: <><path d="M5 4h11l3 3v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  indent: <path d="M4 6h16M10 10h10M10 14h10M4 18h16M4 9.5l3 2.5-3 2.5" />,
  explain: <><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.4M12 16.6v.1" /></>,
  folderOpen: <path d="M3.5 18.5V6A1.5 1.5 0 0 1 5 4.5h5l2 2h6.5A1.5 1.5 0 0 1 20 8v1.5M3.5 18.5l2.6-7.4A1.5 1.5 0 0 1 7.5 10h13.2a.8.8 0 0 1 .8 1l-2.2 7.5h-16z" />,
  file: <><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" /><path d="M14 3.5V8h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  terminal: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" /></>,
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></>,
  spark: <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  record: <circle cx="12" cy="12" r="5" />,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M20.5 15.5l-4.5-4.5-8 8" /></>,
  arrange: <><rect x="4" y="4" width="6" height="5" rx="1" /><rect x="14" y="4" width="6" height="5" rx="1" /><rect x="9" y="15" width="6" height="5" rx="1" /><path d="M7 9v3h10V9M12 12v3" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  stepOver: <><path d="M4 13a8 8 0 0 1 15-3" /><path d="M19.5 5v5h-5" /><circle cx="12" cy="18" r="1.5" /></>,
  stepInto: <><path d="M12 3.5v10M8 10l4 4 4-4" /><circle cx="12" cy="19" r="1.5" /></>,
  stepOut: <><path d="M12 14V4M8 7.5l4-4 4 4" /><circle cx="12" cy="19" r="1.5" /></>,
  folderPlus: <><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5h-7.2L10.5 5H4.5A1.5 1.5 0 0 0 3 6.5" /><path d="M12 11v5M9.5 13.5h5" /></>,
};

export default function Icon({ name, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}

/** The BlackJ mark: a coffee bean, for Java. */
/** The BlackJ mark: a J being typed, the text cursor right after it. */
export function Mark(props) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <path d="M19.6 5.5V18.2a6.1 6.1 0 0 1-12.2 0" fill="none" stroke="currentColor" strokeWidth="4.4" />
      <rect className="mark-caret" x="24.2" y="5.5" width="2.8" height="20.8" fill="var(--accent)" />
    </svg>
  );
}

export function Select({ value, onChange, children, ...rest }) {
  return (
    <span className="select-wrap">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {children}
      </select>
      <Icon name="chevron" />
    </span>
  );
}
