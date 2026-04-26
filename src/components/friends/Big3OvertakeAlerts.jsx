export default function Big3OvertakeAlerts({ events }) {
    return (
        <>
            {events.map((event) => (
                <div
                    key={event.seenKey}
                    style={{
                        background: "#f9731614",
                        border: "1px solid #f9731644",
                        borderRadius: 12,
                        padding: "12px 14px",
                        marginBottom: 12,
                    }}
                >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                        {event.friendName}があなたの{event.exerciseLabel}記録を超えました！
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)" }}>
                        {event.friendName} {event.friendValue}kg / あなた {event.myValue}kg
                    </div>
                </div>
            ))}
        </>
    );
}
