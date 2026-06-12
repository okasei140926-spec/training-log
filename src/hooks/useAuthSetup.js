import { useCallback, useEffect, useRef } from "react";
import { isSupabaseConfigured, supabase } from "../utils/supabase";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeApp, isNativeOAuthCallbackUrl } from "../utils/oauth";
import {
    getInviteCodeFromLocation,
    processPendingInviteForUser,
    savePendingInviteCode,
} from "../utils/invite";
import { debugLog } from "../utils/appHelpers";

export function useAuthSetup({
    user,
    setUser,
    setAuthReady,
    setShowAuth,
    setScreen,
}) {
    const processingInviteCodeRef = useRef("");
    const ensuredProfileUserIdsRef = useRef(new Set());
    const ensuringProfileUserIdsRef = useRef(new Set());

    const ensureProfileForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;
        if (ensuredProfileUserIdsRef.current.has(nextUser.id)) return;
        if (ensuringProfileUserIdsRef.current.has(nextUser.id)) return;

        ensuringProfileUserIdsRef.current.add(nextUser.id);

        try {
            const { data: existingProfile, error: profileError } = await supabase
                .from("profiles")
                .select("id")
                .eq("id", nextUser.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (existingProfile?.id) {
                ensuredProfileUserIdsRef.current.add(nextUser.id);
                return;
            }

            const metadata = nextUser.user_metadata || {};
            const emailPrefix = String(nextUser.email || "").split("@")[0] || "";
            const baseUsername = String(
                metadata.user_name ||
                metadata.preferred_username ||
                metadata.username ||
                metadata.full_name ||
                metadata.name ||
                emailPrefix ||
                "pump-user"
            )
                .trim()
                .replace(/\s+/g, "")
                .slice(0, 20);

            const candidates = [
                baseUsername,
                `${baseUsername || "pumpuser"}-${nextUser.id.slice(0, 4)}`,
                `${baseUsername || "pumpuser"}-${nextUser.id.slice(4, 8)}`,
            ].filter(Boolean);

            for (const candidate of candidates) {
                const { error } = await supabase.from("profiles").insert({
                    id: nextUser.id,
                    username: candidate,
                });

                if (!error) {
                    ensuredProfileUserIdsRef.current.add(nextUser.id);
                    return;
                }
                if (error.code !== "23505") {
                    throw error;
                }
            }

            throw new Error("プロフィールの初期作成に失敗しました。");
        } finally {
            ensuringProfileUserIdsRef.current.delete(nextUser.id);
        }
    }, []);

    const connectPendingFriendForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;
        const result = await processPendingInviteForUser({
            supabase,
            user: nextUser,
        });

        if (result?.message) {
            console.log("[invite]", result);
            window.alert(result.message);
        }
    }, []);

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setUser(null);
            setAuthReady(true);
            return undefined;
        }

        let isMounted = true;
        setAuthReady(false);

        const syncAuthenticatedUser = async (nextUser) => {
            if (!isMounted) return;
            setUser(nextUser ?? null);

            if (!nextUser) {
                debugLog("[auth] signed out");
                return;
            }

            debugLog("[auth] signed in", {
                userId: nextUser.id,
                email: nextUser.email,
            });

            setShowAuth(false);

            void (async () => {
                try {
                    await ensureProfileForUser(nextUser);
                } catch (error) {
                    console.error("ensure oauth profile failed", error);
                }

                try {
                    await connectPendingFriendForUser(nextUser);
                } catch (error) {
                    console.error("connect pending friend failed", error);
                }
            })();
        };

        supabase.auth.getSession()
            .then(({ data: { session } }) => syncAuthenticatedUser(session?.user ?? null))
            .catch((error) => {
                console.error("initial auth session load failed", error);
                if (isMounted) setUser(null);
            })
            .finally(() => {
                if (isMounted) setAuthReady(true);
            });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            void syncAuthenticatedUser(session?.user ?? null);
            if (isMounted) setAuthReady(true);
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectPendingFriendForUser, ensureProfileForUser]);

    useEffect(() => {
        if (!isSupabaseConfigured || !isNativeApp()) return undefined;

        let listenerHandle;
        let isCancelled = false;

        const setupNativeOAuthListener = async () => {
            listenerHandle = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
                if (!url || !isNativeOAuthCallbackUrl(url)) return;

                try {
                    const parsedUrl = new URL(url);
                    const hashParams = new URLSearchParams(String(parsedUrl.hash || "").replace(/^#/, ""));
                    const searchParams = parsedUrl.searchParams;
                    const providerError = searchParams.get("error_description")
                        || hashParams.get("error_description")
                        || searchParams.get("error")
                        || hashParams.get("error");

                    if (providerError) {
                        throw new Error(decodeURIComponent(providerError));
                    }

                    const accessToken = hashParams.get("access_token");
                    const refreshToken = hashParams.get("refresh_token");

                    if (accessToken && refreshToken) {
                        const { error } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken,
                        });
                        if (error) throw error;
                    } else {
                        const code = searchParams.get("code");
                        if (code) {
                            const { error } = await supabase.auth.exchangeCodeForSession(code);
                            if (error) throw error;
                        } else {
                            throw new Error("認証結果を受け取れませんでした。");
                        }
                    }

                    if (!isCancelled) {
                        window.dispatchEvent(new CustomEvent("pump-oauth-complete"));
                    }
                } catch (error) {
                    console.error("native oauth callback failed", error);
                    if (!isCancelled) {
                        window.dispatchEvent(new CustomEvent("pump-oauth-error", {
                            detail: {
                                message: `OAuthログインに失敗しました。${error?.message ? ` ${error.message}` : ""}`.trim(),
                            },
                        }));
                    }
                } finally {
                    Browser.close().catch(() => { });
                }
            });
        };

        void setupNativeOAuthListener();

        return () => {
            isCancelled = true;
            listenerHandle?.remove?.();
        };
    }, []);

    useEffect(() => {
        const inviteCode = getInviteCodeFromLocation(window.location);
        if (inviteCode) {
            savePendingInviteCode(inviteCode);
            setScreen("ranking");
            if (user?.id) {
                const processingKey = `${user.id}:${inviteCode}`;
                if (processingInviteCodeRef.current === processingKey) return;
                processingInviteCodeRef.current = processingKey;
                processPendingInviteForUser({
                    supabase,
                    user,
                    code: inviteCode,
                })
                    .then((result) => {
                        if (result?.message) {
                            console.log("[invite]", result);
                            window.alert(result.message);
                        }
                    })
                    .catch((error) => {
                        console.error("[invite] immediate processing failed", {
                            error,
                            code: error?.code,
                            message: error?.message,
                            details: error?.details,
                            hint: error?.hint,
                            inviteCode,
                            userId: user.id,
                        });
                        window.alert("友達追加に失敗しました。時間をおいて再試行してください。");
                    })
                    .finally(() => {
                        processingInviteCodeRef.current = "";
                    });
            } else {
                setShowAuth(true);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);
}
