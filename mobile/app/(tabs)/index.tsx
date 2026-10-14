import { ScrollView, Text, View } from "react-native";
import {
  CircleCheck,
  Pill,
  Sparkles,
  TriangleAlert,
} from "lucide-react-native";

type Token = {
  name: string;
  value: string;
  usage: string;
  swatchClass: string;
  icon: typeof Pill;
};

const TOKENS: Token[] = [
  {
    name: "cadence.background",
    value: "#f8fafc",
    usage: "Slate-50 · default app background",
    swatchClass: "bg-cadence-background border border-slate-200",
    icon: Sparkles,
  },
  {
    name: "cadence.accent",
    value: "#0d9488",
    usage: "Teal-600 · primary action accent",
    swatchClass: "bg-cadence-accent",
    icon: Pill,
  },
  {
    name: "cadence.adherence",
    value: "#059669",
    usage: "Emerald-600 · adherence indicator",
    swatchClass: "bg-cadence-adherence",
    icon: CircleCheck,
  },
  {
    name: "cadence.alert",
    value: "#d97706",
    usage: "Amber-600 · low-stock alert",
    swatchClass: "bg-cadence-alert",
    icon: TriangleAlert,
  },
];

export default function HomeScreen() {
  return (
    <ScrollView className="flex-1 bg-cadence-background">
      <View className="px-5 pb-8 pt-6">
        {/* Welcome card */}
        <View className="rounded-2xl bg-white p-5 shadow-sm">
          <View className="flex-row items-center">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-cadence-accent">
              <Pill color="#ffffff" size={24} />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-2xl font-bold text-slate-900">
                CadenceRx
              </Text>
              <Text className="mt-0.5 text-sm text-slate-500">
                Medication adherence, on track.
              </Text>
            </View>
          </View>
          <Text className="mt-4 font-mono text-xs text-slate-400">
            Expo SDK 57 · NativeWind v4 · COR-70 scaffold
          </Text>
        </View>

        {/* Design tokens */}
        <Text className="mb-3 mt-7 text-lg font-semibold text-slate-900">
          Design tokens
        </Text>
        {TOKENS.map((token) => (
          <View
            key={token.name}
            className="mb-3 flex-row items-center rounded-2xl bg-white p-4 shadow-sm"
          >
            <View
              className={`h-14 w-14 items-center justify-center rounded-xl ${token.swatchClass}`}
            >
              <token.icon
                color={
                  token.name === "cadence.background" ? "#0d9488" : "#ffffff"
                }
                size={22}
              />
            </View>
            <View className="ml-4 flex-1">
              <Text className="font-mono text-sm font-semibold text-slate-900">
                {token.name}
              </Text>
              <Text className="mt-0.5 text-sm text-slate-500">
                {token.usage}
              </Text>
            </View>
            <Text className="font-mono text-xs text-slate-400">
              {token.value}
            </Text>
          </View>
        ))}

        {/* Accent button preview */}
        <Text className="mb-3 mt-4 text-lg font-semibold text-slate-900">
          Action accent
        </Text>
        <View className="items-center rounded-2xl bg-cadence-accent py-3.5">
          <Text className="text-base font-semibold text-white">
            Primary action
          </Text>
        </View>
        <Text className="mt-3 text-center text-xs text-slate-400">
          Tokens live in tailwind.config.js + constants/theme.ts
        </Text>
      </View>
    </ScrollView>
  );
}
