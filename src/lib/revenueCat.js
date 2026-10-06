import { Capacitor } from "@capacitor/core";
import { LOG_LEVEL, Purchases } from "@revenuecat/purchases-capacitor";

const ENTITLEMENT_ID = process.env.REACT_APP_REVENUECAT_ENTITLEMENT_ID || "pro";

let configuredUserId = "";
let customerInfoListenerId = "";
let latestCustomerInfoListener = null;

// Resolves when Purchases.configure() has successfully completed.
// Functions that call RC APIs (getOfferings etc.) must await this first.
let _rcConfiguredResolve = null;
const _rcConfiguredPromise = new Promise((resolve) => {
  _rcConfiguredResolve = resolve;
});
let _rcConfigured = false;

// Module load time — used as the epoch for elapsed-time logging.
const _appStartedAt = Date.now();

// True when RC was configured without an appUserID (anonymous session).
// Reset to false once a real user ID is associated via Purchases.logIn().
let _configuredAnonymously = false;

const markRcConfigured = () => {
  if (_rcConfigured) return;
  _rcConfigured = true;
  _rcConfiguredResolve?.();
};

// Rejects a promise after `ms` milliseconds with a labelled timeout error.
// Used to prevent any RC SDK call from hanging the UI indefinitely.
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}-timeout`)), ms)
    ),
  ]);

// Waits for RC to be configured, but rejects after `ms` milliseconds.
// This prevents getRevenueCatPriceString from hanging forever when
// configureRevenueCatForUser has not completed (e.g. offline on launch).
// Default is 3 s; callers may pass a longer value for manual-retry paths.
const waitForRcConfiguredWithTimeout = (ms = 3000) =>
  withTimeout(_rcConfiguredPromise, ms, "rc-configure");

// --- RevenueCat timeout constants ---
//
// PURCHASE path (purchaseRevenueCatPro → getCurrentPackage):
//   RC_PURCHASE_OFFERINGS_TIMEOUT_MS — getOfferings() timeout when called during purchase.
//   Extended to 20 s after real-device measurement: getOfferings took 2049 ms in Apple
//   sandbox on iPad Air M3 / iPadOS 27.0.1. The previous hard-coded 3 s default caused
//   "getOfferings-timeout" → purchase-failed in App Store review (Guideline 2.1(b)).
//   Intentionally kept finite (never infinite) so a hung StoreKit call does not
//   freeze the purchase UI forever.
//
// DISPLAY path (getRevenueCatPriceString):
//   Controlled by the caller (ProPaywallModal.jsx: TIMEOUT_AUTO=10 s, TIMEOUT_MANUAL=15 s).
//   Deadline timers (DEADLINE_AUTO=20 s, DEADLINE_MANUAL=30 s) also live in ProPaywallModal.jsx.
//   These are intentionally separate: the display path has its own retry/deadline logic
//   that the purchase path does not share.
const RC_PURCHASE_OFFERINGS_TIMEOUT_MS = 20_000;

// --- Package cache ---
// Stores the Package object from the most recent successful getCurrentPackage() call.
// purchaseRevenueCatPro reuses it to skip a redundant getOfferings() round-trip:
// the same package was already validated when the price string was shown in the paywall.
//
// TTL: 5 minutes — long enough to cover the normal purchase flow (user reads paywall →
// taps buy), short enough to avoid stale product data if the app stays open across a
// price-change event.
const _PACKAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _cachedPackage = null;
let _cachedPackageAt = 0;

const getCachedPackage = () => {
  if (!_cachedPackage) return null;
  if (Date.now() - _cachedPackageAt > _PACKAGE_CACHE_TTL_MS) {
    _cachedPackage = null;
    _cachedPackageAt = 0;
    return null;
  }
  return _cachedPackage;
};

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
    if (configuredUserId === userId) {
      // Already configured for this user — skip configure/logIn, proceed to listener setup.
    } else if (!configuredUserId && !_configuredAnonymously) {
      // Never configured at all — configure with the real user ID directly.
      // (Occurs when the app launches with a session already established.)
      console.log("[WP] revenuecat:configure", {
        phase: "started",
        appUserId: "identified",
        elapsedMs: Date.now() - _appStartedAt,
        reason: null,
      });
      if (process.env.NODE_ENV !== "production") {
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      }
      await Purchases.configure({
        apiKey: getRevenueCatApiKey(),
        appUserID: userId,
      });
      configuredUserId = userId;
      markRcConfigured();
      console.log("[WP] revenuecat:configure", {
        phase: "succeeded",
        appUserId: "identified",
        elapsedMs: Date.now() - _appStartedAt,
        reason: null,
      });
    } else if (_configuredAnonymously && !configuredUserId) {
      // Was configured anonymously — now associating with a real user ID.
      // Purchases.logIn() migrates any anonymous purchases to the real user.
      const loginStartedAt = Date.now();
      const loginResult = await Purchases.logIn({ appUserID: userId });
      _configuredAnonymously = false;
      configuredUserId = userId;
      // markRcConfigured() was already called in configureRevenueCatAnonymously.
      console.log("[WP] revenuecat:login", {
        fromAnonymous: true,
        elapsedMs: Date.now() - loginStartedAt,
      });
      if (loginResult?.customerInfo) latestCustomerInfoListener?.(loginResult.customerInfo);
    } else if (configuredUserId !== userId) {
      // Switching between two identified users (e.g. account switch).
      const loginStartedAt = Date.now();
      const loginResult = await Purchases.logIn({ appUserID: userId });
      configuredUserId = userId;
      markRcConfigured();
      console.log("[WP] revenuecat:login", {
        fromAnonymous: false,
        elapsedMs: Date.now() - loginStartedAt,
      });
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

// Configure RevenueCat with an anonymous user ID so that getOfferings() and
// purchasePackage() work before the user has logged in.  This is the correct
// RevenueCat flow for unauthenticated users: configure → purchase, then
// logIn(userId) once the user authenticates to migrate the purchase.
//
// Must be called at app startup (before any paywall is shown).  Idempotent —
// subsequent calls are silently skipped when RC is already configured.
export const configureRevenueCatAnonymously = async () => {
  const availability = getRevenueCatAvailability();
  if (!availability.native) {
    return { configured: false, reason: "not-native" };
  }
  if (!availability.configured) {
    return { configured: false, reason: "missing-api-key" };
  }
  if (configuredUserId || _configuredAnonymously) {
    console.log("[WP] revenuecat:configure", {
      phase: "skipped",
      appUserId: configuredUserId ? "identified" : "anonymous",
      elapsedMs: Date.now() - _appStartedAt,
      reason: configuredUserId ? "already-identified" : "already-anonymous",
    });
    return { configured: true, reason: "already-configured" };
  }

  console.log("[WP] revenuecat:configure", {
    phase: "started",
    appUserId: "anonymous",
    elapsedMs: Date.now() - _appStartedAt,
    reason: null,
  });
  try {
    if (process.env.NODE_ENV !== "production") {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    }
    await Purchases.configure({ apiKey: getRevenueCatApiKey() });
    _configuredAnonymously = true;
    markRcConfigured();
    console.log("[WP] revenuecat:configure", {
      phase: "succeeded",
      appUserId: "anonymous",
      elapsedMs: Date.now() - _appStartedAt,
      reason: null,
    });
    return { configured: true };
  } catch (error) {
    const reason = error?.message || String(error);
    console.warn("[WP] revenuecat:configure", {
      phase: "failed",
      appUserId: "anonymous",
      elapsedMs: Date.now() - _appStartedAt,
      reason,
    });
    return { configured: false, reason, error };
  }
};

// timeoutMs controls both the configure-wait timeout and the getOfferings timeout.
// Display path callers (getRevenueCatPriceString) pass their own value.
// Purchase path callers (purchaseRevenueCatPro) use RC_PURCHASE_OFFERINGS_TIMEOUT_MS.
const getCurrentPackage = async (timeoutMs = RC_PURCHASE_OFFERINGS_TIMEOUT_MS) => {
  await waitForRcConfiguredWithTimeout(timeoutMs);
  // getOfferings() queries StoreKit / App Store and can hang indefinitely
  // if the store is unreachable (observed in reviewer environment).
  const offerings = await withTimeout(Purchases.getOfferings(), timeoutMs, "getOfferings");
  const currentOffering = offerings?.current || Object.values(offerings?.all || {})[0] || null;
  const pkg = (
    currentOffering?.monthly ||
    currentOffering?.annual ||
    currentOffering?.availablePackages?.[0] ||
    null
  );
  // Populate cache so purchaseRevenueCatPro can skip the next getOfferings() call.
  if (pkg) {
    _cachedPackage = pkg;
    _cachedPackageAt = Date.now();
  }
  return pkg;
};

/**
 * Returns the localized price string for the default monthly package,
 * e.g. "¥480". Throws if not on native or if no price is available.
 * Callers should handle the error and show a retry UI instead of a
 * hardcoded fallback price.
 * @param {number} [timeoutMs=3000] Per-call timeout passed to getCurrentPackage.
 */
export const getRevenueCatPriceString = async (timeoutMs = 3000) => {
  if (!isNativePlatform()) throw new Error("not-native");
  const pkg = await getCurrentPackage(timeoutMs);
  const price = pkg?.product?.priceString;
  if (!price) throw new Error("no-price");
  return price; // e.g. "¥480"
};

export const purchaseRevenueCatPro = async (user, onCustomerInfoUpdated) => {
  let configured;
  if (user?.id) {
    // Authenticated user — configure with real user ID (handles anonymous→identified migration).
    configured = await configureRevenueCatForUser(user, onCustomerInfoUpdated);
  } else if (_rcConfigured) {
    // RC is already configured anonymously — reuse it so the purchase proceeds without login.
    // latestCustomerInfoListener is updated so the result callback reaches the caller.
    latestCustomerInfoListener = onCustomerInfoUpdated;
    configured = { configured: true, available: true };
  } else {
    // Neither a user ID nor a prior configure — attempt anonymous configure as last resort.
    const anonResult = await configureRevenueCatAnonymously();
    latestCustomerInfoListener = onCustomerInfoUpdated;
    if (!anonResult.configured) {
      return { success: false, available: getRevenueCatAvailability().native, configured: false, reason: anonResult.reason || "configure-failed" };
    }
    configured = { configured: true, available: true };
  }
  if (!configured.configured) return { success: false, ...configured };

  const purchaseStartedAt = Date.now();
  const logPurchaseState = (state, extra = {}) => {
    console.log("[WP] paywall:state", {
      state,
      elapsedMs: Date.now() - purchaseStartedAt,
      packageId: extra.packageId ?? null,
      errorCode: extra.errorCode ?? null,
      errorMessage: extra.errorMessage ?? null,
      isSandbox: extra.isSandbox ?? null,
      timeoutKind: extra.timeoutKind ?? null,
      timeoutMs: extra.timeoutMs ?? null,
      fromCache: extra.fromCache ?? null,
    });
  };

  // Track which phase threw, so the catch block can attribute the timeout correctly.
  let _purchasePhase = "offerings"; // "offerings" | "purchase"

  try {
    // ■2: Reuse the package already fetched for price display.
    // getCachedPackage() returns the object if it was fetched within the last 5 minutes.
    // This avoids a redundant getOfferings() round-trip and eliminates the race where
    // the purchase-path timeout (previously 3 s) fired before StoreKit responded.
    let aPackage = getCachedPackage();
    const fromCache = Boolean(aPackage);
    if (!aPackage) {
      // Cache miss or stale — fall back to a fresh fetch with the extended purchase timeout.
      aPackage = await getCurrentPackage(RC_PURCHASE_OFFERINGS_TIMEOUT_MS);
    }

    if (!aPackage) {
      console.warn("[RevenueCat] no package available for purchase");
      return { success: false, available: true, configured: true, reason: "no-package" };
    }

    const packageId = aPackage?.identifier || aPackage?.product?.identifier || null;
    logPurchaseState("purchase-started", { packageId, fromCache });

    _purchasePhase = "purchase";
    const result = await Purchases.purchasePackage({ aPackage });
    const customerInfo = result?.customerInfo;
    onCustomerInfoUpdated?.(customerInfo);
    const plan = buildRevenueCatPlan(customerInfo);
    logPurchaseState("purchase-succeeded", {
      packageId,
      isSandbox: plan.isSandbox ?? null,
      fromCache,
    });
    return {
      success: isRevenueCatCustomerPro(customerInfo),
      // purchaseCompleted: true when purchasePackage resolved without throwing.
      // Even if entitlement is not yet reflected (success: false), this flag
      // lets activatePumpPro distinguish "API call succeeded but entitlement delayed"
      // from "API call failed / user cancelled".
      purchaseCompleted: true,
      customerInfo,
      plan,
      productIdentifier: result?.productIdentifier || null,
    };
  } catch (error) {
    const serialized = serializeRevenueCatError(error);
    console.warn("[RevenueCat] purchase failed", serialized);

    // Determine which timeout fired (if any) so the log can attribute it precisely.
    // Error messages come from withTimeout's label: e.g. "getOfferings-timeout", "rc-configure-timeout".
    const _isTimeout = Boolean(serialized.message?.endsWith("-timeout"));
    const _timeoutKind = !_isTimeout ? null
      : (_purchasePhase === "offerings" ? "purchase-offerings" : "purchase-package");
    const _timeoutMs = _timeoutKind === "purchase-offerings" ? RC_PURCHASE_OFFERINGS_TIMEOUT_MS : null;

    logPurchaseState(serialized.userCancelled ? "purchase-cancelled" : "purchase-failed", {
      errorCode: serialized.code ?? null,
      errorMessage: serialized.message ?? null,
      timeoutKind: _timeoutKind,
      timeoutMs: _timeoutMs,
    });
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
