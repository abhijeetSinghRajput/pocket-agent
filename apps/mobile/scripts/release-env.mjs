// The environment every release is made with: the APK build and the over-the-air updates must use
// the same one, or an update's fingerprint wouldn't match the installed app (it would never apply).
export const releaseEnv = () => ({
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://pocket-agent-api.onrender.com',
  GOOGLE_SERVICES_JSON: './google-services.json',
});
