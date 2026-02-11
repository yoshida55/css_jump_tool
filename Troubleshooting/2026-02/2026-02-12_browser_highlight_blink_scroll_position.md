# ブラウザハイライト機能の点滅・位置ズレ問題

**日付**: 2026-02-12
**Keywords**: ブラウザハイライト, 点滅, blink, scroll, position, オーバーレイ, DOM再作成, currentBrowserSelector, lastHighlightedSelector, HTML対応, VS Code拡張, Chrome拡張, content.js, extension.ts
**Error**: なし（動作不具合）
**影響範囲**: VS Code拡張機能のブラウザハイライト機能全体
**重要度**: 🟡 Important

---

## 症状

VS Code拡張機能（css-to-html-jumper v1.10.0）のブラウザハイライト機能で複数の問題が発生。

### 症状1: ハイライトが点滅する
**期待動作**: CSSセレクタ行にカーソルを置いている間、ブラウザ上の該当要素がオレンジ色で安定してハイライトされる
**実際の動作**:
- ハイライトが0.5秒ごとに点滅（消える→出る を繰り返す）
- タイマー（5秒後）で消えた後も再出現と消滅を繰り返す

### 症状2: スクロールでハイライト位置がズレる
**期待動作**: スクロールしてもハイライトは要素に追従して表示される
**実際の動作**: ハイライトオーバーレイが`position: fixed`で固定されているため、スクロール直後に最大500ms（ポーリング間隔）ズレる

### 症状3: ハイライトが消えない
**期待動作**: セレクタ行から離れたら数秒後に自動消去される
**実際の動作**: ずっと表示されたまま

### 症状4: カーソル移動してもハイライトが消えない
**期待動作**: CSSプロパティ行や空行に移動したら即座にハイライト解除
**実際の動作**: ハイライトが残り続ける

### 症状5: HTMLファイルでハイライトが動作しない
**期待動作**: HTMLの`class="xxx"`や`id="yyy"`にカーソルを置いたらブラウザでハイライト
**実際の動作**: CSS専用でHTMLファイルは非対応

---

## 原因

### 原因1: DOM再作成による点滅
500msポーリングで毎回以下を実行していた：
```javascript
// content.js (before fix)
function highlightElementBySelector(type, name) {
  removeVSCodeHighlight(); // ← 毎回DOM削除
  // ... overlay作成
  document.body.appendChild(overlay); // ← 毎回DOM追加
}
```

**根本原因**:
- ポーリングで同じセレクタでも`highlightElementBySelector()`を毎回実行
- DOM削除→作成のサイクルが0.5秒ごとに発生
- `transition: all 0.2s ease`により追加時にアニメーション発生→フラッシュ
- 2秒後のタイマー削除と、ポーリングでの再作成が競合して点滅

### 原因2: position:fixedとスクロール追従
オーバーレイを`position: fixed`で配置し、`getBoundingClientRect()`で座標計算していたが、スクロールイベントへの対応がなかった。

```javascript
overlay.style.cssText =
  "position: fixed !important;" +
  "left: " + rect.left + "px !important;" +
  "top: " + rect.top + "px !important;";
```

**根本原因**:
- `getBoundingClientRect()`はビューポート相対座標を返す
- スクロール直後、次のポーリング（500ms後）まで位置が更新されない
- 500msの間、ハイライトが古い位置に表示される

### 原因3: タイマー未実装
初期実装ではハイライトの自動消去機能がなく、セレクタが変わるまで表示され続けた。

### 原因4: currentBrowserSelectorのクリア漏れ
extension.tsの`onDidChangeTextEditorSelection`で、プロパティ行や空行に移動した際に`currentBrowserSelector`をnullにしていなかった。

```typescript
// extension.ts (before fix)
if (line.includes(':') && !line.includes('{')) {
  return; // ← currentBrowserSelectorがクリアされない
}
```

### 原因5: HTML対応ロジック未実装
`onDidChangeTextEditorSelection`がCSSファイル専用で、HTMLの`class="xxx"`からセレクタを抽出する処理がなかった。

```typescript
// extension.ts (before fix)
if (!editor || editor.document.languageId !== 'css') {
  return; // ← HTMLは即リターン
}
```

---

## 対処

### 対処1: 点滅修正（セレクタ重複チェック + DOM再利用）

**Step 1**: 前回のセレクタを記録、同じセレクタなら再ハイライトしない
```javascript
// content.js
var lastHighlightedSelector = null;

vscodeHighlightPolling = setInterval(function() {
  fetch("http://127.0.0.1:3848/selector")
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.type && data.name) {
        var selectorKey = data.type + ":" + data.name;
        if (selectorKey !== lastHighlightedSelector) {
          lastHighlightedSelector = selectorKey;
          highlightElementBySelector(data.type, data.name);
        } else {
          // 同じセレクタ → 位置だけ更新
          updateHighlightPosition();
        }
      } else if (lastHighlightedSelector) {
        lastHighlightedSelector = null;
        removeVSCodeHighlight();
      }
    });
}, 500);
```

**Step 2**: transition削除（DOM追加時のフラッシュ防止）
```javascript
overlay.style.cssText =
  "position: fixed !important;" +
  "left: " + rect.left + "px !important;" +
  // ... (transition削除)
  "box-sizing: border-box !important;"; // transition: all 0.2s ease を削除
```

**Step 3**: オーバーレイDOM再利用
```javascript
var highlightOverlay = null;
var highlightLabel = null;

function highlightElementBySelector(type, name) {
  removeVSCodeHighlight(); // 古いDOMを削除
  // 新しいオーバーレイを作成して変数に保存
  highlightOverlay = document.createElement("div");
  // ...
  highlightLabel = document.createElement("div");
  // ...
}

function updateHighlightPosition() {
  if (!lastHighlightedElement || !highlightOverlay) return;
  var rect = lastHighlightedElement.getBoundingClientRect();
  highlightOverlay.style.left = rect.left + "px";
  highlightOverlay.style.top = rect.top + "px";
  highlightOverlay.style.width = rect.width + "px";
  highlightOverlay.style.height = rect.height + "px";
  if (highlightLabel) {
    highlightLabel.style.left = rect.left + "px";
    highlightLabel.style.top = (rect.top - 28) + "px";
  }
}
```

### 対処2: スクロール追従
scrollイベントで即座に位置を更新：
```javascript
// content.js
function highlightElementBySelector(type, name) {
  // ... overlay作成

  // スクロール追従イベント登録
  window.removeEventListener("scroll", updateHighlightPosition);
  window.addEventListener("scroll", updateHighlightPosition);
}

function removeVSCodeHighlight() {
  // ... DOM削除
  window.removeEventListener("scroll", updateHighlightPosition);
}
```

### 対処3: 3秒タイマー実装
```javascript
// content.js
var highlightFadeTimer = null;

function highlightElementBySelector(type, name) {
  // ... overlay作成

  // 3秒後に自動消去（セレクタ名は残す→同じセレクタの再表示を防ぐ）
  if (highlightFadeTimer) clearTimeout(highlightFadeTimer);
  highlightFadeTimer = setTimeout(function() {
    removeVSCodeHighlight(); // lastHighlightedSelectorはnullにしない
  }, 3000);
}
```

**ポイント**: タイマーで消す時に`lastHighlightedSelector = null`にしない。これにより：
- 3秒後にDOMは消える
- `lastHighlightedSelector`は残る → ポーリングで同じセレクタを検出しても再ハイライトしない
- セレクタが**変わった時**だけ新しいハイライトが発生

### 対処4: カーソル移動で解除
```typescript
// extension.ts
const onSelectionChange = vscode.window.onDidChangeTextEditorSelection((e) => {
  const editor = e.textEditor;
  if (!editor || editor.document.languageId !== 'css') { return; }
  const line = editor.document.lineAt(editor.selection.active.line).text;

  // プロパティ行やセレクタのない行 → ハイライト解除
  if (line.includes(':') && !line.includes('{')) {
    currentBrowserSelector = null; // ← 追加
    return;
  }

  const selectorMatch = line.match(/\.[\w-]+|#[\w-]+/);
  if (!selectorMatch) {
    currentBrowserSelector = null; // ← 追加
    return;
  }
  // ...
});
```

### 対処5: HTML対応
```typescript
// extension.ts
const onSelectionChange = vscode.window.onDidChangeTextEditorSelection((e) => {
  const editor = e.textEditor;
  if (!editor) { return; }
  const lang = editor.document.languageId;
  if (lang !== 'css' && lang !== 'html') { return; }

  const line = editor.document.lineAt(editor.selection.active.line).text;
  const cursorCol = editor.selection.active.character;

  if (lang === 'css') {
    // CSS処理（既存ロジック）
  } else {
    // HTMLモード：カーソル位置のclass/idを抽出
    const classMatch = line.match(/class\s*=\s*"([^"]*)"/i);
    const idMatch = line.match(/id\s*=\s*"([^"]*)"/i);

    let found = false;

    // id属性チェック
    if (idMatch && idMatch.index !== undefined) {
      const valStart = line.indexOf('"', idMatch.index) + 1;
      const valEnd = valStart + idMatch[1].length;
      if (cursorCol >= valStart && cursorCol <= valEnd) {
        currentBrowserSelector = { type: 'id', name: idMatch[1].trim(), timestamp: Date.now() };
        found = true;
      }
    }

    // class属性チェック（カーソル位置の単語を特定）
    if (!found && classMatch && classMatch.index !== undefined) {
      const valStart = line.indexOf('"', classMatch.index) + 1;
      const valEnd = valStart + classMatch[1].length;
      if (cursorCol >= valStart && cursorCol <= valEnd) {
        // カーソル位置のクラス名を特定
        const classes = classMatch[1].split(/\s+/).filter((c: string) => c);
        let pos = valStart;
        for (const cls of classes) {
          const clsStart = line.indexOf(cls, pos);
          const clsEnd = clsStart + cls.length;
          if (cursorCol >= clsStart && cursorCol <= clsEnd) {
            currentBrowserSelector = { type: 'class', name: cls, timestamp: Date.now() };
            found = true;
            break;
          }
          pos = clsEnd;
        }
      }
    }

    if (!found) {
      currentBrowserSelector = null;
    }
  }
});
```

---

## 修正ファイル

### Chrome拡張
- `css-jumper/content.js` (55-195行目)
  - 変数追加: `lastHighlightedSelector`, `highlightOverlay`, `highlightLabel`, `highlightFadeTimer`
  - `startVSCodeHighlightPolling()`: セレクタ重複チェック追加
  - `highlightElementBySelector()`: DOM再利用、transition削除、scrollイベント登録、3秒タイマー
  - `updateHighlightPosition()`: 新規関数（スクロール追従）
  - `removeVSCodeHighlight()`: イベントリスナー削除追加

### VS Code拡張
- `css-to-html-jumper/src/extension.ts` (1455-1520行目)
  - `onDidChangeTextEditorSelection`: HTML対応ロジック追加、currentBrowserSelectorクリア追加
- `css-to-html-jumper/package.json`: バージョン1.10.0にアップデート

---

## 予防策

### 1. ポーリングでのDOM操作は最小限に
- DOM追加/削除を繰り返すとパフォーマンス悪化 + 点滅の原因
- **状態変化があった時だけ**DOM操作する
- オーバーレイは再利用、位置だけ更新

### 2. transitionは慎重に使う
- DOM追加時の`transition`は意図しないアニメーション発生の原因
- ハイライトのような頻繁に更新される要素には不要

### 3. タイマーとポーリングの競合に注意
- タイマーで状態をリセットする場合、ポーリングでの再発火を考慮
- `lastHighlightedSelector`を残すことで再ハイライト抑止

### 4. スクロール追従は必須
- `position: fixed` + `getBoundingClientRect()`の組み合わせはスクロール時にズレる
- scrollイベントでリアルタイム更新が必要

### 5. 言語拡張は初期から設計
- 後からHTML対応を追加すると複雑化
- 最初から`languageId`分岐を考慮したコード設計が望ましい

---

## 関連問題

なし（今回が初出）

---

## 学んだこと

### 1. ポーリング + DOM操作 = 点滅リスク
ポーリングで繰り返し実行される関数内で毎回DOMを作り直すと、ユーザーには点滅として見える。**状態管理**で変化検知し、変化時のみDOM操作が鉄則。

### 2. オーバーレイのベストプラクティス
- `position: fixed` + スクロールイベント
- オーバーレイDOMは保持、座標だけ更新
- transition不要（即座に反映すべき）

### 3. タイマー削除とポーリング再発火
タイマーで消した後、ポーリングが同じ条件で再度発火することを想定する。**状態フラグ**で制御し、意図しない再表示を防ぐ。

### 4. カーソル位置からのセレクタ抽出
HTMLでは`class="a b c"`のようにスペース区切りで複数のクラスが存在するため、カーソル位置（`character`）から該当するクラス名を特定する必要がある。正規表現 + インデックス計算で実装。

### 5. Chrome拡張とVS Code拡張の連携
- VS Code拡張: HTTPサーバー（port 3848）で`currentBrowserSelector`を配信
- Chrome拡張: 500msポーリングで取得しブラウザ上にハイライト
- 双方向通信不要、シンプルなポーリング方式で十分

---

## 補足：最終的な動作仕様

| 操作 | 動作 |
|------|------|
| CSSセレクタ行にカーソル | ブラウザで該当要素をオレンジハイライト、3秒後に自動消去 |
| 同じセレクタ行で待機 | ハイライト維持、3秒後に消去、再出現なし |
| HTML `class="xxx"` にカーソル | ブラウザでそのクラスをハイライト |
| HTML `id="yyy"` にカーソル | ブラウザでそのIDをハイライト |
| プロパティ行に移動 | 即座にハイライト解除 |
| スクロール | ハイライトが要素に追従（ズレなし） |
| 別のセレクタ行に移動 | 新しいハイライト表示、3秒タイマー再スタート |
