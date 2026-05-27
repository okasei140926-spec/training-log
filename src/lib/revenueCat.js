import { Capacitor } from "@capacitor/core";
import { LOG_LEVEL, Purchases } from "@revenuecat/purchases-capacitor";

const ENTITLEMENT_ID = process.env.REACT_APP_REVENUECAT_ENTITLEMENT_ID || "pro";

let configuredUserId = "";
let customerInfoListenerId = "";
let latestCustomerInfoListener = null;

const getPlatform = () => {
  try {
    return Capacitor.getPlatform();
  } catch {
    return "web";
  }
};

const isNativePlatform = () => {
  try {
    return Boolean(Capacitor.isNativePlatform?.());
  } catch {
    return false;
  }
};

const getRevenueCatApiKey = () => {
  const platform = getPlatform();
  if (platform === "ios") {
    return process.env.REACT_APP_REVENUECAT_IOS_API_KEY || process.env.REACT_APP_REVENUECAT_API_KEY || "";
  }
  if (platform === "android") {
    return process.env.REACT_APP_REVENUECAT_ANDROID_API_KEY || process.env.REACT_APP_REVENUECAT_API_KEY || "";
  }
  return process.env.REACT_APP_REVENUECAT_API_KEY || "";
};

const serializeRevenueCatError = (error) => ({
  message: error?.message || String(error || "unknown error"),
  code: error?.code || null,
  underlyingErrorMessage: error?.underlyingErrorMessage || null,
  userCancelled: Boolean(error?.userCancelled || error?.cancelled || error?.code === "PURCHASE_CANCELLED"),
});

export const getRevenueCatAvailability = () => {
  const platform = getPlatform();
  const apiKey = getRevenueCatApiKey();
  return {
    platform,
    native: isNativePlatform(),
    configured: Boolean(apiKey),
    entitlementId: ENTITLEMENT_ID,
  };
};

export const isRevenueCatCustomerPro = (customerInfo) =>
  Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]?.isActive);

export const buildRevenueCatPlan = (customerInfo) => {
  const entitlement = customerInfo?.entitlements?.active?.[ENTITLEMENT_ID] || null;
  const isPro = Boolean(entitlement?.isActive);
  return {
    isPro,
    status: isPro ? "pro" : "free",
    label: isPro ? "Pro" : "Free",
    renewalStopped: isPro ? entitlement?.willRenew === false : false,
    expiresAt: entitlement?.expirationDate || customerInfo?.latestExpirationDate || null,
    managementURL: customerInfo?.managementURL || null,
    provider: "revenuecat",
    entitlementId: ENTITLEMENT_ID,
    productIdentifier: entitlement?.productIdentifier || null,
    isSandbox: Boolean(entitlement?.isSandbox),
  };
};

export const configureRevenueCatForUser = async (user, onCustomerInfoUpdated) => {
  const userId = user?.id || "";
  const availability = getRevenueCatAvailability();
  if (!availability.native) {
    return { available: false, configured: false, reason: "not-native", availability };
  }
  if (!availability.configured) {
    console.warn("[RevenueCat] API key is not configured", availability);
    return { available: false, configured: false, reason: "missing-api-key", availability };
  }
  if (!userId) {
    return { available: true, configured: false, reason: "missing-user-id", availability };
  }

  latestCustomerInfoListener = onCustomerInfoUpdated;

  try {
    if (!configuredUserId) {
      if (process.env.NODE_ENV !== "production") {
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      }
      await Purchases.configure({
        apiKey: getRevenueCatApiKey(),
        appUserID: userId,
      });
      configuredUserId = userId;
    } else if (configuredUserId !== userId) {
      const loginResult = await Purchases.logIn({ appUserID: userId });
      configuredUserId = userId;
      if (loginResult?.customerInfo) latestCustomerInfoListener?.(loginResult.customerInfo);
    }

    await Purchases.setAttributes({
      supabase_user_id: userId,
    }).catch((error) => {
      console.warn("[RevenueCat] setAttributes failed", serializeRevenueCatError(error));
    });

    if (user?.email) {
      await Purchases.setEmail({ email: user.email }).catch((error) => {
        console.warn("[RevenueCat] setEmail failed", serializeRevenueCatError(error));
      });
    }

    if (!customerInfoListenerId && typeof latestCustomerInfoListener === "function") {
      customerInfoListenerId = await Purchases.addCustomerInfoUpdateListener((customerInfo) => {
        latestCustomerInfoListener?.(customerInfo);
      });
    }

    const { customerInfo } = await Purchases.getCustomerInfo();
    latestCustomerInfoListener?.(customerInfo);
    console.log("[RevenueCat] configured", {
      platform: availability.platform,
      user_id: userId,
      entitlementId: ENTITLEMENT_ID,
      isPro: isRevenueCatCustomerPro(customerInfo),
      managementURL: customerInfo?.managementURL || null,
    });
    return { available: true, configured: true, customerInfo, plan: buildRevenueCatPlan(customerInfo), availability };
  } catch (error) {
    console.error("[RevenueCat] configure failed", {
      user_id: userId,
      availability,
      error: serializeRevenueCatError(error),
    });
    return { available: true, configured: false, reason: "configure-failed", error, availability };
  }
};

const getCurrentPackage = async () => {
  const offerings = await Purchases.getOfferings();
  const currentOffering = offerings?.current || Object.values(offerings?.all || {})[0] || null;
  return (
    currentOffering?.monthly ||
    currentOffering?.annual ||
    currentOffering?.availablePackages?.[0] ||
    null
  );
};

export const purchaseRevenueCatPro = async (user, onCustomerInfoUpdated) => {
  const configured = await configureRevenueCatForUser(user, onCustomerInfoUpdated);
  if (!configured.configured) return { success: false, ...configured };

  try {
    const aPackage = await getCurrentPackage();
    if (!aPackage) {
      console.warn("[RevenueCat] no package available for purchase");
      return { success: false, available: true, configured: true, reason: "no-package" };
    }

    const result = await Purchases.purchasePackage({ aPackage });
    const customerInfo = result?.customerInfo;
    onCustomerInfoUpdated?.(customerInfo);
    return {
      success: isRevenueCatCustomerPro(customerInfo),
      customerInfo,
      plan: buildRevenueCatPlan(customerInfo),
      productIdentifier: result?.productIdentifier || null,
    };
  } catch (error) {
    const serialized = serializeRevenueCatError(error);
    console.warn("[RevenueCat] purchase failed", serialized);
    return {
      success: false,
      available: true,
      configured: true,
      cancelled: serialized.userCancelled,
      reason: serialized.userCancelled ? "cancelled" : "purchase-failed",
      error,
    };
  }
};

export const restoreRevenueCatPurchases = async (user, onCustomerInfoUpdated) => {
  const configured = await configureRevenueCatForUser(user, onCustomerInfoUpdated);
  if (!configured.configured) return { success: false, ...configured };

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    onCustomerInfoUpdated?.(customerInfo);
    return {
      success: isRevenueCatCustomerPro(customerInfo),
      customerInfo,
      plan: buildRevenueCatPlan(customerInfo),
    };
  } catch (error) {
    console.warn("[RevenueCat] restore failed", serializeRevenueCatError(error));
    return { success: false, available: true, configured: true, reason: "restore-failed", error };
  }
};

export const refreshRevenueCatCustomerInfo = async (user, onCustomerInfoUpdated) => {
  const configured = await configureRevenueCatForUser(user, onCustomerInfoUpdated);
  if (!configured.configured) return { success: false, ...configured };

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    onCustomerInfoUpdated?.(customerInfo);
    return {
      success: true,
      customerInfo,
      plan: buildRevenueCatPlan(customerInfo),
    };
  } catch (error) {
    console.warn("[RevenueCat] customer info refresh failed", serializeRevenueCatError(error));
    return { success: false, available: true, configured: true, reason: "refresh-failed", error };
  }
};
