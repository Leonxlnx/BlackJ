// Glyphs of the runtime area, drawn for BlackJ on a 16px grid (1.5px strokes, currentColor).
// Each one says what the program is doing, not just what a button does.

const svg = (children, cls, size = 16) => (
  <svg className={'rt-glyph ' + (cls || '')} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Stop: a soft square; while the program runs, a short arc circles it like a second hand. */
export function StopGlyph({ running = false }) {
  return svg(
    <>
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.4" fill="currentColor" stroke="none" />
      {running && <circle className="rt-orbit-track" cx="8" cy="8" r="6.25" strokeOpacity="0.18" />}
      {running && <path className="rt-orbit" d="M8 1.75a6.25 6.25 0 0 1 5.4 3.1" />}
      {!running && <circle cx="8" cy="8" r="6.25" strokeOpacity="0.35" />}
    </>,
    running ? 'rt-glyph-running' : '',
  );
}

/**
 * Running: the program's pulse, a heartbeat trace with a bright stretch travelling along it. A
 * status, never a button: Stop keeps the square.
 */
export function RunningGlyph() {
  const d = 'M1.75 8.5h2.6l1.4-3.25 2.5 6.5 1.6-4.25 1 1h3.4';
  return svg(
    <>
      <path d={d} strokeOpacity="0.28" />
      <path className="rt-pulse" d={d} pathLength="100" />
    </>,
    'rt-glyph-pulse',
  );
}

/** Pause: two bars of unequal height, a program caught mid-step. */
export function PauseGlyph() {
  return svg(
    <>
      <path d="M5.75 4.25v7.5" />
      <path d="M10.25 5.75v6" />
    </>,
  );
}

/** Continue: a bar where it stood, an arrow where it goes on. */
export function ResumeGlyph() {
  return svg(
    <>
      <path d="M4 4.25v7.5" />
      <path d="M7.25 4.6v6.8a.5.5 0 0 0 .77.42l5.1-3.4a.5.5 0 0 0 0-.84l-5.1-3.4a.5.5 0 0 0-.77.42z" fill="currentColor" stroke="none" />
    </>,
  );
}

/** The program's prompt: a chevron with a caret that blinks while the program waits. */
export function PromptGlyph({ waiting = false }) {
  return svg(
    <>
      <path d="M3.5 4.75L7 8l-3.5 3.25" />
      <path className={waiting ? 'rt-caret on' : 'rt-caret'} d="M9.5 11.75h3.25" />
    </>,
  );
}

/** Send: the Enter key's return arrow. */
export function ReturnGlyph() {
  return svg(
    <>
      <path d="M12.5 3.75v3.5a2 2 0 0 1-2 2H4" />
      <path d="M6.25 6.5L3.5 9.25 6.25 12" />
    </>,
  );
}

/** A program window: a frame with its title bar and a lit dot, the window is alive. */
export function WindowGlyph() {
  return svg(
    <>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.75" />
      <path d="M2.25 6h11.5" />
      <circle cx="4.4" cy="4.65" r=".55" fill="currentColor" stroke="none" />
    </>,
  );
}

/** A thread: one line that runs on in a loop. */
export function ThreadGlyph() {
  return svg(<path d="M2 10.5c1.6 0 2-5 3.6-5s2 5 3.6 5 2-5 3.6-5c.7 0 1.1.9 1.2 1.8" />);
}

/** Waiting until the student's code runs again: an hourglass that has not started. */
export function ArmedGlyph() {
  return svg(
    <>
      <path d="M4.5 2.75h7M4.5 13.25h7" />
      <path d="M5.25 2.75c0 3 5.5 3 5.5 5.25s-5.5 2.25-5.5 5.25M10.75 2.75c0 3-5.5 3-5.5 5.25s5.5 2.25 5.5 5.25" strokeOpacity="0.85" />
    </>,
  );
}

/** Java starting: three dots that fill one after the other. */
export function StartingGlyph() {
  return svg(
    <>
      <circle className="rt-dot d1" cx="4" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle className="rt-dot d2" cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle className="rt-dot d3" cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </>,
  );
}

/** Something is wrong with Java itself: a cracked bean. */
export function FaultGlyph() {
  return svg(
    <>
      <path d="M8 2.5c3.2 0 5 2.3 5 5.5s-1.8 5.5-5 5.5S3 11.2 3 8s1.8-5.5 5-5.5z" />
      <path d="M8.6 4.5L7.2 7.4l1.6.9-1.3 3.2" />
    </>,
  );
}
