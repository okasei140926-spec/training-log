# PUMP 保存経路マップ

> 作成: 2026-10-10
> 目的: トレーニング記録データを保持する「入れ物」の全体像を把握し、
> リファクタリングの起点にする。
> コードから断定できることと **【推測】** を区別して記載する。

---

## 目次

1. [入れ物の一覧](#1-入れ物の一覧)
2. [ラベルの一覧](#2-ラベルの一覧)
3. [データの流れ](#3-データの流れ)
4. [重複の指摘](#4-重複の指摘)
5. [畳む案](#5-畳む案)

---

## 1. 入れ物の一覧

### 凡例

- **寿命**: `session` = アプリ再起動で消える / `persistent` = 再起動後も残る
- **真実の源 / 派生**: そのデータが「正とみなされる」か、他から計算されたものか

---

### C1. `draft` — 編集中のワークアウトドラフト（React state）

| 項目 | 内容 |
|------|------|
| 定義 | `src/features/workout/useWorkoutLog.js` L265 `useState` |
| 寿命 | session（ただし変更のたびに C2 に書き出す） |
| 保持内容 | `{ date, exercises[], logData{}, sessionEx[], exerciseUnits{}, meta{} }` — 現在開いている日付1日分の編集バッファ |
| 真実の源 / 派生 | **ユーザー入力の真実の源**（表示に使われる最上流） |

**書き込み箇所:**
- `src/features/workout/useWorkoutLog.js` L272 (`setDraft`) — ユーザー操作全般
- `src/hooks/useHistoryHandlers.js` L162, L324 — 日付ナビゲーション時の hydrate

**読み取り箇所:**
- `src/App.jsx` L376, L378, L403 (`logData`, `sessionEx`, `exerciseUnits` として分解して参照)
- `src/hooks/useDisplayHistory.js` L122 前後 — displayHistory のオーバーレイ計算
- `src/features/workout/useWorkoutLog.js` L282 — draftHash の計算

---

### C2. localStorage: `draft_{field}_{YYYY-MM-DD}`

| 項目 | 内容 |
|------|------|
| キー群 | `draft_logData_{date}`, `draft_sessionEx_{date}`, `draft_exerciseUnits_{date}`, `draft_todayLabels_{date}`, `draft_meta_{date}` |
| 定義 | `src/hooks/useDraftStore.js` L79–114 (load), L323–362 (save) |
| 寿命 | **persistent**（ブラウザ/WebView の localStorage、アプリ削除まで残る） |
| 保持内容 | 日付ごとの編集バッファのスナップショット |
| 真実の源 / 派生 | ユーザーの未同期編集の真実の源（Supabase へ届く前の保険） |

**書き込み箇所:**
- `src/features/workout/workoutDraftStore.js` L191–360 `saveWorkoutDraft()` — C1 の変更をフラッシュ
- `src/hooks/useDraftStore.js` L318 — ラッパー経由

**読み取り箇所:**
- `src/features/workout/workoutDraftStore.js` L150–189 `loadWorkoutDraft()`
- `src/hooks/useDraftStore.js` L79–114 `load()`
- `src/App.jsx` L1384 `rescueUnsyncedDrafts()` — 起動時に全日付をスキャン

**レガシーグローバルキー（非推奨、移行中）:**
`draft_logData`, `draft_sessionEx`, `draft_exerciseUnits`, `draft_todayLabels`, `draft_meta`
(日付なし。`useDraftStore.js` L111–114 で読み取り専用)

---

### C3. `history` — 全期間の信頼済み履歴（React state）

| 項目 | 内容 |
|------|------|
| 定義 | `src/App.jsx` L238 `useState({})` |
| 寿命 | session |
| 保持内容 | `{ [exerciseName]: [{ date, sets[], bodyPart, order }] }` — 全日付を横断した種目別の記録 |
| 真実の源 / 派生 | **派生**（C6 `trustedWorkoutRows` + C7 `workoutsDataHistory` から `buildTrustedHistory()` で構築） |

**書き込み箇所:**
- `src/App.jsx` L738 前後 `setHistory()` — `useWorkoutHistory` の結果を受け取る
- `src/hooks/useHistoryHandlers.js` L340 前後 — 編集後の即時更新（楽観的更新）

**読み取り箇所:**
- `src/App.jsx` L730 `latestHistoryRef` — ミラーRef（後述 C9）
- `src/hooks/useHistorySave.js` L295 前後 — Supabase 書き込み時のペイロード構築
- `src/hooks/useDisplayHistory.js` — displayHistory の計算元

---

### C4. `workoutsDataHistory` — workouts.data フィールドのキャッシュ（React state）

| 項目 | 内容 |
|------|------|
| 定義 | `src/App.jsx` L239 `useState({})` |
| 寿命 | session |
| 保持内容 | `{ [date]: jsonbData }` — Supabase `workouts.data`（JSONB）の内容を日付キーでキャッシュ |
| 真実の源 / 派生 | **派生**（C8 `trustedWorkoutRows` を受け取って整形） |

**書き込み箇所:**
- `src/App.jsx` L735 前後 `setWorkoutsDataHistory()`

**読み取り箇所:**
- `src/features/workout/useWorkoutHistory.js` L17 props として受け取り、`buildTrustedHistory()` に渡す

---

### C5. `pendingWorkoutContentChangeDatesRef` — 同期待ちキュー（useRef）

| 項目 | 内容 |
|------|------|
| 定義 | `src/App.jsx` L413 `useRef(new Map())` |
| 寿命 | session |
| 保持内容 | `Map<date, { reason, explicitEdit, explicitDelete, deleteScope, ... }>` — Supabase にまだ届いていない変更の日付と意図 |
| 真実の源 / 派生 | 派生（ユーザー操作の意図を一時的に記録するメタデータ） |

**書き込み箇所:**
- `src/hooks/useHistorySave.js` L122 `markWorkoutContentChanged()` — 追加 / OR-merge
- `src/hooks/useHistoryHandlers.js` L437 — Supabase sync 成功後に `.delete(editDate)`
- `src/hooks/useHistoryHandlers.js` L759 — 日付削除後に `.delete(normalizedTargetDate)`

**読み取り箇所:**
- `src/hooks/useHistoryHandlers.js` L129, L159 — `handleLogForDate()` での hydrate 制御
- `src/hooks/useHistorySave.js` L298, L895 — sync ループでの判定

---

### C6. `trustedWorkoutRows` — Supabase から取得した行キャッシュ（React state）

| 項目 | 内容 |
|------|------|
| 定義 | `src/hooks/useHistorySync.js` L80 `useState([])` |
| 寿命 | session（ただし定期 fetch で更新） |
| 保持内容 | Supabase `workouts` テーブルの行配列 `[{ date, data, ... }]` |
| 真実の源 / 派生 | **リモートの真実の源を反映するキャッシュ**。Supabase の内容をそのまま保持 |

**書き込み箇所:**
- `src/hooks/useHistorySync.js` L186 `applyTrustedWorkoutRowsSnapshot()` 内 `setTrustedWorkoutRows()`
- `src/App.jsx` L1956 `clearTrustedRowsForDate()` — exercise_delete 後に該当日付を除去

**読み取り箇所:**
- `src/App.jsx` L1213, L2022 — `useDisplayHistory` / `useWorkoutHistory` の props として渡す
- `src/hooks/useHistorySync.js` L127, L142 — `applyTrustedWorkoutRowsSnapshot()` 内での merge/filter

---

### C7. `trustedWorkoutRowsRef` — C6 の同期 Ref

| 項目 | 内容 |
|------|------|
| 定義 | `src/hooks/useHistorySync.js` L92 `useRef(trustedWorkoutRows)` |
| 寿命 | session |
| 保持内容 | C6 と同じ内容を useRef でミラー（非同期コールバック内からアクセスするため） |
| 真実の源 / 派生 | C6 の派生（冗長コピー） |

**書き込み箇所:**
- `src/hooks/useHistorySync.js` L186 — C6 更新と同時に更新

**読み取り箇所:**
- `src/App.jsx` L1950, L1952 `clearTrustedRowsForDate()` 内

---

### C8. `latestHistoryRef` — C3 の同期 Ref

| 項目 | 内容 |
|------|------|
| 定義 | `src/App.jsx` L730 `useRef(history)` |
| 寿命 | session |
| 保持内容 | C3 `history` と同じ内容 |
| 真実の源 / 派生 | C3 の派生（冗長コピー） |

**書き込み箇所:**
- `src/App.jsx` L731 前後 `useEffect` で `history` 変更のたびに更新

**読み取り箇所:**
- `src/hooks/useHistorySave.js` 複数箇所 — 保存ペイロード構築

---

### C9. `pendingSavePayloadsRef` — 保存直前のペイロードキャッシュ（useRef）

| 項目 | 内容 |
|------|------|
| 定義 | `src/App.jsx` L1201 `useRef(new Map())` |
| 寿命 | session |
| 保持内容 | `Map<date, payload>` — Supabase に送る直前のペイロード（sync 失敗時のリトライ用） |
| 真実の源 / 派生 | 派生（C3 から構築したスナップショット） |

**書き込み箇所:**
- `src/hooks/useHistorySave.js` 複数箇所 — sync 直前に `.set(date, payload)`

**読み取り箇所:**
- `src/hooks/useHistorySave.js` L298 前後 — retry 時に読み出し

---

### C10. `canonicalDisplayHistory` — 表示用の信頼済み履歴（derived）

| 項目 | 内容 |
|------|------|
| 定義 | `src/hooks/useDisplayHistory.js` L122 |
| 寿命 | session（useMemo、入力変化で再計算） |
| 保持内容 | `useWorkoutHistory()` の `trustedHistory`（= C3 と同じ型） そのもの |
| 真実の源 / 派生 | **派生**（C3 の別名。コンポーネント側からは独立した入れ物に見える） |

**書き込み箇所:** なし（useMemo で計算）

**読み取り箇所:**
- `src/hooks/useHistoryHandlers.js` L67, L162, L324 — `handleLogForDate()` で hydrate 元として使用
- `src/App.jsx` L2128, L2803 — 表示用データとして参照

---

### C11. Supabase: `workouts` テーブル

| 項目 | 内容 |
|------|------|
| 定義 | Supabase DB |
| 寿命 | **persistent**（真の永続ストレージ） |
| 保持内容 | 行: `{ user_id, date, data(JSONB) }` — `data` に全種目・全セットを格納 |
| 真実の源 / 派生 | **リモートの真実の源** |

**書き込み箇所:**
- `src/features/workout/workoutRepository.js` L622 `delete` — 日付削除
- `src/features/workout/workoutRepository.js` L74–109 `upsert/insert` — 保存

**読み取り箇所:**
- `src/features/workout/workoutRepository.js` L21–25, L215–219 `select`
- `src/hooks/useHistorySync.js` `fetchTrustedWorkoutRows()` 経由

---

### C12. Supabase: 正規化テーブル（`workout_exercises`, `workout_sets`）

| 項目 | 内容 |
|------|------|
| 定義 | Supabase DB |
| 寿命 | **persistent** |
| 保持内容 | `workout_exercises`: exercise_name, body_part, display_order / `workout_sets`: weight, reps, unit, set_number |
| 真実の源 / 派生 | **【推測】** C11 と同じ内容を正規化した冗長コピー。クエリ最適化目的と推測 |

**書き込み箇所:**
- `src/features/workout/workoutRepository.js` L62 `delete`, L74–109 `upsert/insert`

**読み取り箇所:**
- `src/features/workout/workoutRepository.js` L54–56, L168–180

---

### C13. Supabase: `workout_sessions` テーブル

| 項目 | 内容 |
|------|------|
| 定義 | Supabase DB |
| 寿命 | **persistent** |
| 保持内容 | `{ user_id, date, duration_sec, summary_json }` — セッション単位の集計 |
| 真実の源 / 派生 | 派生（workouts から集計して書き込む） |

**書き込み箇所:**
- `src/hooks/useHistoryHandlers.js` L432 `syncWorkoutSessionSnapshot()`

**読み取り箇所:**
- `src/hooks/useHistorySave.js` L186–187, L880, L1122

---

### C14. `persistentDeletedDates` — 永続削除日付リスト（localStorage）

| 項目 | 内容 |
|------|------|
| キー | `src/utils/appHelpers.js` 等で定義（`loadPersistentDeletedDates(userId)` 参照） |
| 寿命 | **persistent** |
| 保持内容 | `{ [YYYY-MM-DD]: timestamp }` — ユーザーが「日付全体削除」した日付と削除時刻 |
| 真実の源 / 派生 | 削除意図の真実の源 |

**書き込み箇所:**
- `src/hooks/useHistoryHandlers.js` L681 前後 `handleDeleteDate()`
- `src/App.jsx` L483 前後 — 再入力時にリストから解除

**読み取り箇所:**
- `src/hooks/useHistoryHandlers.js` L273 `loadPersistentDeletedDates()`
- `src/App.jsx` L2010–2011 `useMemo` で `persistentDeletedDates` として参照
- `src/hooks/useHistorySync.js` 複数 — fetch 結果から削除日付をフィルタ

---

### 入れ物サマリー

| ID | 名前 | 寿命 | 真実の源 |
|----|------|------|---------|
| C1 | `draft` (useState) | session | ✓ ユーザー入力 |
| C2 | localStorage `draft_*_{date}` | persistent | ✓ 未同期編集 |
| C3 | `history` (useState) | session | 派生 |
| C4 | `workoutsDataHistory` (useState) | session | 派生 |
| C5 | `pendingWorkoutContentChangeDatesRef` (useRef Map) | session | 派生（メタ） |
| C6 | `trustedWorkoutRows` (useState) | session | ✓ リモートキャッシュ |
| C7 | `trustedWorkoutRowsRef` (useRef) | session | 派生（C6コピー） |
| C8 | `latestHistoryRef` (useRef) | session | 派生（C3コピー） |
| C9 | `pendingSavePayloadsRef` (useRef Map) | session | 派生 |
| C10 | `canonicalDisplayHistory` (useMemo) | session | 派生（C3別名） |
| C11 | Supabase `workouts` | persistent | ✓ リモート真実の源 |
| C12 | Supabase `workout_exercises`, `workout_sets` | persistent | 派生（C11正規化） |
| C13 | Supabase `workout_sessions` | persistent | 派生（C11集計） |
| C14 | localStorage `persistentDeletedDates` | persistent | ✓ 削除意図 |

**合計: 14個。うち「真実の源」: C1, C2, C6, C11, C14 の 5個。**

---

## 2. ラベルの一覧

### L1. `explicitDelete`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「ユーザーが明示的に削除した」 |
| 定義箇所 | `src/features/workout/workoutDraftStore.js` L70, `src/hooks/useHistorySave.js` L73 |
| 値のパターン | `true` / `false`（未設定時は `false` 扱い） |

**実際の意味:**
`markWorkoutContentChanged()` で **OR-merge** される（`src/hooks/useHistorySave.js` L104–106）。
一度 `true` になると、明示的に `options.explicitDelete === false` を渡さない限り `false` に戻らない。
結果として「削除意図があった」という**過去の痕跡**を表すフラグになっている。

**名前とのズレ:**
「ユーザーが削除した」ではなく「このセッション中のどこかで削除が起きた」という意味。
削除後にユーザーが同じ日付でセットを再入力しても、`explicitDelete` は `true` のまま残る。
`deleteScope` を補助指標として使うことでこの問題を回避しているが（`deleteScope` は `explicitEdit` が来るとリセット）、本質的には名前と動作が乖離している。

**sticky:** **YES。** OR-merge で一度立つと落ちない。

---

### L2. `explicitEdit`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「ユーザーが明示的に編集した」 |
| 定義箇所 | `src/features/workout/workoutDraftStore.js` L71, `src/hooks/useHistorySave.js` L100 |
| 値のパターン | `true` / `false` |

**実際の意味:**
`EXPLICIT_WORKOUT_EDIT_REASONS`（`src/hooks/useHistorySave.js`）に含まれる `reason` が渡されると自動で `true` になる。
OR-merge される（`previous.explicitEdit || options.explicitEdit`）。

**名前とのズレ:**
`"explicit_date_nav"`（カレンダーでの日付切り替え）も `source` フィールドに入るが、
`EXPLICIT_WORKOUT_EDIT_REASONS` に含まれる場合は `explicitEdit: true` が立つ可能性がある。
「ユーザーがコンテンツを編集した」のか「ユーザーが画面を操作した」のかが区別されていない。

**sticky:** **YES（OR-merge）。** ただし `pendingWorkoutContentChangeDatesRef` から `.delete()` されるタイミング（sync 成功時）でリセットされる。

---

### L3. `hasUnsavedChanges`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「ローカルに未保存（未同期）の変更がある」 |
| 定義箇所 | `src/features/workout/workoutDraftStore.js` L65 |
| 値のパターン | `true` / `false` |

**実際の意味:**
Supabase sync 成功後に `hasUnsavedChanges: false` で上書きされる（`src/hooks/useHistoryHandlers.js` L452）。
`rescueUnsyncedDrafts()` はこのフラグが `true` のドラフトを再キューに入れる。

**名前とのズレ:**
リモートから来たデータ（`payloadOrigin: "canonicalDisplayHistory"`）が `hasUnsavedChanges: true` で
localStorage に書き込まれることがあった（zombie restore バグの原因の一つ）。
「ユーザーが変更した」と「未同期のデータがある」が混同されている。

**sticky:** No（sync 成功で落ちる）。

---

### L4. `payloadOrigin`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「このペイロードが元々どこから来たか」 |
| 定義箇所 | `src/features/workout/workoutDraftStore.js` L79 |
| 値のパターン | `"canonicalDisplayHistory"` / `"fetchedRemoteRows"` / `null` |

**実際の意味:**
one-way valve（`workoutDraftStore.js` L208）は `source === "remote_supabase"` をチェックするが、
`payloadOrigin` はチェックしない。
`payloadOrigin: "canonicalDisplayHistory"` のドラフトは valve をすり抜けて localStorage に書かれる可能性があった。

**名前とのズレ:**
`source` が「このリクエストがどこから来たか（操作の文脈）」を表すのに対し、
`payloadOrigin` は「コンテンツそのものがどこから来たか（データの出所）」を表す。
本来は `source` が両方の責務を担うべきだったが、後付けで `payloadOrigin` が追加された。
2つのフィールドが互いに不完全な情報を持つ状態になっている。

**sticky:** No。

---

### L5. `source`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「このドラフトがどこから来たか」 |
| 定義箇所 | `src/features/workout/workoutDraftStore.js` L64 |
| 値のパターン | `"user_edit"` / `"remote_supabase"` / `"explicit_date_nav"` / `"canonical_display_history"` / `"save_verified"` / `"empty_draft"` / `"date_scoped_draft"` / `"legacy_draft"` / `"history_record_edit"` / `"set_delete"` / `"history_record_delete"` / `"date_delete"` ほか |

**実際の意味:**
one-way valve は `source === "remote_supabase"` のみをブロックする。
しかし「リモートデータをそのまま表示用に変換した」ケース（`canonical_display_history`）は
`source` がリモートに見えないため valve を通過する。

**名前とのズレ:**
`"explicit_date_nav"` は「データの出所」ではなく「なぜこのドラフトが作られたか（ユーザーがカレンダーをタップした）」という操作の理由。
`source` が「データの出所」と「操作の理由」の両方を兼ねており、意味が過負荷になっている。

**sticky:** No（上書きされる）。

---

### L6. `deleteScope`

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「削除の範囲」 |
| 定義箇所 | `src/features/workout/workoutRepository.js` L343, `src/hooks/useHistorySave.js` L107–115 |
| 値のパターン | `"date"` / `"partial"` / `null` |

**実際の意味:**
`explicitDelete` が sticky で落ちない代わりに、`deleteScope` を使って「今の操作が date 削除か否か」を判定する補助フィールド。
`explicitEdit: true` が来ると `deleteScope` は `null` にリセットされる（`useHistorySave.js` L113–115）。

**名前とのズレ:**
ほぼ名前通りだが、`explicitDelete` の sticky 問題を回避するための補助手段として使われており、
設計上は `deleteScope` がなくても `explicitDelete` だけで表現できるべき情報を代替している。

**sticky:** No（`explicitEdit` でリセット）。

---

### L7. `reason`（`markWorkoutContentChanged` の第2引数）

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「変更が発生した理由」 |
| 定義箇所 | `src/hooks/useHistorySave.js` L73 |
| 値のパターン | `"history_record_edit"` / `"set_delete"` / `"history_record_delete"` / `"date_delete"` / `"content_change"` ほか |

**実際の意味:**
`EXPLICIT_WORKOUT_EDIT_REASONS` セットに含まれる `reason` は `explicitEdit: true` を自動でセットする。
ほぼ名前通りだが、`reason` の値が `explicitEdit` フラグの真偽を決定するサイドエフェクトを持つ点は非自明。

**名前とのズレ:** ほぼなし。

---

### L8. `forceReplace`（`applyTrustedWorkoutRowsSnapshot` のオプション）

| 項目 | 内容 |
|------|------|
| 名前の意味 | 「既存データを強制上書き」 |
| 定義箇所 | `src/hooks/useHistorySync.js` 内 |
| 値のパターン | `{ replace: true }` / `{ replace: false }` |

**実際の意味:**
`replace: true` は `trustedWorkoutRows` 全体を置き換える。
`replace: false`（デフォルト）は merge（日付ブロック単位の差分更新）。

**名前とのズレ:** ほぼなし。ただし `replace: true` が zombie restore の起点になることがある。C6 を全置換すると、C10 (`canonicalDisplayHistory`) が再計算され、それが C2 に書き戻されるパスが存在する。

---

### sticky なフラグまとめ

| フラグ | sticky か | 落ちる条件 |
|--------|-----------|-----------|
| `explicitDelete` | **YES（OR-merge）** | `options.explicitDelete === false` を明示的に渡す、または `pendingWorkoutContentChangeDatesRef` の `.delete()` |
| `explicitEdit` | **YES（OR-merge）** | `pendingWorkoutContentChangeDatesRef` の `.delete()`（sync 成功時） |
| `pendingWorkoutContentChangeDatesRef` の Map エントリ | **YES（sync 失敗時）** | Supabase sync 成功（`useHistoryHandlers.js` L437）または日付削除後（L759） |

---

## 3. データの流れ

### 3-1. セット入力（編集）の経路

```
ユーザーがセットを入力
  ↓
C1 draft (useWorkoutLog useState)
  ↓ onDraftChange コールバック（即時）
  ↓
C2 localStorage draft_*_{date}  ← saveWorkoutDraft()
  ↓ （同時に）
C5 pendingWorkoutContentChangeDatesRef.set(date, { reason, explicitEdit:true })
      ← markWorkoutContentChanged()  [useHistorySave.js L73]
  ↓
  （useEffect / sync loop が C5 を監視）
  ↓
buildWorkoutDraftForDateFromHistory(date, C3 history)
      → C9 pendingSavePayloadsRef.set(date, payload)
  ↓
syncWorkoutRowsForDates(userId, payload)
      → Supabase: C11 workouts (upsert)
      → Supabase: C12 workout_exercises / workout_sets (upsert)
      → Supabase: C13 workout_sessions (upsert)
  ↓ 成功
C5 pendingWorkoutContentChangeDatesRef.delete(date)
C2 localStorage: meta.hasUnsavedChanges = false, source = "save_verified"
  ↓
  （次回 fetch タイミングで）
Supabase C11 → fetchTrustedWorkoutRows()
  ↓
C6 trustedWorkoutRows (setTrustedWorkoutRows)
C7 trustedWorkoutRowsRef ← 同時更新
  ↓
buildTrustedHistory(C6, C4, ...) → C3 history (setHistory)
C4 workoutsDataHistory ← 同時更新
  ↓
C10 canonicalDisplayHistory ← useMemo 再計算
```

---

### 3-2. 削除（日付全体）の経路

```
ユーザーが日付削除ボタンをタップ
  ↓
handleDeleteDate(targetDate)  [useHistoryHandlers.js L681]
  ↓
C14 localStorage persistentDeletedDates.set(date, timestamp)
C5 pendingWorkoutContentChangeDatesRef.set(date, { explicitDelete:true, deleteScope:"date" })
C1 draft をクリア（空の draft に更新）
C2 localStorage draft_*_{date} をクリア
  ↓
  （sync loop が C5 を監視）
  ↓
Supabase C11 workouts.delete(date)
Supabase C12 workout_exercises / workout_sets.delete(date)
  ↓ 成功
C5 pendingWorkoutContentChangeDatesRef.delete(date)
  ↓
C6 trustedWorkoutRows から該当行が除去される（次回 fetch）
C3 history から該当日付が除去される（rebuild）
C10 canonicalDisplayHistory が再計算
```

---

### 3-3. アプリ起動・オンライン復帰時のレスキュー

```
アプリ起動 / ネットワーク復帰
  ↓
rescueUnsyncedDrafts()  [App.jsx L1384]
  ↓
C2 localStorage: 全日付キーをスキャン
  ↓
  hasUnsavedChanges: true かつ
  payloadOrigin が "canonicalDisplayHistory" / "fetchedRemoteRows" でない
  ドラフトを選別
  ↓
C5 pendingWorkoutContentChangeDatesRef.set(date, { explicitEdit:true })
  ↓
sync loop へ → 3-1 の Supabase 書き込み経路へ
```

---

## 4. 重複の指摘

### 重複1: C3 `history` と C10 `canonicalDisplayHistory`

**内容:** `canonicalDisplayHistory` は `useDisplayHistory.js` L122 で `workoutHistoryView.trustedHistory` に代入するだけ。
`useWorkoutHistory()` の返り値 `trustedHistory` と `history`（App.jsx state）は同じ型・同じ内容を持つ。

**なぜ重複しているか:**
`useDisplayHistory` が `useWorkoutHistory` をラップして `canonicalDisplayHistory` という名前を付け直している。
**【推測】** 命名の責任を分離するリファクタリング中間状態と思われる。
`history`（App.jsx state）が先に存在し、後から `useWorkoutHistory` に移行する際に
別名が残った可能性が高い。

---

### 重複2: C6 `trustedWorkoutRows` と C7 `trustedWorkoutRowsRef`

**内容:** 全く同じデータを useState と useRef の両方で保持している。

**なぜ重複しているか:**
React の useEffect / コールバック内では useState の最新値を参照できないケースがあるため、
useRef ミラーが必要になる。典型的な React パターン。
意図的な冗長化。

---

### 重複3: C3 `history` と C8 `latestHistoryRef`

**内容:** 同上。useRef ミラー。理由は重複2と同じ。

---

### 重複4: C11 `workouts` と C12 `workout_exercises` / `workout_sets`

**内容:** `workouts.data`（JSONB）が全種目・全セットを保持しており、
`workout_exercises` / `workout_sets` は同じ内容を正規化した別テーブル。

**なぜ重複しているか:**
**【推測】** `workouts.data` は非正規化 JSONB で「書きやすい・読みやすい」が、
クエリ（種目別・日付別の集計など）には不向き。
正規化テーブルはそのためのインデックスとして追加されたと考えられる。
ただし2つのテーブルを常に同期して更新する必要があり、sync 失敗時に不整合が生じるリスクがある。

---

### 重複5: C2 localStorage と C6 `trustedWorkoutRows`

**内容:** 同じ日付のトレーニングデータが、localStorage（ユーザー編集バッファ）と
Supabase fetch キャッシュ（C6）の両方に存在することがある。

**なぜ重複しているか:**
設計上意図された分離。C2 は「まだ Supabase に届いていないユーザー入力」、
C6 は「Supabase から確認が取れた内容」。
one-way valve はこの2つを分離するための機構。
ただし valve が `source` の文字列だけで判定しているため、
`source` の付け方が一貫していないと混入が起きる（過去の zombie restore バグの原因）。

---

## 5. 畳む案

### 方針

「14個の入れ物を減らす」より「真実の源を 5個→3個 に減らす」ことが目標。
C1, C2, C6, C11, C14 のうち、アーキテクチャ上欠かせないのは C2, C11, C14 の3個。
C1 は UX 上必要（編集バッファ）、C6 は性能上必要（fetch キャッシュ）。
**真の問題は真実の源が多いことではなく、派生物が独立した真実の源のように振る舞うこと。**

---

### 低リスクな統合（副作用が限定的）

#### 案A: C7 `trustedWorkoutRowsRef` を廃止 → C6 直参照に置き換え

useRef ミラーパターンを Zustand / jotai のような外部ストアに置き換えるか、
`useCallback` の依存配列を正しく設定することで解消できる。
影響範囲: `useHistorySync.js` 内のみ。
リスク: **低**（純粋なリファクタリング、動作変化なし）。

#### 案B: C8 `latestHistoryRef` を廃止

同上。`history` を Ref ではなく外部ストアで持つか、`useCallback` の deps を直す。
リスク: **低**。

#### 案C: C10 `canonicalDisplayHistory` の名前を `trustedHistory` に統一

別名を作るのをやめ、`useWorkoutHistory()` の返り値を直接使う。
リスク: **低**（命名の整理のみ、ロジック変化なし）。

---

### 中リスクな統合

#### 案D: C3 `history` と C6 `trustedWorkoutRows` の統合

現在 C6 → `buildTrustedHistory()` → C3 という変換パスがある。
C3 を廃止して C6 を直接 `buildTrustedHistory()` に渡す形に変更し、
`history` state を持つ場所を1箇所にする。
リスク: **中**（`history` を直接書き込んでいる楽観的更新パス（`useHistoryHandlers.js` L340前後）が壊れる可能性）。

#### 案E: `source` と `payloadOrigin` の統合

`source` に「操作の文脈」と「データの出所」の両方を混在させるのをやめ、
1つのフィールドに統一する。
具体的には `payloadOrigin` を廃止し、
`source` の値として `"remote_supabase"`, `"user_edit"` のように
**コンテンツの出所のみ**を表現するよう整理する。
one-way valve の判定を `source` 1つで完結させる。
リスク: **中**（`source` の全値パターンの洗い替えが必要、既存のガードロジックへの影響が広い）。

---

### 高リスクな統合

#### 案F: `explicitDelete` の sticky 化をやめる

OR-merge をやめ、`deleteScope` も廃止して、
「削除意図」を `pendingWorkoutContentChangeDatesRef` の Map エントリ有無だけで判定する。
リスク: **高**（sync ループと `handleLogForDate()` の両方が `explicitDelete` の sticky 性を前提にロジックを組んでいる。全面的な書き換えが必要）。

#### 案G: C2 localStorage と C6 `trustedWorkoutRows` の統合（one-way valve の廃止）

「ユーザー編集バッファ」と「リモートキャッシュ」を同じ場所で管理し、
タイムスタンプで新しい方を優先する楽観的マージに切り替える。
リスク: **高**（offline/online 競合、zombie restore、削除の伝播など、現在のバグの大半がこのレイヤーに集中しており、統合には競合解決戦略の再設計が必要）。
