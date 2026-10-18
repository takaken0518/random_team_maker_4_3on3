# 実装計画書: スマブラ3on3 チームドラフト・ルーレット配信ツール

## 1. 概要
本計画は、要件定義書および基本・詳細設計書（[design_document.md](../system_design/design_document.md)）に基づき、OBS配信映えするスマブラ3on3ドラフトツールの実装手順を定義する。

## 2. 実装方針 & 技術スタック
- **アーキテクチャ**: ゼロ依存（Zero Dependency）の Vanilla HTML5 / CSS3 / ES Modules
- **デザイン方針**:
  - スマブラ大会配信向けのサイバー＆エネルギッシュなリッチデザイン
  - ダーク基調（#0b0e14）、スマブラゴールド（#ffd700）、フレイムレッド（#ff3b30）
  - ガラスモーフィズム（backdrop-filter）、斜線アングル（`clip-path`）、光彩エフェクト
- **アニメーション & SE**:
  - CSS3 + RequestAnimationFrame によるイージング減速ルーレット
  - ヒットストップ・画面シェイク・カットインフラッシュ
  - Web Audio API による完全ローカル生成の効果音（外部音源不要）
  - Canvas 2D による完成時紙吹雪

## 3. 実装ステップ
1. **コアロジック層の実装**:
   - `js/state.js`: 状態構造、Undoスナップショット、LocalStorage永続化
   - `js/participants.js`: テキスト・CSVパーサー、バリデーションロジック
   - `js/draft-engine.js`: キュー作成（ラウンド/チーム完結順）、ランダム選出
   - `js/audio.js`: Web Audio API シンセ（Tick, Hitstop, Fanfare）
   - `js/animation.js`: ルーレット描画、画面振動、紙吹雪パーティクル
2. **UI・スタイル層の実装**:
   - `index.css`: レスポンシブ＆フルHD最適化、スマブラ風タイポグラフィ、透過モード、各種アニメーションキーフレーム
   - `index.html`: セマンティックな画面構造、アクセシビリティ・視認性を担保したコンポーネント配置
   - `js/app.js`: コントローラーの統合、ショートカットキー、イベントハンドリング
3. **検証と調整**:
   - 参加者登録 $\to$ ルーレット実行 $\to$ Undo $\to$ リロード復元 $\to$ 全チーム完了フィナーレの一連の動作確認
