export const WEEK_DAYS = ["日","月","火","水","木","金","土"];

export const PALETTE = ["#FF4D4D","#4D9FFF","#FFD700","#FF6B35","#4ECDC4","#A855F7","#F472B6","#34D399"];

export const LABEL_COLORS = {
  胸:             "#FF4D4D",
  背中:           "#4D9FFF",
  四頭:           "#FFD700",
  ハムストリングス: "#FF6B35",
  肩:             "#4ECDC4",
  二頭:           "#A855F7",
  三頭:           "#F472B6",
  腹筋:           "#34D399",
};

export const QUICK_LABELS = ["胸","背中","四頭","ハムストリングス","肩","二頭","三頭","腹筋"];

export const SUGGESTIONS = {
  胸:             ["ベンチプレス","インクラインベンチプレス","ダンベルフライ","ペックフライ","ディップス","インクラインダンベルプレス","デクラインベンチプレス"],
  背中:           ["デッドリフト","ラットプルダウン","シーテッドロウ","チンニング","ダンベルロウ","Tバーロウ","フェイスプル"],
  四頭:           ["スクワット","レッグプレス","レッグエクステンション","ブルガリアンスクワット","ハックスクワット","フロントスクワット"],
  ハムストリングス: ["ルーマニアンデッドリフト","レッグカール","シーテッドレッグカール","グッドモーニング","スティッフレッグデッドリフト"],
  肩:             ["ショルダープレス","サイドレイズ","フロントレイズ","リアレイズ","アーノルドプレス","フェイスプル","アップライトロウ"],
  二頭:           ["バーベルカール","ダンベルカール","ハンマーカール","インクラインカール","プリーチャーカール","コンセントレーションカール"],
  三頭:           ["トライセプスプッシュダウン","オーバーヘッドエクステンション","スカルクラッシャー","クローズグリップベンチ","キックバック","ディップス"],
  腹筋:           ["クランチ","レッグレイズ","プランク","ケーブルクランチ","ロシアンツイスト"],
};

export function getSuggestions(target) {
  if (!target) return [];
  const targets = Array.isArray(target) ? target : [target];
  const result = []; const seen = new Set();
  targets.forEach(t => {
    const key = SUGGESTIONS[t] ? t : Object.keys(SUGGESTIONS).find(k => t.includes(k) || k.includes(t));
    if (key) SUGGESTIONS[key].forEach(s => {
      if (!seen.has(s)) { seen.add(s); result.push({ name: s, label: key }); }
    });
  });
  return result;
}