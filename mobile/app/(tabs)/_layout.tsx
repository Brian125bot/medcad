import { Tabs } from "expo-router";
import { House, SwatchBook } from "lucide-react-native";

import { cadenceTokens } from "@/constants/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: cadenceTokens.accent,
        tabBarInactiveTintColor: cadenceTokens.muted,
        headerStyle: { backgroundColor: cadenceTokens.background },
        headerTintColor: cadenceTokens.ink,
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <House color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: "Theme",
          tabBarIcon: ({ color, size }) => (
            <SwatchBook color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
