import { FlatList, StyleSheet, Text, View } from "react-native";
import { useApp } from "@/context/AppContext";

export default function ManageScreen() {
  const { bootstrap } = useApp();
  const isAdmin = bootstrap?.me?.roles?.includes("admin");
  const chores = bootstrap?.manageChores || [];

  if (!isAdmin) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Manage is admin-only</Text>
        <Text style={styles.emptyBody}>Ask a household admin for access.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Full add/edit UI lands next. Showing all household chores (not filtered by
        impersonation).
      </Text>
      <FlatList
        data={chores}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Text style={styles.emptyBody}>No chores yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {Number(item.pts).toFixed(2)} pts · assignee {String(item.assignee_id).slice(0, 8)}…
              {item.group_key ? ` · ${item.group_key}` : ""}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#f6f4ff" },
  hint: { padding: 16, paddingBottom: 0, color: "#555", fontSize: 13 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  emptyBody: { color: "#666", textAlign: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e8e4f8",
  },
  name: { fontWeight: "700", fontSize: 15 },
  meta: { color: "#666", fontSize: 12, marginTop: 4 },
});
