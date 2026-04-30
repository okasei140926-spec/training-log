import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const authSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const adminSupabase =
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

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!authSupabase || !adminSupabase) {
    return res.status(500).json({ error: "Push通知の設定が不足しています。" });
  }

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return res.status(500).json({ error: "VAPIDキーが設定されていません。" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const {
    data: { user },
    error: userError,
  } = await authSupabase.auth.getUser(accessToken);

  if (userError || !user?.id) {
    return res.status(401).json({ error: "ログインが必要です" });
  }

  const { data: rows, error: rowsError } = await adminSupabase
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", user.id)
    .eq("enabled", true);

  if (rowsError) {
    return res.status(500).json({ error: "通知先の取得に失敗しました。" });
  }

  if (!rows?.length) {
    return res.status(400).json({ error: "通知が有効になっていません。" });
  }

  const payload = JSON.stringify({
    title: "IRON LOG",
    body: "通知テストです。記録リマインドやFriends通知に使われます。",
    url: "/",
  });

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: row.keys || {},
          },
          payload
        );
        return { ok: true, id: row.id };
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await adminSupabase
            .from("push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", row.id);
        }
        throw error;
      }
    })
  );

  const successCount = results.filter((result) => result.status === "fulfilled").length;

  if (successCount === 0) {
    return res.status(500).json({ error: "テスト通知の送信に失敗しました。" });
  }

  return res.status(200).json({ success: true, sent: successCount });
}
