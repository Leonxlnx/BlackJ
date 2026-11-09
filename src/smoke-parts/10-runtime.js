// Runtime smoke: window programs live on after main (Stop, closing, pausing), the tutor's window
// commands (list, capture, keys, clicks), Stop for input and endless loops, long output,
// System.exit. Every program window opens at -4000,-4000 and out of sight (offscreen mode).
const SPIEL = `import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

public class Spiel extends JPanel {
    private int x = 20;
    private int ticks = 0;

    public Spiel() {
        setPreferredSize(new Dimension(360, 220));
        setBackground(Color.WHITE);
        setFocusable(true);
        addKeyListener(new KeyAdapter() {
            @Override
            public void keyPressed(KeyEvent e) {
                System.out.println("taste " + e.getKeyCode());
                if (e.getKeyCode() == KeyEvent.VK_RIGHT) x += 10;
                repaint();
            }
        });
        addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                System.out.println("klick " + e.getX() + "," + e.getY());
            }
        });
        new Timer(40, e -> tick()).start();
    }

    void tick() {
        ticks++;
        repaint();
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        g.setColor(new Color(30, 30, 34));
        g.fillRoundRect(x, 80, 60, 60, 16, 16);
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("Mini-Spiel");
            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
            Spiel s = new Spiel();
            f.setContentPane(s);
            f.pack();
            f.setLocation(-4000, -4000);
            f.setVisible(true);
            s.requestFocusInWindow();
        });
    }
}
`;

const FRAGE = `import java.util.Scanner;

public class Frage {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("Wie heißt du? ");
        String name = sc.nextLine();
        System.out.println("Hallo " + name);
    }
}
`;

const ENDLOS = `public class Endlos {
    public static void main(String[] args) {
        long n = 0;
        while (true) {
            n++;
        }
    }
}
`;

const VIEL = `public class Viel {
    public static void main(String[] args) {
        for (int i = 0; i < 200000; i++) {
            System.out.println("Zeile " + i);
        }
    }
}
`;

const ENDE = `public class Ende {
    public static void main(String[] args) {
        System.out.println("tschüss");
        System.exit(3);
    }
}
`;

export default async function ({ step, shot, until, wait, A, api, getState, setState }) {
  const consoleText = () => getState().console.map((l) => l.text).join('');
  const ready = () => getState().bench.state === 'ready' && !getState().bench.starting;
  // Each step starts with nothing running, whatever the step before left behind.
  const clean = async () => {
    const s = getState();
    if (s.bench.state === 'running' || s.bench.state === 'waiting' || s.bench.live || s.debug.paused || s.debug.armed) await A.stopProgram({ quiet: true });
    await until(() => ready(), 30000, 'clean start');
    setState({ dock: 'console', dockCollapsed: false });
  };
  const write = async (name, text) => {
    if (!getState().files[name + '.java']) {
      const err = await A.newClass(name, 'main');
      if (err) throw new Error(err);
    }
    A.editFile(name + '.java', text);
    await A.saveFile(name + '.java');
  };

  await step('runtime: a window program runs on after main; list, capture, keys and clicks reach it', async () => {
    await A.openExample('Bankkonto');
    await until(() => document.querySelectorAll('.class-card').length >= 2);
    for (const [n, text] of [['Spiel', SPIEL], ['Frage', FRAGE], ['Endlos', ENDLOS], ['Viel', VIEL], ['Ende', ENDE]]) await write(n, text);
    await A.compile();
    await until(() => getState().compile.state === 'ok' && ready(), 30000, 'compile + bench ' + JSON.stringify(getState().bench));
    if (!(await A.setProgramOffscreen(true))) throw new Error('offscreen');
    setState({ dock: 'console', dockCollapsed: false });
    const r = await A.runMain('Spiel');
    if (!r.finished || !r.stillRunning || r.windows[0] !== 'Mini-Spiel') throw new Error('runMain ' + JSON.stringify({ r, bench: { ...getState().bench, objects: undefined } }));
    await until(() => getState().bench.live && getState().bench.live.windows.length === 1, 5000, 'live');
    await until(() => document.querySelector('[data-tour="stop"]') && document.querySelector('.rt-strip[data-state="live"]'), 5000, 'stop in the title bar, live strip');
    if (document.querySelector('[data-tour="run-main"]')) throw new Error('run main shown while the program runs');
    const wins = await A.programWindows();
    if (wins.length !== 1 || wins[0].title !== 'Mini-Spiel' || wins[0].width !== 360 || wins[0].height !== 220) throw new Error('windows ' + JSON.stringify(wins));
    const cap = await A.captureWindow({ id: wins[0].id, maxWidth: 1024 });
    if (cap.error || !cap.png.startsWith('iVBORw0KGgo') || cap.width !== 360) throw new Error('capture ' + JSON.stringify({ ...cap, png: cap.png && cap.png.slice(0, 20) }));
    const sent = await A.sendProgramInput({ events: [{ type: 'key', key: 'RIGHT' }, { type: 'wait', ms: 30 }, { type: 'click', x: 50, y: 40 }] });
    if (sent.delivered !== 2) throw new Error('input ' + JSON.stringify(sent));
    await until(() => consoleText().includes('taste 39') && consoleText().includes('klick 50,40'), 5000, 'key and click output: ' + consoleText().slice(-200));
    await shot('runtime-01-window-live');
    // The capture is a real picture of the game (the square moved right by the key): shown for a screenshot.
    const after = await A.captureWindow({});
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + after.png;
    img.style.cssText = 'position:fixed;left:24px;top:24px;z-index:99999;border:1px solid #888;background:#fff';
    document.body.appendChild(img);
    await until(() => img.complete && img.naturalWidth === 360, 3000, 'capture image');
    await shot('runtime-00-capture');
    img.remove();
  });

  await step('runtime: pause a window program (timer), then Stop while paused', async () => {
    setState({ dock: 'console' });
    await until(() => document.querySelector('[data-tour="console:pause"]'), 5000, 'pause in the strip');
    document.querySelector('[data-tour="console:pause"]').click();
    await until(() => getState().debug.paused, 20000, 'paused');
    const frames = getState().debug.paused.frames;
    if (!frames.some((f) => f.className === 'Spiel')) throw new Error('frames ' + JSON.stringify(frames));
    // Pausing opens the debugger; the console says the same.
    await until(() => getState().dock === 'debug' && document.querySelector('[data-tour="debug:resume"]:not([disabled])'), 3000, 'debugger with continue');
    await shot('runtime-02-paused-debugger');
    setState({ dock: 'console' });
    await until(() => document.querySelector('.rt-strip[data-state="paused"]'), 3000, 'paused strip');
    await shot('runtime-02b-paused-console');
    await A.stopProgram();
    await until(() => ready() && !getState().bench.live && !getState().debug.paused, 20000, 'stopped');
    if ((await A.programWindows()).length) throw new Error('window still open');
    if (!consoleText().includes('Programm gestoppt')) throw new Error('stop note');
  });

  await step('runtime: closing the last window ends the program', async () => {
    await clean();
    const t0 = Date.now();
    const r = await A.runMain('Spiel');
    if (!r.stillRunning) {
      const { live, windowPending, state } = getState().bench;
      throw new Error(JSON.stringify({ r, ms: Date.now() - t0, live, windowPending, state, debug: { attached: !!getState().debug.attached, paused: !!getState().debug.paused } }));
    }
    await until(() => getState().bench.live, 5000, 'live');
    const closed = await A.closeProgramWindows();
    if (closed.closed !== 1) throw new Error(JSON.stringify(closed));
    await until(() => !getState().bench.live, 5000, 'not live after closing');
    await until(() => getState().console.some((l) => l.stream === 'note' && l.text.includes('Fenster geschlossen')), 3000, 'ended note');
    if (document.querySelector('.rt-strip')) throw new Error('strip still shown');
    await until(() => document.querySelector('[data-tour="run-main"]'), 3000, 'run main back');
  });

  await step('runtime: Stop ends a program that waits for input and an endless loop', async () => {
    await clean();
    const asks = A.runMain('Frage');
    await until(() => getState().bench.state === 'waiting', 15000, 'waiting');
    await until(() => document.querySelector('.rt-strip[data-state="waiting"]') && document.querySelector('.rt-input.waiting'), 3000, 'waiting UI');
    await shot('runtime-03-waiting');
    document.querySelector('[data-tour="console:stop"]').click();
    await asks;
    await until(() => ready(), 20000, 'ready after stopping input');
    const loop = A.runMain('Endlos');
    await until(() => getState().bench.state === 'running', 15000, 'running');
    await wait(300);
    document.querySelector('[data-tour="console:pause"]').click();
    await until(() => getState().debug.paused, 20000, 'loop paused');
    if (!getState().debug.paused.frames.some((f) => f.className === 'Endlos')) throw new Error(JSON.stringify(getState().debug.paused.frames));
    // Paused, the debugger is in front: Stop from the title bar.
    document.querySelector('[data-tour="stop"]').click();
    await loop;
    await until(() => ready() && !getState().debug.paused, 20000, 'ready after stopping the loop');
  });

  await step('runtime: 200 000 lines stay fast, the console keeps the newest', async () => {
    await clean();
    A.clearConsole();
    const t0 = Date.now();
    await A.runMain('Viel');
    await until(() => consoleText().includes('Zeile 199999'), 20000, 'last line');
    const ms = Date.now() - t0;
    const chars = consoleText().length;
    if (chars > 320000) throw new Error('console holds ' + chars + ' chars');
    if (!getState().console.some((l) => l.stream === 'trimmed')) throw new Error('no trimmed note');
    await log(`     200000 lines in ${ms} ms, console keeps ${chars} chars`);
    if (ms > 20000) throw new Error('slow: ' + ms + ' ms');
    // Scrolled up to read, the console stays put and offers a way back to the end.
    const body = document.querySelector('.rt-console-body');
    body.scrollTop = 0;
    body.dispatchEvent(new Event('scroll'));
    await until(() => document.querySelector('.rt-to-end'), 3000, 'to the end');
    await shot('runtime-04-long-output');
    document.querySelector('.rt-to-end').click();
  });

  await step('runtime: System.exit restarts the JVM and says so', async () => {
    await clean();
    A.clearConsole();
    await A.runMain('Ende');
    await until(() => getState().console.some((l) => l.stream === 'note' && l.text.includes('System.exit(3)')), 15000, 'exit note: ' + consoleText());
    if (!consoleText().includes('tschüss')) throw new Error('last output before System.exit lost: ' + consoleText());
    await until(() => ready(), 30000, 'bench back');
    if (/bench exited/i.test(consoleText())) throw new Error('raw exit text');
    await shot('runtime-05-system-exit');
  });

  async function log(line) {
    try {
      await api.smoke.log(line);
    } catch { /* only a note */ }
  }
}
