import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet } from "react-native";
import { Shell } from "@/components/Shell";
import { clearToken, getToken } from "@/lib/auth-token";
import { LoginScreen } from "@/screens/LoginScreen";
import { colors } from "@/theme";

type AuthState = "checking" | "signedOut" | "signedIn";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    getToken().then((token) => setAuth(token ? "signedIn" : "signedOut"));
  }, []);

  const signOut = () => {
    clearToken().then(() => setAuth("signedOut"));
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      {auth === "checking" ? (
        <ActivityIndicator
          style={styles.centered}
          size="large"
          color={colors.brand}
        />
      ) : auth === "signedIn" ? (
        <Shell onSignOut={signOut} />
      ) : (
        <LoginScreen onLoggedIn={() => setAuth("signedIn")} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1 },
});
