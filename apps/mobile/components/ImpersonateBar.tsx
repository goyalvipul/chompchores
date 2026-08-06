import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/context/AppContext";

export function ImpersonateBar() {
  const { bootstrap, viewAs, setViewAs } = useApp();
  const me = bootstrap?.me;
  if (!me?.roles?.includes("admin")) return null;

  const members = bootstrap?.householdMembers || [];

  function pick(id: string | null) {
    setViewAs(id);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Impersonate</Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.chip, !viewAs && styles.chipOn]}
          onPress={() => pick(null)}
        >
          <Text style={styles.chipText}>None</Text>
        </Pressable>
        {members
          .filter((m) => m.roles?.includes("chore") || m.id === viewAs)
          .map((m) => (
            <Pressable
              key={m.id}
              style={[styles.chip, viewAs === m.id && styles.chipOn]}
              onPress={() => pick(m.id)}
            >
              <Text style={styles.chipText}>{m.username}</Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, backgroundColor: "#fff" },
  label: { fontSize: 11, fontWeight: "700", color: "#666", marginBottom: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fafafa",
  },
  chipOn: { borderColor: "#6c47e8", backgroundColor: "#efeaff" },
  chipText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
});
