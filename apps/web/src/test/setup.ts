// The gateway client and URL signer read their config on first use.
process.env.GATEWAY_SIGNING_KEY ??= "test-signing-key-test-signing-key";
process.env.GATEWAY_URL ??= "http://gateway.invalid";
