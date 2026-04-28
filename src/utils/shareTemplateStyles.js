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
            background: "linear-gradient(180deg, #fffaf5 0%, #fff3ea 52%, #fef7f9 100%)",
            color: "#5f4648",
            border: "1px solid #f1e2d7",
            boxShadow: "0 24px 60px rgba(201, 167, 146, 0.2)",
        },
        photoFrame: {
            background: "#fffefd",
            border: "1px solid #efe4dc",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#fff7ef",
            color: "#a06b57",
            border: "1px solid #f0ddd0",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(236,219,207,0.95)",
            color: "#5f4648",
        },
        label: { color: "#9d7d73" },
        accent: "#8f5d4c",
        brand: "#c09f92",
        title: "Glow Workout",
    };
}
