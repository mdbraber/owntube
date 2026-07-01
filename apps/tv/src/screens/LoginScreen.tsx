import { useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { LOGO_WORDMARK } from "@/assets";
import { FocusButton } from "@/components/FocusButton";
import { setToken } from "@/lib/auth-token";
import { trpcClient } from "@/lib/trpc";
import { colors, focus, fontSize, radius, spacing } from "@/theme";

type FocusedField = "email" | "password" | null;

/**
 * V1 TV login: email + password typed on the remote's virtual keyboard, calls
 * the `auth.deviceLogin` procedure, and stores the returned device JWT. A
 * device-pairing flow (TV shows a code, confirm from phone) replaces this later.
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);

  const canSubmit = email.trim().length > 0 && password.length >= 8;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { token } = await trpcClient.auth.deviceLogin.mutate({
        email: email.trim(),
        password,
      });
      await setToken(token);
      onLoggedIn();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Sign in failed. Try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <Image
          source={LOGO_WORDMARK}
          style={styles.wordmark}
          resizeMode="contain"
        />
        <Text style={styles.heading}>Sign in</Text>

        <TextInput
          style={[
            styles.input,
            focusedField === "email" && styles.inputFocused,
          ]}
          placeholder="Email"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocusedField("email")}
          onBlur={() => setFocusedField(null)}
          hasTVPreferredFocus
        />
        <TextInput
          style={[
            styles.input,
            focusedField === "password" && styles.inputFocused,
          ]}
          placeholder="Password"
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FocusButton
          label="Sign in"
          variant="primary"
          disabled={!canSubmit}
          loading={submitting}
          onPress={submit}
          style={styles.submit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    paddingHorizontal: spacing.screen,
  },
  panel: {
    width: 620,
    alignItems: "stretch",
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
    shadowColor: colors.shadow,
    shadowOpacity: 0.38,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
  wordmark: { width: 210, height: 46, alignSelf: "center" },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
    textAlign: "center",
  },
  input: {
    color: colors.foreground,
    fontSize: fontSize.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.shell,
    backgroundColor: colors.surface,
    borderWidth: focus.borderWidth,
    borderColor: colors.surfaceBorder,
  },
  inputFocused: {
    borderColor: colors.ring,
    backgroundColor: colors.surfaceStrong,
    shadowColor: colors.brand,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  error: {
    color: colors.destructive,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  submit: { alignSelf: "stretch" },
});
