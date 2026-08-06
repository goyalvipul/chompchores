import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function SetupScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>ChompChores</Text>
      <Text style={styles.body}>
        Copy apps/mobile/.env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and
        EXPO_PUBLIC_SUPABASE_ANON_KEY from a NEW Supabase project.
      </Text>
      <Text style={styles.warn}>
        The home Docker JSON app used by kids stays separate until you choose to migrate a
        snapshot.
      </Text>
      <Link href="/login" style={styles.link}>
        Continue to login (after env is set & app restarted)
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: "center", gap: 12, backgroundColor: "#f6f4ff" },
  title: { fontSize: 28, fontWeight: "800", color: "#6c47e8" },
  body: { fontSize: 15, color: "#333", lineHeight: 22 },
  warn: { fontSize: 13, color: "#9a3412", lineHeight: 20 },
  link: { marginTop: 16, color: "#6c47e8", fontWeight: "700" },
});
