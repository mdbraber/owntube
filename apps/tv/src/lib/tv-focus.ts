import type { ComponentProps, ReactNode, Ref } from "react";
import {
  TVFocusGuideView as RNTVFocusGuideView,
  type ViewInstance,
} from "react-native";

/**
 * A View as a ref sees it on react-native-tvos. The fork attaches
 * `requestTVFocus()` to every View instance at runtime (View.js), but the
 * generated 0.88 types leave it out.
 */
export type TVView = ViewInstance & { requestTVFocus?: () => void };

/** A TVFocusGuideView's ref: a View plus the `setDestinations()` it attaches. */
export type TVFocusGuide = TVView & {
  setDestinations?: (destinations: (ViewInstance | number)[]) => void;
};

/**
 * TVFocusGuideView with its `ref` typed. The component forwards `ref` to its
 * inner View at runtime, but the generated 0.88 props type doesn't declare it.
 */
export const TVFocusGuideView = RNTVFocusGuideView as (
  props: ComponentProps<typeof RNTVFocusGuideView> & {
    ref?: Ref<TVFocusGuide>;
  },
) => ReactNode;
