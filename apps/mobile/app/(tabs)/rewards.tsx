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
import { redeemReward } from "@/lib/api";

export default function RewardsScreen() {
  const { bootstrap, viewAs, refresh } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);
  const isAdmin = bootstrap?.me?.roles?.includes("admin");
  const needsPick = isAdmin && !viewAs;
  const rewards = bootstrap?.rewards || [];
  const points = Number(bootstrap?.progress?.points || 0);

  async function onRedeem(id: string) {
    setBusyId(id);
    try {
      await redeemReward(id, viewAs);
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Redeem failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <ImpersonateBar />
      {needsPick ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Select a user</Text>
          <Text style={styles.emptyBody}>Impersonate someone to see their rewards.</Text>
        </View>
      ) : (
        <FlatList
          data={rewards}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListHeaderComponent={
            <Text style={styles.bank}>Bank: {points.toFixed(2)} pts</Text>
          }
          ListEmptyComponent={<Text style={styles.emptyBody}>No rewards yet.</Text>}
          renderItem={({ item }) => {
            const isTimer = item.type === "timer";
            return (
              <View style={styles.card}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {isTimer
                    ? `Timer · ${item.timer_pts} pts / ${item.timer_hours} hr`
                    : `${Number(item.cost).toFixed(2)} pts`}
                  {" · "}
                  {item.redeem_type || "persistent"}
                </Text>
                {!isTimer ? (
                  <Pressable
                    style={styles.btn}
                    onPress={() => onRedeem(item.id)}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.btnText}>Redeem</Text>
                    )}
                  </Pressable>
                ) : (
                  <Text style={styles.meta}>Timer redeem comes in a later build.</Text>
                )}
              </View>
            );
          }}
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
  bank: { fontWeight: "700", marginBottom: 8, color: "#333" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e8e4f8",
    gap: 6,
  },
  name: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 12, color: "#666" },
  btn: {
    alignSelf: "flex-start",
    backgroundColor: "#16a34a",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
