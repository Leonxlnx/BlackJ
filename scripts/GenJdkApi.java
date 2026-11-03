import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Writes src/lib/jdkApi.json: the public methods and constants of the library classes students use
 * most, for code completion after a dot. Run with: java scripts/GenJdkApi.java
 */
public class GenJdkApi {
    static final String[] CLASSES = {
        "java.lang.String", "java.lang.StringBuilder", "java.lang.Math", "java.lang.Integer", "java.lang.Double",
        "java.lang.Character", "java.lang.Boolean", "java.lang.Long", "java.lang.Object", "java.lang.System",
        "java.io.PrintStream", "java.util.Scanner", "java.util.Random", "java.util.ArrayList", "java.util.LinkedList",
        "java.util.List", "java.util.HashMap", "java.util.Map", "java.util.HashSet", "java.util.Set",
        "java.util.Arrays", "java.util.Collections", "java.util.Iterator", "java.util.Objects", "java.time.LocalDate",
    };

    public static void main(String[] args) throws Exception {
        StringBuilder out = new StringBuilder("{\n");
        boolean first = true;
        for (String name : CLASSES) {
            Class<?> c = Class.forName(name);
            Map<String, Method> byKey = new TreeMap<>();
            for (Method m : c.getMethods()) {
                if (m.isSynthetic() && !m.isBridge()) continue;
                if (m.getDeclaringClass() == Object.class && c != Object.class && !m.getName().matches("toString|equals|hashCode")) continue;
                if (m.getName().matches("wait|notify|notifyAll|getClass")) continue;
                String key = m.getName() + "(" + params(m) + ")" + (Modifier.isStatic(m.getModifiers()) ? "s" : "");
                Method prev = byKey.get(key);
                if (prev == null || (prev.isBridge() && !m.isBridge()) || prev.getReturnType().isAssignableFrom(m.getReturnType())) byKey.put(key, m);
            }
            List<Method> methods = new ArrayList<>(byKey.values());
            // A generic bridge (compareTo(Object) next to compareTo(String)) only adds noise.
            methods.removeIf((m) -> m.isBridge() && byKey.values().stream().anyMatch((o) -> !o.isBridge() && o.getName().equals(m.getName()) && o.getParameterCount() == m.getParameterCount()));
            methods.sort(Comparator.comparing(Method::getName).thenComparingInt(Method::getParameterCount));
            if (!first) out.append(",\n");
            first = false;
            out.append("  \"").append(c.getSimpleName()).append("\": {\"pkg\": \"").append(c.getPackageName()).append("\"");
            if (c.getTypeParameters().length > 0) {
                out.append(", \"tp\": [");
                for (int i = 0; i < c.getTypeParameters().length; i++) out.append(i > 0 ? ", " : "").append('"').append(c.getTypeParameters()[i].getName()).append('"');
                out.append("]");
            }
            out.append(", \"m\": [");
            for (int i = 0; i < methods.size(); i++) {
                Method m = methods.get(i);
                out.append(i > 0 ? ", " : "").append("[\"").append(m.getName()).append("\", \"").append(simple(m.getGenericReturnType())).append("\", [");
                Type[] ps = m.getGenericParameterTypes();
                for (int j = 0; j < ps.length; j++) out.append(j > 0 ? ", " : "").append('"').append(simple(ps[j]).replace("\"", "")).append('"');
                out.append("]").append(Modifier.isStatic(m.getModifiers()) ? ", 1" : "").append("]");
            }
            out.append("], \"f\": [");
            boolean firstField = true;
            for (Field f : c.getFields()) {
                if (!Modifier.isStatic(f.getModifiers())) continue;
                out.append(firstField ? "" : ", ").append("[\"").append(f.getName()).append("\", \"").append(simple(f.getGenericType())).append("\"]");
                firstField = false;
            }
            out.append("]}");
        }
        out.append("\n}\n");
        Path target = Path.of("src", "lib", "jdkApi.json");
        Files.writeString(target, out.toString(), StandardCharsets.UTF_8);
        System.out.println("wrote " + target + " (" + out.length() / 1024 + " KB)");
    }

    static String params(Method m) {
        StringBuilder b = new StringBuilder();
        for (Class<?> p : m.getParameterTypes()) b.append(b.length() > 0 ? "," : "").append(p.getName());
        return b.toString();
    }

    /** java.util.List<java.lang.String> → List<String>; varargs stay as arrays. */
    static String simple(Type t) {
        return t.getTypeName().replaceAll("\\b(?:[a-z]\\w*\\.)+([A-Z])", "$1").replace("$", ".");
    }
}
