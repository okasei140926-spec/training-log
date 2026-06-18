import LogScreen from "./LogScreen";

export default function LogScreenView({
    handleLogScreenInputPointerDownCapture,
    handleLogScreenFocusCapture,
    handleLogScreenBlurCapture,
    touchStartX,
    touchStartY,
    setScreen,
    workoutStartedForDate,
    logDate,
    workoutTimerStatus,
    workoutElapsedSec,
    savedWorkoutDurationSecByDate,
    user,
    manualBests,
    customBodyParts,
    hiddenBodyParts,
    setCustomBodyParts,
    setHiddenBodyParts,
    todayLabels,
    dayColor,
    workoutLogExercises,
    workoutLogData,
    getExSets,
    setField,
    setWeightMode,
    addSet,
    removeSet,
    removeEx,
    timerLeft,
    intervalSec,
    setIntervalSec,
    startTimer,
    stopTimer,
    handleSaveLog,
    addExToSession,
    quickAddToSession,
    reorderEx,
    renameEx,
    getPrev,
    getPR,
    getPreviousPR,
    copySetDown,
    copyRepDown,
    unit,
    getWorkoutLogExUnit,
    toggleExUnit,
    muscleEx,
    customExercisesByBodyPart,
    onSaveCustomExercise,
    onBulkSaveCustomExercises,
    updateTodayLabels,
    canonicalDisplayHistory,
    handleFinishWorkoutTimerAndShowSummary,
    handleLogSetInputFocusChange,
    logExerciseFocusRequest,
    setLogExerciseFocusRequest,
    lastActiveLogExerciseByDate,
    handleLogExerciseActiveChange,
    deleteAllHistoryForDate,
}) {
    return (
        <div
            onPointerDownCapture={handleLogScreenInputPointerDownCapture}
            onFocusCapture={handleLogScreenFocusCapture}
            onBlurCapture={handleLogScreenBlurCapture}
            onTouchStart={(e) => {
                touchStartX.current = e.touches[0].clientX;
                touchStartY.current = e.touches[0].clientY;
            }}
            onTouchEnd={(e) => {
                if (touchStartX.current == null || touchStartY.current == null) return;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;

                const dx = endX - touchStartX.current;
                const dy = Math.abs(endY - touchStartY.current);

                const startedFromLeftEdge = touchStartX.current <= 24;
                const isRightSwipe = dx >= 80;
                const isHorizontal = dy < 40;

                if (startedFromLeftEdge && isRightSwipe && isHorizontal) {
                    setScreen("history");
                }

                touchStartX.current = null;
                touchStartY.current = null;
            }}
        >
            {(() => {
                const todayKey = new Date().toISOString().slice(0, 10);
                const showCurrentLogWorkoutTimer = workoutStartedForDate === logDate && logDate === todayKey;
                const displayedWorkoutTimerStatus = showCurrentLogWorkoutTimer
                    ? workoutTimerStatus
                    : "idle";
                const displayedWorkoutElapsedSec = showCurrentLogWorkoutTimer
                    ? workoutElapsedSec
                    : (savedWorkoutDurationSecByDate[logDate] || 0);

                return (
                    <LogScreen
                        user={user}
                        manualBests={manualBests}
                        customBodyParts={customBodyParts}
                        hiddenBodyParts={hiddenBodyParts}
                        onAddCustomBodyPart={(bodyPart) => {
                            setCustomBodyParts((prev) =>
                                prev.includes(bodyPart) ? prev : [...prev, bodyPart]
                            );
                        }}
                        onUpdateHiddenBodyParts={setHiddenBodyParts}
                        todayLabels={todayLabels}
                        dayColor={dayColor}
                        exercises={workoutLogExercises}
                        logData={workoutLogData}
                        getExSets={getExSets}
                        setField={setField}
                        setWeightMode={setWeightMode}
                        addSet={addSet}
                        removeSet={removeSet}
                        removeEx={removeEx}
                        timerLeft={timerLeft}
                        intervalSec={intervalSec}
                        setIntervalSec={setIntervalSec}
                        startTimer={startTimer}
                        stopTimer={stopTimer}
                        saveLog={handleSaveLog}
                        onAddEx={addExToSession}
                        onQuickAddEx={quickAddToSession}
                        onReorderEx={reorderEx}
                        onRenameEx={renameEx}
                        getPrev={getPrev}
                        getPR={getPR}
                        getPreviousPR={getPreviousPR}
                        onCopyDown={copySetDown}
                        onCopyDownReps={copyRepDown}
                        unit={unit}
                        getExUnit={getWorkoutLogExUnit}
                        onToggleExUnit={toggleExUnit}
                        muscleEx={muscleEx}
                        customExercisesByBodyPart={customExercisesByBodyPart}
                        onSaveCustomExercise={onSaveCustomExercise}
                        onBulkSaveCustomExercises={onBulkSaveCustomExercises}
                        setTodayLabels={updateTodayLabels}
                        history={canonicalDisplayHistory}
                        logDate={logDate}
                        workoutElapsedSec={displayedWorkoutElapsedSec}
                        workoutTimerStatus={displayedWorkoutTimerStatus}
                        onFinishWorkoutTimer={handleFinishWorkoutTimerAndShowSummary}
                        onSetInputFocusChange={handleLogSetInputFocusChange}
                        focusExerciseRequest={logExerciseFocusRequest}
                        onFocusExerciseHandled={(request) => {
                            setLogExerciseFocusRequest((current) =>
                                current?.nonce === request?.nonce ? null : current
                            );
                        }}
                        lastActiveExercise={lastActiveLogExerciseByDate?.[logDate] || null}
                        onActiveExerciseChange={handleLogExerciseActiveChange}
                        resetSession={() => {
                            deleteAllHistoryForDate(logDate);
                        }}
                    />
                );
            })()}
        </div>
    );
}
