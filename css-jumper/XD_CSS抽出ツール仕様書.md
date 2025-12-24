# XD CSS 抽出ツール 仕様書

## 目的

Adobe XD の共有ページから**デザイン要素の CSS 情報を自動抽出**し、正確な HTML/CSS を生成するためのデータを取得する。

---

## 背景

- AI で HTML/CSS を生成すると、**サイズがずれる**問題がある
- XD の共有ページには**正確なサイズ情報**が表示される
- 手動で 1 つずつ値を取るのは**非効率**

---

## 入力

**Adobe XD の共有 URL**
例: `https://xd.adobe.com/view/f8705381-6851-40f7-9bd7-b225b5027483-ad23/`

---

## 欲しいデータ（要素ごとに）

| プロパティ  | 説明              | 例                           |
| ----------- | ----------------- | ---------------------------- |
| 要素名      | XD 内のレイヤー名 | `mainvisual`, `header-title` |
| width       | 幅                | `1260px`                     |
| height      | 高さ              | `590px`                      |
| x (left)    | X 座標            | `70px`                       |
| y (top)     | Y 座標            | `60px`                       |
| font-size   | フォントサイズ    | `16px`                       |
| font-family | フォント名        | `Noto Sans JP`               |
| color       | 文字色            | `#333333`                    |
| background  | 背景色/画像       | `#FFFFFF`                    |
| opacity     | 不透明度          | `100%`                       |
| margin      | マージン          | `20px 0`                     |
| padding     | パディング        | `10px 15px`                  |

---

## 出力形式

**JSON**

```json
{
  "artboard": "Brand - PC",
  "width": 1400,
  "elements": [
    {
      "name": "mainvisual",
      "type": "image",
      "css": {
        "width": "1260px",
        "height": "590px",
        "left": "70px",
        "top": "60px",
        "opacity": "1"
      }
    },
    {
      "name": "header-title",
      "type": "text",
      "css": {
        "width": "200px",
        "height": "30px",
        "fontSize": "24px",
        "fontFamily": "Noto Sans JP",
        "color": "#333333"
      }
    }
  ]
}
```

---

## 技術的な調査結果

1. XD の共有ページは**JavaScript で動的レンダリング**
2. 「スペックを表示」→ アートボード選択 → 要素クリック → CSS 表示
3. CSS は**div の中にテキスト**として表示される
4. 要素ごとにクリックして情報を取得する必要がある

---

## 実装アプローチ案

1. **Chrome 拡張機能**

   - XD ページ上で動作
   - DOM 操作で要素をクリック → CSS 情報を抽出
   - JSON として出力

2. **ブラウザ自動化（Playwright/Puppeteer）**
   - XD ページを開いてスクレイピング
   - すべての要素を順番にクリック
   - CSS 情報を収集

---

## 補足

抽出したデータがあれば：

- **HTML/CSS 生成の精度向上**
- **デザインとの差異チェック**
- **コーディング作業の効率化**
