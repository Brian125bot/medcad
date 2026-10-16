import { Tabs } from "expo-router";
import { CalendarDays, type LucideIcon, Package, Palette, Pill, TrendingUp } from "lucide-react-native";

import { TabHeaderActions, TabHeaderTitle } from "@/components/tab-header/TabHeader";
import { cadenceTokens } from "@/constants/theme";
import { useTodayPendingCount } from "@/hooks/useTodaySchedule";
import {
  INITIAL_TAB,
  PRIMARY_TABS,
  type PrimaryTabName,
  themeTabHref,
  toTabBadge,
} from "@/lib/navigation/tabs";

export const unstable_settings = {
  initialRouteName: INITIAL_TAB,
};

const TAB_ICONS: Record<PrimaryTabName, LucideIcon> = {
  today: CalendarDays,
  regimen: Pill,
  insights: TrendingUp,
  cabinet: Package,
};

export default function TabLayout() {
  // Doses still pending today (COR-74); no badge until loaded.
  const dosesDueToday = useTodayPendingCount();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: cadenceTokens.accent,
        tabBarInactiveTintColor: cadenceTokens.muted,
        tabBarBadgeStyle: { backgroundColor: cadenceTokens.accent },
        headerStyle: { backgroundColor: cadenceTokens.background },
        headerTintColor: cadenceTokens.ink,
        headerTitleAlign: "left",
        headerTitle: () => <TabHeaderTitle />,
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
      {/* Scaffold typography reference: a tab in development builds only. */}
      <Tabs.Screen
        name="two"
        options={{
          title: "Theme",
          href: themeTabHref(__DEV__),
          tabBarIcon: ({ color, size }) => <Palette color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
