import { Capacitor } from "@capacitor/core";

export const NATIVE_OAUTH_REDIRECT_URL = "app.ironlog.traininglog://auth/callback";
const APPLE_OAUTH_ENABLED = String(process.env.REACT_APP_ENABLE_APPLE_OAUTH || "").toLowerCase() === "true";

export const isNativeApp = () => Capacitor.isNativePlatform();
export const isAppleOAuthEnabled = () => APPLE_OAUTH_ENABLED;

export const getOAuthRedirectUrl = () =>
  isNativeApp() ? NATIVE_OAUTH_REDIRECT_URL : window.location.origin;

export const isNativeOAuthCallbackUrl = (url) =>
  typeof url === "string" && url.startsWith("app.ironlog.traininglog://auth/");

export const getOAuthProviderLabel = (provider) =>
  provider === "apple" ? "Apple" : "Google";

export const getAppleOAuthDisabledMessage = () =>
  "Appleログインは現在準備中です。設定が完了したら利用できるようになります。";

export const getOAuthPendingFailureMessage = (provider, reason = "default") => {
  const providerLabel = getOAuthProviderLabel(provider);

  if (reason === "cancelled") {
    if (provider === "apple") {
      return "Appleログインの設定がまだ完了していません。管理者設定を確認してください。";
    }
    return `${providerLabel}ログインを完了できませんでした。画面を閉じた場合は、もう一度お試しください。`;
  }

  if (provider === "apple") {
    return "Appleログインの設定がまだ完了していません。管理者設定を確認してください。";
  }

  return `${providerLabel}ログインを完了できませんでした。もう一度お試しください。`;
};

export const getOAuthErrorMessage = (provider, error) => {
  const providerLabel = getOAuthProviderLabel(provider);
  const rawMessage = String(error?.message || "").trim();

  if (!rawMessage) {
    return `${providerLabel}ログインに失敗しました。もう一度お試しください。`;
  }

  if (rawMessage.includes("popup_closed_by_user")) {
    return `${providerLabel}ログインをキャンセルしました。`;
  }

  if (
    rawMessage.includes("invalid_client") ||
    rawMessage.includes("provider is not enabled") ||
    rawMessage.includes("unsupported provider") ||
    rawMessage.includes("client secret") ||
    rawMessage.includes("redirect_uri_mismatch")
  ) {
    return `${providerLabel}ログインの設定がまだ完了していません。管理者設定を確認してください。`;
  }

  if (rawMessage.includes("provider is not enabled")) {
    return `${providerLabel}ログインが有効化されていません。設定を確認してください。`;
  }

  return rawMessage;
};
