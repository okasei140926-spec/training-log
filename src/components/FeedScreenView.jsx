import { lazy } from "react";
const FriendsScreen = lazy(() => import("./FriendsScreen"));

export default function FeedScreenView({
    history,
    historySyncDiagnostic,
    manualBests,
    sessionSyncVersion,
    historyDeleteMarkersRef,
    user,
    setShowAuth,
    setScreen,
    handleLogout,
    setSessionEx,
    setLogData,
    setLogMode,
    onCopyExercises,
}) {
    return (
        <FriendsScreen
            mode="feed"
            history={history}
            historySyncDiagnostic={historySyncDiagnostic}
            manualBests={manualBests}
            sessionSyncVersion={sessionSyncVersion}
            deletedWorkoutDates={historyDeleteMarkersRef.current?.dates || []}
            user={user}
            onLogin={() => setShowAuth(true)}
            onOpenRecord={() => setScreen("history")}
            onLogout={handleLogout}

            onCopyExercises={onCopyExercises}
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
