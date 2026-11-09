// Agent smoke, against the scripted fake API (electron/smoke-ai.cjs; nothing leaves the machine):
// a build that keeps a live checklist, looks at its window out of sight (and resized) and plays it,
// with the screenshots as thumbnails; Stop in the middle of a long play-test; back to a checkpoint;
// the model picker in the composer. Every program window opens at -4000,-4000.
export default async function ({ step, shot, until, wait, A, getState, setState, log }) {
  const lastTurn = () => getState().chat.turns[getState().chat.turns.length - 1];
  const tools = (turn) => (turn.parts || []).filter((p) => p.type === 'tool');
  const noProgram = () => !getState().bench.live && getState().bench.state !== 'running' && getState().bench.state !== 'waiting';

  await step('agent: a build plans, looks at its window, resizes it and plays it', async () => {
    await A.openExample('Tiere');
    await until(() => document.querySelectorAll('.class-card').length >= 5, 15000, 'Tiere');
    await A.setApiKey('sk-ant-smoke', false);
    A.setTutorMode('build');
    setState({ tutorOpen: true, side: 'tutor', dockCollapsed: false });
    A.askTutor('Baue ein Fenster mit einem Quadrat, das man mit den Pfeiltasten bewegt');
    // The checklist is pinned while the turn works; the look shows up as a running row.
    await until(() => document.querySelector('.ag-plan.live .ag-plan-list li'), 15000, 'live plan');
    await until(() => tools(lastTurn()).some((p) => p.name === 'look_at_program'), 20000, 'look_at_program row');
    await until(() => document.querySelector('.ag-plan.live') && document.querySelectorAll('.ag-shot').length >= 1, 30000, 'first thumbnail while working');
    // Scrolled far down, the live plan stays pinned at the top of the chat (a spacer above makes room to scroll).
    const chat = document.querySelector('.side-body.tutor .chat');
    const planEl = document.querySelector('.ag-plan.live');
    let pinned = null;
    if (planEl) {
      // The plan sticks within its turn, so the turn gets room below too: early in the turn it can
      // still be shorter than the distance scrolled, and a sticky element never leaves its parent.
      const turnEl = planEl.closest('.msg-ai');
      chat.style.paddingBottom = '1400px';
      turnEl.style.paddingBottom = '600px';
      const turnTop = turnEl.getBoundingClientRect().top - chat.getBoundingClientRect().top;
      chat.scrollTop += turnTop + 160;
      // Measured at once (layout places sticky elements synchronously): a message arriving before
      // the scroll event would bring the chat back to its end, as it should while it follows.
      pinned = Math.round(planEl.getBoundingClientRect().top - chat.getBoundingClientRect().top);
      chat.style.paddingBottom = '';
      turnEl.style.paddingBottom = '';
      chat.scrollTop = chat.scrollHeight;
    }
    await log(`     plan pinned ${pinned} px below the chat's top`);
    if (planEl && (pinned < -2 || pinned > 16)) throw new Error('plan not pinned: ' + pinned);
    await shot('agent-01-live');
    await until(() => !getState().chat.busy, 60000, 'build did not end');
    const turn = lastTurn();
    const text = (turn.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
    if (/FEHLT|KOMPILIERFEHLER/.test(text)) throw new Error('mock saw: ' + text.slice(0, 400));
    const names = tools(turn).map((p) => p.name + ':' + p.status);
    for (const n of ['update_plan:done', 'create_class:done', 'compile:done', 'look_at_program:done', 'use_program:done']) {
      if (!names.includes(n)) throw new Error('missing ' + n + ' in ' + names.join(' '));
    }
    if (!turn.plan || turn.plan.length !== 3 || turn.plan.some((x) => x.status !== 'done')) throw new Error('plan ' + JSON.stringify(turn.plan));
    // Four screenshots: the window, resized, a frame while playing, the end.
    const shots = tools(turn).flatMap((p) => p.shots || []);
    if (shots.length !== 4) throw new Error('shots ' + shots.length);
    const sizes = shots.map((id) => getState().agentShots[id]).map((s) => `${s.width}x${s.height}`);
    if (sizes[0] !== '320x200' || sizes[1] !== '520x330') throw new Error('sizes ' + sizes.join(' '));
    // The out-of-sight program is gone again and new windows open in sight.
    await until(() => noProgram(), 10000, 'program still runs');
    if ((await A.programWindows()).length) throw new Error('window still open');
    if (document.querySelector('.ag-plan.live')) throw new Error('plan still pinned');
    if (!document.querySelector('.ag-plan[data-done="true"]')) throw new Error('plan card not done');
    await until(() => document.querySelector('.build-card .build-shot img'), 5000, 'build card preview');
    if (document.querySelectorAll('.build-file').length !== 1) throw new Error('build files ' + document.querySelectorAll('.build-file').length);
    if (!document.querySelector('.ag-foot')) throw new Error('no footer with the time');
    await shot('agent-02-build-done');
    // A file chip opens the file.
    A.openFile('Hund.java');
    // The build's first rows are folded once it is done: open the group, the create_class row has the chip.
    if (!document.querySelector('.ag-group-head[aria-expanded="false"]')) throw new Error('finished group not folded');
    document.querySelector('.ag-group-head[aria-expanded="false"]').click();
    await until(() => [...document.querySelectorAll('.file-chip')].some((b) => b.textContent === 'Feld' && !b.disabled), 3000, 'file chip');
    [...document.querySelectorAll('.file-chip')].find((b) => b.textContent === 'Feld').click();
    await until(() => getState().activeTab === 'Feld.java', 3000, 'chip did not open the file');
    // `Feld` in the answer opens the file too.
    A.openFile('Hund.java');
    const inline = document.querySelector('.msg-ai .md code.md-file[data-file="Feld.java"]');
    if (!inline) throw new Error('no chip for `Feld` in the answer');
    inline.click();
    await until(() => getState().activeTab === 'Feld.java', 3000, 'inline chip did not open the file');
    // The picture large, and through the strip with the arrow keys.
    document.querySelector('.ag-shot').click();
    await until(() => document.querySelector('.ag-lightbox img'), 3000, 'lightbox');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await until(() => /2 von/.test(document.querySelector('.ag-lb-count') ? document.querySelector('.ag-lb-count').textContent : ''), 3000, 'next picture');
    await shot('agent-03-lightbox');
    // Playing runs through the pictures by itself.
    document.querySelector('.ag-lightbox [data-act="play"]').click();
    await until(() => /^1 von/.test(document.querySelector('.ag-lb-count').textContent), 3000, 'play did not advance');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('.ag-lightbox'), 3000, 'lightbox still open');
  });

  await step('agent: Stop ends a long play-test at once and closes the program', async () => {
    A.askTutor('Spiel es lange');
    await until(() => tools(lastTurn()).some((p) => p.name === 'use_program' && p.status === 'running') && getState().bench.live, 30000, 'play-test running');
    await wait(300);
    const t0 = Date.now();
    document.querySelector('.send-btn.stop').click();
    // Either the row says "Stoppt" right away, or the turn has ended already.
    await until(() => document.querySelector('.live-status[data-stopping]') || !getState().chat.busy, 1000, 'stop not shown at once');
    await until(() => !getState().chat.busy, 3000, 'turn still busy after stop');
    const ms = Date.now() - t0;
    if (lastTurn().status !== 'aborted') throw new Error('status ' + lastTurn().status);
    await until(() => noProgram(), 10000, 'program still runs after stop');
    await log(`     stopped in ${ms} ms`);
    if (ms > 2500) throw new Error('stop took ' + ms + ' ms');
    await shot('agent-04-stopped');
  });

  await step('agent: back to the checkpoint before the build', async () => {
    const btn = document.querySelector('.msg-user [data-act="checkpoint"]');
    if (!btn) throw new Error('no checkpoint on the build message');
    btn.click();
    await until(() => document.querySelector('.ag-cp.open [data-act="restore"]'), 3000, 'confirm');
    document.querySelector('.ag-cp.open').scrollIntoView({ block: 'center' });
    if (!/1 Datei ändert sich/.test(document.querySelector('.ag-cp.open').textContent)) throw new Error('confirm: ' + document.querySelector('.ag-cp.open').textContent);
    await shot('agent-05-checkpoint');
    document.querySelector('.ag-cp.open [data-act="restore"]').click();
    await until(() => !getState().files['Feld.java'], 10000, 'Feld.java still there');
    await until(() => document.querySelector('.build-card[data-status="undone"]'), 3000, 'build card not undone');
    if (!getState().chat.notes.some((n) => n.includes('zurückgesetzt'))) throw new Error('no note for the tutor');
  });

  await step('agent: a turn that broke off (overloaded) after a tool round goes on by itself', async () => {
    A.setTutorMode('explain');
    A.askTutor('Hol tief Luft');
    await until(() => lastTurn().status === 'error' && lastTurn().retryAt, 30000, 'no error with a resume');
    await until(() => document.querySelector('.ag-retry'), 2000, 'no countdown');
    await shot('agent-08-resume');
    await until(() => lastTurn().status === 'done', 30000, 'did not go on: ' + lastTurn().status);
    const said = (lastTurn().parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    if (!said.includes('Weiter nach der Pause.')) throw new Error('text ' + said);
  });

  await step('agent: the model picker in the composer', async () => {
    const before = getState().settings.model;
    document.querySelector('.composer .mp-trigger').click();
    await until(() => document.querySelector('.composer .mp-pop .mp-row[data-family="haiku"]'), 3000, 'model list');
    await shot('agent-06-models');
    document.querySelector('.composer .mp-pop .mp-row[data-family="haiku"]').click();
    await until(() => getState().settings.model === 'claude-haiku-5-5', 3000, 'model not set');
    await A.updateSettings({ model: before });
    await A.updateSettings({ theme: 'light' });
    await shot('agent-07-light');
    await A.updateSettings({ theme: 'dark' });
    A.setTutorMode('hints');
    await A.forgetApiKey();
  });
}
