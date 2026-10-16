import { Text, View } from "react-native";

/** Centered placeholder for a tab whose content has not been built yet. */
export function EmptyTabState({ title, message }: { title: string; message: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-cadence-background px-8">
      <Text className="text-center text-base font-semibold text-slate-900">{title}</Text>
      <Text className="mt-1 text-center text-sm text-slate-500">{message}</Text>
    </View>
  );
}
