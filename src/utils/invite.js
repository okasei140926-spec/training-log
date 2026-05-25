export const PENDING_INVITE_CODE_KEY = "pendingInviteCode";
export const LEGACY_PENDING_FRIEND_ID_KEY = "pendingFriendId";

export const normalizeInviteCode = (value) => String(value || "").trim();

export const getInviteCodeFromLocation = (location = window.location) => {
  const searchParams = new URLSearchParams(location.search || "");
  const queryCode =
    searchParams.get("code") ||
    searchParams.get("token") ||
    searchParams.get("invite") ||
    searchParams.get("ref");
  if (queryCode) return normalizeInviteCode(queryCode);

  const pathParts = String(location.pathname || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const inviteIndex = pathParts.findIndex((part) => part.toLowerCase() === "invite");
  if (inviteIndex >= 0 && pathParts[inviteIndex + 1]) {
    return normalizeInviteCode(decodeURIComponent(pathParts[inviteIndex + 1]));
  }

  return "";
};

export const savePendingInviteCode = (code) => {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return "";
  localStorage.setItem(PENDING_INVITE_CODE_KEY, normalized);
  localStorage.setItem(LEGACY_PENDING_FRIEND_ID_KEY, normalized);
  return normalized;
};

export const loadPendingInviteCode = () =>
  normalizeInviteCode(
    localStorage.getItem(PENDING_INVITE_CODE_KEY) ||
    localStorage.getItem(LEGACY_PENDING_FRIEND_ID_KEY)
  );

export const clearPendingInviteCode = () => {
  localStorage.removeItem(PENDING_INVITE_CODE_KEY);
  localStorage.removeItem(LEGACY_PENDING_FRIEND_ID_KEY);
};

export const isInAppBrowser = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Line\/|Instagram|FBAN|FBAV|FB_IAB|Messenger|MicroMessenger|Twitter|TikTok|Bytedance/i.test(ua);
};

export async function processPendingInviteForUser({
  supabase,
  user,
  code = loadPendingInviteCode(),
} = {}) {
  const inviteCode = normalizeInviteCode(code);
  if (!supabase || !user?.id || !inviteCode) {
    return { status: "idle", message: "" };
  }

  if (inviteCode === user.id) {
    clearPendingInviteCode();
    return {
      status: "self",
      message: "自分自身の招待リンクなので追加できません。",
    };
  }

  const selectColumns = "id, username";
  const profileLookup = await supabase
    .from("profiles")
    .select(selectColumns)
    .eq("id", inviteCode)
    .maybeSingle();

  if (profileLookup.error) {
    console.error("[invite] profile lookup failed", {
      error: profileLookup.error,
      code: profileLookup.error?.code,
      message: profileLookup.error?.message,
      details: profileLookup.error?.details,
      hint: profileLookup.error?.hint,
      inviteCode,
      userId: user.id,
    });
    throw profileLookup.error;
  }

  const targetProfile = profileLookup.data;
  if (!targetProfile?.id) {
    return {
      status: "not_found",
      message: "招待リンクが無効、または期限切れです。",
    };
  }

  const friendshipPairFilter = `and(requester_id.eq.${user.id},receiver_id.eq.${targetProfile.id}),and(requester_id.eq.${targetProfile.id},receiver_id.eq.${user.id})`;
  const friendshipLookup = await supabase
    .from("friendships")
    .select("requester_id, receiver_id, status")
    .or(friendshipPairFilter);

  if (friendshipLookup.error) {
    console.error("[invite] friendship lookup failed", {
      error: friendshipLookup.error,
      code: friendshipLookup.error?.code,
      message: friendshipLookup.error?.message,
      details: friendshipLookup.error?.details,
      hint: friendshipLookup.error?.hint,
      inviteCode,
      userId: user.id,
      targetUserId: targetProfile.id,
    });
    throw friendshipLookup.error;
  }

  if ((friendshipLookup.data || []).some((item) => item.status === "accepted")) {
    clearPendingInviteCode();
    return {
      status: "already_friends",
      message: `${targetProfile.username || "このユーザー"}とはすでに友達です。`,
      friendId: targetProfile.id,
    };
  }

  const existingRows = friendshipLookup.data || [];
  const insertResult = existingRows.length > 0
    ? await supabase
        .from("friendships")
        .update({ status: "accepted" })
        .or(friendshipPairFilter)
    : await supabase.from("friendships").upsert({
        requester_id: user.id,
        receiver_id: targetProfile.id,
        status: "accepted",
      });

  if (insertResult.error) {
    console.error("[invite] friendship upsert failed", {
      error: insertResult.error,
      code: insertResult.error?.code,
      message: insertResult.error?.message,
      details: insertResult.error?.details,
      hint: insertResult.error?.hint,
      inviteCode,
      userId: user.id,
      targetUserId: targetProfile.id,
    });
    throw insertResult.error;
  }

  clearPendingInviteCode();
  return {
    status: "connected",
    message: `${targetProfile.username || "友達"}を追加しました。`,
    friendId: targetProfile.id,
  };
}
