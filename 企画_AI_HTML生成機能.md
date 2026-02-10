# AI HTML生成機能 企画書

## 背景

### 現状の課題
- HTMLを手書きするのは遅い
- AIにスクショを渡すと毎回全体を生成し直す（部分追加できない）
- Figmaは学習コストが高く、出力コードが汚い
- 「ここにこれ追加したい」を伝えるのに、コードの場所を探すのが面倒

### 既存資産
- CSS Jumperで**クリック → 要素特定**の仕組みが既にある
- Native Messagingで**外部ファイル操作**ができる基盤がある
- Live Serverで**ファイル保存 → 即反映**の環境がある

---

## コンセプト

**ブラウザ上でクリック → 自然言語で指示 → その場にHTML+CSSを追加**

```
「ここ」を指して「こうしたい」と言うだけでコードが生まれる
```

---

## 操作フロー

```
① Live Serverでページを開く
② 要素をCtrl+Shift+クリック（挿入モード）
   → クリックした要素がハイライトされる
   → 「この中に追加」「この下に追加」を選択
③ テキスト入力欄が表示される
   → 例:「横並びで3つカード、画像+タイトル+説明文」
   → 例:「ナビゲーション、ロゴ左、メニュー右寄せ」
④ AIがHTML骨組み + レイアウトCSSを生成
   → 既存のクラス命名規則を踏襲
   → flexレイアウト中心、装飾は最小限
⑤ Native Messaging経由でHTMLファイルに挿入
   → CSSは既存のCSSファイルに追記
⑥ Live Serverが自動リロード → 即反映
⑦ 気に入らなければ Ctrl+Z（VS Code側で取り消し）
```

---

## 技術構成

| レイヤー | 技術 | 既存/新規 |
|---------|------|----------|
| クリック検知 | content.js | ✅ 既存流用（Alt+クリックと同じ） |
| 要素情報取得 | content.js | ✅ 既存流用（クラス名、構造取得） |
| テキスト入力UI | content.js（オーバーレイ） | 🆕 新規 |
| AI通信 | background.js → Claude API | 🆕 新規 |
| コード生成 | Claude API | 🆕 新規 |
| ファイル書き換え | Native Messaging → exe | 🆕 新規（open_vscode.exeの拡張 or 別exe） |
| CSS追記 | 同上 | 🆕 新規 |

---

## AIへのプロンプト設計（案）

```
【既存HTML構造】
<div class="main_wrapper">
  <header class="header">...</header>
  <!-- ← ここに挿入 -->
</div>

【既存クラス命名規則】
アンダースコア区切り（例: main_wrapper, nav_list）

【ユーザー指示】
「横並びで3つカード、画像+タイトル+説明文」

【出力ルール】
- HTML骨組みのみ（テキストはダミー）
- CSSはレイアウトのみ（flex, width, gap, padding）
- 装飾なし（色、影、角丸、フォント指定しない）
- 既存の命名規則を踏襲
- クラス名はアンダースコア区切り
```

---

## 出力例

### ユーザー指示
「横並びで3つカード、画像+タイトル+説明文」

### 生成HTML
```html
<div class="card_row">
  <div class="card_item">
    <img src="" alt="" class="card_img">
    <h3 class="card_title">タイトル</h3>
    <p class="card_desc">説明文が入ります</p>
  </div>
  <div class="card_item">
    <img src="" alt="" class="card_img">
    <h3 class="card_title">タイトル</h3>
    <p class="card_desc">説明文が入ります</p>
  </div>
  <div class="card_item">
    <img src="" alt="" class="card_img">
    <h3 class="card_title">タイトル</h3>
    <p class="card_desc">説明文が入ります</p>
  </div>
</div>
```

### 生成CSS
```css
.card_row {
  display: flex;
  gap: 2rem;
}
.card_item {
  flex: 1;
}
.card_img {
  width: 100%;
}
```

---

## 必要なもの

| 項目 | 詳細 |
|------|------|
| Claude API Key | background.jsから直接呼ぶ or popup.jsで設定 |
| 新規exe | HTMLファイル書き換え用（Native Messaging） |
| 挿入位置の特定 | クリックした要素のHTML上の行番号が必要 |

---

## 制約・リスク

| 項目 | 対策 |
|------|------|
| API有料 | 骨組み生成は短いのでコスト低い（1回 $0.01未満） |
| ファイル破壊 | 挿入前にバックアップ or VS Codeの取り消しに頼る |
| 会社PC | API通信がブロックされる可能性 → オフライン時はテンプレ選択式にフォールバック |
| セキュリティ | API Keyは chrome.storage に保存（.envと同等） |

---

## 段階的開発（案）

### Phase 1: 最小構成
- クリックで要素選択 → テキスト入力 → AIがHTML生成 → **クリップボードにコピー**
- ファイル書き換えはしない（ユーザーが手動で貼り付け）
- これだけでも十分便利

### Phase 2: ファイル直接挿入
- Native MessagingでHTMLファイルに挿入
- CSSファイルにも追記

### Phase 3: 編集・削除
- 生成した要素を右クリック → 「AIで修正」「削除」
- 「もうちょい余白広げて」みたいな自然言語で修正

---

## 既存機能との関係

CSS Jumperに**追加機能として組み込む**のが自然。理由:
- クリック検知の仕組みが共通
- Native Messagingの基盤が共通
- 同じポップアップでAPI Key設定できる
- 別PJにする理由がない

---

**作成日**: 2026-02-10
**ステータス**: 企画段階
