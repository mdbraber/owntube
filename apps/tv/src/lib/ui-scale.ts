import { reloadAppAsync } from "expo";
import * as SecureStore from "expo-secure-store";
import { PixelRatio, Platform, StyleSheet } from "react-native";

/**
 * Interface size on Apple TV.
 *
 * Every size in this app is written for Android TV, which lays a 1080p screen
 * out as 960×540 dp. tvOS lays the same screen out as 1920×1080 points, so the
 * same numbers draw everything at half the size. On tvOS the numbers are scaled
 * by the chosen size: Large (2×) matches Android TV and Apple's own apps,
 * Default (1.5×) shows more per screen, Compact (1×) is the unscaled layout.
 * Android TV is always 1×: nothing changes there.
 *
 * The scale is fixed for a run of the app: styles are created once, when their
 * module loads. Changing it saves the choice and reloads the app.
 */
export type UiSize = "compact" | "default" | "large";

export const UI_SIZES: readonly UiSize[] = ["compact", "default", "large"];

const TVOS_FACTORS: Record<UiSize, number> = {
  compact: 1,
  default: 1.5,
  large: 2,
};

const STORAGE_KEY = "ui-size";

/** Whether this build offers a choice of size (Apple TV). */
export const UI_SIZE_ADJUSTABLE = Platform.OS === "ios";

function readUiSize(): UiSize {
  try {
    const stored = SecureStore.getItem(STORAGE_KEY);
    return UI_SIZES.includes(stored as UiSize) ? (stored as UiSize) : "default";
  } catch {
    return "default";
  }
}

/** The size this run of the app uses. */
export const uiSize: UiSize = UI_SIZE_ADJUSTABLE ? readUiSize() : "default";

/** Multiplier from the Android TV (dp) numbers to this platform's units. */
export const UI_SCALE = UI_SIZE_ADJUSTABLE ? TVOS_FACTORS[uiSize] : 1;

/**
 * A size written in Android TV dp, in this platform's units. Styles made with
 * `createStyles` are scaled already; this is for sizes used in code: animated
 * widths, scroll offsets, list item lengths, icon sizes.
 */
export function s(size: number): number {
  return UI_SCALE === 1
    ? size
    : PixelRatio.roundToNearestPixel(size * UI_SCALE);
}

/** Saves a new size and reloads the app to apply it. */
export async function setUiSize(size: UiSize): Promise<void> {
  if (size === uiSize) return;
  await SecureStore.setItemAsync(STORAGE_KEY, size);
  await reloadAppAsync("Interface size changed");
}

/** Style properties that are lengths, and so scale. */
const LENGTH_KEYS = new Set([
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  "start",
  "end",
  "inset",
  "insetBlock",
  "insetInline",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginHorizontal",
  "marginVertical",
  "marginStart",
  "marginEnd",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingHorizontal",
  "paddingVertical",
  "paddingStart",
  "paddingEnd",
  "gap",
  "rowGap",
  "columnGap",
  "flexBasis",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "outlineWidth",
  "outlineOffset",
  "shadowRadius",
  "textShadowRadius",
]);

type Style = Record<string, unknown>;

function scaleOffset(offset: unknown): unknown {
  if (!offset || typeof offset !== "object") return offset;
  const { width, height } = offset as { width?: unknown; height?: unknown };
  return {
    width: typeof width === "number" ? s(width) : width,
    height: typeof height === "number" ? s(height) : height,
  };
}

function scaleTransform(transform: unknown): unknown {
  if (!Array.isArray(transform)) return transform;
  return transform.map((step: Style) => {
    const out: Style = { ...step };
    for (const key of ["translateX", "translateY"]) {
      if (typeof out[key] === "number") out[key] = s(out[key] as number);
    }
    return out;
  });
}

function scaleStyle(style: Style): Style {
  const out: Style = {};
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === "number" && LENGTH_KEYS.has(key)) {
      out[key] = s(value);
    } else if (key === "shadowOffset" || key === "textShadowOffset") {
      out[key] = scaleOffset(value);
    } else if (key === "transform") {
      out[key] = scaleTransform(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * `StyleSheet.create`, with every length scaled to this platform (see the top
 * of this file). Write sizes in Android TV dp, as everywhere in this app.
 */
export const createStyles: typeof StyleSheet.create = (styles) => {
  if (UI_SCALE === 1) return StyleSheet.create(styles);
  const scaled: Record<string, Style> = {};
  for (const [name, style] of Object.entries(styles as Record<string, Style>)) {
    scaled[name] = scaleStyle(style);
  }
  return StyleSheet.create(scaled as typeof styles);
};
