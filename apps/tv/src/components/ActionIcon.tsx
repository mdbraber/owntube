import {
  CAPTIONS_FRAME,
  FILLED_ICON_PATHS,
  type FilledIconName,
  ICON_VIEW_BOX,
  STROKED_ICON_PATHS,
} from "@web/lib/action-icon-paths";
import Svg, { G, Path, Rect } from "react-native-svg";

export type ActionIconName = FilledIconName | "captions" | "skipForward";

/**
 * The web app's action icons, drawn with react-native-svg.
 *
 * The geometry comes from @web/lib/action-icon-paths rather than a TV-only copy
 * or a lookalike from an icon font, so a like button is the same shape on both
 * surfaces. Feather was close but not the same glyphs.
 */
export function ActionIcon({
  name,
  size,
  color,
}: {
  name: ActionIconName;
  size: number;
  color: string;
}) {
  if (name === "captions") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${ICON_VIEW_BOX} ${ICON_VIEW_BOX}`}
      >
        <Rect
          x={CAPTIONS_FRAME.x}
          y={CAPTIONS_FRAME.y}
          width={CAPTIONS_FRAME.width}
          height={CAPTIONS_FRAME.height}
          rx={CAPTIONS_FRAME.rx}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
        <Path
          d={STROKED_ICON_PATHS.captionsLines}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  // Forward is the same arrow mirrored, exactly as the web does it.
  if (name === "skipForward") {
    return (
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${ICON_VIEW_BOX} ${ICON_VIEW_BOX}`}
      >
        <G transform={`translate(${ICON_VIEW_BOX},0) scale(-1,1)`}>
          <Path d={FILLED_ICON_PATHS.skip} fill={color} />
        </G>
      </Svg>
    );
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_VIEW_BOX} ${ICON_VIEW_BOX}`}
    >
      <Path d={FILLED_ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}
