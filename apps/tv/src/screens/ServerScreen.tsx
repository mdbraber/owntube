import { useState } from "react";
import { Image, Text, View } from "react-native";
import { LOGO_WORDMARK } from "@/assets";
import { FocusButton } from "@/components/FocusButton";
import { FocusableTextInput } from "@/components/focusable-text-input";
import {
  BUILT_IN_URL,
  baseUrl,
  checkServer,
  normalizeServerUrl,
  saveServerUrl,
} from "@/lib/config";
import { createStyles } from "@/lib/ui-scale";
import { colors, fontSize, radius, spacing } from "@/theme";

/**
 * First run (and Settings → Server → Change): which OwnTube server this TV
 * uses. Checks that an OwnTube answers there before saving, so a typo or a
 * proxy's placeholder page never gets as far as sign-in.
 */
export function ServerScreen({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState(baseUrl());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const url = normalizeServerUrl(text);
    if (!url) {
      setError("Enter the server's address, e.g. owntube.example.org");
      return;
    }
    setChecking(true);
    setError(null);
    const ok = await checkServer(url);
    setChecking(false);
    if (!ok) {
      setError(`No OwnTube server answered at ${url}`);
      return;
    }
    await saveServerUrl(url);
    onDone();
  };

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <Image
          source={LOGO_WORDMARK}
          style={styles.wordmark}
          resizeMode="contain"
        />
        <Text style={styles.heading}>Connect to your server</Text>
        <Text style={styles.body}>
          The address you open OwnTube at in a browser.
        </Text>
        <FocusableTextInput
          value={text}
          onChangeText={setText}
          placeholder={BUILT_IN_URL}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
          hasTVPreferredFocus
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FocusButton
          label="Connect"
          variant="primary"
          loading={checking}
          onPress={() => void connect()}
        />
      </View>
    </View>
  );
}

const styles = createStyles({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  panel: {
    width: 560,
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.cardElevated,
  },
  wordmark: { width: 210, height: 46, alignSelf: "center" },
  heading: {
    color: colors.foreground,
    fontSize: fontSize.xl,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: colors.mutedForeground,
    fontSize: fontSize.md,
    textAlign: "center",
  },
  error: { color: colors.destructive, fontSize: fontSize.md },
});
