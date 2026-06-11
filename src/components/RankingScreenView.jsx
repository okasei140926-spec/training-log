import { lazy } from "react";
const FriendsScreen = lazy(() => import("./FriendsScreen"));

export default function RankingScreenView({
    history,
    historySyncDiagnostic,
    manualBests,
    sessionSyncVersion,
    user,
    setShowAuth,
    setScreen,
    handleLogout,
    setSessionEx,
    setLogData,
    setLogMode,
}) {
    return (
        <FriendsScreen
            mode="ranking"
            history={history}
            historySyncDiagnostic={historySyncDiagnostic}
            manualBests={manualBests}
            sessionSyncVersion={sessionSyncVersion}
            user={user}
            onLogin={() => setShowAuth(true)}
            onOpenRecord={() => setScreen("history")}
            onLogout={handleLogout}
            onCopyMenu={(exs) => {
                setSessionEx(exs.map(ex => ({ id: Date.now() + Math.random(), name: ex.name })));
                setLogData(exs.reduce((acc, ex) => ({
                    ...acc,
                    [ex.name]: [
                        { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
                        { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
                        { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
                    ],
                }), {}));
                setLogMode("today");
                setScreen("log");
            }}
        />
    );
}
