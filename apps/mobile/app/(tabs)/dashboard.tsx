import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ImpersonateBar } from "@/components/ImpersonateBar";
import { useApp } from "@/context/AppContext";
import { toggleChore } from "@/lib/api";

export default function DashboardScreen() {
  const { bootstrap, viewAs, refresh, loading, error, signOut } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = bootstrap?.me?.roles?.includes("admin");
  const needsPick = isAdmin && !viewAs;
  const chores = bootstrap?.chores || [];
  const progress = bootstrap?.progress;
  const checked = progress?.checked || {};

  async function onToggle(id: string) {
    setBusyId(id);
    try {
      await toggleChore(id, viewAs);
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Toggle failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <ImpersonateBar />
      <View style={styles.bank}>
        <Text style={styles.bankLabel}>Point bank</Text>
        <Text style={styles.bankPts}>
          {needsPick || !progress ? "—" : Number(progress.points).toFixed(2)}
        </Text>
        <Text style={styles.who}>
          {bootstrap?.me ? `Signed in as ${bootstrap.me.username}` : ""}
        </Text>
        <Pressable onPress={() => signOut()}>
          <Text style={styles.logout}>Sign out</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}
      {loading && !bootstrap ? <ActivityIndicator /> : null}

      {needsPick ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Select a user</Text>
          <Text style={styles.emptyBody}>
            Use Impersonate above to view a chore dashboard.
          </Text>
        </View>
      ) : (
        <FlatList
          data={chores}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={
            <Text style={styles.emptyBody}>No chores assigned.</Text>
          }
          renderItem={({ item }) => {
            const on = !!checked[item.id];
            return (
              <Pressable
                style={[styles.chore, on && styles.choreOn]}
                onPress={() => onToggle(item.id)}
                disabled={busyId === item.id}
              >
                <Text style={styles.check}>{on ? "✓" : "○"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.choreName}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {item.group_key ? `Group · ${item.group_key}` : "Individual"} ·{" "}
                    {Number(item.pts).toFixed(2)} pts
                  </Text>
                </View>
                {busyId === item.id ? <ActivityIndicator /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#f6f4ff" },
  bank: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: "#1a1a2e",
    borderRadius: 14,
    padding: 16,
  },
  bankLabel: { color: "#aaa", fontSize: 12, fontWeight: "700" },
  bankPts: { color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 4 },
  who: { color: "#bbb", marginTop: 8, fontSize: 12 },
  logout: { color: "#c4b5fd", marginTop: 8, fontWeight: "700" },
  empty: { padding: 32, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  emptyBody: { color: "#666", textAlign: "center" },
  chore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e8e4f8",
  },
  choreOn: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  check: { fontSize: 22, width: 28, textAlign: "center" },
  choreName: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 12, color: "#666", marginTop: 2 },
  err: { color: "#b91c1c", padding: 16 },
});
