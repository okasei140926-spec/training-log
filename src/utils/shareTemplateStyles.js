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
            background: "linear-gradient(180deg, #f3fffd 0%, #e8fff7 42%, #eef8ff 100%)",
            color: "#1f4b52",
            border: "1px solid #cdeee7",
            boxShadow: "0 24px 60px rgba(93, 199, 180, 0.22)",
        },
        photoFrame: {
            background: "#ffffff",
            border: "1px solid #caedf2",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#edfffa",
            color: "#12897a",
            border: "1px solid #bfeee5",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(183, 235, 226, 0.95)",
            color: "#1f4b52",
        },
        label: { color: "#5f8f93" },
        accent: "#18b8b3",
        accentText: "#07383c",
        brand: "#6fbec1",
        title: "GYM GLOW",
        titleIcon: "✦",
        summaryBadgeWithPhoto: "share ready",
        summaryBadgeWithoutPhoto: "stats pop",
        fullRecordTitle: "GLOW LOG",
        fullRecordBadge: "full menu",
    };
}
