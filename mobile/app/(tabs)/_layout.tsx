import { Tabs } from "expo-router";
import { CalendarCheck, ChartLine, type LucideIcon, Package, Pill } from "lucide-react-native";

import { TabHeaderActions, TabHeaderTitle } from "@/components/tab-header/TabHeader";
import { cadenceTokens } from "@/constants/theme";
import { INITIAL_TAB, PRIMARY_TABS, type PrimaryTabName, toTabBadge } from "@/lib/navigation/tabs";

export const unstable_settings = {
  initialRouteName: INITIAL_TAB,
};

const TAB_ICONS: Record<PrimaryTabName, LucideIcon> = {
  today: CalendarCheck,
  regimen: Pill,
  insights: ChartLine,
  cabinet: Package,
};

// Count of doses due today for the Today badge. No data source yet: COR-74
// supplies it. While undefined, no badge is shown.
const dosesDueToday: number | undefined = undefined;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: cadenceTokens.accent,
        tabBarInactiveTintColor: cadenceTokens.muted,
        tabBarBadgeStyle: { backgroundColor: cadenceTokens.accent },
        headerStyle: { backgroundColor: cadenceTokens.background },
        headerTintColor: cadenceTokens.ink,
        headerTitleAlign: "left",
        headerTitle: ({ children }) => <TabHeaderTitle title={children} />,
        headerRight: () => <TabHeaderActions />,
      }}
    >
      {PRIMARY_TABS.map(({ name, title }) => {
        const Icon = TAB_ICONS[name];
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title,
              tabBarIcon: ({ color, size }) => <Icon color={color} size={size} />,
              tabBarBadge: name === "today" ? toTabBadge(dosesDueToday) : undefined,
            }}
          />
        );
      })}
      {/* Scaffold typography reference: hidden from the tab bar, dev builds only. */}
      <Tabs.Screen name="two" options={{ title: "Theme", href: null }} />
    </Tabs>
  );
}
