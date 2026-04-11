const DEMO_ENABLED = process.env.REACT_APP_DEMO === "true";

const DEMO_DATA = [
  {
    id: 1, name: "Ryo", color: "#FF4D4D",
    today: {
      label: "胸", time: "1時間前",
      exercises: [
        { name: "ベンチプレス", weight: 100, reps: 8 },
        { name: "インクラインベンチプレス", weight: 80, reps: 10 },
        { name: "ダンベルフライ", weight: 24, reps: 12 },
      ],
    },
    bests: { ベンチプレス: 105, デッドリフト: 140, スクワット: 120 },
    recentLogs: [
      {
        date: "昨日", label: "背中",
        exercises: [
          { name: "デッドリフト", weight: 140, reps: 5 },
          { name: "ラットプルダウン", weight: 75, reps: 10 },
          { name: "シーテッドロウ", weight: 70, reps: 10 },
          { name: "チンニング", weight: 0, reps: 8 },
        ],
      },
      {
        date: "3日前", label: "脚",
        exercises: [
          { name: "スクワット", weight: 120, reps: 6 },
          { name: "レッグプレス", weight: 180, reps: 12 },
          { name: "レッグカール", weight: 50, reps: 12 },
        ],
      },
    ],
  },
  {
    id: 2, name: "Kenta", color: "#4D9FFF",
    today: null,
    bests: { ベンチプレス: 90, デッドリフト: 110, スクワット: 100 },
    recentLogs: [
      {
        date: "昨日", label: "肩",
        exercises: [
          { name: "ショルダープレス", weight: 65, reps: 8 },
          { name: "サイドレイズ", weight: 20, reps: 15 },
          { name: "フロントレイズ", weight: 16, reps: 12 },
          { name: "リアレイズ", weight: 14, reps: 15 },
        ],
      },
      {
        date: "2日前", label: "胸",
        exercises: [
          { name: "ベンチプレス", weight: 90, reps: 8 },
          { name: "インクラインベンチプレス", weight: 70, reps: 10 },
          { name: "ダンベルフライ", weight: 22, reps: 12 },
        ],
      },
    ],
  },
];

export const DEMO_FRIENDS = DEMO_ENABLED ? DEMO_DATA : [];
