import Svg, { Circle, Ellipse, Line, Path, Rect } from "react-native-svg";

import type { PillAppearance } from "@/lib/wizard/medication-form";

const STROKE = "#94a3b8";

/** Live pill preview (COR-75). Re-renders on every shape/color change. */
export function PillPreview({
  appearance,
  size = 120,
}: {
  appearance: PillAppearance;
  size?: number;
}) {
  const { shape, primaryColor, secondaryColor } = appearance;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      accessibilityLabel={`${shape} pill preview`}
    >
      {shape === "round" && (
        <>
          <Circle cx={60} cy={60} r={42} fill={primaryColor} stroke={STROKE} strokeWidth={2} />
          <Path d="M 18 60 A 42 42 0 0 0 102 60 Z" fill={secondaryColor} />
          <Circle cx={60} cy={60} r={42} fill="none" stroke={STROKE} strokeWidth={2} />
          <Line x1={22} y1={60} x2={98} y2={60} stroke={STROKE} strokeWidth={1.5} />
        </>
      )}
      {shape === "capsule" && (
        <>
          <Path d="M 60 38 H 36 A 22 22 0 0 0 36 82 H 60 Z" fill={primaryColor} />
          <Path d="M 60 38 H 84 A 22 22 0 0 1 84 82 H 60 Z" fill={secondaryColor} />
          <Rect x={14} y={38} width={92} height={44} rx={22} fill="none" stroke={STROKE} strokeWidth={2} />
          <Line x1={60} y1={38} x2={60} y2={82} stroke={STROKE} strokeWidth={1.5} />
        </>
      )}
      {shape === "oval" && (
        <>
          <Ellipse cx={60} cy={60} rx={46} ry={30} fill={primaryColor} />
          <Path d="M 14 60 A 46 30 0 0 0 106 60 Z" fill={secondaryColor} />
          <Ellipse cx={60} cy={60} rx={46} ry={30} fill="none" stroke={STROKE} strokeWidth={2} />
        </>
      )}
    </Svg>
  );
}
