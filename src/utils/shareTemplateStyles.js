export function formatDate(dateStr) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${year}/${month}/${day}`;
}

export function buildTemplateStyles(template) {
    if (template === "cool") {
        return {
            shell: {
                background: "linear-gradient(180deg, #0f0f10 0%, #1a1a1d 100%)",
                color: "#f5f5f5",
                border: "1px solid #3b3b40",
                boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            },
            photoFrame: {
                background: "#111214",
                border: "1px solid #2e2f35",
                borderRadius: 24,
                padding: 10,
            },
            badge: {
                background: "#202127",
                color: "#d7d7dd",
                border: "1px solid #363741",
            },
            summaryCard: {
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f5f5f5",
            },
            label: { color: "#9c9ca8" },
            accent: "#f5f5f5",
            accentText: "#111214",
            brand: "#9c9ca8",
            title: "TODAY'S WORKOUT",
            titleIcon: "◆",
            summaryBadgeWithPhoto: "performance log",
            summaryBadgeWithoutPhoto: "stats focus",
            fullRecordTitle: "FULL WORKOUT LOG",
            fullRecordBadge: "all sets",
        };
    }

    return {
        shell: {
            background: "linear-gradient(180deg, #F0FBFF 0%, #EAF8FF 48%, #F7FDFF 100%)",
            color: "#155E75",
            border: "1px solid #BAE6FD",
            boxShadow: "0 24px 60px rgba(56, 189, 248, 0.18)",
        },
        photoFrame: {
            background: "#ffffff",
            border: "1px solid #BAE6FD",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#ECFEFF",
            color: "#0891B2",
            border: "1px solid #BAE6FD",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(186, 230, 253, 0.95)",
            color: "#155E75",
        },
        label: { color: "#4B89A0" },
        accent: "#38BDF8",
        accentText: "#083344",
        brand: "#59B8DA",
        title: "GYM GLOW",
        titleIcon: "✦",
        summaryBadgeWithPhoto: "share ready",
        summaryBadgeWithoutPhoto: "stats pop",
        fullRecordTitle: "GLOW LOG",
        fullRecordBadge: "full menu",
    };
}
