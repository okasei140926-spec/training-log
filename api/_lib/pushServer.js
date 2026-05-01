import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { getBig3ExerciseKey } from "../../src/utils/exerciseName.js";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const authSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export const adminSupabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function pushServerReady() {
  return Boolean(
    authSupabase &&
      adminSupabase &&
      vapidPublicKey &&
      vapidPrivateKey &&
      vapidSubject
  );
}

export function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function authenticateRequest(req) {
  if (!authSupabase) return { user: null, error: new Error("authSupabase unavailable") };

  const accessToken = getBearerToken(req);
  if (!accessToken) return { user: null, error: new Error("missing bearer token") };

  const {
    data: { user },
    error,
  } = await authSupabase.auth.getUser(accessToken);

  return { user: user || null, error: error || null };
}

const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const cloneRecord = (record) => ({
  ...record,
  sets: Array.isArray(record?.sets)
    ? record.sets.map((set) => ({ ...set }))
    : record?.sets,
});

const buildHistoryRecordSignature = (record) => {
  const setsSignature = Array.isArray(record?.sets)
    ? record.sets
        .map((set) => `${set?.weight ?? ""}|${set?.reps ?? ""}|${set?.done ? 1 : 0}`)
        .join(";")
    : "";

  return [
    record?.date ?? "",
    setsSignature,
    record?.weight ?? "",
    record?.reps ?? "",
  ].join("::");
};

export function mergeHistoryMaps(...sources) {
  const merged = {};

  sources.forEach((source) => {
    if (!isPlainObject(source)) return;

    Object.entries(source).forEach(([exerciseName, records]) => {
      if (!exerciseName || !Array.isArray(records) || !records.length) return;

      if (!merged[exerciseName]) merged[exerciseName] = [];
      const seen = new Set(merged[exerciseName].map(buildHistoryRecordSignature));

      records.forEach((record) => {
        if (!record || typeof record !== "object") return;

        const signature = buildHistoryRecordSignature(record);
        if (seen.has(signature)) return;

        merged[exerciseName].push(cloneRecord(record));
        seen.add(signature);
      });
    });
  });

  Object.keys(merged).forEach((exerciseName) => {
    merged[exerciseName] = merged[exerciseName].sort((a, b) => {
      const dateCompare = String(a?.date || "").localeCompare(String(b?.date || ""));
      if (dateCompare !== 0) return dateCompare;

      const orderA = Number.isFinite(a?.order) ? a.order : 999;
      const orderB = Number.isFinite(b?.order) ? b.order : 999;
      return orderA - orderB;
    });

    if (!merged[exerciseName].length) delete merged[exerciseName];
  });

  return merged;
}

export function buildHistoryFromWorkoutRows(rows) {
  return mergeHistoryMaps(...(rows || []).map((row) => row?.data));
}

export function calc1RMFromSets(sets) {
  if (!sets || !sets.length) return 0;

  return Math.max(
    ...sets.map((set) => {
      if (!set?.weight || set.weight === "BW") return 0;
      const weight = Number(set.weight);
      const reps = Number(set.reps);
      if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) {
        return 0;
      }
      if (reps === 1) return weight;
      return weight * (1 + reps / 30);
    })
  );
}

export function getRecordSets(record) {
  if (!record) return [];
  return Array.isArray(record.sets) && record.sets.length > 0
    ? record.sets
    : [{ weight: record.weight, reps: record.reps }];
}

export function hasWorkoutOnDate(historyMap, workoutDate) {
  return Object.values(historyMap || {}).some((records) =>
    (records || []).some((record) => {
      if (!record || record.date !== workoutDate) return false;
      const sets = getRecordSets(record);
      return sets.some((set) => calc1RMFromSets([set]) > 0 || set?.weight === "BW");
    })
  );
}

export function excludeDateFromHistory(historyMap, excludedDate) {
  const next = {};

  Object.entries(historyMap || {}).forEach(([name, records]) => {
    const filtered = (records || []).filter((record) => record?.date !== excludedDate);
    if (filtered.length) next[name] = filtered.map(cloneRecord);
  });

  return next;
}

export function computeBig3FromHistory(historyMap, manualBestRows = []) {
  const bests = { bench: 0, squat: 0, deadlift: 0 };

  Object.entries(historyMap || {}).forEach(([name, records]) => {
    const key = getBig3ExerciseKey(name);
    if (!key) return;

    (records || []).forEach((record) => {
      const value = Math.round(calc1RMFromSets(getRecordSets(record)));
      if (value > bests[key]) bests[key] = value;
    });
  });

  (manualBestRows || []).forEach((best) => {
    const key = getBig3ExerciseKey(best?.exercise_name);
    if (!key) return;

    const value = Math.round(
      calc1RMFromSets([{ weight: best?.weight, reps: best?.reps }])
    );
    if (value > bests[key]) bests[key] = value;
  });

  return {
    ...bests,
    total: bests.bench + bests.squat + bests.deadlift,
  };
}

export function getLatestWorkoutDate(historyMap) {
  const dates = Object.values(historyMap || {})
    .flatMap((records) => (records || []).map((record) => record?.date).filter(Boolean))
    .sort();

  return dates[dates.length - 1] || null;
}

export async function getAcceptedFriendIds(userId) {
  const { data, error } = await adminSupabase
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  if (error) throw error;

  return [...new Set(
    (data || []).map((row) => (row.requester_id === userId ? row.receiver_id : row.requester_id))
  )];
}

export async function sendPushToUser({
  userId,
  title,
  body,
  url = "/",
  type,
  dedupeKey,
  payload = {},
}) {
  const { data: subscriptions, error: subscriptionError } = await adminSupabase
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", userId)
    .eq("enabled", true);

  if (subscriptionError) throw subscriptionError;
  if (!subscriptions?.length) {
    return { sent: false, skipped: true, reason: "no-subscriptions" };
  }

  const { error: insertError } = await adminSupabase
    .from("notification_events")
    .insert({
      user_id: userId,
      type,
      dedupe_key: dedupeKey,
      payload,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return { sent: false, skipped: true, reason: "duplicate" };
    }
    throw insertError;
  }

  const messagePayload = JSON.stringify({
    title,
    body,
    url,
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys || {},
          },
          messagePayload
        );
        return { ok: true, id: subscription.id };
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await adminSupabase
            .from("push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
        throw error;
      }
    })
  );

  const successCount = results.filter((result) => result.status === "fulfilled").length;

  if (successCount === 0) {
    await adminSupabase
      .from("notification_events")
      .delete()
      .eq("user_id", userId)
      .eq("dedupe_key", dedupeKey);

    return { sent: false, skipped: false, reason: "delivery-failed" };
  }

  await adminSupabase
    .from("notification_events")
    .update({ sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("dedupe_key", dedupeKey);

  return { sent: true, count: successCount };
}
