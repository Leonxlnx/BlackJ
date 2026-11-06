import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.Type;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * BlackJ object bench runtime.
 *
 * Runs inside its own JVM. Reads one JSON request per line on stdin and answers one JSON
 * message per line on the real stdout. Everything the student's code prints goes through
 * System.out / System.err, which are redirected into "out" events, and System.in is fed by
 * "stdin" requests. Compiled with --release 11 so it runs on any JDK from 11 up.
 */
public class BlackJBench {

    static PrintStream proto;
    static final Object PROTO_LOCK = new Object();
    static PadLoader loader;
    static File classDir;
    static String classpath;

    static final Map<String, Object> bench = new LinkedHashMap<>();
    static final Map<String, Object> handles = new HashMap<>();
    static final IdentityHashMap<Object, String> handleOf = new IdentityHashMap<>();
    static int handleSeq = 0;

    static final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "main");
        t.setDaemon(true);
        return t;
    });
    static final ExecutorService helper = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "blackj-helper");
        t.setDaemon(true);
        return t;
    });
    static volatile boolean busy = false;
    static InputQueue input;
    static PrintStream userOut, userErr;
    static final Map<String, Boolean> projectClassCache = new HashMap<>();

    public static void main(String[] args) throws Exception {
        proto = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        userOut = new PrintStream(new EventStream("out"), true, "UTF-8");
        userErr = new PrintStream(new EventStream("err"), true, "UTF-8");
        System.setOut(userOut);
        System.setErr(userErr);
        input = new InputQueue();
        System.setIn(input);

        Thread flusher = new Thread(() -> {
            while (true) {
                try { Thread.sleep(40); } catch (InterruptedException e) { return; }
                userOut.flush();
                userErr.flush();
            }
        }, "blackj-flush");
        flusher.setDaemon(true);
        flusher.start();

        // args[0]: the compiled classes first, then libraries (+libs jars, JUnit), path-separator separated.
        classpath = args.length > 0 ? args[0] : ".";
        List<URL> urls = new ArrayList<>();
        for (String part : classpath.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            if (part.isEmpty()) continue;
            File f = new File(part).getAbsoluteFile();
            if (classDir == null) classDir = f;
            urls.add(f.toURI().toURL());
        }
        if (classDir == null) classDir = new File(".").getAbsoluteFile();
        loader = new PadLoader(urls.toArray(new URL[0]), BlackJBench.class.getClassLoader());

        Map<String, Object> ready = new LinkedHashMap<>();
        ready.put("event", "ready");
        ready.put("java", System.getProperty("java.version"));
        send(ready);

        BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(FileDescriptor.in), StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            handleLine(line);
        }
        System.exit(0);
    }

    // ------------------------------------------------------------------ dispatch

    @SuppressWarnings("unchecked")
    static void handleLine(String line) {
        Object id = null;
        try {
            Map<String, Object> req = (Map<String, Object>) Json.parse(line);
            id = req.get("id");
            String cmd = str(req.get("cmd"));
            switch (cmd) {
                case "stdin":
                    input.feed(str(req.get("text")).getBytes(StandardCharsets.UTF_8));
                    reply(id, null);
                    break;
                case "ping":
                    reply(id, "pong");
                    break;
                case "new":
                case "call":
                case "main":
                case "pad":
                    runUser(id, cmd, req);
                    break;
                case "inspectClass":
                    reply(id, inspectClass(str(req.get("className"))));
                    break;
                case "padReset":
                    padValues.clear();
                    padTypes.clear();
                    reply(id, null);
                    break;
                case "describe":
                    reply(id, describe(str(req.get("className"))));
                    break;
                case "inspect":
                    reply(id, inspect(str(req.get("ref"))));
                    break;
                case "store":
                    reply(id, store(str(req.get("ref")), (String) req.get("name")));
                    break;
                case "remove":
                    bench.remove(str(req.get("name")));
                    reply(id, listBench());
                    break;
                case "list":
                    reply(id, listBench());
                    break;
                default:
                    throw new BenchError("unknownCommand", "cmd", cmd);
            }
        } catch (Throwable t) {
            replyError(id, t);
        }
    }

    static void runUser(final Object id, final String cmd, final Map<String, Object> req) throws BenchError {
        if (busy) throw new BenchError("busy");
        busy = true;
        Map<String, Object> started = new LinkedHashMap<>();
        started.put("event", "running");
        started.put("running", true);
        send(started);
        worker.submit(() -> {
            Thread.currentThread().setContextClassLoader(loader);
            Object result = null;
            Throwable failure = null;
            try {
                if (cmd.equals("new")) result = doNew(req);
                else if (cmd.equals("call")) result = doCall(req);
                else if (cmd.equals("pad")) result = doPad(req);
                else result = doMain(req);
            } catch (Throwable t) {
                failure = t;
            } finally {
                busy = false;
                userOut.flush();
                userErr.flush();
            }
            if (failure != null) replyError(id, failure);
            else reply(id, result);
            Map<String, Object> idle = new LinkedHashMap<>();
            idle.put("event", "running");
            idle.put("running", false);
            send(idle);
        });
    }

    // ------------------------------------------------------------------ commands

    static final String[] LIBRARY_PACKAGES = { "java.lang.", "java.util.", "java.time.", "java.math.", "java.io.", "java.text.", "java.util.function." };

    /** A class by name; library classes may also be given by their simple name ("Math", "ArrayList"). */
    static Class<?> findClass(String name) throws ClassNotFoundException {
        try {
            return loader.loadClass(name);
        } catch (ClassNotFoundException e) {
            if (name.indexOf('.') >= 0) throw e;
            for (String p : LIBRARY_PACKAGES) {
                try {
                    return loader.loadClass(p + name);
                } catch (ClassNotFoundException ignored) { }
            }
            throw e;
        }
    }

    /** Like BlueJ's "Use Library Class": the public constructors and methods of a library class. */
    static Map<String, Object> describeLibrary(Class<?> c) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("name", c.getName());
        d.put("kind", kindOf(c));
        d.put("library", true);
        d.put("superclass", null);
        d.put("interfaces", new ArrayList<>());
        List<Object> ctors = new ArrayList<>();
        if (Modifier.isPublic(c.getModifiers()) && !c.isInterface() && !Modifier.isAbstract(c.getModifiers()) && !c.isEnum()) {
            Constructor<?>[] ks = c.getConstructors();
            Arrays.sort(ks, Comparator.comparingInt(Constructor::getParameterCount));
            for (Constructor<?> k : ks) {
                if (k.isSynthetic()) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", key("<init>", k.getParameterTypes()));
                m.put("name", c.getSimpleName());
                m.put("params", params(k.getParameters()));
                m.put("visibility", "public");
                ctors.add(m);
            }
        }
        d.put("constructors", ctors);
        Map<String, Method> byKey = new LinkedHashMap<>();
        for (Method m : c.getMethods()) {
            if (m.isSynthetic() && !m.isBridge()) continue;
            if (m.getDeclaringClass() == Object.class && !(m.getName().equals("toString") || m.getName().equals("equals") || m.getName().equals("hashCode"))) continue;
            String k = key(m.getName(), m.getParameterTypes());
            Method prev = byKey.get(k);
            // Keep the real method over a compiler bridge, and the most specific return type.
            if (prev == null || (prev.isBridge() && !m.isBridge())
                    || (prev.isBridge() == m.isBridge() && prev.getReturnType() != m.getReturnType() && prev.getReturnType().isAssignableFrom(m.getReturnType()))) {
                byKey.put(k, m);
            }
        }
        List<Method> sorted = new ArrayList<>(byKey.values());
        sorted.sort(Comparator.comparing(Method::getName).thenComparingInt(Method::getParameterCount));
        List<Object> methods = new ArrayList<>();
        for (Method m : sorted) methods.add(methodInfo(m, m.getDeclaringClass() != c && !m.isBridge()));
        d.put("methods", methods);
        return d;
    }

    /** A method the bench may call: inside a closed module, the same method seen through a public type. */
    static Method accessible(Method m, Class<?> c) {
        try {
            m.setAccessible(true);
            return m;
        } catch (RuntimeException closed) { /* module boundary */ }
        Deque<Class<?>> todo = new ArrayDeque<>();
        Set<Class<?>> seen = new HashSet<>();
        todo.add(c);
        while (!todo.isEmpty()) {
            Class<?> k = todo.poll();
            if (!seen.add(k)) continue;
            if (Modifier.isPublic(k.getModifiers())) {
                try {
                    Method p = k.getMethod(m.getName(), m.getParameterTypes());
                    if (Modifier.isPublic(p.getDeclaringClass().getModifiers())) return p;
                } catch (NoSuchMethodException ignored) { }
            }
            if (k.getSuperclass() != null) todo.add(k.getSuperclass());
            todo.addAll(Arrays.asList(k.getInterfaces()));
        }
        return m;
    }

    static Map<String, Object> describe(String className) throws Exception {
        Class<?> c = findClass(className);
        if (!isProjectClass(c)) return describeLibrary(c);
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("name", c.getName());
        d.put("kind", kindOf(c));
        d.put("superclass", c.getSuperclass() != null && isProjectClass(c.getSuperclass()) ? c.getSuperclass().getName() : null);
        List<Object> ifaces = new ArrayList<>();
        for (Class<?> i : c.getInterfaces()) ifaces.add(i.getName());
        d.put("interfaces", ifaces);

        List<Object> ctors = new ArrayList<>();
        if (!c.isInterface() && !Modifier.isAbstract(c.getModifiers()) && !c.isEnum()) {
            for (Constructor<?> k : c.getDeclaredConstructors()) {
                if (Modifier.isPrivate(k.getModifiers()) || k.isSynthetic()) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", key("<init>", k.getParameterTypes()));
                m.put("name", c.getSimpleName());
                m.put("params", params(k.getParameters()));
                m.put("visibility", visibility(k.getModifiers()));
                ctors.add(m);
            }
        }
        d.put("constructors", ctors);

        List<Object> methods = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            if (k != c && !isProjectClass(k)) break;
            for (Method m : k.getDeclaredMethods()) {
                if (m.isSynthetic() || m.isBridge() || Modifier.isPrivate(m.getModifiers())) continue;
                if (c.isEnum() && k == c && (m.getName().equals("values") || m.getName().equals("valueOf")) && Modifier.isStatic(m.getModifiers())) continue;
                String sig = key(m.getName(), m.getParameterTypes());
                if (!seen.add(sig)) continue;
                methods.add(methodInfo(m, k != c));
            }
        }
        for (String name : new String[] { "toString", "equals", "hashCode" }) {
            try {
                Method m = name.equals("equals") ? Object.class.getMethod(name, Object.class) : Object.class.getMethod(name);
                if (seen.add(key(m.getName(), m.getParameterTypes()))) methods.add(methodInfo(m, true));
            } catch (NoSuchMethodException ignored) { }
        }
        d.put("methods", methods);
        return d;
    }

    static Map<String, Object> methodInfo(Method m, boolean inherited) {
        Map<String, Object> mi = new LinkedHashMap<>();
        mi.put("key", key(m.getName(), m.getParameterTypes()));
        mi.put("name", m.getName());
        mi.put("returnType", typeName(m.getGenericReturnType()));
        mi.put("params", params(m.getParameters()));
        mi.put("static", Modifier.isStatic(m.getModifiers()));
        mi.put("abstract", Modifier.isAbstract(m.getModifiers()));
        mi.put("visibility", visibility(m.getModifiers()));
        mi.put("declaringClass", m.getDeclaringClass().getName());
        mi.put("inherited", inherited);
        return mi;
    }

    static List<Object> params(Parameter[] ps) {
        List<Object> out = new ArrayList<>();
        for (Parameter p : ps) {
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("name", p.isNamePresent() ? p.getName() : p.getName());
            pm.put("type", typeName(p.getParameterizedType()));
            pm.put("raw", p.getType().getName());
            pm.put("category", category(p.getType()));
            out.add(pm);
        }
        return out;
    }

    static Object doNew(Map<String, Object> req) throws Throwable {
        Class<?> c = findClass(str(req.get("className")));
        if (c.isInterface()) throw new BenchError("interface", "type", c.getSimpleName());
        if (Modifier.isAbstract(c.getModifiers())) throw new BenchError("abstractClass", "type", c.getSimpleName());
        String wanted = str(req.get("key"));
        Constructor<?> ctor = null;
        for (Constructor<?> k : c.getDeclaredConstructors()) {
            if (key("<init>", k.getParameterTypes()).equals(wanted)) ctor = k;
        }
        if (ctor == null) throw new BenchError("notFound", "name", wanted);
        try {
            ctor.setAccessible(true);
        } catch (RuntimeException closed) { /* public library constructor: callable as it is */ }
        Object[] args = convertArgs(ctor.getParameters(), req.get("args"));
        String name = benchName((String) req.get("name"), c);
        Object o;
        try {
            o = ctor.newInstance(args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        bench.put(name, o);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("name", name);
        r.put("value", repr(o, c));
        r.put("bench", listBench());
        return r;
    }

    static Object doCall(Map<String, Object> req) throws Throwable {
        Object target = null;
        Class<?> c;
        String ref = (String) req.get("target");
        if (ref != null) {
            target = resolve(ref);
            c = target.getClass();
        } else {
            c = findClass(str(req.get("className")));
        }
        String wanted = str(req.get("key"));
        Method method = findMethod(c, wanted);
        if (method == null) throw new BenchError("notFound", "name", wanted);
        method = accessible(method, c);
        Object[] args = convertArgs(method.getParameters(), req.get("args"));
        Object result;
        try {
            result = method.invoke(Modifier.isStatic(method.getModifiers()) ? null : target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        Map<String, Object> r = new LinkedHashMap<>();
        boolean isVoid = method.getReturnType() == void.class;
        r.put("void", isVoid);
        r.put("type", typeName(method.getGenericReturnType()));
        r.put("value", isVoid ? null : repr(result, method.getReturnType()));
        r.put("bench", listBench());
        return r;
    }

    static Object doMain(Map<String, Object> req) throws Throwable {
        Class<?> c = loader.loadClass(str(req.get("className")));
        Method m;
        try {
            m = c.getDeclaredMethod("main", String[].class);
        } catch (NoSuchMethodException e) {
            throw new BenchError("noMain", "type", c.getSimpleName());
        }
        if (!Modifier.isStatic(m.getModifiers())) throw new BenchError("noMain", "type", c.getSimpleName());
        m.setAccessible(true);
        List<String> args = new ArrayList<>();
        if (req.get("args") instanceof List) for (Object a : (List<?>) req.get("args")) args.add(String.valueOf(a));
        try {
            m.invoke(null, (Object) args.toArray(new String[0]));
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("void", true);
        r.put("bench", listBench());
        return r;
    }

    static Map<String, Object> inspect(String ref) throws Exception {
        Object o = resolve(ref);
        Class<?> c = o.getClass();
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ref", ref);
        r.put("value", repr(o, c));
        r.put("type", typeName(c));
        if (c.isArray()) {
            int n = Array.getLength(o);
            List<Object> items = new ArrayList<>();
            for (int i = 0; i < Math.min(n, 200); i++) {
                Map<String, Object> it = new LinkedHashMap<>();
                it.put("name", "[" + i + "]");
                it.put("type", typeName(c.getComponentType()));
                it.put("value", repr(Array.get(o, i), c.getComponentType()));
                items.add(it);
            }
            r.put("length", n);
            r.put("items", items);
            return r;
        }
        if (!isProjectClass(c)) {
            if (o instanceof Collection) {
                Collection<?> col = (Collection<?>) o;
                List<Object> items = new ArrayList<>();
                int i = 0;
                for (Object e : col) {
                    if (i >= 200) break;
                    Map<String, Object> it = new LinkedHashMap<>();
                    it.put("name", "[" + i + "]");
                    it.put("type", e == null ? "Object" : typeName(e.getClass()));
                    it.put("value", repr(e, e == null ? Object.class : e.getClass()));
                    items.add(it);
                    i++;
                }
                r.put("length", col.size());
                r.put("items", items);
            } else if (o instanceof Map) {
                Map<?, ?> map = (Map<?, ?>) o;
                List<Object> items = new ArrayList<>();
                int i = 0;
                for (Map.Entry<?, ?> e : map.entrySet()) {
                    if (i >= 200) break;
                    Map<String, Object> it = new LinkedHashMap<>();
                    it.put("name", String.valueOf(e.getKey()));
                    Object v = e.getValue();
                    it.put("type", v == null ? "Object" : typeName(v.getClass()));
                    it.put("value", repr(v, v == null ? Object.class : v.getClass()));
                    items.add(it);
                    i++;
                }
                r.put("length", map.size());
                r.put("items", items);
            }
            return r;
        }
        List<Object> fields = new ArrayList<>();
        List<Object> statics = new ArrayList<>();
        List<Class<?>> chain = new ArrayList<>();
        for (Class<?> k = c; k != null && k != Object.class && isProjectClass(k); k = k.getSuperclass()) chain.add(0, k);
        for (Class<?> k : chain) {
            for (Field f : k.getDeclaredFields()) {
                if (f.isSynthetic()) continue;
                boolean isStatic = Modifier.isStatic(f.getModifiers());
                if (k.isEnum() && f.isEnumConstant()) continue;
                Map<String, Object> fi = new LinkedHashMap<>();
                fi.put("name", f.getName());
                fi.put("type", typeName(f.getGenericType()));
                fi.put("declaredIn", k.getSimpleName());
                fi.put("visibility", visibility(f.getModifiers()));
                fi.put("final", Modifier.isFinal(f.getModifiers()));
                try {
                    f.setAccessible(true);
                    fi.put("value", repr(f.get(isStatic ? null : o), f.getType()));
                } catch (Throwable t) {
                    fi.put("value", null);
                }
                (isStatic ? statics : fields).add(fi);
            }
        }
        r.put("fields", fields);
        r.put("statics", statics);
        return r;
    }

    static Object store(String ref, String name) throws Exception {
        Object o = resolve(ref);
        String n = benchName(name, o.getClass());
        bench.put(n, o);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("name", n);
        r.put("bench", listBench());
        return r;
    }

    static List<Object> listBench() {
        List<Object> out = new ArrayList<>();
        for (Map.Entry<String, Object> e : bench.entrySet()) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("name", e.getKey());
            Object o = e.getValue();
            b.put("type", o == null ? "null" : typeName(o.getClass()));
            b.put("className", o == null ? null : o.getClass().getName());
            b.put("value", repr(o, o == null ? Object.class : o.getClass()));
            if (o != null && isProjectClass(o.getClass())) b.put("preview", preview(o));
            out.add(b);
        }
        return out;
    }

    /** The first few instance fields with their values, shown on the object's card. */
    static List<Object> preview(Object o) {
        List<Object> out = new ArrayList<>();
        List<Class<?>> chain = new ArrayList<>();
        for (Class<?> k = o.getClass(); k != null && isProjectClass(k); k = k.getSuperclass()) chain.add(0, k);
        for (Class<?> k : chain) {
            for (Field f : k.getDeclaredFields()) {
                if (f.isSynthetic() || Modifier.isStatic(f.getModifiers())) continue;
                if (out.size() >= 4) return out;
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("name", f.getName());
                try {
                    f.setAccessible(true);
                    Map<String, Object> v = repr(f.get(o), f.getType());
                    String text = v.get("kind").equals("string") ? "\"" + v.get("text") + "\"" : v.get("text") != null ? String.valueOf(v.get("text")) : String.valueOf(v.get("type"));
                    if (v.get("length") != null && !v.get("kind").equals("array")) text = v.get("type") + " (" + v.get("length") + ")";
                    p.put("text", text.length() > 40 ? text.substring(0, 40) + "…" : text);
                } catch (Throwable t) {
                    p.put("text", "?");
                }
                out.add(p);
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ arguments

    @SuppressWarnings("unchecked")
    static Object[] convertArgs(Parameter[] ps, Object rawArgs) throws Exception {
        List<Object> args = rawArgs == null ? new ArrayList<>() : (List<Object>) rawArgs;
        if (args.size() != ps.length) throw new BenchError("argCount", "expected", String.valueOf(ps.length));
        Object[] out = new Object[ps.length];
        for (int i = 0; i < ps.length; i++) {
            Map<String, Object> spec = (Map<String, Object>) args.get(i);
            out[i] = convertArg(ps[i].getType(), ps[i].getName(), spec);
        }
        return out;
    }

    static Object convertArg(Class<?> t, String pname, Map<String, Object> spec) throws Exception {
        String kind = str(spec.get("kind"));
        if (kind.equals("ref")) {
            Object o = resolve(str(spec.get("name")));
            if (o != null && !wrap(t).isInstance(o)) throw new BenchError("argWrongType", "param", pname, "type", typeName(t), "value", str(spec.get("name")));
            return o;
        }
        String raw = str(spec.get("text"));
        String s = raw.trim();
        if (s.isEmpty() && t != String.class) throw new BenchError("argEmpty", "param", pname, "type", typeName(t));
        if (s.equals("null") && !t.isPrimitive()) return null;
        return parseValue(t, pname, s, raw);
    }

    static Object parseValue(Class<?> t, String pname, String s, String raw) throws Exception {
        Class<?> w = wrap(t);
        try {
            if (w == Integer.class) return Integer.parseInt(s.replace("_", ""));
            if (w == Long.class) return Long.parseLong(stripSuffix(s.replace("_", ""), "lL"));
            if (w == Short.class) return Short.parseShort(s);
            if (w == Byte.class) return Byte.parseByte(s);
        } catch (NumberFormatException e) {
            throw new BenchError("argInt", "param", pname, "type", typeName(t), "value", s);
        }
        try {
            if (w == Double.class) return Double.parseDouble(stripSuffix(s.replace(',', '.').replace("_", ""), "dD"));
            if (w == Float.class) return Float.parseFloat(stripSuffix(s.replace(',', '.').replace("_", ""), "fF"));
        } catch (NumberFormatException e) {
            throw new BenchError("argDecimal", "param", pname, "type", typeName(t), "value", s);
        }
        if (w == Boolean.class) {
            String l = s.toLowerCase();
            if (l.equals("true") || l.equals("wahr")) return Boolean.TRUE;
            if (l.equals("false") || l.equals("falsch")) return Boolean.FALSE;
            throw new BenchError("argBool", "param", pname, "value", s);
        }
        if (w == Character.class) {
            String v = s;
            if (v.length() >= 3 && v.startsWith("'") && v.endsWith("'")) v = unescape(v.substring(1, v.length() - 1));
            if (v.length() == 1) return v.charAt(0);
            throw new BenchError("argChar", "param", pname, "value", s);
        }
        if (t == String.class || t == CharSequence.class || t == Object.class && s.startsWith("\"")) {
            if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) return unescape(s.substring(1, s.length() - 1));
            return raw;
        }
        if (t.isEnum()) {
            String v = s.contains(".") ? s.substring(s.lastIndexOf('.') + 1) : s;
            for (Object constant : t.getEnumConstants()) {
                if (((Enum<?>) constant).name().equals(v)) return constant;
            }
            throw new BenchError("argEnum", "param", pname, "type", t.getSimpleName(), "value", s);
        }
        if (t.isArray()) {
            String inner = s;
            if ((inner.startsWith("{") && inner.endsWith("}")) || (inner.startsWith("[") && inner.endsWith("]"))) inner = inner.substring(1, inner.length() - 1);
            List<String> parts = splitTopLevel(inner);
            Object arr = Array.newInstance(t.getComponentType(), parts.size());
            for (int i = 0; i < parts.size(); i++) {
                String p = parts.get(i).trim();
                Object v = p.equals("null") && !t.getComponentType().isPrimitive() ? null : parseValue(t.getComponentType(), pname + "[" + i + "]", p, p);
                Array.set(arr, i, v);
            }
            return arr;
        }
        if (bench.containsKey(s)) {
            Object o = bench.get(s);
            if (o == null || w.isInstance(o)) return o;
            throw new BenchError("argWrongType", "param", pname, "type", typeName(t), "value", s);
        }
        throw new BenchError("argObject", "param", pname, "type", typeName(t), "value", s);
    }

    static List<String> splitTopLevel(String s) {
        List<String> out = new ArrayList<>();
        if (s.trim().isEmpty()) return out;
        StringBuilder cur = new StringBuilder();
        boolean inStr = false, inChar = false;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && (inStr || inChar) && i + 1 < s.length()) { cur.append(ch).append(s.charAt(++i)); continue; }
            if (ch == '"' && !inChar) inStr = !inStr;
            if (ch == '\'' && !inStr) inChar = !inChar;
            if (ch == ',' && !inStr && !inChar) { out.add(cur.toString()); cur.setLength(0); continue; }
            cur.append(ch);
        }
        out.add(cur.toString());
        return out;
    }

    static String stripSuffix(String s, String suffixes) {
        if (!s.isEmpty() && suffixes.indexOf(s.charAt(s.length() - 1)) >= 0) return s.substring(0, s.length() - 1);
        return s;
    }

    static String unescape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                switch (n) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case '0': b.append('\0'); break;
                    default: b.append(n);
                }
            } else b.append(ch);
        }
        return b.toString();
    }

    static String benchName(String wanted, Class<?> c) throws BenchError {
        if (wanted != null && !wanted.trim().isEmpty()) {
            String n = wanted.trim();
            if (!isIdentifier(n)) throw new BenchError("nameInvalid", "name", n);
            if (bench.containsKey(n)) throw new BenchError("nameTaken", "name", n);
            return n;
        }
        String base = c.getSimpleName();
        if (base.isEmpty()) base = "objekt";
        base = Character.toLowerCase(base.charAt(0)) + base.substring(1);
        for (int i = 1; ; i++) {
            if (!bench.containsKey(base + i)) return base + i;
        }
    }

    static boolean isIdentifier(String s) {
        if (s.isEmpty() || !Character.isJavaIdentifierStart(s.charAt(0))) return false;
        for (int i = 1; i < s.length(); i++) if (!Character.isJavaIdentifierPart(s.charAt(i))) return false;
        return true;
    }

    // ------------------------------------------------------------------ class inspector

    static Map<String, Object> inspectClass(String className) throws Exception {
        Class<?> c = Class.forName(className, true, loader);
        List<Object> statics = new ArrayList<>();
        for (Field f : c.getDeclaredFields()) {
            if (f.isSynthetic() || !Modifier.isStatic(f.getModifiers()) || (c.isEnum() && f.isEnumConstant())) continue;
            Map<String, Object> fi = new LinkedHashMap<>();
            fi.put("name", f.getName());
            fi.put("type", typeName(f.getGenericType()));
            fi.put("declaredIn", c.getSimpleName());
            fi.put("visibility", visibility(f.getModifiers()));
            fi.put("final", Modifier.isFinal(f.getModifiers()));
            try {
                f.setAccessible(true);
                fi.put("value", repr(f.get(null), f.getType()));
            } catch (Throwable t) {
                fi.put("value", null);
            }
            statics.add(fi);
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ref", className);
        r.put("type", typeName(c));
        r.put("isClass", true);
        r.put("fields", new ArrayList<>());
        r.put("statics", statics);
        return r;
    }

    // ------------------------------------------------------------------ code pad
    //
    // Like BlueJ's code pad: an expression shows its value, statements run, and variables
    // declared here stay available for the next line. Each input is compiled in memory into a
    // tiny class in the default package and loaded by the same loader as the student's classes,
    // so even package-private classes work. Objects on the bench can be used by their name.

    static final Map<String, Object> padValues = new LinkedHashMap<>();
    static final Map<String, String> padTypes = new LinkedHashMap<>();
    static int padSeq = 0;
    static boolean padHas;
    static Object padValue;
    static String padType;
    static javax.tools.JavaCompiler padCompiler;
    static javax.tools.StandardJavaFileManager padFiles;

    public static Object padGet(String name) { return padValues.containsKey(name) ? padValues.get(name) : bench.get(name); }
    public static void padPut(String name, Object value) { padValues.put(name, value); }
    static void noteValue(Object v, String type) { padHas = true; padValue = v; padType = type; }
    public static void padNote(Object v) { noteValue(v, null); }
    public static void padNote(int v) { noteValue(v, "int"); }
    public static void padNote(long v) { noteValue(v, "long"); }
    public static void padNote(double v) { noteValue(v, "double"); }
    public static void padNote(float v) { noteValue(v, "float"); }
    public static void padNote(boolean v) { noteValue(v, "boolean"); }
    public static void padNote(char v) { noteValue(v, "char"); }
    public static void padNote(short v) { noteValue(v, "short"); }
    public static void padNote(byte v) { noteValue(v, "byte"); }

    static final java.util.regex.Pattern DECL = java.util.regex.Pattern.compile(
            "^\\s*(?:final\\s+)?([A-Za-z_$][\\w$.]*(?:\\s*<[^;=()]*>)?(?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_$][\\w$]*)\\s*=");
    static final Set<String> NOT_TYPES = new HashSet<>(java.util.Arrays.asList(
            "return", "new", "throw", "else", "case", "package", "import", "break", "continue", "yield", "assert", "do", "goto", "instanceof"));
    static final Map<String, String> WRAPPERS = new HashMap<>();
    static {
        WRAPPERS.put("int", "Integer"); WRAPPERS.put("long", "Long"); WRAPPERS.put("double", "Double"); WRAPPERS.put("float", "Float");
        WRAPPERS.put("boolean", "Boolean"); WRAPPERS.put("char", "Character"); WRAPPERS.put("short", "Short"); WRAPPERS.put("byte", "Byte");
    }

    static Map<String, Object> doPad(Map<String, Object> req) throws Throwable {
        String code = str(req.get("code")).trim();
        while (code.endsWith(";;")) code = code.substring(0, code.length() - 1);
        Map<String, Object> r = new LinkedHashMap<>();
        if (code.isEmpty()) {
            r.put("kind", "done");
            return r;
        }
        if (padCompiler == null) {
            padCompiler = javax.tools.ToolProvider.getSystemJavaCompiler();
            if (padCompiler == null) throw new BenchError("noCompiler");
            padFiles = padCompiler.getStandardFileManager(null, java.util.Locale.ENGLISH, StandardCharsets.UTF_8);
        }
        // New declarations in this input: "int x = 5;" or "Hund h = new Hund(...);" at the top level.
        Map<String, String> declared = new LinkedHashMap<>();
        for (String stmt : splitTopLevel(code, ';')) {
            java.util.regex.Matcher m = DECL.matcher(stmt);
            if (m.find() && !NOT_TYPES.contains(m.group(1))) declared.put(m.group(2), m.group(1).replaceAll("\\s+", " "));
        }
        boolean looksLikeStatement = code.endsWith(";") || code.endsWith("}") || !declared.isEmpty();
        List<Object> exprErrors = null;
        if (!looksLikeStatement) {
            Object res = padRun(code, true, declared, r);
            if (res != null) return r;
            exprErrors = castList(r.remove("diagnostics"));
        }
        String stmtCode = code.endsWith(";") || code.endsWith("}") ? code : code + ";";
        Object res = padRun(stmtCode, false, declared, r);
        if (res != null) return r;
        List<Object> stmtErrors = castList(r.get("diagnostics"));
        if (exprErrors != null && !exprErrors.isEmpty() && Json.write(stmtErrors).contains("not a statement")) r.put("diagnostics", exprErrors);
        r.put("kind", "error");
        return r;
    }

    @SuppressWarnings("unchecked")
    static List<Object> castList(Object o) { return o == null ? new ArrayList<>() : (List<Object>) o; }

    static List<String> splitTopLevel(String s, char sep) {
        List<String> out = new ArrayList<>();
        int depth = 0;
        boolean inStr = false, inChar = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if ((inStr || inChar) && ch == '\\' && i + 1 < s.length()) { cur.append(ch).append(s.charAt(++i)); continue; }
            if (ch == '"' && !inChar) inStr = !inStr;
            else if (ch == '\'' && !inStr) inChar = !inChar;
            else if (!inStr && !inChar) {
                if (ch == '(' || ch == '{' || ch == '[') depth++;
                else if (ch == ')' || ch == '}' || ch == ']') depth--;
                else if (ch == sep && depth == 0) { out.add(cur.toString()); cur.setLength(0); continue; }
            }
            cur.append(ch);
        }
        if (cur.toString().trim().length() > 0) out.add(cur.toString());
        return out;
    }

    /** Compiles and runs one pad input. Returns non-null when it ran (r filled), null on compile errors. */
    static Object padRun(String code, boolean expression, Map<String, String> declared, Map<String, Object> r) throws Throwable {
        String cls = "__BlackJPad" + (++padSeq);
        List<String> prelude = new ArrayList<>();
        List<String> writeBack = new ArrayList<>();
        for (Map.Entry<String, Object> e : bench.entrySet()) {
            String n = e.getKey();
            if (padTypes.containsKey(n) || declared.containsKey(n) || e.getValue() == null) continue;
            String t = sourceType(e.getValue().getClass());
            prelude.add(t + " " + n + " = (" + t + ") BlackJBench.padGet(\"" + n + "\");");
        }
        for (Map.Entry<String, String> e : padTypes.entrySet()) {
            String n = e.getKey();
            if (declared.containsKey(n)) continue;
            String t = e.getValue();
            String cast = WRAPPERS.containsKey(t) ? WRAPPERS.get(t) : t;
            prelude.add(t + " " + n + " = (" + cast + ") BlackJBench.padGet(\"" + n + "\");");
            writeBack.add("BlackJBench.padPut(\"" + n + "\", " + n + ");");
        }
        for (String n : declared.keySet()) writeBack.add("BlackJBench.padPut(\"" + n + "\", " + n + ");");
        StringBuilder src = new StringBuilder();
        src.append("@SuppressWarnings({\"unchecked\", \"rawtypes\"}) public class ").append(cls).append(" {\n");
        src.append("public static void __run() throws Throwable {\n");
        for (String p : prelude) src.append(p).append('\n');
        int userStart = 3 + prelude.size();
        if (expression) {
            src.append("var __r = (").append(code).append(");\n");
            for (String w : writeBack) src.append(w).append('\n');
            src.append("BlackJBench.padNote(__r);\n");
        } else {
            src.append(code).append('\n');
            for (String w : writeBack) src.append(w).append('\n');
        }
        src.append("}\n}\n");

        javax.tools.DiagnosticCollector<javax.tools.JavaFileObject> diags = new javax.tools.DiagnosticCollector<>();
        MemManager mem = new MemManager(padFiles);
        String cp = classpath + File.pathSeparator + System.getProperty("java.class.path");
        List<String> opts = java.util.Arrays.asList("-classpath", cp, "-encoding", "UTF-8", "-g", "-proc:none", "-nowarn", "-Xlint:none");
        // javac localises its messages from the default locale; the explanations need English.
        java.util.Locale previous = java.util.Locale.getDefault();
        boolean ok;
        try {
            java.util.Locale.setDefault(java.util.Locale.ENGLISH);
            ok = padCompiler.getTask(null, mem, diags, opts, null, java.util.Collections.singletonList(new MemSource(cls, src.toString()))).call();
        } finally {
            java.util.Locale.setDefault(previous);
        }
        if (!ok) {
            List<Object> list = new ArrayList<>();
            int userLines = code.split("\n", -1).length;
            for (javax.tools.Diagnostic<? extends javax.tools.JavaFileObject> d : diags.getDiagnostics()) {
                if (d.getKind() != javax.tools.Diagnostic.Kind.ERROR) continue;
                Map<String, Object> dm = new LinkedHashMap<>();
                long line = d.getLineNumber() - userStart + 1;
                long col = d.getColumnNumber() - (expression && line == 1 ? "var __r = (".length() : 0);
                dm.put("line", line >= 1 && line <= userLines ? line : 1);
                dm.put("column", Math.max(1, col));
                StringBuilder msg = new StringBuilder();
                for (String part : d.getMessage(java.util.Locale.ENGLISH).split("\n")) {
                    if (part.contains("__BlackJPad")) continue;
                    if (msg.length() > 0) msg.append('\n');
                    msg.append(part);
                }
                dm.put("message", msg.toString());
                list.add(dm);
            }
            r.put("diagnostics", list);
            return null;
        }
        Map<String, byte[]> classes = new LinkedHashMap<>();
        for (Map.Entry<String, MemOut> e : mem.out.entrySet()) classes.put(e.getKey(), e.getValue().bytes.toByteArray());
        loader.add(classes);
        padHas = false;
        padValue = null;
        padType = null;
        Method run = loader.loadClass(cls).getMethod("__run");
        try {
            run.invoke(null);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
        for (Map.Entry<String, String> e : declared.entrySet()) {
            String t = e.getValue();
            if (t.equals("var")) {
                Object v = padValues.get(e.getKey());
                t = v == null ? "Object" : sourceType(v.getClass());
            }
            padTypes.put(e.getKey(), t);
        }
        if (expression && padHas) {
            r.put("kind", "value");
            Class<?> prim = primitiveClass(padType);
            r.put("type", padType != null ? padType : padValue == null ? "null" : typeName(padValue.getClass()));
            r.put("value", repr(padValue, prim != null ? prim : padValue == null ? Object.class : padValue.getClass()));
        } else {
            r.put("kind", "done");
        }
        r.put("vars", listPadVars());
        r.put("bench", listBench());
        return r;
    }

    static List<Object> listPadVars() {
        List<Object> out = new ArrayList<>();
        for (Map.Entry<String, String> e : padTypes.entrySet()) {
            Map<String, Object> v = new LinkedHashMap<>();
            Object val = padValues.get(e.getKey());
            Class<?> prim = primitiveClass(e.getValue());
            v.put("name", e.getKey());
            v.put("type", e.getValue());
            v.put("value", repr(val, prim != null ? prim : val == null ? Object.class : val.getClass()));
            out.add(v);
        }
        return out;
    }

    static Class<?> primitiveClass(String t) {
        if (t == null) return null;
        switch (t) {
            case "int": return int.class;
            case "long": return long.class;
            case "double": return double.class;
            case "float": return float.class;
            case "boolean": return boolean.class;
            case "char": return char.class;
            case "short": return short.class;
            case "byte": return byte.class;
            default: return null;
        }
    }

    /** The type to declare a bench object with in pad code: its class, or the nearest accessible parent. */
    static String sourceType(Class<?> c) {
        while (c != null && (c.isAnonymousClass() || c.isLocalClass() || !(Modifier.isPublic(c.getModifiers()) || isProjectClass(c)))) c = c.getSuperclass();
        if (c == null) return "Object";
        String n = c.getCanonicalName();
        return n == null ? "Object" : n;
    }

    static class PadLoader extends URLClassLoader {
        private final Map<String, byte[]> extra = new HashMap<>();
        PadLoader(URL[] urls, ClassLoader parent) { super(urls, parent); }
        synchronized void add(Map<String, byte[]> classes) { extra.putAll(classes); }
        @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
            byte[] b;
            synchronized (this) { b = extra.remove(name); }
            if (b != null) return defineClass(name, b, 0, b.length);
            return super.findClass(name);
        }
    }

    static class MemSource extends javax.tools.SimpleJavaFileObject {
        final String code;
        MemSource(String name, String code) {
            super(java.net.URI.create("string:///" + name + ".java"), Kind.SOURCE);
            this.code = code;
        }
        @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) { return code; }
    }

    static class MemOut extends javax.tools.SimpleJavaFileObject {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        MemOut(String name) { super(java.net.URI.create("mem:///" + name.replace('.', '/') + ".class"), Kind.CLASS); }
        @Override public OutputStream openOutputStream() { return bytes; }
    }

    static class MemManager extends javax.tools.ForwardingJavaFileManager<javax.tools.StandardJavaFileManager> {
        final Map<String, MemOut> out = new LinkedHashMap<>();
        MemManager(javax.tools.StandardJavaFileManager m) { super(m); }
        @Override public javax.tools.JavaFileObject getJavaFileForOutput(Location location, String className, javax.tools.JavaFileObject.Kind kind, javax.tools.FileObject sibling) {
            MemOut o = new MemOut(className);
            out.put(className, o);
            return o;
        }
    }

    // ------------------------------------------------------------------ values

    static Object resolve(String ref) throws BenchError {
        if (bench.containsKey(ref)) return bench.get(ref);
        if (handles.containsKey(ref)) return handles.get(ref);
        throw new BenchError("noObject", "name", ref);
    }

    static String handle(Object o) {
        String h = handleOf.get(o);
        if (h == null) {
            h = "#" + (++handleSeq);
            handleOf.put(o, h);
            handles.put(h, o);
        }
        return h;
    }

    static Map<String, Object> repr(Object v, Class<?> declared) {
        Map<String, Object> r = new LinkedHashMap<>();
        if (v == null) {
            r.put("kind", "null");
            r.put("text", "null");
            return r;
        }
        Class<?> c = v.getClass();
        if (c == Character.class) {
            r.put("kind", "prim");
            r.put("type", declared.isPrimitive() ? declared.getName() : "Character");
            r.put("text", "'" + v + "'");
            return r;
        }
        if (v instanceof Number || v instanceof Boolean) {
            r.put("kind", "prim");
            r.put("type", declared.isPrimitive() ? declared.getName() : c.getSimpleName());
            r.put("text", String.valueOf(v));
            return r;
        }
        if (v instanceof String) {
            String s = (String) v;
            r.put("kind", "string");
            r.put("type", "String");
            r.put("text", s.length() > 4000 ? s.substring(0, 4000) + "…" : s);
            return r;
        }
        if (c.isEnum() || (c.getSuperclass() != null && c.getSuperclass().isEnum())) {
            r.put("kind", "enum");
            r.put("type", typeName(declared.isEnum() ? declared : c.getSuperclass().isEnum() ? c.getSuperclass() : c));
            r.put("text", ((Enum<?>) v).name());
            r.put("handle", handle(v));
            return r;
        }
        if (c.isArray()) {
            r.put("kind", "array");
            r.put("type", typeName(c));
            r.put("length", Array.getLength(v));
            r.put("handle", handle(v));
            r.put("text", typeName(c.getComponentType()) + "[" + Array.getLength(v) + "]");
            return r;
        }
        r.put("kind", "object");
        r.put("type", typeName(c));
        r.put("className", c.getName());
        r.put("project", isProjectClass(c));
        r.put("handle", handle(v));
        if (v instanceof Collection) r.put("length", ((Collection<?>) v).size());
        if (v instanceof Map) r.put("length", ((Map<?, ?>) v).size());
        String text = overridesToString(c) ? safeToString(v) : null;
        if (text != null) r.put("text", text.length() > 300 ? text.substring(0, 300) + "…" : text);
        return r;
    }

    static boolean overridesToString(Class<?> c) {
        try {
            return c.getMethod("toString").getDeclaringClass() != Object.class;
        } catch (NoSuchMethodException e) {
            return false;
        }
    }

    /** toString() of the student's class may loop forever or throw, so it runs guarded. */
    static String safeToString(final Object v) {
        Future<String> f = helper.submit(() -> String.valueOf(v));
        try {
            return f.get(400, TimeUnit.MILLISECONDS);
        } catch (Throwable t) {
            f.cancel(true);
            return null;
        }
    }

    // ------------------------------------------------------------------ helpers

    static Method findMethod(Class<?> c, String wanted) {
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            for (Method m : k.getDeclaredMethods()) {
                if (key(m.getName(), m.getParameterTypes()).equals(wanted)) return m;
            }
        }
        for (Class<?> i : c.getInterfaces()) {
            for (Method m : i.getMethods()) {
                if (key(m.getName(), m.getParameterTypes()).equals(wanted)) return m;
            }
        }
        return null;
    }

    static String key(String name, Class<?>[] types) {
        StringBuilder b = new StringBuilder(name).append('(');
        for (int i = 0; i < types.length; i++) {
            if (i > 0) b.append(',');
            b.append(types[i].getName());
        }
        return b.append(')').toString();
    }

    static String kindOf(Class<?> c) {
        if (c.isInterface()) return "interface";
        if (c.isEnum()) return "enum";
        if (Modifier.isAbstract(c.getModifiers())) return "abstract";
        return "class";
    }

    static String category(Class<?> t) {
        Class<?> w = wrap(t);
        if (w == Integer.class || w == Long.class || w == Short.class || w == Byte.class) return "int";
        if (w == Double.class || w == Float.class) return "decimal";
        if (w == Boolean.class) return "boolean";
        if (w == Character.class) return "char";
        if (t == String.class) return "string";
        if (t.isEnum()) return "enum";
        if (t.isArray()) return "array";
        return "object";
    }

    static String visibility(int mod) {
        if (Modifier.isPublic(mod)) return "public";
        if (Modifier.isProtected(mod)) return "protected";
        if (Modifier.isPrivate(mod)) return "private";
        return "package";
    }

    static String typeName(Type t) {
        String n = t.getTypeName();
        return n.replace("java.lang.", "").replace("java.util.", "");
    }

    static boolean isProjectClass(Class<?> c) {
        if (c == null || c.isPrimitive() || c.isArray()) return false;
        String name = c.getName();
        Boolean known = projectClassCache.get(name);
        if (known != null) return known;
        // A student class: loaded by our loader from the compiled project, not from a library jar.
        boolean is = c.getClassLoader() == loader && new File(classDir, name.replace('.', File.separatorChar) + ".class").exists();
        projectClassCache.put(name, is);
        return is;
    }

    static Class<?> wrap(Class<?> t) {
        if (!t.isPrimitive()) return t;
        if (t == int.class) return Integer.class;
        if (t == long.class) return Long.class;
        if (t == double.class) return Double.class;
        if (t == float.class) return Float.class;
        if (t == boolean.class) return Boolean.class;
        if (t == char.class) return Character.class;
        if (t == short.class) return Short.class;
        if (t == byte.class) return Byte.class;
        return Void.class;
    }

    static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    // ------------------------------------------------------------------ protocol

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
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("ok", false);
        m.put("error", describeError(t));
        send(m);
    }

    static Map<String, Object> describeError(Throwable t) {
        Map<String, Object> e = new LinkedHashMap<>();
        if (t instanceof BenchError) {
            BenchError b = (BenchError) t;
            e.put("kind", "bench");
            e.put("code", b.code);
            e.put("params", b.params);
            return e;
        }
        if (t instanceof ClassNotFoundException || t instanceof NoClassDefFoundError) {
            e.put("kind", "bench");
            e.put("code", "classMissing");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("type", t.getMessage());
            e.put("params", p);
            return e;
        }
        e.put("kind", "exception");
        e.put("type", t.getClass().getName());
        e.put("simpleType", t.getClass().getSimpleName());
        e.put("message", t.getMessage());
        List<Object> frames = new ArrayList<>();
        StackTraceElement[] st = t.getStackTrace();
        for (int i = 0; i < st.length && frames.size() < 12; i++) {
            StackTraceElement f = st[i];
            if (f.getClassName().startsWith("BlackJBench")) break;
            boolean project = new File(classDir, f.getClassName().replace('.', File.separatorChar) + ".class").exists();
            if (!project && i > 0 && st.length > 1 && frames.size() > 0) continue;
            Map<String, Object> fm = new LinkedHashMap<>();
            fm.put("className", f.getClassName());
            fm.put("method", f.getMethodName());
            fm.put("file", f.getFileName());
            fm.put("line", f.getLineNumber());
            fm.put("project", project);
            frames.add(fm);
            if (t instanceof StackOverflowError && frames.size() >= 6) break;
        }
        e.put("frames", frames);
        if (t.getCause() != null && t.getCause() != t) {
            e.put("cause", t.getCause().getClass().getSimpleName() + ": " + t.getCause().getMessage());
        }
        return e;
    }

    static class BenchError extends Exception {
        final String code;
        final Map<String, Object> params = new LinkedHashMap<>();

        BenchError(String code, String... kv) {
            super(code);
            this.code = code;
            for (int i = 0; i + 1 < kv.length; i += 2) params.put(kv[i], kv[i + 1]);
        }
    }

    /** Collects what the student's code prints and sends it as "out" events. */
    static class EventStream extends OutputStream {
        final String stream;
        final ByteArrayOutputStream buf = new ByteArrayOutputStream();

        EventStream(String stream) { this.stream = stream; }

        @Override public synchronized void write(int b) {
            buf.write(b);
            if (buf.size() > 8192) flush();
        }

        @Override public synchronized void write(byte[] b, int off, int len) {
            buf.write(b, off, len);
            if (buf.size() > 8192) flush();
        }

        @Override public synchronized void flush() {
            if (buf.size() == 0) return;
            String text = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            buf.reset();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("event", "out");
            m.put("stream", stream);
            m.put("text", text);
            send(m);
        }
    }

    /** System.in for the student's code, fed line by line from the console. */
    static class InputQueue extends InputStream {
        private byte[] data = new byte[0];
        private int pos = 0;
        private boolean announced = false;

        synchronized void feed(byte[] more) {
            byte[] next = new byte[data.length - pos + more.length];
            System.arraycopy(data, pos, next, 0, data.length - pos);
            System.arraycopy(more, 0, next, data.length - pos, more.length);
            data = next;
            pos = 0;
            announced = false;
            notifyAll();
        }

        private void waitForData() throws java.io.InterruptedIOException {
            while (pos >= data.length) {
                if (!announced) {
                    announced = true;
                    userOut.flush();
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("event", "waitingForInput");
                    send(m);
                }
                try {
                    wait();
                } catch (InterruptedException e) {
                    throw new java.io.InterruptedIOException();
                }
            }
        }

        @Override public synchronized int read() throws java.io.IOException {
            waitForData();
            return data[pos++] & 0xff;
        }

        @Override public synchronized int read(byte[] b, int off, int len) throws java.io.IOException {
            if (len == 0) return 0;
            waitForData();
            int n = Math.min(len, data.length - pos);
            System.arraycopy(data, pos, b, off, n);
            pos += n;
            return n;
        }

        @Override public synchronized int available() {
            return data.length - pos;
        }
    }

    /** A small JSON reader and writer, enough for the bench protocol. */
    static final class Json {
        private final String s;
        private int i = 0;

        private Json(String s) { this.s = s; }

        static Object parse(String s) {
            Json j = new Json(s);
            j.ws();
            Object v = j.value();
            return v;
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
