import { lazy } from "react";
const HistoryScreen = lazy(() => import("./HistoryScreen"));

export default function CalendarScreenView({
    canonicalDisplayHistory,
    workoutElapsedSec,
    savedWorkoutDurationSecByDate,
    logDate,
    muscleEx,
    exerciseBodyPartOverrides,
    hiddenBodyParts,
    handleEditHistory,
    handleDeleteHistory,
    deleteAllHistoryForDate,
    unit,
    getExUnit,
    handleCalendarDayOpen,
    user,
    manualBests,
    customBodyParts,
    setManualBests,
    setCustomBodyParts,
    setSummary,
    openWorkoutDayShareModal,
}) {
    return (
        <HistoryScreen
            history={canonicalDisplayHistory}
            todayWorkoutDurationSec={workoutElapsedSec || savedWorkoutDurationSecByDate[logDate] || 0}
            muscleEx={muscleEx}
            exerciseBodyPartOverrides={exerciseBodyPartOverrides}
            hiddenBodyParts={hiddenBodyParts}
            onEditHistory={handleEditHistory}
            onDeleteHistory={handleDeleteHistory}
            onDeleteDate={deleteAllHistoryForDate}
            workoutDurationSecByDate={savedWorkoutDurationSecByDate}
            unit={unit}
            getExUnit={getExUnit}
            onLogForDate={handleCalendarDayOpen}
            user={user}
            manualBests={manualBests}
            customBodyParts={customBodyParts}
            onAddManualBest={(best) => {
                setManualBests((prev) => [best, ...prev]);
            }}
            onUpdateManualBest={(updatedBest) => {
                setManualBests((prev) =>
                    prev.map((item) => (item.id === updatedBest.id ? updatedBest : item))
                );
            }}
            onDeleteManualBest={(id) => {
                setManualBests((prev) => prev.filter((item) => item.id !== id));
            }}
            onAddCustomBodyPart={(bodyPart) => {
                setCustomBodyParts((prev) =>
                    prev.includes(bodyPart) ? prev : [...prev, bodyPart]
                );
            }}
            onOpenWorkoutDaySummary={(nextSummary) => {
                setSummary(nextSummary);
            }}
            onOpenWorkoutDayShare={openWorkoutDayShareModal}
        />
    );
}
