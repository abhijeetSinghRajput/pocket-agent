import { Path, Rect, Svg } from 'react-native-svg';

// The owner's Agents mark (a soft rounded face with two eyes), drawn in its own 177 × 130 units and
// centred in a square with room for the stroke.
const FACE =
  'M177 65C177 130 137.377 130 88.5 130C27 130 0 120 0 65C0 1 37 0 88.5 0C137.377 0 175.994 0 177 65Z';
const BOX = 201;
const EYES = [
  { cx: 52.5, cy: 65 },
  { cx: 123.5, cy: 64 },
];

/**
 * The Agents tab's icon, with the same props a lucide icon takes in the tab bar (size, stroke
 * colour, inside fill, stroke width in 24-pixel units), so it gets the same duotone and the same
 * heavier stroke when its tab is open. The eyes are solid and as wide as the stroke.
 */
export function AgentsIcon({
  size = 24,
  color = 'currentColor',
  fill = 'none',
  strokeWidth = 2,
}: {
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
}) {
  const stroke = (strokeWidth * BOX) / 24;
  return (
    <Svg width={size} height={size} viewBox={`-12 ${65 - BOX / 2} ${BOX} ${BOX}`} accessibilityElementsHidden>
      <Path d={FACE} fill={fill} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
      {EYES.map((e) => (
        <Rect
          key={e.cx}
          x={e.cx - stroke / 2}
          y={e.cy - 22}
          width={stroke}
          height={44}
          rx={stroke / 2}
          fill={color}
        />
      ))}
    </Svg>
  );
}
