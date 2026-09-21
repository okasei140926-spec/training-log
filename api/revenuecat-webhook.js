import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET;

// RevenueCat event types that mean the subscription is active
const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "TRANSFER",
]);

// RevenueCat event types that mean the subscription ended
const INACTIVE_EVENTS = new Set([
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
  "SUBSCRIBER_ALIAS",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify Authorization header
  const authHeader = req.headers["authorization"] || "";
  if (WEBHOOK_SECRET) {
    const expected = `Bearer ${WEBHOOK_SECRET}`;
    if (authHeader !== expected) {
      console.warn("[revenuecat-webhook] unauthorized", { authHeader: authHeader.slice(0, 20) });
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  if (!adminSupabase) {
    console.error("[revenuecat-webhook] adminSupabase not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const event = body?.event;
  if (!event) {
    return res.status(400).json({ error: "Missing event" });
  }

  const eventType = event.type;
  const appUserId = event.app_user_id;
  const expirationAtMs = event.expiration_at_ms;
  const productId = event.product_id;

  console.log("[revenuecat-webhook]", { eventType, appUserId, productId, expirationAtMs });

  if (!appUserId) {
    return res.status(400).json({ error: "Missing app_user_id" });
  }

  const isActive = ACTIVE_EVENTS.has(eventType);
  const isInactive = INACTIVE_EVENTS.has(eventType);

  if (!isActive && !isInactive) {
    // Unhandled event type (e.g. TEST) — acknowledge but skip
    return res.status(200).json({ received: true, skipped: true, eventType });
  }

  const expiresAt = expirationAtMs ? new Date(Number(expirationAtMs)).toISOString() : null;

  const { error } = await adminSupabase
    .from("pump_pro_subscriptions")
    .upsert(
      {
        user_id: appUserId,
        active: isActive,
        provider: "revenuecat",
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[revenuecat-webhook] DB upsert failed", { error, appUserId, eventType });
    return res.status(500).json({ error: error.message });
  }

  console.log("[revenuecat-webhook] DB updated", { appUserId, eventType, isActive, expiresAt });
  return res.status(200).json({ received: true, eventType, isActive });
}
