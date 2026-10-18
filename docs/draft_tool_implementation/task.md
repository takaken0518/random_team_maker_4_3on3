# タスクリスト: スマブラ3on3 チームドラフト・ルーレット配信ツール実装

## 進行状況
- [x] 1. 設計・計画
  - [x] 要件定義書確認
  - [x] 基本・詳細設計書作成 (`docs/system_design/design_document.md`)
  - [x] 実装計画書作成 (`docs/draft_tool_implementation/implementation_plan.md`)
- [x] 2. コアロジック・モジュール実装 (`js/`)
  - [x] `js/state.js`: 状態管理（AppState）、LocalStorage自動保存、Undo履歴管理
  - [x] `js/participants.js`: 参加者パース（改行・CSV）、バリデーション（3の倍数判定）、サンプルデータ投入
  - [x] `js/draft-engine.js`: ラウンド順・チーム順キュー生成、ランダム抽選（Fisher-Yates / crypto）、進行管理
  - [x] `js/audio.js`: Web Audio APIによるリアルタイム効果音シンセサイザー（回転音、ドラムロール、打撃インパクト、ファンファーレ）
  - [x] `js/animation.js`: イージング減速ルーレット、スマブラ風スラッシュ・ヒットストップ・画面振動、Canvas紙吹雪
- [x] 3. UI・デザインシステム実装
  - [x] `index.css`: スマブラ大会風のサイバー＆リッチUI、ガラスモーフィズム、ネオン発光、斜線カットイン、OBS透過背景モード
  - [x] `index.html`: ヘッダー、ルーレットステージ、全チームグリッド、運営コントロールバー、参加者登録・設定モーダル
  - [x] `js/app.js`: 各モジュール統合、UIバインディング、キーボードショートカット（Space, Ctrl+Z, H等）
- [ ] 4. 実行環境 & 動作検証・OBS連携確認
  - [x] `server.js` & `start.bat`: ゼロ依存ローカルHTTPサーバー & ワンクリック起動スクリプト
  - [x] 参加者インポートとバリデーション検証（Node.jsでのロジック確認のみ）
  - [ ] ルーレットアニメーションとサウンド再生検証（未実施）
  - [x] Undo動作（Node.jsでのロジック確認のみ） / [ ] LocalStorageリロード復元（未実施）
  - [ ] ブラウザでの全24名完走テスト（未実施。初版で完了と誤記していたため訂正）
- [x] 5. Walkthrough作成
  - [x] `walkthrough.md` 作成
