import { ScrollView, Text, View } from "react-native";
import { Info } from "lucide-react-native";

/**
 * Theme reference screen (COR-70 scaffold).
 * Shows the NativeWind typography scale and confirms safe-area wiring.
 */
export default function ThemeScreen() {
  return (
    <ScrollView className="flex-1 bg-cadence-background">
      <View className="px-5 pb-8 pt-6">
        <Text className="text-lg font-semibold text-slate-900">Typography</Text>
        <View className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <Text className="text-3xl font-bold text-slate-900">
            Heading 3xl bold
          </Text>
          <Text className="mt-2 text-xl font-semibold text-slate-900">
            Heading xl semibold
          </Text>
          <Text className="mt-2 text-base text-slate-700">
            Body base — regular weight for longer passages of text.
          </Text>
          <Text className="mt-2 text-sm text-slate-500">
            Caption sm — secondary information in muted slate.
          </Text>
          <Text className="mt-2 font-mono text-xs text-slate-400">
            mono xs — hex values, build info, debug output
          </Text>
        </View>

        <Text className="mb-3 mt-7 text-lg font-semibold text-slate-900">
          Safe area
        </Text>
        <View className="flex-row items-start rounded-2xl bg-white p-5 shadow-sm">
          <Info color="#0d9488" size={20} />
          <Text className="ml-3 flex-1 text-sm leading-5 text-slate-600">
            The root layout wraps navigation in{" "}
            <Text className="font-mono text-xs">SafeAreaProvider</Text> and sets
            a dark <Text className="font-mono text-xs">StatusBar</Text> for the
            light Slate-50 background — content stays clear of notches and the
            home indicator on both platforms.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
