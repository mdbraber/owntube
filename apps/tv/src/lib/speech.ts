import { requireOptionalNativeModule } from "expo-modules-core";

type SpeechPackage = typeof import("expo-speech-recognition");

/**
 * expo-speech-recognition, when this build has its native side.
 *
 * Importing the package looks its native module up straight away and throws
 * without it. tvOS has no speech recognition API, so the module isn't linked
 * there (see `expo.autolinking` in package.json), and the package is only
 * loaded where the native side exists.
 */
const pkg: SpeechPackage | null = requireOptionalNativeModule(
  "ExpoSpeechRecognition",
)
  ? require("expo-speech-recognition")
  : null;

/** The recogniser, or null where the build has none. */
export const speechRecognition = pkg?.ExpoSpeechRecognitionModule ?? null;

/**
 * The package's event hook, or a no-op where there is no recogniser. Which
 * one is fixed for the whole run, so the hook order stays the same.
 */
export const useSpeechRecognitionEvent: SpeechPackage["useSpeechRecognitionEvent"] =
  pkg?.useSpeechRecognitionEvent ?? (() => {});
