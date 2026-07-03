import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

export type FocusableTextInputHandle = {
  focus: () => void;
  blur: () => void;
};

type Props = Omit<TextInputProps, "style"> & {
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

export const FocusableTextInput = forwardRef<FocusableTextInputHandle, Props>(
  function FocusableTextInput(
    {
      containerStyle,
      editable = true,
      inputStyle,
      onBlur,
      onFocus,
      placeholderTextColor = colors.mutedForeground,
      selectionColor = colors.brand,
      ...inputProps
    },
    ref,
  ) {
    const inputRef = useRef<TextInput>(null);
    const [surfaceFocused, setSurfaceFocused] = useState(false);
    const [inputFocused, setInputFocused] = useState(false);
    const isFocused = surfaceFocused || inputFocused;

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }));

    const focusInput = () => {
      if (editable) inputRef.current?.focus();
    };

    return (
      <Pressable
        disabled={!editable}
        hasTVPreferredFocus={inputProps.hasTVPreferredFocus}
        onBlur={() => setSurfaceFocused(false)}
        onFocus={() => setSurfaceFocused(true)}
        onPress={focusInput}
        style={[
          styles.surface,
          isFocused && styles.surfaceFocused,
          !editable && styles.disabled,
          containerStyle,
        ]}
      >
        <TextInput
          {...inputProps}
          ref={inputRef}
          editable={editable}
          hasTVPreferredFocus={false}
          onBlur={(event) => {
            setInputFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setInputFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={placeholderTextColor}
          selectionColor={selectionColor}
          style={[styles.input, inputStyle]}
        />
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  surface: {
    minHeight: 58,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  surfaceFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.surfaceStrong,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  disabled: { opacity: 0.4 },
  input: {
    color: colors.foreground,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 0,
  },
});
