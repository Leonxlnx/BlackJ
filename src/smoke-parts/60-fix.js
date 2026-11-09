// Smoke steps of the 1.10 fixes: a window that an object on the bench opened is no running main
// program (Run stays, the objects stay, main runs beside it); an out-of-sight window that the
// program places itself after pack() never shows; an armed pause ends with the program.
// Every window here opens at -4000,-4000 (the smoke runs out of sight).
const BILD = `import javax.swing.*;

public class Bild {
    private JFrame f;

    public Bild() {
        f = new JFrame("Leinwand");
        f.setSize(300, 200);
        f.setLocation(-4000, -4000);
        f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        f.setVisible(true);
    }

    public static void main(String[] args) {
        System.out.println("main läuft");
    }
}
`;

// pack(), then a place of its own (stands in for setLocationRelativeTo(null), but is off the screen
// too), then setVisible(true): the bench moves it away before it shows.
const MITTE = `import javax.swing.*;
import java.awt.event.*;

public class Mitte {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("Mitte");
            f.add(new JLabel("mitte"));
            f.pack();
            String nachPack = f.getX() + "," + f.getY();
            f.setLocation(-2500, -2500);
            f.addWindowListener(new WindowAdapter() {
                @Override
                public void windowOpened(WindowEvent e) {
                    java.awt.Point p = f.getLocationOnScreen();
                    System.out.println("geoeffnet " + p.x + "," + p.y);
                }
            });
            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
            f.setVisible(true);
            System.out.println("pack " + nachPack + " show " + f.getX() + "," + f.getY() + " fokus " + f.isAutoRequestFocus());
        });
    }
}
`;

const WARTE = `import javax.swing.*;

public class Warte {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("Warte");
            f.setSize(220, 120);
            f.setLocation(-4000, -4000);
            f.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
            f.setVisible(true);
        });
    }
}
`;

export default async function ({ step, shot, until, wait, A, getState, setState }) {
  const consoleText = () => getState().console.map((l) => l.text).join('');
  const ready = () => getState().bench.state === 'ready' && !getState().bench.starting;
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

  await step('fix: a window an object opened keeps "main starten" and the objects; main runs beside it', async () => {
    await A.openExample('Bankkonto');
    await until(() => document.querySelectorAll('.class-card').length >= 2);
    for (const [n, text] of [['Bild', BILD], ['Mitte', MITTE], ['Warte', WARTE]]) await write(n, text);
    await A.compile();
    await until(() => getState().compile.state === 'ok' && ready(), 30000, 'compile + bench');
    await clean();
    const desc = await A.describe('Bild');
    if (!desc || !desc.constructors.length) throw new Error('describe Bild');
    const made = await A.createObject('Bild', desc.constructors[0], [], 'bild1');
    if (!made || made.error || made.exception) throw new Error('new Bild ' + JSON.stringify(made));
    await until(() => getState().bench.live && getState().bench.live.windows.length === 1, 5000, 'canvas window');
    if (getState().bench.liveFrom !== 'bench') throw new Error('liveFrom ' + getState().bench.liveFrom);
    await until(() => document.querySelector('[data-tour="run-main"]'), 3000, 'main starten stays');
    if (document.querySelector('[data-tour="stop"]') || document.querySelector('.rt-strip[data-state="live"]')) throw new Error('a bench window counted as a running program');
    const notes = getState().console.filter((l) => l.stream === 'note').length;
    const r = await A.runMain('Bild');
    if (!r.finished) throw new Error('runMain ' + JSON.stringify(r));
    if (!getState().bench.objects.some((o) => o.name === 'bild1')) throw new Error('main wiped the bench: ' + JSON.stringify(getState().bench.objects.map((o) => o.name)));
    if (!consoleText().includes('main läuft')) throw new Error('main output');
    if (consoleText().includes('neu gestartet')) throw new Error('JVM restarted for main');
    await until(() => document.querySelector('[data-tour="run-main"]'), 3000, 'still main starten');
    await shot('fix-01-bench-window');
    // Closing the canvas ends nothing: no "Programm beendet" while the objects are still there.
    await A.closeProgramWindows();
    await until(() => !getState().bench.live, 5000, 'canvas closed');
    await wait(200);
    const after = getState().console.filter((l) => l.stream === 'note').slice(notes);
    if (after.some((l) => l.text.includes('Fenster geschlossen'))) throw new Error('ended note for a bench window');
  });

  await step('fix: out of sight, a window placed after pack() is moved away before it shows', async () => {
    await clean();
    if (!(await A.setProgramOffscreen(true))) throw new Error('offscreen');
    A.clearConsole();
    const r = await A.runMain('Mitte');
    if (!r.stillRunning) throw new Error('runMain ' + JSON.stringify(r));
    await until(() => consoleText().includes('geoeffnet'), 5000, 'windowOpened: ' + consoleText());
    const text = consoleText();
    if (!text.includes('pack -4000,-4000 show -4000,-4000 fokus false')) throw new Error('moved too late: ' + text);
    if (!text.includes('geoeffnet -4000,-4000')) throw new Error('opened on screen: ' + text);
    await A.closeProgramWindows();
    await until(() => !getState().bench.live, 5000, 'closed');
  });

  await step('fix: an armed pause is cancelled when the program ends by itself', async () => {
    await clean();
    const r = await A.runMain('Warte');
    if (!r.stillRunning) throw new Error('runMain ' + JSON.stringify(r));
    await wait(300);
    const res = await A.pauseProgram();
    if (res && res.paused) throw new Error('paused a program that only waits: ' + JSON.stringify(res));
    if (!getState().debug.armed) throw new Error('not armed: ' + JSON.stringify(res));
    await A.closeProgramWindows();
    await until(() => !getState().bench.live && !getState().debug.armed, 5000, 'still armed after the program ended');
    // The next call does not stop at its first line.
    const again = await A.runMain('Bild');
    if (!again.finished || getState().debug.paused) throw new Error('stopped without a breakpoint: ' + JSON.stringify(again));
    await clean();
  });
}
