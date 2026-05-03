import { Capacitor } from "@capacitor/core";

export const NATIVE_OAUTH_REDIRECT_URL = "app.ironlog.traininglog://auth/callback";

export const isNativeApp = () => Capacitor.isNativePlatform();

export const getOAuthRedirectUrl = () =>
  isNativeApp() ? NATIVE_OAUTH_REDIRECT_URL : window.location.origin;

export const isNativeOAuthCallbackUrl = (url) =>
  typeof url === "string" && url.startsWith("app.ironlog.traininglog://auth/");

export const getOAuthProviderLabel = (provider) =>
  provider === "apple" ? "Apple" : "Google";

export const getOAuthErrorMessage = (provider, error) => {
  const providerLabel = getOAuthProviderLabel(provider);
  const rawMessage = String(error?.message || "").trim();

  if (!rawMessage) {
    return `${providerLabel}ログインに失敗しました。もう一度お試しください。`;
  }

  if (rawMessage.includes("popup_closed_by_user")) {
    return `${providerLabel}ログインをキャンセルしました。`;
  }

  if (rawMessage.includes("provider is not enabled")) {
    return `${providerLabel}ログインが有効化されていません。設定を確認してください。`;
  }

  return rawMessage;
};
