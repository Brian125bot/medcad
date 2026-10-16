import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { cadenceTokens } from "@/constants/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 72;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Daily progress ring; animates as doses are logged. */
export function ProgressRing({ taken, total }: { taken: number; total: number }) {
  const fraction = total > 0 ? taken / total : 0;
  const progress = useSharedValue(fraction);

  useEffect(() => {
    progress.value = withTiming(fraction, { duration: 450 });
  }, [fraction, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${taken} of ${total} doses taken`}
      accessibilityValue={{ min: 0, max: total, now: taken }}
      testID="today-progress"
      style={{ width: SIZE, height: SIZE }}
      className="items-center justify-center"
    >
      <Svg width={SIZE} height={SIZE} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="#e2e8f0" strokeWidth={STROKE} fill="none" />
        <AnimatedCircle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={cadenceTokens.adherence}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          fill="none"
          animatedProps={animatedProps}
        />
      </Svg>
      <Text className="text-base font-bold text-slate-900">
        {taken}/{total}
      </Text>
    </View>
  );
}
