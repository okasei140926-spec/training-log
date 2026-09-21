/**
 * Feature flags.
 * Set BILLING_ENABLED = true when in-app purchase (RevenueCat/Stripe) is ready for production.
 */
export const BILLING_ENABLED = false;

/**
 * Supabase user IDs that can see the billing flow even when BILLING_ENABLED = false.
 * Set REACT_APP_BILLING_TEST_USER_IDS in .env.local (comma-separated UUIDs).
 */
export const BILLING_TEST_USER_IDS = (process.env.REACT_APP_BILLING_TEST_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Returns true if billing UI should be shown for this user.
 * Always true when BILLING_ENABLED, or when userId is in the test list.
 */
export const isBillingEnabled = (userId) =>
  BILLING_ENABLED || Boolean(userId && BILLING_TEST_USER_IDS.includes(userId));
