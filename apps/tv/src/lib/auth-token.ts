import * as SecureStore from "expo-secure-store";

// Device JWT from `auth.deviceLogin`, sent as `Authorization: Bearer <token>`.
// Stored in the OS keystore (expo-secure-store). JWEs stay well under the
// platform's ~2KB value limit, so no chunking is needed.
const TOKEN_KEY = "owntube.device-token";

export function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function setToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export function clearToken(): Promise<void> {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}
