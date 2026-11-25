import {
  Button,
  Form,
  Host,
  LabeledContent,
  Section,
  Text,
  TextField,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  disabled,
  foregroundStyle,
  keyboardType,
  onSubmit,
  submitLabel,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, PlatformColor, StyleSheet, View } from "react-native";
import {
  BUILT_IN_URL,
  changeServer,
  checkServer,
  normalizeServerUrl,
  SERVER_URL,
} from "@/lib/config";
import { forgetSession, getToken } from "@/lib/session";
import { trpc } from "@/lib/trpc";

type Account = { email: string; autoplayNext: boolean } | null;

/**
 * The app's own settings, natively: the server it opens, the playback
 * settings the native player uses, and the signed-in account. Everything else
 * stays on the web settings page ("All settings"), shared with the browser
 * and the TV.
 */
export default function SettingsScreen() {
  const [account, setAccount] = useState<Account | undefined>(undefined);
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);

  const loadAccount = useCallback(async () => {
    if (!(await getToken())) {
      setAccount(null);
      return;
    }
    try {
      const [me, settings] = await Promise.all([
        trpc.auth.me.query(),
        trpc.settings.get.query(),
      ]);
      setAccount({ email: me.email, autoplayNext: settings.autoplayNext });
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const setAutoplayNext = async (on: boolean) => {
    if (!account) return;
    setAccount({ ...account, autoplayNext: on });
    try {
      await trpc.settings.update.mutate({ autoplayNext: on });
    } catch {
      setAccount({ ...account, autoplayNext: !on });
    }
  };

  const connect = async () => {
    const url = normalizeServerUrl(address);
    if (!url) {
      Alert.alert("Not an address", "Enter the address you open in a browser.");
      return;
    }
    if (url === SERVER_URL) return;
    setChecking(true);
    const ok = await checkServer(url);
    setChecking(false);
    if (!ok) {
      Alert.alert(
        "No OwnTube server there",
        `${url} didn't answer as an OwnTube server. Check the address, and that this device can reach it.`,
      );
      return;
    }
    Alert.alert(
      "Switch server?",
      `The app reloads on ${url}. You sign in there separately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch",
          onPress: () => void changeServer(url, forgetSession),
        },
      ],
    );
  };

  const openWeb = (path: string, title: string) =>
    router.push({ pathname: "/library/page", params: { path, title } });

  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      {/* iPad: a readable column on the grouped background, as Settings. */}
      <View style={readable.page}>
        <Host style={readable.column}>
          <Form>
            <Section
              title="Server"
              footer={
                <Text
                  modifiers={[
                    foregroundStyle({
                      type: "hierarchical",
                      style: "secondary",
                    }),
                  ]}
                >
                  The OwnTube server this app opens: the address you use in a
                  browser.
                </Text>
              }
            >
              <LabeledContent label="Address">
                <Text>{SERVER_URL.replace(/^https?:\/\//, "")}</Text>
              </LabeledContent>
              <TextField
                placeholder="Another server, e.g. owntube.example.org"
                onTextChange={setAddress}
                modifiers={[
                  keyboardType("url"),
                  textInputAutocapitalization("never"),
                  autocorrectionDisabled(true),
                  submitLabel("go"),
                  onSubmit(() => void connect()),
                ]}
              />
              <Button
                label={checking ? "Checking…" : "Switch server"}
                onPress={() => void connect()}
                modifiers={[disabled(checking || !address.trim())]}
              />
              {SERVER_URL !== BUILT_IN_URL ? (
                <Button
                  label="Use the app's own server"
                  onPress={() => void changeServer(null, forgetSession)}
                />
              ) : null}
            </Section>

            <Section
              title="Playback"
              footer={
                account === null ? (
                  <Text
                    modifiers={[
                      foregroundStyle({
                        type: "hierarchical",
                        style: "secondary",
                      }),
                    ]}
                  >
                    Sign in to change playback settings.
                  </Text>
                ) : undefined
              }
            >
              <Toggle
                label="Autoplay next"
                systemImage="forward.end"
                isOn={account?.autoplayNext ?? true}
                onIsOnChange={(on) => void setAutoplayNext(on)}
                modifiers={[disabled(!account)]}
              />
            </Section>

            <Section title="Account">
              {account ? (
                <LabeledContent label="Signed in as">
                  <Text>{account.email}</Text>
                </LabeledContent>
              ) : (
                <Button
                  label="Sign in"
                  onPress={() => openWeb("/login", "Sign in")}
                />
              )}
              <Button
                label="All settings"
                systemImage="gearshape"
                onPress={() => openWeb("/settings", "All settings")}
              />
            </Section>

            <Section title="About">
              <LabeledContent label="Version">
                <Text>{Constants.expoConfig?.version ?? "–"}</Text>
              </LabeledContent>
            </Section>
          </Form>
        </Host>
      </View>
    </>
  );
}

const readable = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    backgroundColor: PlatformColor("systemGroupedBackground"),
  },
  column: { flex: 1, width: "100%", maxWidth: 720 },
});
