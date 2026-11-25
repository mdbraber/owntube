import { reloadAppAsync } from "expo";
import * as SecureStore from "expo-secure-store";
import { PixelRatio, Platform, StyleSheet } from "react-native";

/**
 * Interface size: Compact, Default or Large, chosen in Settings.
 *
 * Every size in this app is written in Android TV dp, where a 1080p screen is
 * 960×540 dp, and those numbers as written are Large: the size of Apple's and
 * Google's own TV apps. Default draws everything at three quarters of that, so
 * more fits on a screen, and Compact at half.
 *
 * tvOS lays the same screen out as 1920×1080 points, twice the numbers, so
 * there every size is doubled first: Large is 2×, Default 1.5×, Compact 1×.
 *
 * The scale is fixed for a run of the app: styles are created once, when their
 * module loads. Changing it saves the choice and reloads the app.
 */
export type UiSize = "compact" | "default" | "large";

export const UI_SIZES: readonly UiSize[] = ["compact", "default", "large"];

/** Each size as a share of the written (Large) sizes. */
const SIZE_FACTORS: Record<UiSize, number> = {
  compact: 0.5,
  default: 0.75,
  large: 1,
};

/** Platform units per written dp: tvOS points are half a dp on a 1080p TV. */
const PLATFORM_FACTOR = Platform.OS === "ios" ? 2 : 1;

const STORAGE_KEY = "ui-size";

function readUiSize(): UiSize {
  try {
    const stored = SecureStore.getItem(STORAGE_KEY);
    return UI_SIZES.includes(stored as UiSize) ? (stored as UiSize) : "default";
  } catch {
    return "default";
  }
}

/** The size this run of the app uses. */
export const uiSize: UiSize = readUiSize();

/** Multiplier from the written (Android TV dp) numbers to this platform's units. */
export const UI_SCALE = SIZE_FACTORS[uiSize] * PLATFORM_FACTOR;

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
