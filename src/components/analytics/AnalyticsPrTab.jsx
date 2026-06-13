import PrCard from "./PrCard";

export default function AnalyticsPrTab({
  prData,
  selectedPrBodyPart,
  setSelectedPrBodyPart,
  selectedPrGroup,
  selectedExerciseKey,
  onSelectExercise,
}) {
  return (
    <>
      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>
          自己ベスト
        </div>
        {prData.groupedByBodyPart.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
              {prData.groupedByBodyPart.map((group) => (
                <button
                  key={group.bodyPart}
                  type="button"
                  onClick={() => setSelectedPrBodyPart(selectedPrBodyPart === group.bodyPart ? null : group.bodyPart)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    background:
                      selectedPrBodyPart === group.bodyPart
                        ? "linear-gradient(135deg, rgba(15, 94, 99, 0.14), rgba(18, 199, 194, 0.12))"
                        : "linear-gradient(180deg, var(--card2), var(--card))",
                    color: "var(--text)",
                    textAlign: "left",
                    boxShadow:
                      selectedPrBodyPart === group.bodyPart ? "0 10px 22px rgba(15, 94, 99, 0.10)" : "none",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 900, color: selectedPrBodyPart === group.bodyPart ? "var(--accent)" : "var(--text)" }}>
                    {group.bodyPart}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 700, marginTop: 2 }}>
                    {group.items.length}種目
                  </div>
                </button>
              ))}
            </div>

            {selectedPrGroup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selectedPrGroup.items.map((item) => (
                  <div key={item.key}>
                    <PrCard
                      item={item}
                      hideEstimated1RM={true}
                      selectedExerciseKey={selectedExerciseKey}
                      onSelect={onSelectExercise}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            まだPRデータがありません
          </div>
        )}
      </div>
    </>
  );
}
