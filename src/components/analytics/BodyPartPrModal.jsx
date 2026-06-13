import PrCard from "./PrCard";

export default function BodyPartPrModal({ selectedPrGroup, selectedExerciseKey, onSelectExercise, onClose }) {
  if (!selectedPrGroup) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 999,
        padding: "16px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--card)",
          borderRadius: 20,
          padding: "18px 16px 20px",
          border: "1px solid var(--border2)",
          maxHeight: "65vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 44,
            height: 5,
            borderRadius: 999,
            background: "var(--border2)",
            margin: "0 auto 14px",
          }}
        />
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
            {selectedPrGroup.bodyPart}の部位別PR
          </div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
            全{selectedPrGroup.items.length}件
          </div>
        </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedPrGroup.items.map((item) => (
              <div key={`all-${item.key}`}>
                <PrCard
                  item={item}
                  hideEstimated1RM={true}
                  selectedExerciseKey={selectedExerciseKey}
                  onSelect={onSelectExercise}
                />
              </div>
            ))}
          </div>
      </div>
    </div>
  );
}
