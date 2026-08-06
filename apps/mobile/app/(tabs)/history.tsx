import { FlatList, StyleSheet, Text, View } from "react-native";
import { ImpersonateBar } from "@/components/ImpersonateBar";
import { useApp } from "@/context/AppContext";

export default function HistoryScreen() {
  const { bootstrap, viewAs } = useApp();
  const isAdmin = bootstrap?.me?.roles?.includes("admin");
  const needsPick = isAdmin && !viewAs;
  const days = bootstrap?.historyDays || [];

  return (
    <View style={styles.wrap}>
      <ImpersonateBar />
      {needsPick ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Select a user</Text>
          <Text style={styles.emptyBody}>Impersonate to view history.</Text>
        </View>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.id || d.day}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={<Text style={styles.emptyBody}>No history yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.day}>
              <Text style={styles.dayTitle}>{item.day}</Text>
              <Text style={styles.summary}>
                Earned {Number(item.daily_earned || 0).toFixed(2)} · Spent{" "}
                {Number(item.daily_spent || 0).toFixed(2)}
                {item.penalty ? ` · Penalty ${Number(item.penalty).toFixed(2)}` : ""}
              </Text>
              {(item.entries || []).map((e: any, i: number) => (
                <View key={i} style={styles.entry}>
                  <Text style={styles.entryLabel}>{e.label}</Text>
                  <Text style={styles.entryPts}>
                    {Number(e.pts) >= 0 ? "+" : ""}
                    {Number(e.pts).toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#f6f4ff" },
  empty: { padding: 32, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  emptyBody: { color: "#666", textAlign: "center" },
  day: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e8e4f8",
  },
  dayTitle: { fontWeight: "800", fontSize: 15 },
  summary: { color: "#666", fontSize: 12, marginVertical: 6 },
  entry: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#eee",
  },
  entryLabel: { flex: 1, fontSize: 13 },
  entryPts: { fontWeight: "700", fontSize: 13 },
});
