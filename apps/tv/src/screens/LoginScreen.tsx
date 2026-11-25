import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { LOGO_WORDMARK } from "@/assets";
import { FocusButton } from "@/components/FocusButton";
import {
  FocusableTextInput,
  type FocusableTextInputHandle,
} from "@/components/focusable-text-input";
import { setToken } from "@/lib/auth-token";
import { baseUrl } from "@/lib/config";
import { trpcClient } from "@/lib/trpc";
import { createStyles } from "@/lib/ui-scale";
import { colors, fontSize, monoFont, radius, spacing } from "@/theme";

type PairingState =
  | { status: "loading" }
  | {
      status: "ready";
      userCode: string;
      deviceCode: string;
      expiresAt: number;
      qrModules: QrModules;
      verificationUrl: string;
    }
  | { status: "error" };

type QrModules = {
  size: number;
  data: number[];
};

function createQrModules(verificationUrl: string): QrModules {
  const qr = QRCode.create(verificationUrl, { errorCorrectionLevel: "M" });
  return {
    size: qr.modules.size,
    data: Array.from(qr.modules.data),
  };
}

function qrRowKey(row: number): string {
  return `qr-row-${row}`;
}

function qrCellKey(row: number, column: number): string {
  return `qr-cell-${row}-${column}`;
}

function QrMatrix({ modules }: { modules: QrModules }) {
  const rows = Array.from({ length: modules.size }, (_, row) => (
    <View key={qrRowKey(row)} style={styles.qrRow}>
      {Array.from({ length: modules.size }, (_cell, column) => {
        const index = row * modules.size + column;
        return (
          <View
            key={qrCellKey(row, column)}
            style={[
              styles.qrCell,
              modules.data[index] === 1 && styles.qrCellDark,
            ]}
          />
        );
      })}
    </View>
  ));

  return <View style={styles.qrMatrix}>{rows}</View>;
}

/**
 * TV sign-in. Device pairing is the main path: the TV shows a code and QR
 * (`auth.startDevicePairing`), polls `auth.pollDevicePairing` until the user
 * confirms on another device, and replaces an expired code automatically.
 * Email + password on the remote's keyboard (`auth.deviceLogin`) remains as a
 * fallback. Either way the returned device JWT is stored.
 */
export function LoginScreen({
  onLoggedIn,
  onChangeServer,
}: {
  onLoggedIn: () => void;
  /** Back to the server screen, for a TV pointed at the wrong server. */
  onChangeServer?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pairingState, setPairingState] = useState<PairingState>({
    status: "loading",
  });
  const passwordInputRef = useRef<FocusableTextInputHandle>(null);

  const canSubmit = email.trim().length > 0 && password.length >= 8;

  const startPairing = useCallback(async () => {
    setPairingState({ status: "loading" });
    try {
      const pairing = await trpcClient.auth.startDevicePairing.mutate();
      const verificationUrl = `${baseUrl()}${pairing.verificationPath}`;
      setPairingState({
        status: "ready",
        userCode: pairing.userCode,
        deviceCode: pairing.deviceCode,
        expiresAt: pairing.expiresAt,
        verificationUrl,
        qrModules: createQrModules(verificationUrl),
      });
    } catch {
      setPairingState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    startPairing();
  }, [startPairing]);

  // The server may be briefly unreachable (Wi-Fi waking up, a restart); keep
  // trying rather than waiting for someone to find the Refresh button.
  useEffect(() => {
    if (pairingState.status !== "error") return;
    const retry = setTimeout(startPairing, 10_000);
    return () => clearTimeout(retry);
  }, [pairingState.status, startPairing]);

  useEffect(() => {
    if (pairingState.status !== "ready") return;

    let active = true;
    const poll = async () => {
      try {
        const result = await trpcClient.auth.pollDevicePairing.query({
          userCode: pairingState.userCode,
          deviceCode: pairingState.deviceCode,
        });
        if (!active) return;
        if (result.status === "approved") {
          await setToken(result.token);
          if (active) onLoggedIn();
          return;
        }
        // A code only lives ten minutes; nobody should have to find a button
        // to get a new one on a TV, so swap in a fresh code straight away.
        if (
          result.status === "expired" ||
          Date.now() >= pairingState.expiresAt
        ) {
          void startPairing();
        }
      } catch {
        if (active && Date.now() >= pairingState.expiresAt) {
          void startPairing();
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onLoggedIn, pairingState, startPairing]);

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

        <View style={styles.methods}>
          <View style={styles.qrSection}>
            <Text style={styles.sectionTitle}>Scan with phone</Text>
            <View style={styles.qrFrame}>
              {pairingState.status === "ready" ? (
                <QrMatrix modules={pairingState.qrModules} />
              ) : pairingState.status === "loading" ? (
                <ActivityIndicator color={colors.brand} size="large" />
              ) : (
                <Text style={styles.qrUnavailable}>QR unavailable</Text>
              )}
            </View>
            {pairingState.status === "ready" ? (
              <>
                <Text style={styles.codeLabel}>TV code</Text>
                <Text style={styles.code}>{pairingState.userCode}</Text>
                <Text style={styles.waiting}>Waiting for approval...</Text>
              </>
            ) : (
              <FocusButton
                label="Refresh QR"
                onPress={startPairing}
                style={styles.refreshButton}
              />
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.manualSection}>
            <Text style={styles.sectionTitle}>Use password</Text>
            <FocusableTextInput
              placeholder="Email"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              returnKeyType="next"
              hasTVPreferredFocus
            />
            <FocusableTextInput
              ref={passwordInputRef}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              returnKeyType="done"
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
      </View>
      {/* Outside the panel, which already fills the screen's height. */}
      {onChangeServer ? (
        <FocusButton
          label={`Server: ${baseUrl().replace(/^https?:\/\//, "")} · Change`}
          onPress={onChangeServer}
          style={styles.serverButton}
        />
      ) : null}
    </View>
  );
}

const styles = createStyles({
  serverButton: {
    position: "absolute",
    right: spacing.screen,
    bottom: spacing.screen,
    minHeight: 40,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    paddingHorizontal: spacing.screen,
  },
  panel: {
    width: 980,
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
  methods: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.xl,
  },
  qrSection: {
    width: 312,
    alignItems: "center",
    gap: spacing.md,
  },
  manualSection: {
    flex: 1,
    alignItems: "stretch",
    gap: spacing.lg,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  qrFrame: {
    width: 268,
    height: 268,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.card,
    backgroundColor: colors.primaryForeground,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  qrMatrix: {
    width: 244,
    height: 244,
    padding: 12,
    backgroundColor: colors.primaryForeground,
  },
  qrRow: {
    flex: 1,
    flexDirection: "row",
  },
  qrCell: {
    flex: 1,
    backgroundColor: colors.primaryForeground,
  },
  qrCellDark: {
    backgroundColor: colors.videoBackground,
  },
  qrUnavailable: {
    color: colors.background,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  codeLabel: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  code: {
    color: colors.foreground,
    fontFamily: monoFont,
    fontSize: fontSize.xl,
    fontWeight: "700",
  },
  waiting: {
    color: colors.mutedForeground,
    fontSize: fontSize.sm,
  },
  refreshButton: { alignSelf: "stretch" },
  divider: {
    width: 1,
    backgroundColor: colors.surfaceBorder,
  },
  error: {
    color: colors.destructive,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
  submit: { alignSelf: "stretch" },
});
