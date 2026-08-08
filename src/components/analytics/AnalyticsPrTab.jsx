import PrCard from "./PrCard";

export default function AnalyticsPrTab({
  prData,
  selectedPrBodyPart,
  setSelectedPrBodyPart,
  selectedExerciseKey,
  onSelectExercise,
}) {
  const groups = prData.groupedByBodyPart || [];
  const hasData = groups.length > 0;

  // Items to display: null = すべて
  const displayItems =
    selectedPrBodyPart === null
      ? prData.allItemsSortedByDate || []
      : (groups.find((g) => g.bodyPart === selectedPrBodyPart)?.items || []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        background: "var(--card)",
        borderRadius: 22,
        padding: 18,
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-card)",
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 14 }}>
          自己ベスト
        </div>

        {hasData ? (
          <>
            {/* Horizontal filter chips */}
            <div style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              marginBottom: 16,
              paddingBottom: 4,
            }}>
              {/* "すべて" chip */}
              <button
                type="button"
                onClick={() => setSelectedPrBodyPart(null)}
                style={{
                  flexShrink: 0,
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: selectedPrBodyPart === null
                    ? "1.5px solid var(--accent)"
                    : "1.5px solid rgba(130,150,155,0.25)",
                  background: selectedPrBodyPart === null
                    ? "rgba(18,199,194,0.12)"
                    : "var(--card2)",
                  color: selectedPrBodyPart === null ? "var(--accent)" : "var(--text2)",
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                すべて
              </button>

              {groups.map((group) => {
                const isSelected = selectedPrBodyPart === group.bodyPart;
                return (
                  <button
                    key={group.bodyPart}
                    type="button"
                    onClick={() => setSelectedPrBodyPart(isSelected ? null : group.bodyPart)}
                    style={{
                      flexShrink: 0,
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: isSelected
                        ? "1.5px solid var(--accent)"
                        : "1.5px solid rgba(130,150,155,0.25)",
                      background: isSelected
                        ? "rgba(18,199,194,0.12)"
                        : "var(--card2)",
                      color: isSelected ? "var(--accent)" : "var(--text2)",
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {group.bodyPart}
                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
                      {group.items.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* PR item list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {displayItems.map((item) => (
                <PrCard
                  key={item.key}
                  item={item}
                  hideEstimated1RM={true}
                  selectedExerciseKey={selectedExerciseKey}
                  onSelect={onSelectExercise}
                  showBodyPart={selectedPrBodyPart === null}
                  prDiff={item.prDiff}
                  isNew={item.isNew}
                  stagnationWeeks={item.stagnationWeeks}
                />
              ))}
              {displayItems.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text2)" }}>種目がありません</div>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            まだPRデータがありません
          </div>
        )}
      </div>
    </div>
  );
}
