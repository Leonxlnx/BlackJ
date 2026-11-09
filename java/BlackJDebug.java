import com.sun.jdi.AbsentInformationException;
import com.sun.jdi.ArrayReference;
import com.sun.jdi.ArrayType;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.CharValue;
import com.sun.jdi.ClassType;
import com.sun.jdi.DoubleValue;
import com.sun.jdi.Field;
import com.sun.jdi.FloatValue;
import com.sun.jdi.IncompatibleThreadStateException;
import com.sun.jdi.IntegerValue;
import com.sun.jdi.InvalidStackFrameException;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Location;
import com.sun.jdi.Method;
import com.sun.jdi.ObjectCollectedException;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.PrimitiveValue;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadGroupReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.VMDisconnectedException;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventQueue;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.LocatableEvent;
import com.sun.jdi.event.MethodEntryEvent;
import com.sun.jdi.event.StepEvent;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.event.VMStartEvent;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.MethodEntryRequest;
import com.sun.jdi.request.StepRequest;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * BlackJ debugger helper.
 *
 * Runs in its own JVM and attaches over JDWP to the object bench, which is started with
 * -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:0. Reads one JSON
 * request per line on stdin and answers one JSON message per line on stdout, like BlackJBench.
 * Uses only JDI (module jdk.jdi). It never invokes methods in the student's VM, so looking at
 * values cannot run student code. Compiled with --release 11.
 *
 * Only threads that run the student's code are ever stopped, and breakpoints and steps suspend
 * just the event thread, so the bench keeps answering while the student's code is paused.
 */
public class BlackJDebug {

    /** Classes "step into" never stops in (JDI patterns: only a leading or trailing * is allowed). */
    static final String[] LIBRARY = { "java.*", "javax.*", "jdk.*", "sun.*", "com.sun.*", "BlackJBench", "BlackJBench$*" };
    static final Set<String> BOXES = new HashSet<>(Arrays.asList("java.lang.Integer", "java.lang.Long", "java.lang.Short",
            "java.lang.Byte", "java.lang.Double", "java.lang.Float", "java.lang.Boolean", "java.lang.Character"));
    static final int MAX_ELEMENTS = 100;
    static final int MAX_STRING = 2000;
    static final Pattern SHORT_PACKAGES = Pattern.compile("(?<![\\w.$])java\\.(?:lang|util)\\.(?=[A-Z])");

    static PrintStream proto;
    static final Object PROTO_LOCK = new Object();
    /** Guards all state below. Held while one request or one event set is handled. */
    static final Object LOCK = new Object();

    static VirtualMachine vm;
    static EventRequestManager erm;
    static File classDir;
    static boolean detaching = false;
    static boolean deathSent = false;
    static boolean firstEventSeen = false;

    /** With suspend=y the VM waits at its start event until the first resume. */
    static EventSet startSet;
    static boolean resumeEarly = false;

    /** The thread shown as paused; threads that stopped meanwhile wait until it resumes. */
    static ThreadReference current;
    static final Map<ThreadReference, String> waiting = new LinkedHashMap<>();
    static final Map<ThreadReference, StepPlan> stepping = new HashMap<>();
    /** The bench's protocol thread (also called "main"); never stopped. */
    static final Set<Long> readers = new HashSet<>();

    /** Breakpoints: class name -> lines, and which lines turned out to have code. */
    static final Map<String, TreeSet<Integer>> wanted = new LinkedHashMap<>();
    static final Map<String, Set<Integer>> verified = new HashMap<>();
    static final Map<String, Set<String>> loadedTypes = new HashMap<>();
    static final Set<Location> installed = new HashSet<>();

    static final Map<Long, ObjectReference> objects = new HashMap<>();
    static final Map<String, Boolean> studentCache = new HashMap<>();

    public static void main(String[] args) throws Exception {
        proto = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true, "UTF-8"));
        if (args.length < 1) {
            error("usage: java BlackJDebug <port>");
            System.exit(2);
        }
        try {
            vm = attach(args[0]);
        } catch (Exception e) {
            error("could not attach to port " + args[0] + ": " + e.getMessage());
            System.exit(1);
        }
        erm = vm.eventRequestManager();
        Thread events = new Thread(BlackJDebug::eventLoop, "blackj-debug-events");
        events.setDaemon(true);
        events.start();

        BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(FileDescriptor.in), StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            handleLine(line);
        }
        synchronized (LOCK) {
            shutdown();
        }
        System.exit(0);
    }

    static VirtualMachine attach(String port) throws Exception {
        AttachingConnector socket = null;
        for (AttachingConnector c : Bootstrap.virtualMachineManager().attachingConnectors()) {
            if (c.name().equals("com.sun.jdi.SocketAttach")) socket = c;
        }
        if (socket == null) throw new IllegalStateException("the JDK has no socket attach connector");
        Map<String, Connector.Argument> a = socket.defaultArguments();
        a.get("hostname").setValue("127.0.0.1");
        a.get("port").setValue(port);
        if (a.containsKey("timeout")) a.get("timeout").setValue("5000");
        IOException last = null;
        for (int i = 0; i < 25; i++) {
            try {
                return socket.attach(a);
            } catch (IOException e) {
                last = e;
                Thread.sleep(200);
            }
        }
        throw last;
    }

    // ------------------------------------------------------------------ dispatch

    @SuppressWarnings("unchecked")
    static void handleLine(String line) {
        Object id = null;
        boolean leave = false;
        try {
            Map<String, Object> req = (Map<String, Object>) Json.parse(line);
            id = req.get("id");
            String cmd = str(req.get("cmd"));
            Object result = null;
            synchronized (LOCK) {
                switch (cmd) {
                    case "init":
                        result = init((String) req.get("classDir"));
                        break;
                    case "setBreakpoints":
                        result = setBreakpoints((Map<String, Object>) req.get("breakpoints"));
                        break;
                    case "resume":
                        result = resume();
                        break;
                    case "stepOver":
                        step("over");
                        break;
                    case "stepInto":
                        step("into");
                        break;
                    case "stepOut":
                        step("out");
                        break;
                    case "pause":
                        result = pause(Boolean.TRUE.equals(req.get("arm")));
                        break;
                    case "variables":
                        result = variables(req.get("frame") == null ? 0 : ((Number) req.get("frame")).intValue());
                        break;
                    case "expand":
                        result = expand(((Number) req.get("objectId")).longValue());
                        break;
                    case "detach":
                        leave = true;
                        shutdown();
                        break;
                    default:
                        throw new DebugError("unknown command: " + cmd);
                }
            }
            reply(id, result);
        } catch (Throwable t) {
            replyError(id, t);
        }
        if (leave) System.exit(0);
    }

    static Object init(String dir) throws InterruptedException {
        classDir = dir == null || dir.trim().isEmpty() ? null : new File(dir).getAbsoluteFile();
        studentCache.clear();
        // A VM started with suspend=y (all threads suspended) reports its start right after the
        // attach; wait a moment for that event so the reply can say whether it waits for "resume".
        // A running VM (suspend=n) sends no start event to a late debugger, so no waiting then.
        boolean anySuspended = false;
        for (ThreadReference t : vm.allThreads()) {
            if (t.isSuspended()) anySuspended = true;
        }
        long until = System.currentTimeMillis() + 1000;
        while (anySuspended && !firstEventSeen && System.currentTimeMillis() < until) LOCK.wait(20);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("vm", vm.name());
        r.put("version", vm.version());
        r.put("suspended", startSet != null);
        return r;
    }

    // ------------------------------------------------------------------ breakpoints

    @SuppressWarnings("unchecked")
    static Object setBreakpoints(Map<String, Object> spec) {
        erm.deleteEventRequests(new ArrayList<>(erm.breakpointRequests()));
        erm.deleteEventRequests(new ArrayList<>(erm.classPrepareRequests()));
        wanted.clear();
        verified.clear();
        loadedTypes.clear();
        installed.clear();
        if (spec != null) {
            for (Map.Entry<String, Object> e : spec.entrySet()) {
                TreeSet<Integer> lines = new TreeSet<>();
                if (e.getValue() instanceof List) {
                    for (Object n : (List<Object>) e.getValue()) lines.add(((Number) n).intValue());
                }
                if (lines.isEmpty()) continue;
                String c = e.getKey();
                wanted.put(c, lines);
                // The class and its nested classes may load later: install when they are prepared.
                watch(c, null);
                watch(c + "$*", null);
                // Further top-level classes in the same source file (class Knochen in Hund.java).
                if (vm.canUseSourceNameFilters()) watch(c.contains(".") ? packageOf(c) + ".*" : null, simpleName(c) + ".java");
            }
        }
        if (!wanted.isEmpty()) {
            for (ReferenceType rt : vm.allClasses()) {
                if (rt.isPrepared()) install(rt);
            }
        }
        Map<String, Object> r = new LinkedHashMap<>();
        for (String c : wanted.keySet()) r.put(c, status(c));
        return r;
    }

    static void watch(String classPattern, String sourceName) {
        ClassPrepareRequest r = erm.createClassPrepareRequest();
        if (classPattern != null) r.addClassFilter(classPattern);
        if (sourceName != null) r.addSourceNameFilter(sourceName);
        // Suspend the loading thread briefly, so the breakpoints exist before the class runs.
        r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        r.enable();
    }

    /** The breakpoint class a loaded type belongs to: itself, an outer class or its source file. */
    static String familyOf(ReferenceType rt) {
        String n = rt.name();
        for (String c : wanted.keySet()) {
            if (n.equals(c) || n.startsWith(c + "$")) return c;
        }
        for (String c : wanted.keySet()) {
            if (!packageOf(n).equals(packageOf(c))) continue;
            try {
                if (rt.sourceName().equals(simpleName(c) + ".java")) return c;
            } catch (AbsentInformationException ignored) {
                // no source file attribute
            }
        }
        return null;
    }

    static void install(ReferenceType rt) {
        String c = familyOf(rt);
        if (c == null) return;
        loadedTypes.computeIfAbsent(c, k -> new HashSet<>()).add(rt.name());
        Set<Integer> hit = verified.computeIfAbsent(c, k -> new HashSet<>());
        for (int line : wanted.get(c)) {
            List<Location> locations;
            try {
                locations = rt.locationsOfLine(line);
            } catch (AbsentInformationException e) {
                continue;
            }
            for (Location loc : locations) {
                hit.add(line);
                if (!installed.add(loc)) continue;
                BreakpointRequest br = erm.createBreakpointRequest(loc);
                br.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                br.enable();
            }
        }
    }

    static void prepared(ReferenceType rt) {
        String c = familyOf(rt);
        if (c == null) return;
        install(rt);
        Map<String, Object> m = event("breakpoints");
        m.put("className", c);
        m.put("lines", status(c));
        send(m);
    }

    /** Per line: true = has code, false = no code, null = class (or a nested class) not loaded yet. */
    static List<Object> status(String c) {
        Set<Integer> hit = verified.get(c);
        Set<String> loaded = loadedTypes.get(c);
        boolean pending = loaded == null || nestedNotLoaded(c, loaded);
        List<Object> out = new ArrayList<>();
        for (int line : wanted.get(c)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("line", line);
            m.put("verified", hit != null && hit.contains(line) ? Boolean.TRUE : pending ? null : Boolean.FALSE);
            out.add(m);
        }
        return out;
    }

    /** Does classDir hold nested classes of c (Hund$1.class) that are not loaded yet? */
    static boolean nestedNotLoaded(String c, Set<String> loaded) {
        if (classDir == null) return false;
        File dir = new File(classDir, packageOf(c).replace('.', File.separatorChar));
        String[] names = dir.list();
        if (names == null) return false;
        String prefix = simpleName(c) + "$";
        String pkg = packageOf(c).isEmpty() ? "" : packageOf(c) + ".";
        for (String f : names) {
            if (f.startsWith(prefix) && f.endsWith(".class") && !loaded.contains(pkg + f.substring(0, f.length() - 6))) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ events

    static void eventLoop() {
        EventQueue queue = vm.eventQueue();
        try {
            while (true) {
                EventSet set = queue.remove();
                synchronized (LOCK) {
                    handle(set);
                    firstEventSeen = true;
                    LOCK.notifyAll();
                }
            }
        } catch (InterruptedException | VMDisconnectedException e) {
            // the program has ended or the connection was closed
        }
        synchronized (LOCK) {
            if (detaching) return;
            gone();
        }
        System.exit(0);
    }

    static void handle(EventSet set) {
        boolean keep = false;
        try {
            ThreadReference stop = null;
            String reason = null;
            Set<ReferenceType> prepared = new HashSet<>();
            for (Event e : set) {
                if (e instanceof VMStartEvent) {
                    if (set.suspendPolicy() == EventRequest.SUSPEND_ALL && !resumeEarly) {
                        startSet = set;
                        keep = true;
                    }
                } else if (e instanceof VMDeathEvent || e instanceof VMDisconnectEvent) {
                    gone();
                } else if (e instanceof ClassPrepareEvent) {
                    // One class can match several watches (class name and source file).
                    ReferenceType rt = ((ClassPrepareEvent) e).referenceType();
                    if (prepared.add(rt)) prepared(rt);
                } else if (e instanceof BreakpointEvent) {
                    ThreadReference t = ((BreakpointEvent) e).thread();
                    if (!isForeign(t)) {
                        stop = t;
                        reason = "breakpoint";
                    }
                } else if (armed != null && e.request() == armed) {
                    // "Pause" while none of the student's code ran: stop where it runs next.
                    LocatableEvent le = (LocatableEvent) e;
                    ThreadReference t = le.thread();
                    if (stop == null && !isForeign(t) && isStudent(le.location().declaringType().name())) {
                        disarm();
                        clearStepping(t);
                        stop = t;
                        reason = "pause";
                    }
                } else if (e instanceof StepEvent || e instanceof MethodEntryEvent) {
                    LocatableEvent le = (LocatableEvent) e;
                    StepPlan p = stepping.get(le.thread());
                    if (stepArrived(le) && stop == null) {
                        stop = le.thread();
                        reason = p.reason;
                    }
                }
            }
            if (stop != null) {
                clearStepping(stop);
                keep = true;
                stopped(stop, reason);
            }
        } catch (VMDisconnectedException e) {
            throw e;
        } catch (Exception e) {
            error("event handling failed: " + e);
        } finally {
            if (!keep) set.resume();
        }
        if (current == null && stepping.isEmpty()) promote();
    }

    static void stopped(ThreadReference t, String reason) throws Exception {
        if (current == null) {
            current = t;
            announce(t, reason);
        } else if (!t.equals(current)) {
            waiting.put(t, reason);
        }
    }

    /** Shows the next thread that stopped while another one was shown. */
    static void promote() {
        while (current == null && !waiting.isEmpty()) {
            Iterator<Map.Entry<ThreadReference, String>> it = waiting.entrySet().iterator();
            Map.Entry<ThreadReference, String> next = it.next();
            it.remove();
            try {
                current = next.getKey();
                announce(current, next.getValue());
            } catch (VMDisconnectedException e) {
                throw e;
            } catch (Exception e) {
                current = null;
                try {
                    next.getKey().resume();
                } catch (RuntimeException ignored) {
                    // the thread is gone
                }
            }
        }
    }

    static void gone() {
        if (deathSent) return;
        deathSent = true;
        current = null;
        armed = null;
        waiting.clear();
        stepping.clear();
        send(event("vmDeath"));
    }

    /** Threads of the bench itself and of the JVM are never stopped or shown. */
    static boolean isForeign(ThreadReference t) {
        try {
            if (t.name().startsWith("blackj-")) return true;
            ThreadGroupReference g = t.threadGroup();
            if (g != null && (g.name().equals("system") || g.name().equals("InnocuousThreadGroup"))) return true;
            if (readers.contains(t.uniqueID())) return true;
            if (isReader(t)) {
                readers.add(t.uniqueID());
                return true;
            }
            return false;
        } catch (ObjectCollectedException e) {
            return true;
        }
    }

    /** The bench reads its protocol on the JVM's own "main" thread, whose bottom frame is BlackJBench.main. */
    static boolean isReader(ThreadReference t) {
        try {
            int n = t.frameCount();
            if (n == 0) return false;
            Location l = t.frame(n - 1).location();
            return l.declaringType().name().equals("BlackJBench") && l.method().name().equals("main");
        } catch (IncompatibleThreadStateException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ resume, pause, step

    static Object resume() throws Exception {
        Map<String, Object> r = new LinkedHashMap<>();
        if (current == null && armed != null) {
            // "Continue" while waiting for the student's code: do not stop there after all.
            disarm();
            Map<String, Object> ev = event("resumed");
            ev.put("reason", "disarm");
            send(ev);
            r.put("resumed", true);
            return r;
        }
        if (startSet != null) {
            EventSet s = startSet;
            startSet = null;
            s.resume();
            send(event("resumed"));
            r.put("resumed", true);
            return r;
        }
        if (current == null) {
            resumeEarly = true;
            promote();
            r.put("resumed", false);
            return r;
        }
        ThreadReference t = current;
        current = null;
        clearStepping(t);
        resumed(t, "resume");
        t.resume();
        promote();
        r.put("resumed", true);
        return r;
    }

    /**
     * A method entry request for the student's classes, armed by a pause that found none of the
     * student's code running (a window program waiting for a click, a key or its timer): the
     * thread that runs the student's code next stops there. Resume disarms it.
     */
    static MethodEntryRequest armed;

    static void arm() {
        if (armed != null) return;
        MethodEntryRequest me = erm.createMethodEntryRequest();
        for (String f : LIBRARY) me.addClassExclusionFilter(f);
        me.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        me.enable();
        armed = me;
    }

    static void disarm() {
        if (armed == null) return;
        try {
            erm.deleteEventRequest(armed);
        } catch (RuntimeException ignored) {
            // the VM is gone
        }
        armed = null;
    }

    static Object pause(boolean arm) throws Exception {
        Map<String, Object> r = new LinkedHashMap<>();
        if (current == null) promote();
        if (current != null) {
            disarm();
            r.put("paused", true);
            r.put("thread", current.name());
            return r;
        }
        ThreadReference chosen = null;
        for (ThreadReference t : vm.allThreads()) {
            try {
                if (t.isSuspended()) continue;
                int st = t.status();
                if (st == ThreadReference.THREAD_STATUS_ZOMBIE || st == ThreadReference.THREAD_STATUS_NOT_STARTED) continue;
                if (t.name().startsWith("blackj-") || readers.contains(t.uniqueID())) continue;
                ThreadGroupReference g = t.threadGroup();
                if (g != null && (g.name().equals("system") || g.name().equals("InnocuousThreadGroup"))) continue;
                t.suspend();
                boolean keep = false;
                try {
                    if (isReader(t)) readers.add(t.uniqueID());
                    else keep = studentFrames(t.frames(), false).size() > 0;
                } catch (IncompatibleThreadStateException | InvalidStackFrameException e) {
                    keep = false;
                }
                if (keep && (chosen == null || (!chosen.name().equals("main") && t.name().equals("main")))) {
                    if (chosen != null) chosen.resume();
                    chosen = t;
                } else {
                    t.resume();
                }
            } catch (ObjectCollectedException e) {
                // the thread ended meanwhile
            }
        }
        if (chosen == null) {
            r.put("paused", false);
            if (arm) {
                arm();
                r.put("armed", true);
            }
            return r;
        }
        disarm();
        clearStepping(chosen);
        r.put("paused", true);
        r.put("thread", chosen.name());
        if (holdsBenchLock(chosen)) {
            // Caught inside the bench's own output code (println -> EventStream -> send). Stopping
            // there would hold the bench's protocol lock, so run on to the student's code first;
            // the "paused" event follows from there.
            StepPlan p = new StepPlan();
            p.kind = "over";
            p.reason = "pause";
            p.startDepth = -1;
            stepping.put(chosen, p);
            climb(chosen, p);
            chosen.resume();
            return r;
        }
        current = chosen;
        announce(chosen, "pause");
        return r;
    }

    /** Does t hold a monitor the bench's other threads need (its protocol lock, System.out, System.in)? */
    static boolean holdsBenchLock(ThreadReference t) {
        if (!vm.canGetOwnedMonitorInfo()) return false;
        try {
            List<ObjectReference> owned = t.ownedMonitors();
            if (owned.isEmpty()) return false;
            Set<ObjectReference> locks = new HashSet<>();
            for (ReferenceType bench : vm.classesByName("BlackJBench")) {
                for (Field f : bench.fields()) {
                    if (!f.isStatic()) continue;
                    Value v = bench.getValue(f);
                    if (v instanceof ObjectReference) locks.add((ObjectReference) v);
                }
            }
            for (ObjectReference m : owned) {
                if (isHelper(m.referenceType().name()) || locks.contains(m)) return true;
            }
        } catch (IncompatibleThreadStateException e) {
            return false;
        }
        return false;
    }

    /** What a step tries to reach; kept while JDI steps (and maybe climbs out of library code). */
    static final class StepPlan {
        String kind;          // over, into, out
        String reason = "step";
        int startDepth;       // stack depth of the student frame the step started in
        Method startMethod;
        int startLine;
        MethodEntryRequest entry;
    }

    static void step(String kind) throws Exception {
        if (current == null) throw new DebugError("the program is not paused");
        ThreadReference t = current;
        List<StackFrame> frames = t.frames();
        List<Integer> shown = studentFrames(frames, true);
        int top = shown.isEmpty() ? 0 : shown.get(0);
        StepPlan p = new StepPlan();
        p.kind = kind;
        p.startDepth = frames.size() - top;
        Location at = frames.get(top).location();
        p.startMethod = at.method();
        p.startLine = at.lineNumber();
        clearStepping(t);
        stepping.put(t, p);
        // Paused inside library code (Thread.sleep, Scanner): first climb back to the student's code.
        if (top > 0) climb(t, p);
        else issueStep(t, depthOf(kind));
        current = null;
        resumed(t, "step");
        t.resume();
    }

    static int depthOf(String kind) {
        if (kind.equals("into")) return StepRequest.STEP_INTO;
        if (kind.equals("out")) return StepRequest.STEP_OUT;
        return StepRequest.STEP_OVER;
    }

    /**
     * A plain JDI line step. "Into" skips library classes with exclusion filters. Over and out
     * need no filters, and without them stepping off the end of a method reports where it
     * lands, so a return into library code that calls back into the student's code (println ->
     * toString, forEach -> lambda) can climb on instead of silently running to the end.
     */
    static void issueStep(ThreadReference t, int depth) throws IncompatibleThreadStateException {
        deleteStepRequests(t);
        boolean filtered = depth == StepRequest.STEP_INTO;
        if (filtered) {
            List<StackFrame> frames = t.frames();
            if (frames.size() > 1 && !isStudentFrame(frames.get(1))) {
                for (int i = 2; i < frames.size() && filtered; i++) {
                    if (isStudentFrame(frames.get(i))) filtered = false;
                }
            }
        }
        StepRequest r = erm.createStepRequest(t, StepRequest.STEP_LINE, depth);
        if (filtered) {
            for (String f : LIBRARY) r.addClassExclusionFilter(f);
        }
        r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        r.enable();
    }

    /** Leaves library code: step out until a student frame is reached, or a student method is entered. */
    static void climb(ThreadReference t, StepPlan p) {
        deleteStepRequests(t);
        if (!p.kind.equals("out") && p.entry == null) {
            MethodEntryRequest me = erm.createMethodEntryRequest();
            me.addThreadFilter(t);
            for (String f : LIBRARY) me.addClassExclusionFilter(f);
            me.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            me.enable();
            p.entry = me;
        }
        StepRequest r = erm.createStepRequest(t, StepRequest.STEP_LINE, StepRequest.STEP_OUT);
        r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        r.enable();
    }

    /** Called for step and method entry events. True when the thread should stop here. */
    static boolean stepArrived(LocatableEvent e) throws Exception {
        ThreadReference t = e.thread();
        StepPlan p = stepping.get(t);
        if (p == null) {
            deleteStepRequests(t);
            return false;
        }
        Location loc = e.location();
        boolean student = isStudent(loc.declaringType().name());
        if (e instanceof MethodEntryEvent) return student;
        deleteStepRequests(t);
        if (student) {
            int depth = t.frameCount();
            if (p.kind.equals("out")) {
                if (depth < p.startDepth) return true;
                issueStep(t, StepRequest.STEP_OUT);
                return false;
            }
            // Back in the starting line after a detour through library code: finish that line.
            if (depth == p.startDepth && loc.method().equals(p.startMethod) && loc.lineNumber() == p.startLine) {
                issueStep(t, depthOf(p.kind));
                return false;
            }
            return true;
        }
        if (studentFrames(t.frames(), false).isEmpty()) {
            // Stepped off the end of the student's code: let the thread run on.
            clearStepping(t);
            return false;
        }
        climb(t, p);
        return false;
    }

    static void deleteStepRequests(ThreadReference t) {
        List<EventRequest> old = new ArrayList<>();
        for (StepRequest r : erm.stepRequests()) {
            if (r.thread().equals(t)) old.add(r);
        }
        erm.deleteEventRequests(old);
    }

    static void clearStepping(ThreadReference t) {
        deleteStepRequests(t);
        StepPlan p = stepping.remove(t);
        if (p != null && p.entry != null) erm.deleteEventRequest(p.entry);
    }

    static void resumed(ThreadReference t, String reason) {
        Map<String, Object> m = event("resumed");
        m.put("thread", t.name());
        m.put("reason", reason);
        send(m);
    }

    // ------------------------------------------------------------------ frames and variables

    static boolean isStudentFrame(StackFrame f) {
        return isStudent(f.location().declaringType().name());
    }

    /** Indexes of the student's frames, top first. With fallback, the top frame if there are none. */
    static List<Integer> studentFrames(List<StackFrame> frames, boolean fallback) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < frames.size(); i++) {
            if (isStudentFrame(frames.get(i))) out.add(i);
        }
        if (out.isEmpty() && fallback && !frames.isEmpty()) out.add(0);
        return out;
    }

    static boolean isStudent(String name) {
        Boolean known = studentCache.get(name);
        if (known != null) return known;
        boolean is;
        if (name.contains("/") || isHelper(name) || name.startsWith("java.") || name.startsWith("javax.")
                || name.startsWith("jdk.") || name.startsWith("sun.") || name.startsWith("com.sun.")) {
            is = false; // library, BlackJ itself, or a hidden class (Zoo$$Lambda/0x...)
        } else if (classDir == null) {
            is = true;
        } else {
            is = new File(classDir, name.replace('.', File.separatorChar) + ".class").isFile();
        }
        studentCache.put(name, is);
        return is;
    }

    static boolean isHelper(String name) {
        return name.equals("BlackJBench") || name.startsWith("BlackJBench$") || name.equals("BlackJDebug") || name.startsWith("BlackJDebug$");
    }

    static void announce(ThreadReference t, String reason) throws Exception {
        List<StackFrame> frames = t.frames();
        List<Integer> shown = studentFrames(frames, true);
        Map<String, Object> m = event("paused");
        m.put("reason", reason);
        m.put("thread", t.name());
        List<Object> list = new ArrayList<>();
        for (int i = 0; i < shown.size(); i++) list.add(frameInfo(i, frames.get(shown.get(i)).location()));
        m.put("frames", list);
        Map<String, Object> vars = shown.isEmpty() ? null : frameVariables(frames.get(shown.get(0)));
        m.put("variables", vars == null ? new ArrayList<>() : vars.get("variables"));
        m.put("statics", vars == null ? new ArrayList<>() : vars.get("statics"));
        send(m);
    }

    static Map<String, Object> frameInfo(int index, Location loc) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("index", index);
        f.put("className", loc.declaringType().name());
        f.put("method", loc.method().name());
        String file = null;
        String path = null;
        try {
            file = loc.sourceName();
            path = loc.sourcePath().replace('\\', '/');
        } catch (AbsentInformationException ignored) {
            // compiled without source file information
        }
        f.put("file", file);
        f.put("path", path);
        f.put("line", loc.lineNumber());
        return f;
    }

    static Object variables(int index) throws Exception {
        if (current == null) throw new DebugError("the program is not paused");
        List<StackFrame> frames = current.frames();
        List<Integer> shown = studentFrames(frames, true);
        if (index < 0 || index >= shown.size()) throw new DebugError("there is no frame " + index);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("frame", index);
        r.putAll(frameVariables(frames.get(shown.get(index))));
        return r;
    }

    /** this, the local variables, and the static fields of the frame's class. */
    static Map<String, Object> frameVariables(StackFrame f) {
        List<Object> vars = new ArrayList<>();
        ObjectReference self = f.thisObject();
        if (self != null) vars.add(variable("this", typeName(self.referenceType().name()), self));
        try {
            List<LocalVariable> locals = f.visibleVariables();
            Map<LocalVariable, Value> values = f.getValues(locals);
            for (LocalVariable lv : locals) vars.add(variable(lv.name(), typeOf(lv.typeName(), lv.genericSignature()), values.get(lv)));
        } catch (AbsentInformationException e) {
            // Compiled without -g: only the argument values are known, without names.
            List<Value> args = f.getArgumentValues();
            List<String> types = f.location().method().argumentTypeNames();
            for (int i = 0; i < args.size(); i++) vars.add(variable("arg" + i, typeName(types.get(i)), args.get(i)));
        }
        List<Object> statics = new ArrayList<>();
        ReferenceType rt = f.location().declaringType();
        if (isStudent(rt.name())) {
            List<Field> fields = new ArrayList<>();
            for (Field fd : rt.fields()) {
                if (fd.isStatic() && !fd.isSynthetic() && !fd.isEnumConstant()) fields.add(fd);
            }
            Map<Field, Value> values = rt.getValues(fields);
            for (Field fd : fields) statics.add(variable(fd.name(), typeOf(fd.typeName(), fd.genericSignature()), values.get(fd)));
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("variables", vars);
        r.put("statics", statics);
        return r;
    }

    /** Fields of an object, or the elements of an array or list (at most MAX_ELEMENTS). */
    static Object expand(long id) throws Exception {
        ObjectReference o = objects.get(id);
        if (o == null) throw new DebugError("unknown object " + id);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("objectId", id);
        r.put("type", typeName(o.referenceType().name()));
        List<Object> children = new ArrayList<>();
        Elements list;
        if (o instanceof ArrayReference) {
            ArrayReference a = (ArrayReference) o;
            int n = a.length();
            String component = typeName(((ArrayType) a.referenceType()).componentTypeName());
            List<Value> values = n == 0 ? new ArrayList<>() : a.getValues(0, Math.min(n, MAX_ELEMENTS));
            for (int i = 0; i < values.size(); i++) children.add(variable("[" + i + "]", component, values.get(i)));
            r.put("kind", "array");
            r.put("size", n);
            if (n > values.size()) r.put("more", n - values.size());
        } else if ((list = elements(o, MAX_ELEMENTS)) != null) {
            for (int i = 0; i < list.values.size(); i++) {
                Value v = list.values.get(i);
                String type = v instanceof ObjectReference ? typeName(((ObjectReference) v).referenceType().name()) : "Object";
                children.add(variable("[" + i + "]", type, v));
            }
            r.put("kind", "list");
            r.put("size", list.size);
            if (list.size > list.values.size()) r.put("more", list.size - list.values.size());
        } else {
            // Instance fields, those of superclasses first, like BlueJ's inspector.
            List<ClassType> chain = new ArrayList<>();
            if (o.referenceType() instanceof ClassType) {
                for (ClassType k = (ClassType) o.referenceType(); k != null; k = k.superclass()) chain.add(0, k);
            }
            List<Field> fields = new ArrayList<>();
            for (ClassType k : chain) {
                for (Field f : k.fields()) {
                    if (!f.isStatic()) fields.add(f);
                }
            }
            Map<Field, Value> values = o.getValues(fields);
            for (Field f : fields) {
                Map<String, Object> v = variable(f.name(), typeOf(f.typeName(), f.genericSignature()), values.get(f));
                v.put("declaredIn", simpleName(f.declaringType().name()));
                children.add(v);
            }
            r.put("kind", "object");
        }
        r.put("children", children);
        return r;
    }

    // ------------------------------------------------------------------ values

    static Map<String, Object> variable(String name, String type, Value v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("type", type);
        m.put("value", value(v));
        return m;
    }

    /** How a value is shown. Reads fields only, never calls a method (no toString). */
    static Map<String, Object> value(Value v) {
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            if (v == null) {
                m.put("kind", "null");
                m.put("text", "null");
            } else if (v instanceof PrimitiveValue) {
                m.put("kind", "prim");
                m.put("text", primitiveText((PrimitiveValue) v));
            } else if (v instanceof StringReference) {
                m.put("kind", "string");
                m.put("text", quote(((StringReference) v).value()));
            } else if (v instanceof ArrayReference) {
                ArrayReference a = (ArrayReference) v;
                int n = a.length();
                String t = typeName(a.referenceType().name());
                int b = t.indexOf('[');
                m.put("kind", "array");
                m.put("text", t.substring(0, b) + "[" + n + "]" + t.substring(b + 2));
                m.put("objectId", register(a));
                m.put("size", n);
            } else if (v instanceof ObjectReference) {
                ObjectReference o = (ObjectReference) v;
                ReferenceType rt = o.referenceType();
                if (BOXES.contains(rt.name())) {
                    Value inner = o.getValue(rt.fieldByName("value"));
                    m.put("kind", "prim");
                    m.put("text", inner instanceof PrimitiveValue ? primitiveText((PrimitiveValue) inner) : "?");
                    return m;
                }
                String constant = enumName(o);
                m.put("kind", "object");
                m.put("text", constant != null ? constant : simpleName(rt.name()) + " (id=" + o.uniqueID() + ")");
                m.put("objectId", register(o));
                Elements e = elements(o, 0);
                if (e != null) m.put("size", e.size);
            } else {
                m.put("kind", "prim");
                m.put("text", String.valueOf(v));
            }
        } catch (ObjectCollectedException e) {
            m.clear();
            m.put("kind", "null");
            m.put("text", "(collected)");
        }
        return m;
    }

    static long register(ObjectReference o) {
        if (objects.size() > 50000) objects.clear();
        objects.put(o.uniqueID(), o);
        return o.uniqueID();
    }

    static String primitiveText(PrimitiveValue p) {
        if (p instanceof CharValue) return charLiteral(((CharValue) p).value());
        if (p instanceof BooleanValue) return String.valueOf(((BooleanValue) p).value());
        if (p instanceof DoubleValue) return String.valueOf(((DoubleValue) p).value());
        if (p instanceof FloatValue) return String.valueOf(((FloatValue) p).value());
        return String.valueOf(p.longValue());
    }

    static String enumName(ObjectReference o) {
        if (!(o.referenceType() instanceof ClassType)) return null;
        for (ClassType k = (ClassType) o.referenceType(); k != null; k = k.superclass()) {
            if (k.name().equals("java.lang.Enum")) {
                Value n = o.getValue(k.fieldByName("name"));
                return n instanceof StringReference ? ((StringReference) n).value() : null;
            }
        }
        return null;
    }

    static final class Elements {
        int size;
        final List<Value> values = new ArrayList<>();
    }

    /** Elements of the common list classes, read from their fields. Null for anything else. */
    static Elements elements(ObjectReference o, int max) {
        if (!(o.referenceType() instanceof ClassType) || isStudent(o.referenceType().name())) return null;
        try {
            for (ClassType k = (ClassType) o.referenceType(); k != null; k = k.superclass()) {
                switch (k.name()) {
                    case "java.util.ArrayList": return fromArray(o, k, "elementData", intField(o, k, "size"), max);
                    case "java.util.Vector": return fromArray(o, k, "elementData", intField(o, k, "elementCount"), max);
                    case "java.util.Arrays$ArrayList": return fromArray(o, k, "a", -1, max);
                    case "java.util.ImmutableCollections$ListN": return fromArray(o, k, "elements", -1, max);
                    case "java.util.concurrent.CopyOnWriteArrayList": return fromArray(o, k, "array", -1, max);
                    case "java.util.LinkedList": return linked(o, k, max);
                    case "java.util.ImmutableCollections$List12": return list12(o, k, max);
                    default:
                }
            }
        } catch (RuntimeException e) {
            if (e instanceof VMDisconnectedException || e instanceof ObjectCollectedException) throw e;
            // another JDK layout: show the fields instead
        }
        return null;
    }

    static int intField(ObjectReference o, ClassType k, String name) {
        return ((IntegerValue) o.getValue(k.fieldByName(name))).value();
    }

    static Elements fromArray(ObjectReference o, ClassType k, String field, int size, int max) {
        Elements e = new Elements();
        e.size = Math.max(size, 0);
        if (size >= 0 && (max == 0 || size == 0)) return e;
        Value v = o.getValue(k.fieldByName(field));
        if (!(v instanceof ArrayReference)) return e;
        ArrayReference a = (ArrayReference) v;
        int length = a.length();
        if (size < 0) e.size = length;
        int take = Math.min(Math.min(e.size, max), length);
        if (take > 0) e.values.addAll(a.getValues(0, take));
        return e;
    }

    static Elements linked(ObjectReference o, ClassType k, int max) {
        Elements e = new Elements();
        e.size = intField(o, k, "size");
        Value node = o.getValue(k.fieldByName("first"));
        while (node instanceof ObjectReference && e.values.size() < Math.min(e.size, max)) {
            ObjectReference n = (ObjectReference) node;
            ReferenceType nt = n.referenceType();
            e.values.add(n.getValue(nt.fieldByName("item")));
            node = n.getValue(nt.fieldByName("next"));
        }
        return e;
    }

    static Elements list12(ObjectReference o, ClassType k, int max) {
        Value e0 = o.getValue(k.fieldByName("e0"));
        Value e1 = o.getValue(k.fieldByName("e1"));
        boolean single = e1 == null;
        if (!single) {
            // Newer JDKs mark "one element" with the shared object ImmutableCollections.EMPTY.
            for (ReferenceType t : vm.classesByName("java.util.ImmutableCollections")) {
                Field f = t.fieldByName("EMPTY");
                if (f != null && f.isStatic() && e1.equals(t.getValue(f))) single = true;
            }
        }
        Elements e = new Elements();
        e.size = single ? 1 : 2;
        if (max > 0) e.values.add(e0);
        if (max > 1 && !single) e.values.add(e1);
        return e;
    }

    // ------------------------------------------------------------------ text helpers

    static String quote(String s) {
        boolean cut = s.length() > MAX_STRING;
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < Math.min(s.length(), MAX_STRING); i++) escape(b, s.charAt(i), '"');
        b.append('"');
        if (cut) b.append('…');
        return b.toString();
    }

    static String charLiteral(char c) {
        StringBuilder b = new StringBuilder("'");
        escape(b, c, '\'');
        return b.append('\'').toString();
    }

    static void escape(StringBuilder b, char c, char quote) {
        switch (c) {
            case '\n': b.append("\\n"); break;
            case '\t': b.append("\\t"); break;
            case '\r': b.append("\\r"); break;
            case '\b': b.append("\\b"); break;
            case '\f': b.append("\\f"); break;
            case '\0': b.append("\\0"); break;
            case '\\': b.append("\\\\"); break;
            default:
                if (c == quote) b.append('\\').append(c);
                else if (c < 0x20 || c == 0x7f) b.append(String.format("\\u%04x", (int) c));
                else b.append(c);
        }
    }

    /** java.lang.String -> String, java.util.ArrayList<java.lang.String> -> ArrayList<String>. */
    static String typeName(String name) {
        return SHORT_PACKAGES.matcher(name).replaceAll("");
    }

    /** The declared type, with generics when the class file has them (ArrayList<Tier>). */
    static String typeOf(String typeName, String signature) {
        if (signature != null) {
            try {
                return typeName(parseSignature(signature, new int[] { 0 }));
            } catch (RuntimeException ignored) {
                // unexpected signature: use the erased type
            }
        }
        return typeName(typeName);
    }

    static String parseSignature(String s, int[] pos) {
        char c = s.charAt(pos[0]++);
        switch (c) {
            case 'B': return "byte";
            case 'C': return "char";
            case 'D': return "double";
            case 'F': return "float";
            case 'I': return "int";
            case 'J': return "long";
            case 'S': return "short";
            case 'Z': return "boolean";
            case 'V': return "void";
            case '[': return parseSignature(s, pos) + "[]";
            case '*': return "?";
            case '+': return "? extends " + parseSignature(s, pos);
            case '-': return "? super " + parseSignature(s, pos);
            case 'T': {
                int end = s.indexOf(';', pos[0]);
                String n = s.substring(pos[0], end);
                pos[0] = end + 1;
                return n;
            }
            case 'L': {
                StringBuilder b = new StringBuilder();
                while (true) {
                    char d = s.charAt(pos[0]++);
                    if (d == ';') return b.toString();
                    if (d == '/') {
                        b.append('.');
                    } else if (d == '<') {
                        b.append('<');
                        for (boolean first = true; s.charAt(pos[0]) != '>'; first = false) {
                            if (!first) b.append(", ");
                            b.append(parseSignature(s, pos));
                        }
                        pos[0]++;
                        b.append('>');
                    } else {
                        b.append(d);
                    }
                }
            }
            default:
                throw new IllegalArgumentException(s);
        }
    }

    static String simpleName(String name) {
        return name.substring(name.lastIndexOf('.') + 1);
    }

    static String packageOf(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(0, dot);
    }

    static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    // ------------------------------------------------------------------ protocol

    /** Lets the program run on without the debugger. */
    static void shutdown() {
        detaching = true;
        armed = null;
        try {
            erm.deleteAllBreakpoints();
            erm.deleteEventRequests(new ArrayList<>(erm.classPrepareRequests()));
            erm.deleteEventRequests(new ArrayList<>(erm.stepRequests()));
            erm.deleteEventRequests(new ArrayList<>(erm.methodEntryRequests()));
            if (startSet != null) startSet.resume();
            if (current != null) current.resume();
            for (ThreadReference t : waiting.keySet()) t.resume();
        } catch (VMDisconnectedException | ObjectCollectedException ignored) {
            // already gone
        }
        startSet = null;
        current = null;
        waiting.clear();
        stepping.clear();
        try {
            vm.dispose();
        } catch (VMDisconnectedException ignored) {
            // already gone
        }
    }

    static Map<String, Object> event(String name) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("event", name);
        return m;
    }

    static void error(String message) {
        Map<String, Object> m = event("error");
        m.put("message", message);
        send(m);
    }

    static void send(Map<String, Object> msg) {
        String s = Json.write(msg);
        synchronized (PROTO_LOCK) {
            proto.print(s);
            proto.print('\n');
            proto.flush();
        }
    }

    static void reply(Object id, Object result) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("ok", true);
        m.put("result", result);
        send(m);
    }

    static void replyError(Object id, Throwable t) {
        Map<String, Object> e = new LinkedHashMap<>();
        String message;
        if (t instanceof DebugError) message = t.getMessage();
        else if (t instanceof VMDisconnectedException) message = "the program has ended";
        else if (t instanceof ObjectCollectedException) message = "the object no longer exists";
        else if (t instanceof IncompatibleThreadStateException || t instanceof InvalidStackFrameException) message = "the thread is not paused";
        else message = t.toString();
        e.put("message", message);
        e.put("type", t.getClass().getSimpleName());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("ok", false);
        m.put("error", e);
        send(m);
    }

    static class DebugError extends Exception {
        DebugError(String message) {
            super(message);
        }
    }

    /** A small JSON reader and writer, the same as BlackJBench.Json. */
    static final class Json {
        private final String s;
        private int i = 0;

        private Json(String s) { this.s = s; }

        static Object parse(String s) {
            Json j = new Json(s);
            j.ws();
            return j.value();
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private Object value() {
            ws();
            char c = s.charAt(i);
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            return number();
        }

        private Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++;
            ws();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws();
                String k = string();
                ws();
                i++; // :
                m.put(k, value());
                ws();
                char c = s.charAt(i++);
                if (c == '}') return m;
            }
        }

        private List<Object> array() {
            List<Object> l = new ArrayList<>();
            i++;
            ws();
            if (s.charAt(i) == ']') { i++; return l; }
            while (true) {
                l.add(value());
                ws();
                char c = s.charAt(i++);
                if (c == ']') return l;
            }
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++;
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c == '\\') {
                    char n = s.charAt(i++);
                    switch (n) {
                        case 'n': b.append('\n'); break;
                        case 't': b.append('\t'); break;
                        case 'r': b.append('\r'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: b.append(n);
                    }
                } else b.append(c);
            }
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(start, i);
            if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
            return Long.parseLong(n);
        }

        static String write(Object o) {
            StringBuilder b = new StringBuilder();
            write(b, o);
            return b.toString();
        }

        @SuppressWarnings("unchecked")
        private static void write(StringBuilder b, Object o) {
            if (o == null) b.append("null");
            else if (o instanceof String) quote(b, (String) o);
            else if (o instanceof Boolean || o instanceof Long || o instanceof Integer) b.append(o);
            else if (o instanceof Number) {
                double d = ((Number) o).doubleValue();
                if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) b.append((long) d);
                else b.append(d);
            } else if (o instanceof Map) {
                b.append('{');
                boolean first = true;
                for (Map.Entry<String, Object> e : ((Map<String, Object>) o).entrySet()) {
                    if (!first) b.append(',');
                    first = false;
                    quote(b, e.getKey());
                    b.append(':');
                    write(b, e.getValue());
                }
                b.append('}');
            } else if (o instanceof List) {
                b.append('[');
                boolean first = true;
                for (Object v : (List<Object>) o) {
                    if (!first) b.append(',');
                    first = false;
                    write(b, v);
                }
                b.append(']');
            } else quote(b, String.valueOf(o));
        }

        private static void quote(StringBuilder b, String s) {
            b.append('"');
            for (int k = 0; k < s.length(); k++) {
                char c = s.charAt(k);
                switch (c) {
                    case '"': b.append("\\\""); break;
                    case '\\': b.append("\\\\"); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default:
                        if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
                        else b.append(c);
                }
            }
            b.append('"');
        }
    }
}
