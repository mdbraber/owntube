import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  View,
} from "react-native";
import { Shell } from "@/components/Shell";
import {
  clearAllProfiles,
  clearToken,
  getToken,
  labelActiveProfile,
  listProfiles,
  onSessionExpired,
} from "@/lib/auth-token";
import { loadServerUrl } from "@/lib/config";
import { persister, queryClient } from "@/lib/query-client";
import { trpcClient } from "@/lib/trpc";
import { TrpcProvider } from "@/lib/trpc-react";
import { WatchProgressProvider } from "@/lib/watch-progress";
import { LoginScreen } from "@/screens/LoginScreen";
import { ProfilesScreen } from "@/screens/ProfilesScreen";
import { ServerScreen } from "@/screens/ServerScreen";
import { colors } from "@/theme";

/**
 * "server": choosing (or changing) the OwnTube server, before sign-in.
 * "profiles": Who's watching, when the TV holds more than one account.
 */
type AuthState = "checking" | "server" | "profiles" | "signedOut" | "signedIn";

/** Nothing of one account (or server) may show under the next. */
async function dropCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}

/** Once a profile signs out: pick another if the TV has one, else sign in. */
async function nextAfterLeaving(): Promise<AuthState> {
  const rest = await listProfiles();
  return rest.length > 0 ? "profiles" : "signedOut";
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  // Who's watching opened from a signed-in session covers the shell rather
  // than replacing it, so Back returns to the very screen and card it was
  // opened from. At start, or once a profile has left, it is the "profiles"
  // state instead, with nothing to go back to.
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Bumped when another account is chosen: its shell starts fresh. */
  const [shellKey, setShellKey] = useState(0);

  useEffect(() => {
    Promise.all([loadServerUrl(), getToken(), listProfiles()]).then(
      ([server, token, profiles]) => {
        // Ask for a server only on a fresh install: a TV already signed in
        // predates the setting and keeps using the server it was built for.
        setAuth(
          profiles.length > 1
            ? "profiles"
            : token
              ? "signedIn"
              : server
                ? "signedOut"
                : "server",
        );
      },
    );
  }, []);

  // Name the active profile after its account, once signed in.
  useEffect(() => {
    if (auth !== "signedIn") return;
    trpcClient.auth.me
      .query()
      .then((me) => labelActiveProfile(me.email))
      .catch(() => {});
  }, [auth]);

  /** Where to go once the active profile is gone. */
  const afterLeaving = () => nextAfterLeaving().then((next) => setAuth(next));

  useEffect(
    () =>
      onSessionExpired(() => {
        void dropCache();
        void nextAfterLeaving().then((next) => setAuth(next));
      }),
    [],
  );

  /** Signs this profile out; any others stay on the TV. */
  const signOut = () => {
    clearToken()
      .then(dropCache)
      .finally(() => void afterLeaving());
  };

  // The cache goes once another account is chosen (see ProfilesScreen), not
  // on the way in: backing out keeps the current profile and what it loaded.
  const switchProfile = () => setPickerOpen(true);

  /** Another server's accounts don't apply: every profile goes. */
  const changeServer = () => {
    clearAllProfiles()
      .then(dropCache)
      .finally(() => setAuth("server"));
  };

  return (
    <TrpcProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar hidden />
        {auth === "checking" ? (
          <ActivityIndicator
            style={styles.centered}
            size="large"
            color={colors.brand}
          />
        ) : auth === "signedIn" ? (
          <WatchProgressProvider key={shellKey}>
            <Shell
              onSignOut={signOut}
              onChangeServer={changeServer}
              onSwitchProfile={switchProfile}
              suspended={pickerOpen}
            />
            {pickerOpen ? (
              <View style={StyleSheet.absoluteFill}>
                <ProfilesScreen
                  onChosen={(changed) => {
                    setPickerOpen(false);
                    if (changed) {
                      void dropCache();
                      setShellKey((k) => k + 1);
                    }
                  }}
                  onAdd={() => {
                    setPickerOpen(false);
                    void dropCache();
                    setAuth("signedOut");
                  }}
                  onBack={() => setPickerOpen(false)}
                />
              </View>
            ) : null}
          </WatchProgressProvider>
        ) : auth === "profiles" ? (
          <ProfilesScreen
            onChosen={(changed) => {
              if (changed) void dropCache();
              setAuth("signedIn");
            }}
            onAdd={() => {
              void dropCache();
              setAuth("signedOut");
            }}
          />
        ) : auth === "server" ? (
          <ServerScreen onDone={() => setAuth("signedOut")} />
        ) : (
          <LoginScreen
            onLoggedIn={() => setAuth("signedIn")}
            onChangeServer={() => setAuth("server")}
          />
        )}
      </SafeAreaView>
    </TrpcProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1 },
});
