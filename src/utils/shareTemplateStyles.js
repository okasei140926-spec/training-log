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
            brand: "#9c9ca8",
            title: "TODAY'S WORKOUT",
        };
    }

    return {
        shell: {
            background: "linear-gradient(180deg, #fff8fb 0%, #fff5ef 100%)",
            color: "#51363c",
            border: "1px solid #f3dfe5",
            boxShadow: "0 24px 60px rgba(196,132,148,0.18)",
        },
        photoFrame: {
            background: "#fffdfd",
            border: "1px solid #f1e6ea",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#fff0f5",
            color: "#a25d6c",
            border: "1px solid #f3d7df",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(232,199,210,0.9)",
            color: "#51363c",
        },
        label: { color: "#9b7d86" },
        accent: "#7f4653",
        brand: "#b48d99",
        title: "Workout Moment",
    };
}
