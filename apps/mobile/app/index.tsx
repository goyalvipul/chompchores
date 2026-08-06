import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useApp } from "@/context/AppContext";

export default function Index() {
  const { session, loading, configured } = useApp();
  if (!configured) return <Redirect href="/setup" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  return <Redirect href="/(tabs)/dashboard" />;
}
