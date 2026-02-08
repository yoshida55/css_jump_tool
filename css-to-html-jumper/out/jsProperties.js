"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsMethods = void 0;
exports.jsMethods = {
    // ==================== DOM Selection ====================
    "querySelector": {
        name: "querySelector",
        description: "CSSセレクタで要素を1つ取得。",
        syntax: "document.querySelector(selector)",
        params: [
            "selector → CSSセレクタ文字列"
        ],
        returns: "見つかった要素（なければnull）",
        examples: [
            "document.querySelector('.box') → classがboxの最初の要素",
            "document.querySelector('#header') → idがheaderの要素",
            "document.querySelector('div.active') → activeクラスのdiv"
        ],
        tips: [
            "複数取得したい場合は querySelectorAll() を使う",
            "見つからない場合は null を返すのでエラー注意"
        ],
        related: ["querySelectorAll", "getElementById", "getElementsByClassName"]
    },
    "querySelectorAll": {
        name: "querySelectorAll",
        description: "CSSセレクタで要素を全て取得。",
        syntax: "document.querySelectorAll(selector)",
        params: [
            "selector → CSSセレクタ文字列"
        ],
        returns: "NodeList（配列っぽいもの）",
        examples: [
            "document.querySelectorAll('.item') → 全てのitemクラス要素",
            "document.querySelectorAll('li') → 全てのli要素"
        ],
        tips: [
            "forEachでループ可能",
            "配列に変換: Array.from(nodeList) または [...nodeList]"
        ],
        related: ["querySelector", "getElementsByClassName"]
    },
    "getElementById": {
        name: "getElementById",
        description: "IDで要素を取得。",
        syntax: "document.getElementById(id)",
        params: [
            "id → ID名（#は不要）"
        ],
        returns: "見つかった要素（なければnull）",
        examples: [
            "document.getElementById('header') → id='header'の要素"
        ],
        tips: [
            "querySelectorより高速",
            "IDは1ページに1つだけのはずなので1要素のみ返す"
        ],
        related: ["querySelector"]
    },
    "getElementsByClassName": {
        name: "getElementsByClassName",
        description: "クラス名で要素を全て取得。",
        syntax: "document.getElementsByClassName(className)",
        params: [
            "className → クラス名（.は不要）"
        ],
        returns: "HTMLCollection（ライブコレクション）",
        examples: [
            "document.getElementsByClassName('item') → 全てのitemクラス要素"
        ],
        tips: [
            "ライブコレクション = DOMが変われば自動更新される",
            "querySelectorAllの方が汎用的"
        ],
        related: ["querySelectorAll"]
    },
    // ==================== DOM Manipulation ====================
    "addEventListener": {
        name: "addEventListener",
        description: "イベントリスナーを登録。",
        syntax: "element.addEventListener(event, callback)",
        params: [
            "event → イベント名（'click', 'scroll'等）",
            "callback → 実行する関数"
        ],
        examples: [
            "btn.addEventListener('click', () => { ... })",
            "window.addEventListener('scroll', handleScroll)"
        ],
        tips: [
            "複数のリスナーを同じ要素に追加可能",
            "削除はremoveEventListenerで（同じ関数参照が必要）"
        ],
        related: ["removeEventListener", "onclick"]
    },
    "removeEventListener": {
        name: "removeEventListener",
        description: "イベントリスナーを削除。",
        syntax: "element.removeEventListener(event, callback)",
        params: [
            "event → イベント名",
            "callback → 削除する関数（addEventListenerと同じ参照）"
        ],
        tips: [
            "無名関数は削除できない→変数に入れておく必要あり"
        ],
        related: ["addEventListener"]
    },
    "classList": {
        name: "classList",
        description: "要素のクラスを操作するためのオブジェクト。",
        examples: [
            ".add('active') → クラスを追加",
            ".remove('active') → クラスを削除",
            ".toggle('active') → あれば削除、なければ追加",
            ".contains('active') → クラスがあればtrue"
        ],
        tips: [
            "classNameより直感的で便利",
            "複数クラス: classList.add('a', 'b', 'c')"
        ],
        related: ["className"]
    },
    "innerHTML": {
        name: "innerHTML",
        description: "要素内のHTMLを取得・設定。",
        syntax: "element.innerHTML = '<p>新しい内容</p>'",
        examples: [
            "取得: const html = element.innerHTML",
            "設定: element.innerHTML = '<strong>変更</strong>'"
        ],
        tips: [
            "⚠️ ユーザー入力をそのまま設定するとXSS脆弱性",
            "テキストだけなら textContent の方が安全"
        ],
        related: ["textContent", "innerText", "outerHTML"]
    },
    "textContent": {
        name: "textContent",
        description: "要素内のテキストを取得・設定。",
        syntax: "element.textContent = '新しいテキスト'",
        examples: [
            "取得: const text = element.textContent",
            "設定: element.textContent = 'Hello'"
        ],
        tips: [
            "HTMLタグはエスケープされる（安全）",
            "隠し要素のテキストも取得する"
        ],
        related: ["innerHTML", "innerText"]
    },
    "appendChild": {
        name: "appendChild",
        description: "子要素を末尾に追加。",
        syntax: "parent.appendChild(child)",
        params: [
            "child → 追加する要素"
        ],
        examples: [
            "const li = document.createElement('li');",
            "ul.appendChild(li);"
        ],
        tips: [
            "既存要素を追加すると移動になる",
            "append()は複数追加可能でテキストもOK"
        ],
        related: ["append", "prepend", "insertBefore", "removeChild"]
    },
    "createElement": {
        name: "createElement",
        description: "新しいHTML要素を作成。",
        syntax: "document.createElement(tagName)",
        params: [
            "tagName → タグ名（'div', 'p'等）"
        ],
        returns: "新しい要素（まだDOMに追加されていない）",
        examples: [
            "const div = document.createElement('div');",
            "div.textContent = 'Hello';",
            "document.body.appendChild(div);"
        ],
        tips: [
            "作成後にappendChildなどでDOMに追加する必要あり"
        ],
        related: ["appendChild", "append"]
    },
    "remove": {
        name: "remove",
        description: "要素をDOMから削除。",
        syntax: "element.remove()",
        examples: [
            "document.querySelector('.box').remove()"
        ],
        tips: [
            "IE非対応の場合は parentNode.removeChild(element) を使う"
        ],
        related: ["removeChild", "appendChild"]
    },
    // ==================== Attributes & Styles ====================
    "getAttribute": {
        name: "getAttribute",
        description: "属性の値を取得。",
        syntax: "element.getAttribute(name)",
        params: [
            "name → 属性名"
        ],
        examples: [
            "element.getAttribute('href') → リンク先URL",
            "element.getAttribute('data-id') → カスタムデータ属性"
        ],
        tips: [
            "data-*属性はdatasetプロパティでも取得可能"
        ],
        related: ["setAttribute", "dataset", "hasAttribute"]
    },
    "setAttribute": {
        name: "setAttribute",
        description: "属性を設定。",
        syntax: "element.setAttribute(name, value)",
        params: [
            "name → 属性名",
            "value → 設定する値"
        ],
        examples: [
            "element.setAttribute('href', 'https://example.com')",
            "element.setAttribute('disabled', '')"
        ],
        tips: [
            "Boolean属性は空文字でtrue扱い"
        ],
        related: ["getAttribute", "removeAttribute"]
    },
    "style": {
        name: "style",
        description: "インラインスタイルを直接操作。",
        syntax: "element.style.propertyName = value",
        examples: [
            "element.style.color = 'red'",
            "element.style.backgroundColor = '#fff'  // キャメルケース",
            "element.style.display = 'none'"
        ],
        tips: [
            "CSSのハイフンはキャメルケースに変換",
            "多くのスタイル変更にはクラス操作の方がおすすめ"
        ],
        related: ["classList", "getComputedStyle"]
    },
    "dataset": {
        name: "dataset",
        description: "data-*属性を操作。",
        syntax: "element.dataset.name",
        examples: [
            "data-user-id='123' → element.dataset.userId で取得",
            "element.dataset.userId = '456' で設定"
        ],
        tips: [
            "data-の後のハイフンはキャメルケースに変換"
        ],
        related: ["getAttribute", "setAttribute"]
    },
    // ==================== Array Methods ====================
    "forEach": {
        name: "forEach",
        description: "配列の各要素に対して関数を実行。",
        syntax: "array.forEach((item, index) => { ... })",
        params: [
            "item → 現在の要素",
            "index → インデックス（省略可）"
        ],
        examples: [
            "items.forEach(item => console.log(item))",
            "items.forEach((item, i) => console.log(i, item))"
        ],
        tips: [
            "戻り値なし（undefinedを返す）",
            "途中でbreakできない→breakしたいならforやsomeを使う"
        ],
        related: ["map", "filter", "for...of"]
    },
    "map": {
        name: "map",
        description: "配列の各要素を変換して新しい配列を作成。",
        syntax: "array.map((item, index) => newItem)",
        params: [
            "item → 現在の要素",
            "index → インデックス（省略可）"
        ],
        returns: "新しい配列",
        examples: [
            "const doubled = nums.map(n => n * 2)",
            "const names = users.map(u => u.name)"
        ],
        tips: [
            "元の配列は変更されない（イミュータブル）",
            "戻り値がいらないならforEachを使う"
        ],
        related: ["forEach", "filter", "reduce"]
    },
    "filter": {
        name: "filter",
        description: "条件に合う要素だけの新しい配列を作成。",
        syntax: "array.filter((item) => condition)",
        params: [
            "item → 現在の要素"
        ],
        returns: "条件がtrueの要素だけの配列",
        examples: [
            "const evens = nums.filter(n => n % 2 === 0)",
            "const adults = users.filter(u => u.age >= 20)"
        ],
        tips: [
            "元の配列は変更されない"
        ],
        related: ["find", "map", "some", "every"]
    },
    "find": {
        name: "find",
        description: "条件に合う最初の要素を取得。",
        syntax: "array.find((item) => condition)",
        params: [
            "item → 現在の要素"
        ],
        returns: "見つかった要素（なければundefined）",
        examples: [
            "const found = users.find(u => u.id === 123)"
        ],
        tips: [
            "最初の1件のみ返す",
            "見つからないとundefinedなので注意"
        ],
        related: ["findIndex", "filter", "some"]
    },
    "reduce": {
        name: "reduce",
        description: "配列を1つの値に集約。",
        syntax: "array.reduce((acc, item) => newAcc, initialValue)",
        params: [
            "acc → 累積値（前回のreturn値）",
            "item → 現在の要素",
            "initialValue → 初期値"
        ],
        returns: "最終的な累積値",
        examples: [
            "const sum = nums.reduce((acc, n) => acc + n, 0)",
            "const obj = arr.reduce((acc, item) => { acc[item.id] = item; return acc; }, {})"
        ],
        tips: [
            "初期値は必ず指定するのがおすすめ",
            "合計、グループ化、変換など多用途"
        ],
        related: ["map", "filter"]
    },
    "some": {
        name: "some",
        description: "1つでも条件に合う要素があればtrue。",
        syntax: "array.some((item) => condition)",
        returns: "true/false",
        examples: [
            "const hasAdmin = users.some(u => u.role === 'admin')"
        ],
        tips: [
            "条件に合う要素が見つかった時点で終了（高速）"
        ],
        related: ["every", "find", "includes"]
    },
    "every": {
        name: "every",
        description: "全ての要素が条件に合えばtrue。",
        syntax: "array.every((item) => condition)",
        returns: "true/false",
        examples: [
            "const allAdult = users.every(u => u.age >= 20)"
        ],
        tips: [
            "1つでもfalseがあれば即終了（高速）"
        ],
        related: ["some", "filter"]
    },
    "includes": {
        name: "includes",
        description: "配列に値が含まれているかチェック。",
        syntax: "array.includes(value)",
        returns: "true/false",
        examples: [
            "[1, 2, 3].includes(2) → true",
            "['a', 'b'].includes('c') → false"
        ],
        tips: [
            "オブジェクトの比較は参照比較なので注意"
        ],
        related: ["indexOf", "some"]
    },
    // ==================== String Methods ====================
    "split": {
        name: "split",
        description: "文字列を区切り文字で分割して配列に。",
        syntax: "string.split(separator)",
        params: [
            "separator → 区切り文字"
        ],
        returns: "配列",
        examples: [
            "'a,b,c'.split(',') → ['a', 'b', 'c']",
            "'hello'.split('') → ['h', 'e', 'l', 'l', 'o']"
        ],
        related: ["join", "slice"]
    },
    "join": {
        name: "join",
        description: "配列を結合して文字列に。",
        syntax: "array.join(separator)",
        params: [
            "separator → 区切り文字（省略時はカンマ）"
        ],
        returns: "文字列",
        examples: [
            "['a', 'b', 'c'].join('-') → 'a-b-c'",
            "['a', 'b'].join('') → 'ab'"
        ],
        related: ["split"]
    },
    "trim": {
        name: "trim",
        description: "前後の空白を削除。",
        syntax: "string.trim()",
        returns: "空白を除いた文字列",
        examples: [
            "'  hello  '.trim() → 'hello'"
        ],
        tips: [
            "フォーム入力値の正規化に便利"
        ],
        related: ["trimStart", "trimEnd"]
    },
    // ==================== JSON ====================
    "JSON.parse": {
        name: "JSON.parse",
        description: "JSON文字列をオブジェクトに変換。",
        syntax: "JSON.parse(jsonString)",
        returns: "JavaScriptオブジェクト",
        examples: [
            "const obj = JSON.parse('{\"name\":\"太郎\"}')"
        ],
        tips: [
            "無効なJSONでエラーになるのでtry-catchで囲む"
        ],
        related: ["JSON.stringify"]
    },
    "JSON.stringify": {
        name: "JSON.stringify",
        description: "オブジェクトをJSON文字列に変換。",
        syntax: "JSON.stringify(object)",
        returns: "JSON文字列",
        examples: [
            "const json = JSON.stringify({ name: '太郎' })"
        ],
        tips: [
            "第2引数で整形可能: JSON.stringify(obj, null, 2)"
        ],
        related: ["JSON.parse"]
    },
    // ==================== Async ====================
    "fetch": {
        name: "fetch",
        description: "HTTPリクエストを送信。",
        syntax: "fetch(url, options)",
        params: [
            "url → リクエスト先URL",
            "options → メソッド、ヘッダー等（省略可）"
        ],
        returns: "Promise<Response>",
        examples: [
            "const res = await fetch('/api/users')",
            "const data = await res.json()"
        ],
        tips: [
            "戻り値はPromiseなのでawaitまたは.then()を使う",
            "HTTPエラー(404等)でもrejectされない→res.okをチェック"
        ],
        related: ["async/await", "Promise"]
    },
    "setTimeout": {
        name: "setTimeout",
        description: "指定時間後に1回だけ関数を実行。",
        syntax: "setTimeout(callback, delay)",
        params: [
            "callback → 実行する関数",
            "delay → 遅延時間（ミリ秒）"
        ],
        returns: "タイマーID（clearTimeoutで解除用）",
        examples: [
            "setTimeout(() => console.log('3秒後'), 3000)"
        ],
        tips: [
            "clearTimeoutでキャンセル可能"
        ],
        related: ["setInterval", "clearTimeout"]
    },
    "setInterval": {
        name: "setInterval",
        description: "指定間隔で繰り返し関数を実行。",
        syntax: "setInterval(callback, interval)",
        params: [
            "callback → 実行する関数",
            "interval → 間隔（ミリ秒）"
        ],
        returns: "タイマーID（clearIntervalで解除用）",
        examples: [
            "const id = setInterval(() => console.log('1秒毎'), 1000)",
            "clearInterval(id); // 停止"
        ],
        tips: [
            "必ずclearIntervalで停止しないとメモリリークの原因に"
        ],
        related: ["setTimeout", "clearInterval"]
    },
    // ==================== Console ====================
    "console.log": {
        name: "console.log",
        description: "コンソールにログを出力。",
        syntax: "console.log(message, ...values)",
        examples: [
            "console.log('Hello')",
            "console.log('値:', value)",
            "console.log({ user, data }) // オブジェクトを見やすく"
        ],
        tips: [
            "変数名と値を一緒に見たい時は { } で囲む"
        ],
        related: ["console.error", "console.warn", "console.table"]
    },
    "console.table": {
        name: "console.table",
        description: "配列・オブジェクトを表形式で表示。",
        syntax: "console.table(data)",
        examples: [
            "console.table([{id:1, name:'A'}, {id:2, name:'B'}])"
        ],
        tips: [
            "配列やオブジェクトのデバッグに超便利"
        ],
        related: ["console.log"]
    },
    // ==================== Observers ====================
    "IntersectionObserver": {
        name: "IntersectionObserver",
        description: "要素が画面内に入ったかを監視。スクロールアニメーションに最適。",
        syntax: "new IntersectionObserver(callback, options)",
        params: [
            "callback → 交差状態が変わった時に呼ばれる関数",
            "options → threshold, root, rootMargin等"
        ],
        examples: [
            "const observer = new IntersectionObserver((entries) => { entries.forEach(entry => { if (entry.isIntersecting) { /* 画面内に入った */ } }); });",
            "observer.observe(element);"
        ],
        tips: [
            "scrollイベントより軽量で高パフォーマンス",
            "threshold: 0.5 で要素の50%が見えたら発火"
        ],
        related: ["observe", "unobserve", "disconnect"]
    },
    "observe": {
        name: "observe",
        description: "要素の監視を開始（Observer系で使用）。",
        syntax: "observer.observe(element)",
        params: [
            "element → 監視対象の要素"
        ],
        examples: [
            "intersectionObserver.observe(targetElement)"
        ],
        related: ["unobserve", "disconnect", "IntersectionObserver"]
    },
    "unobserve": {
        name: "unobserve",
        description: "要素の監視を停止（Observer系で使用）。",
        syntax: "observer.unobserve(element)",
        params: [
            "element → 監視を停止する要素"
        ],
        examples: [
            "observer.unobserve(entry.target); // 1回だけアニメーションさせる時"
        ],
        tips: [
            "アニメーション後に呼ぶとパフォーマンス向上"
        ],
        related: ["observe", "disconnect"]
    },
    "disconnect": {
        name: "disconnect",
        description: "全ての監視を停止（Observer系で使用）。",
        syntax: "observer.disconnect()",
        examples: [
            "observer.disconnect(); // 全要素の監視を一括停止"
        ],
        related: ["observe", "unobserve"]
    },
    "ResizeObserver": {
        name: "ResizeObserver",
        description: "要素のサイズ変更を監視。",
        syntax: "new ResizeObserver(callback)",
        params: [
            "callback → サイズ変更時に呼ばれる関数"
        ],
        examples: [
            "const observer = new ResizeObserver((entries) => { entries.forEach(entry => { console.log(entry.contentRect.width); }); });"
        ],
        tips: [
            "レスポンシブ対応のカスタム処理に便利"
        ],
        related: ["observe", "disconnect"]
    },
    "MutationObserver": {
        name: "MutationObserver",
        description: "DOMの変更を監視。",
        syntax: "new MutationObserver(callback)",
        params: [
            "callback → DOM変更時に呼ばれる関数"
        ],
        examples: [
            "const observer = new MutationObserver((mutations) => { mutations.forEach(m => console.log(m)); });",
            "observer.observe(element, { childList: true, subtree: true });"
        ],
        tips: [
            "動的に追加される要素の監視に使用"
        ],
        related: ["observe", "disconnect"]
    },
    // ==================== Storage ====================
    "localStorage": {
        name: "localStorage",
        description: "ブラウザにデータを永続保存。ブラウザを閉じても消えない。",
        syntax: "localStorage.setItem(key, value)",
        examples: [
            "localStorage.setItem('user', JSON.stringify({name: '太郎'}))",
            "const user = JSON.parse(localStorage.getItem('user'))",
            "localStorage.removeItem('user')",
            "localStorage.clear() // 全削除"
        ],
        tips: [
            "文字列しか保存できないのでJSON.stringifyを使う",
            "5MB程度まで保存可能"
        ],
        related: ["sessionStorage", "getItem", "setItem"]
    },
    "sessionStorage": {
        name: "sessionStorage",
        description: "ブラウザにデータを一時保存。タブを閉じると消える。",
        syntax: "sessionStorage.setItem(key, value)",
        examples: [
            "sessionStorage.setItem('token', 'abc123')",
            "const token = sessionStorage.getItem('token')"
        ],
        tips: [
            "タブごとに独立した領域",
            "ログイン情報の一時保持などに"
        ],
        related: ["localStorage"]
    },
    "getItem": {
        name: "getItem",
        description: "Storage（localStorage/sessionStorage）から値を取得。",
        syntax: "localStorage.getItem(key)",
        params: [
            "key → 保存時のキー名"
        ],
        returns: "保存された値（なければnull）",
        examples: [
            "const value = localStorage.getItem('key')"
        ],
        related: ["setItem", "removeItem"]
    },
    "setItem": {
        name: "setItem",
        description: "Storage（localStorage/sessionStorage）に値を保存。",
        syntax: "localStorage.setItem(key, value)",
        params: [
            "key → キー名",
            "value → 保存する値（文字列）"
        ],
        examples: [
            "localStorage.setItem('name', '太郎')"
        ],
        tips: [
            "オブジェクトはJSON.stringifyで文字列化"
        ],
        related: ["getItem", "removeItem"]
    },
    // ==================== Object ====================
    "Object.keys": {
        name: "Object.keys",
        description: "オブジェクトのキー一覧を配列で取得。",
        syntax: "Object.keys(object)",
        returns: "キー名の配列",
        examples: [
            "Object.keys({a: 1, b: 2}) → ['a', 'b']"
        ],
        related: ["Object.values", "Object.entries"]
    },
    "Object.values": {
        name: "Object.values",
        description: "オブジェクトの値一覧を配列で取得。",
        syntax: "Object.values(object)",
        returns: "値の配列",
        examples: [
            "Object.values({a: 1, b: 2}) → [1, 2]"
        ],
        related: ["Object.keys", "Object.entries"]
    },
    "Object.entries": {
        name: "Object.entries",
        description: "オブジェクトの[キー, 値]ペアを配列で取得。",
        syntax: "Object.entries(object)",
        returns: "[[キー, 値], ...]の配列",
        examples: [
            "Object.entries({a: 1, b: 2}) → [['a', 1], ['b', 2]]",
            "Object.entries(obj).forEach(([key, val]) => { ... })"
        ],
        tips: [
            "forEachと組み合わせてオブジェクトをループ"
        ],
        related: ["Object.keys", "Object.values", "Object.fromEntries"]
    },
    "Object.fromEntries": {
        name: "Object.fromEntries",
        description: "[キー, 値]ペアの配列からオブジェクトを作成。",
        syntax: "Object.fromEntries(entries)",
        returns: "オブジェクト",
        examples: [
            "Object.fromEntries([['a', 1], ['b', 2]]) → {a: 1, b: 2}"
        ],
        tips: [
            "Object.entriesの逆操作"
        ],
        related: ["Object.entries"]
    },
    "Object.assign": {
        name: "Object.assign",
        description: "オブジェクトをマージ（コピー）。",
        syntax: "Object.assign(target, ...sources)",
        returns: "マージされたオブジェクト",
        examples: [
            "Object.assign({}, obj1, obj2) → マージした新オブジェクト",
            "Object.assign(target, source) → targetに上書き"
        ],
        tips: [
            "浅いコピーなので注意",
            "スプレッド構文 {...obj1, ...obj2} の方がモダン"
        ],
        related: ["スプレッド構文"]
    },
    // ==================== Array Additional ====================
    "Array.from": {
        name: "Array.from",
        description: "配列っぽいもの（NodeList等）を配列に変換。",
        syntax: "Array.from(arrayLike)",
        returns: "配列",
        examples: [
            "Array.from(document.querySelectorAll('li'))",
            "Array.from({length: 5}, (_, i) => i) → [0,1,2,3,4]"
        ],
        tips: [
            "[...nodeList] でも同様のことが可能"
        ],
        related: ["querySelectorAll"]
    },
    "Array.isArray": {
        name: "Array.isArray",
        description: "値が配列かどうかをチェック。",
        syntax: "Array.isArray(value)",
        returns: "true/false",
        examples: [
            "Array.isArray([1,2,3]) → true",
            "Array.isArray('abc') → false"
        ],
        tips: [
            "typeofでは配列かどうか判定できない"
        ]
    },
    "findIndex": {
        name: "findIndex",
        description: "条件に合う最初の要素のインデックスを取得。",
        syntax: "array.findIndex((item) => condition)",
        returns: "インデックス（なければ-1）",
        examples: [
            "const idx = users.findIndex(u => u.id === 123)"
        ],
        related: ["find", "indexOf"]
    },
    "indexOf": {
        name: "indexOf",
        description: "値が最初に出現するインデックスを取得。",
        syntax: "array.indexOf(value)",
        returns: "インデックス（なければ-1）",
        examples: [
            "[1, 2, 3].indexOf(2) → 1",
            "['a', 'b'].indexOf('c') → -1"
        ],
        related: ["findIndex", "includes", "lastIndexOf"]
    },
    "slice": {
        name: "slice",
        description: "配列の一部を切り出して新しい配列を作成。",
        syntax: "array.slice(start, end)",
        params: [
            "start → 開始インデックス",
            "end → 終了インデックス（この手前まで）"
        ],
        returns: "切り出した新しい配列",
        examples: [
            "[1,2,3,4,5].slice(1, 3) → [2, 3]",
            "[1,2,3,4,5].slice(-2) → [4, 5]"
        ],
        tips: [
            "元の配列は変更されない",
            "配列のコピー: arr.slice()"
        ],
        related: ["splice", "substring"]
    },
    "splice": {
        name: "splice",
        description: "配列の要素を削除・追加（元の配列を変更）。",
        syntax: "array.splice(start, deleteCount, ...items)",
        params: [
            "start → 開始インデックス",
            "deleteCount → 削除する個数",
            "items → 追加する要素（省略可）"
        ],
        returns: "削除された要素の配列",
        examples: [
            "arr.splice(1, 2) → 1番目から2個削除",
            "arr.splice(1, 0, 'new') → 1番目に挿入",
            "arr.splice(1, 1, 'replace') → 1番目を置換"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ],
        related: ["slice"]
    },
    "concat": {
        name: "concat",
        description: "配列を結合して新しい配列を作成。",
        syntax: "array.concat(array2, array3, ...)",
        returns: "結合した新しい配列",
        examples: [
            "[1, 2].concat([3, 4]) → [1, 2, 3, 4]"
        ],
        tips: [
            "スプレッド構文 [...arr1, ...arr2] でも可能"
        ],
        related: ["spread構文"]
    },
    "flat": {
        name: "flat",
        description: "ネストした配列を平坦化。",
        syntax: "array.flat(depth)",
        params: [
            "depth → 平坦化する深さ（デフォルト1）"
        ],
        returns: "平坦化した新しい配列",
        examples: [
            "[[1, 2], [3, 4]].flat() → [1, 2, 3, 4]",
            "[1, [2, [3]]].flat(2) → [1, 2, 3]"
        ],
        related: ["flatMap"]
    },
    "reverse": {
        name: "reverse",
        description: "配列を逆順に（元の配列を変更）。",
        syntax: "array.reverse()",
        returns: "逆順になった配列",
        examples: [
            "[1, 2, 3].reverse() → [3, 2, 1]"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド",
            "元を変えたくない場合: [...arr].reverse()"
        ]
    },
    "sort": {
        name: "sort",
        description: "配列をソート（元の配列を変更）。",
        syntax: "array.sort(compareFunction)",
        params: [
            "compareFunction → 比較関数（省略すると文字列として比較）"
        ],
        returns: "ソートされた配列",
        examples: [
            "[3, 1, 2].sort() → [1, 2, 3]",
            "[3, 1, 2].sort((a, b) => a - b) → 数値昇順",
            "[3, 1, 2].sort((a, b) => b - a) → 数値降順"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド",
            "数値ソートには比較関数が必要"
        ]
    },
    "push": {
        name: "push",
        description: "配列の末尾に要素を追加。",
        syntax: "array.push(element)",
        returns: "追加後の配列の長さ",
        examples: [
            "arr.push('new') → 末尾に追加"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ],
        related: ["pop", "unshift", "shift"]
    },
    "pop": {
        name: "pop",
        description: "配列の末尾から要素を削除して返す。",
        syntax: "array.pop()",
        returns: "削除した要素",
        examples: [
            "const last = arr.pop()"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ],
        related: ["push", "shift"]
    },
    "shift": {
        name: "shift",
        description: "配列の先頭から要素を削除して返す。",
        syntax: "array.shift()",
        returns: "削除した要素",
        examples: [
            "const first = arr.shift()"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ],
        related: ["unshift", "pop"]
    },
    "unshift": {
        name: "unshift",
        description: "配列の先頭に要素を追加。",
        syntax: "array.unshift(element)",
        returns: "追加後の配列の長さ",
        examples: [
            "arr.unshift('first') → 先頭に追加"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ],
        related: ["shift", "push"]
    },
    "fill": {
        name: "fill",
        description: "配列を指定値で埋める。",
        syntax: "array.fill(value, start, end)",
        returns: "変更された配列",
        examples: [
            "[1,2,3].fill(0) → [0,0,0]",
            "new Array(5).fill(0) → [0,0,0,0,0]"
        ],
        tips: [
            "⚠️ 元の配列を変更する破壊的メソッド"
        ]
    },
    // ==================== String Additional ====================
    "replace": {
        name: "replace",
        description: "文字列を置換。",
        syntax: "string.replace(search, replacement)",
        params: [
            "search → 検索文字列または正規表現",
            "replacement → 置換後の文字列"
        ],
        returns: "置換後の文字列",
        examples: [
            "'hello'.replace('l', 'L') → 'heLlo'（最初の1つだけ）",
            "'hello'.replace(/l/g, 'L') → 'heLLo'（全て）"
        ],
        tips: [
            "全置換はreplaceAll()または正規表現で/g"
        ],
        related: ["replaceAll"]
    },
    "replaceAll": {
        name: "replaceAll",
        description: "文字列を全て置換。",
        syntax: "string.replaceAll(search, replacement)",
        returns: "置換後の文字列",
        examples: [
            "'hello'.replaceAll('l', 'L') → 'heLLo'"
        ],
        related: ["replace"]
    },
    "substring": {
        name: "substring",
        description: "文字列の一部を切り出し。",
        syntax: "string.substring(start, end)",
        params: [
            "start → 開始インデックス",
            "end → 終了インデックス（この手前まで）"
        ],
        returns: "切り出した文字列",
        examples: [
            "'hello'.substring(0, 2) → 'he'",
            "'hello'.substring(1) → 'ello'"
        ],
        related: ["slice", "substr"]
    },
    "startsWith": {
        name: "startsWith",
        description: "文字列が指定文字で始まるかチェック。",
        syntax: "string.startsWith(searchString)",
        returns: "true/false",
        examples: [
            "'hello'.startsWith('he') → true"
        ],
        related: ["endsWith", "includes"]
    },
    "endsWith": {
        name: "endsWith",
        description: "文字列が指定文字で終わるかチェック。",
        syntax: "string.endsWith(searchString)",
        returns: "true/false",
        examples: [
            "'hello'.endsWith('lo') → true"
        ],
        related: ["startsWith", "includes"]
    },
    "padStart": {
        name: "padStart",
        description: "文字列の先頭を指定文字で埋める。",
        syntax: "string.padStart(targetLength, padString)",
        returns: "パディングされた文字列",
        examples: [
            "'5'.padStart(2, '0') → '05'（ゼロ埋め）",
            "'1'.padStart(3, '0') → '001'"
        ],
        tips: [
            "日付や時刻のゼロ埋めに便利"
        ],
        related: ["padEnd"]
    },
    "toLowerCase": {
        name: "toLowerCase",
        description: "文字列を小文字に変換。",
        syntax: "string.toLowerCase()",
        returns: "小文字の文字列",
        examples: [
            "'Hello'.toLowerCase() → 'hello'"
        ],
        related: ["toUpperCase"]
    },
    "toUpperCase": {
        name: "toUpperCase",
        description: "文字列を大文字に変換。",
        syntax: "string.toUpperCase()",
        returns: "大文字の文字列",
        examples: [
            "'Hello'.toUpperCase() → 'HELLO'"
        ],
        related: ["toLowerCase"]
    },
    // ==================== Promise & Async ====================
    "Promise": {
        name: "Promise",
        description: "非同期処理を扱うオブジェクト。",
        syntax: "new Promise((resolve, reject) => { ... })",
        params: [
            "resolve → 成功時に呼ぶ関数",
            "reject → 失敗時に呼ぶ関数"
        ],
        examples: [
            "const promise = new Promise((resolve, reject) => { setTimeout(() => resolve('done'), 1000); });"
        ],
        tips: [
            "async/awaitを使う方がシンプルなことが多い"
        ],
        related: ["then", "catch", "async", "await"]
    },
    "then": {
        name: "then",
        description: "Promiseが成功したときの処理を登録。",
        syntax: "promise.then(callback)",
        params: [
            "callback → 成功時に実行する関数"
        ],
        examples: [
            "fetch('/api').then(res => res.json()).then(data => console.log(data))"
        ],
        tips: [
            "チェインで繋げられる",
            "async/awaitの方が読みやすいことが多い"
        ],
        related: ["catch", "finally", "Promise"]
    },
    "catch": {
        name: "catch",
        description: "Promiseがエラーになったときの処理を登録。",
        syntax: "promise.catch(callback)",
        params: [
            "callback → エラー時に実行する関数"
        ],
        examples: [
            "fetch('/api').then(res => res.json()).catch(err => console.error(err))"
        ],
        related: ["then", "finally"]
    },
    "finally": {
        name: "finally",
        description: "Promiseの成功・失敗に関わらず実行される処理。",
        syntax: "promise.finally(callback)",
        examples: [
            "fetch('/api').then(...).catch(...).finally(() => { loading = false; })"
        ],
        tips: [
            "ローディング状態のリセットなどに便利"
        ],
        related: ["then", "catch"]
    },
    "async": {
        name: "async",
        description: "関数を非同期関数として定義。",
        syntax: "async function name() { ... }",
        examples: [
            "async function fetchData() { const res = await fetch('/api'); return res.json(); }"
        ],
        tips: [
            "async関数は必ずPromiseを返す",
            "内部でawaitが使える"
        ],
        related: ["await", "Promise"]
    },
    "await": {
        name: "await",
        description: "Promiseの結果を待つ。",
        syntax: "const result = await promise",
        examples: [
            "const res = await fetch('/api');",
            "const data = await res.json();"
        ],
        tips: [
            "async関数の中でのみ使用可能",
            "try-catchでエラーハンドリング"
        ],
        related: ["async", "Promise"]
    },
    // ==================== DOM Additional ====================
    "closest": {
        name: "closest",
        description: "祖先要素の中でセレクタに一致する最も近い要素を取得。",
        syntax: "element.closest(selector)",
        returns: "見つかった祖先要素（なければnull）",
        examples: [
            "button.closest('.card') → buttonを含む.card要素",
            "event.target.closest('li') → クリックされたli要素"
        ],
        tips: [
            "イベント委譲で親要素を取得するのに便利"
        ],
        related: ["querySelector", "parentElement"]
    },
    "parentElement": {
        name: "parentElement",
        description: "親要素を取得。",
        syntax: "element.parentElement",
        returns: "親要素（なければnull）",
        examples: [
            "const parent = element.parentElement"
        ],
        related: ["closest", "children"]
    },
    "children": {
        name: "children",
        description: "子要素一覧を取得。",
        syntax: "element.children",
        returns: "HTMLCollection",
        examples: [
            "const kids = element.children",
            "[...element.children].forEach(child => { ... })"
        ],
        related: ["parentElement", "firstElementChild"]
    },
    "nextElementSibling": {
        name: "nextElementSibling",
        description: "次の兄弟要素を取得。",
        syntax: "element.nextElementSibling",
        returns: "次の要素（なければnull）",
        examples: [
            "const next = element.nextElementSibling"
        ],
        related: ["previousElementSibling"]
    },
    "previousElementSibling": {
        name: "previousElementSibling",
        description: "前の兄弟要素を取得。",
        syntax: "element.previousElementSibling",
        returns: "前の要素（なければnull）",
        examples: [
            "const prev = element.previousElementSibling"
        ],
        related: ["nextElementSibling"]
    },
    "cloneNode": {
        name: "cloneNode",
        description: "要素をコピー。",
        syntax: "element.cloneNode(deep)",
        params: [
            "deep → trueで子要素も含めてコピー"
        ],
        returns: "コピーされた要素",
        examples: [
            "const copy = element.cloneNode(true)"
        ],
        tips: [
            "idは重複するので変更が必要"
        ]
    },
    "insertAdjacentHTML": {
        name: "insertAdjacentHTML",
        description: "指定位置にHTMLを挿入。",
        syntax: "element.insertAdjacentHTML(position, html)",
        params: [
            "position → 'beforebegin', 'afterbegin', 'beforeend', 'afterend'",
            "html → 挿入するHTML文字列"
        ],
        examples: [
            "element.insertAdjacentHTML('beforeend', '<p>追加</p>')"
        ],
        tips: [
            "innerHTMLより効率的（既存要素を再解析しない）"
        ],
        related: ["innerHTML", "appendChild"]
    },
    "getBoundingClientRect": {
        name: "getBoundingClientRect",
        description: "要素のサイズと位置を取得。",
        syntax: "element.getBoundingClientRect()",
        returns: "{ top, left, bottom, right, width, height }",
        examples: [
            "const rect = element.getBoundingClientRect();",
            "console.log(rect.top, rect.left);"
        ],
        tips: [
            "ビューポート基準の座標",
            "スクロール位置は含まれない"
        ]
    },
    "scrollIntoView": {
        name: "scrollIntoView",
        description: "要素が見えるようにスクロール。",
        syntax: "element.scrollIntoView(options)",
        params: [
            "options → { behavior: 'smooth', block: 'start' }等"
        ],
        examples: [
            "element.scrollIntoView({ behavior: 'smooth' })"
        ],
        tips: [
            "アンカーリンク的な動作を実装できる"
        ]
    },
    "focus": {
        name: "focus",
        description: "要素にフォーカスを当てる。",
        syntax: "element.focus()",
        examples: [
            "inputElement.focus()"
        ],
        tips: [
            "モーダル表示時の最初の入力欄などに"
        ],
        related: ["blur"]
    },
    "blur": {
        name: "blur",
        description: "要素からフォーカスを外す。",
        syntax: "element.blur()",
        examples: [
            "inputElement.blur()"
        ],
        related: ["focus"]
    },
    // ==================== Number ====================
    "parseInt": {
        name: "parseInt",
        description: "文字列を整数に変換。",
        syntax: "parseInt(string, radix)",
        params: [
            "string → 変換する文字列",
            "radix → 基数（10進数なら10）"
        ],
        returns: "整数（変換できなければNaN）",
        examples: [
            "parseInt('42') → 42",
            "parseInt('42px') → 42",
            "parseInt('abc') → NaN"
        ],
        tips: [
            "基数は必ず指定するのがおすすめ（parseInt('10', 10)）"
        ],
        related: ["parseFloat", "Number"]
    },
    "parseFloat": {
        name: "parseFloat",
        description: "文字列を小数に変換。",
        syntax: "parseFloat(string)",
        returns: "数値（変換できなければNaN）",
        examples: [
            "parseFloat('3.14') → 3.14",
            "parseFloat('3.14px') → 3.14"
        ],
        related: ["parseInt", "Number"]
    },
    "toFixed": {
        name: "toFixed",
        description: "小数点以下の桁数を指定して文字列に。",
        syntax: "number.toFixed(digits)",
        returns: "文字列",
        examples: [
            "(3.14159).toFixed(2) → '3.14'",
            "(3).toFixed(2) → '3.00'"
        ],
        tips: [
            "戻り値は文字列なので計算に使う場合は数値に変換"
        ]
    },
    "Math.floor": {
        name: "Math.floor",
        description: "切り捨て（小さい方の整数に）。",
        syntax: "Math.floor(number)",
        returns: "整数",
        examples: [
            "Math.floor(3.7) → 3",
            "Math.floor(-3.7) → -4"
        ],
        related: ["Math.ceil", "Math.round", "Math.trunc"]
    },
    "Math.ceil": {
        name: "Math.ceil",
        description: "切り上げ（大きい方の整数に）。",
        syntax: "Math.ceil(number)",
        returns: "整数",
        examples: [
            "Math.ceil(3.2) → 4",
            "Math.ceil(-3.2) → -3"
        ],
        related: ["Math.floor", "Math.round"]
    },
    "Math.round": {
        name: "Math.round",
        description: "四捨五入。",
        syntax: "Math.round(number)",
        returns: "整数",
        examples: [
            "Math.round(3.5) → 4",
            "Math.round(3.4) → 3"
        ],
        related: ["Math.floor", "Math.ceil"]
    },
    "Math.random": {
        name: "Math.random",
        description: "0以上1未満の乱数を生成。",
        syntax: "Math.random()",
        returns: "0 <= x < 1 の数値",
        examples: [
            "Math.random() → 0.123456...",
            "Math.floor(Math.random() * 10) → 0〜9のランダム整数"
        ],
        tips: [
            "範囲指定: Math.floor(Math.random() * (max - min + 1)) + min"
        ]
    },
    "Math.max": {
        name: "Math.max",
        description: "最大値を取得。",
        syntax: "Math.max(...numbers)",
        returns: "最大値",
        examples: [
            "Math.max(1, 5, 3) → 5",
            "Math.max(...arr) → 配列の最大値"
        ],
        related: ["Math.min"]
    },
    "Math.min": {
        name: "Math.min",
        description: "最小値を取得。",
        syntax: "Math.min(...numbers)",
        returns: "最小値",
        examples: [
            "Math.min(1, 5, 3) → 1",
            "Math.min(...arr) → 配列の最小値"
        ],
        related: ["Math.max"]
    },
    "Math.abs": {
        name: "Math.abs",
        description: "絶対値を取得。",
        syntax: "Math.abs(number)",
        returns: "絶対値",
        examples: [
            "Math.abs(-5) → 5",
            "Math.abs(5) → 5"
        ]
    },
    // ==================== Date ====================
    "Date": {
        name: "Date",
        description: "日付・時刻を扱うオブジェクト。",
        syntax: "new Date()",
        examples: [
            "new Date() → 現在時刻",
            "new Date('2024-01-15') → 指定日時",
            "new Date(2024, 0, 15) → 2024年1月15日（月は0始まり）"
        ],
        tips: [
            "月は0始まり（0=1月, 11=12月）なので注意"
        ],
        related: ["getTime", "getFullYear", "getMonth"]
    },
    "getTime": {
        name: "getTime",
        description: "1970年1月1日からのミリ秒を取得。",
        syntax: "date.getTime()",
        returns: "ミリ秒",
        examples: [
            "new Date().getTime() → 1705312345678"
        ],
        tips: [
            "日付の比較や差分計算に便利"
        ],
        related: ["Date.now"]
    },
    "getFullYear": {
        name: "getFullYear",
        description: "年を取得（4桁）。",
        syntax: "date.getFullYear()",
        returns: "年（例: 2024）",
        examples: [
            "new Date().getFullYear() → 2024"
        ],
        tips: [
            "getYear()は非推奨なので使わない"
        ],
        related: ["getMonth", "getDate"]
    },
    "getMonth": {
        name: "getMonth",
        description: "月を取得（0〜11）。",
        syntax: "date.getMonth()",
        returns: "月（0=1月, 11=12月）",
        examples: [
            "new Date().getMonth() + 1 → 実際の月"
        ],
        tips: [
            "⚠️ 0始まりなので+1が必要"
        ],
        related: ["getFullYear", "getDate"]
    },
    "getDate": {
        name: "getDate",
        description: "日を取得（1〜31）。",
        syntax: "date.getDate()",
        returns: "日",
        examples: [
            "new Date().getDate() → 15"
        ],
        related: ["getFullYear", "getMonth"]
    },
    "toLocaleDateString": {
        name: "toLocaleDateString",
        description: "日付をロケールに応じた文字列に。",
        syntax: "date.toLocaleDateString(locale, options)",
        returns: "日付文字列",
        examples: [
            "new Date().toLocaleDateString('ja-JP') → '2024/1/15'",
            "new Date().toLocaleDateString('ja-JP', {year:'numeric', month:'long', day:'numeric'}) → '2024年1月15日'"
        ],
        related: ["toLocaleTimeString", "toLocaleString"]
    },
    // ==================== Window & Viewport ====================
    "innerWidth": {
        name: "innerWidth",
        description: "ウィンドウのビューポートの幅（スクロールバー含む）。",
        syntax: "window.innerWidth",
        returns: "ピクセル数（数値）",
        examples: [
            "if (window.innerWidth < 768) { /* モバイル用処理 */ }"
        ],
        tips: [
            "メディアクエリの幅と一致するのはこちら",
            "ブラウザの外枠を含まない"
        ],
        related: ["innerHeight", "outerWidth", "clientWidth"]
    },
    "innerHeight": {
        name: "innerHeight",
        description: "ウィンドウのビューポートの高さ（スクロールバー含む）。",
        syntax: "window.innerHeight",
        returns: "ピクセル数（数値）",
        examples: [
            "const vh = window.innerHeight * 0.01;"
        ],
        related: ["innerWidth", "outerHeight"]
    },
    "outerWidth": {
        name: "outerWidth",
        description: "ブラウザウィンドウ全体の幅（枠線やサイドバー含む）。",
        syntax: "window.outerWidth",
        returns: "ピクセル数（数値）",
        related: ["innerWidth"]
    },
    "scrollX": {
        name: "scrollX",
        description: "横方向のスクロール量。",
        syntax: "window.scrollX",
        returns: "ピクセル数（数値）",
        examples: [
            "const x = window.scrollX"
        ],
        tips: [
            "pageXOffset はエイリアス"
        ],
        related: ["scrollY", "scrollTo"]
    },
    "scrollY": {
        name: "scrollY",
        description: "縦方向のスクロール量。",
        syntax: "window.scrollY",
        returns: "ピクセル数（数値）",
        examples: [
            "if (window.scrollY > 100) { header.classList.add('fixed'); }"
        ],
        tips: [
            "pageYOffset はエイリアス"
        ],
        related: ["scrollX", "scrollTo"]
    },
    "scrollTo": {
        name: "scrollTo",
        description: "指定位置までスクロール。",
        syntax: "window.scrollTo(x, y) または window.scrollTo(options)",
        params: [
            "x, y → 座標",
            "options → { top: 0, behavior: 'smooth' }"
        ],
        examples: [
            "window.scrollTo(0, 0); // トップへ",
            "window.scrollTo({ top: 0, behavior: 'smooth' }); // スムーズにトップへ"
        ],
        related: ["scrollBy", "scrollIntoView"]
    },
    "getComputedStyle": {
        name: "getComputedStyle",
        description: "要素に適用されている最終的なスタイルを取得。",
        syntax: "window.getComputedStyle(element)",
        returns: "CSSStyleDeclaration",
        examples: [
            "const style = getComputedStyle(element);",
            "console.log(style.color); // 変換後の値（rgb(...)など）"
        ],
        tips: [
            "styleプロパティと違い、CSSで設定された値も取得可能"
        ],
        related: ["style"]
    },
    "matchMedia": {
        name: "matchMedia",
        description: "メディアクエリの条件判定。",
        syntax: "window.matchMedia(mediaQueryString)",
        returns: "MediaQueryList",
        examples: [
            "const mql = window.matchMedia('(max-width: 600px)');",
            "if (mql.matches) { /* スマホ */ }"
        ],
        tips: [
            "addEventListener('change', ...) で変化を監視可能"
        ],
        related: ["innerWidth"]
    },
    // ==================== Dialogs ====================
    "alert": {
        name: "alert",
        description: "警告ダイアログを表示（ユーザーがOKを押すまで停止）。",
        syntax: "alert(message)",
        examples: [
            "alert('保存しました！')"
        ],
        tips: [
            "デバッグ以外ではあまり使われない（UIが古いため）"
        ],
        related: ["confirm", "prompt"]
    },
    "confirm": {
        name: "confirm",
        description: "確認ダイアログを表示（OK/キャンセル）。",
        syntax: "confirm(message)",
        returns: "true (OK) / false (キャンセル)",
        examples: [
            "if (confirm('本当に削除しますか？')) { deleteItem(); }"
        ],
        related: ["alert", "prompt"]
    },
    "prompt": {
        name: "prompt",
        description: "入力ダイアログを表示。",
        syntax: "prompt(message, defaultValue)",
        returns: "入力された文字列（キャンセルならnull）",
        examples: [
            "const name = prompt('名前を入力してください', '名無し')"
        ],
        related: ["alert", "confirm"]
    },
    // ==================== Location & Navigator ====================
    "location": {
        name: "location",
        description: "現在のURL情報を管理。",
        examples: [
            "console.log(location.href);",
            "location.href = 'https://google.com'; // 遷移"
        ],
        related: ["location.href", "location.reload"]
    },
    "location.href": {
        name: "location.href",
        description: "現在のURL全体を取得・設定。",
        syntax: "location.href = url",
        examples: [
            "location.href = '/login'; // リダイレクト"
        ],
        related: ["location.replace"]
    },
    "location.reload": {
        name: "location.reload",
        description: "ページを再読み込み。",
        syntax: "location.reload()",
        tips: [
            "キャッシュを無視する場合は location.reload(true) ※一部ブラウザのみ"
        ],
        related: ["location.href"]
    },
    "history": {
        name: "history",
        description: "ブラウザの履歴を操作。",
        related: ["history.back", "history.pushState"]
    },
    "history.back": {
        name: "history.back",
        description: "前のページに戻る。",
        syntax: "history.back()",
        tips: [
            "ブラウザの「戻る」ボタンと同じ"
        ],
        related: ["history.forward"]
    },
    "navigator.clipboard": {
        name: "navigator.clipboard",
        description: "クリップボード操作（コピー/貼り付け）。",
        examples: [
            "navigator.clipboard.writeText('コピーするテキスト')"
        ],
        tips: [
            "非同期処理（Promiseを返す）",
            "https環境でのみ動作"
        ]
    },
    // ==================== Events ====================
    "preventDefault": {
        name: "preventDefault",
        description: "ブラウザの既定の動作をキャンセル。",
        syntax: "event.preventDefault()",
        examples: [
            "link.addEventListener('click', (e) => { e.preventDefault(); }); // リンク遷移防止",
            "form.addEventListener('submit', (e) => { e.preventDefault(); }); // 送信防止"
        ],
        related: ["stopPropagation"]
    },
    "stopPropagation": {
        name: "stopPropagation",
        description: "イベントのバブリング（親への伝播）を停止。",
        syntax: "event.stopPropagation()",
        examples: [
            "child.onclick = (e) => e.stopPropagation(); // 親のクリックイベントを発火させない"
        ],
        related: ["preventDefault"]
    },
    "target": {
        name: "target",
        description: "イベントが発生した要素。",
        syntax: "event.target",
        examples: [
            "if (e.target.tagName === 'BUTTON') { ... }"
        ],
        tips: [
            "バブリング時は「実際にクリックされた最下層の要素」になる"
        ],
        related: ["currentTarget"]
    },
    "currentTarget": {
        name: "currentTarget",
        description: "イベントリスナーが登録されている要素。",
        syntax: "event.currentTarget",
        tips: [
            "イベント委譲のとき、リスナーを設定した親要素を取得したい場合はこちら"
        ],
        related: ["target"]
    },
    "key": {
        name: "key",
        description: "押されたキーの値。",
        syntax: "event.key",
        examples: [
            "if (e.key === 'Enter') { submit(); }",
            "if (e.key === 'Escape') { close(); }"
        ],
        related: ["code", "keyCode"]
    },
    // ==================== Animation ====================
    "requestAnimationFrame": {
        name: "requestAnimationFrame",
        description: "次の描画更新のタイミングで関数を実行。",
        syntax: "requestAnimationFrame(callback)",
        examples: [
            "function loop() { draw(); requestAnimationFrame(loop); }",
            "requestAnimationFrame(loop);"
        ],
        tips: [
            "setIntervalよりも滑らかで省電力（60fpsなどモニタに同期）"
        ],
        related: ["cancelAnimationFrame"]
    },
    "cancelAnimationFrame": {
        name: "cancelAnimationFrame",
        description: "requestAnimationFrameの予約をキャンセル。",
        syntax: "cancelAnimationFrame(requestId)",
        related: ["requestAnimationFrame"]
    },
    // ==================== Map & Set ====================
    "Map": {
        name: "Map",
        description: "キーと値のペアを保持するコレクション。キーにオブジェクトも使える。",
        syntax: "new Map()",
        examples: [
            "const map = new Map();",
            "map.set('key', 'value');",
            "map.get('key'); // 'value'"
        ],
        tips: [
            "オブジェクトと違い、挿入順序が保持される",
            "sizeプロパティで要素数を確認可能"
        ],
        related: ["Set", "WeakMap"]
    },
    "Set": {
        name: "Set",
        description: "重複しない値のコレクション。",
        syntax: "new Set(iterable)",
        examples: [
            "const set = new Set([1, 2, 2, 3]); // {1, 2, 3}",
            "set.add(4);"
        ],
        tips: [
            "配列の重複除去に便利: [...new Set(array)]"
        ],
        related: ["Map", "WeakSet"]
    },
    // ==================== Math Constants & Functions ====================
    "Math.PI": {
        name: "Math.PI",
        description: "円周率（約3.14159）。",
        syntax: "Math.PI",
        related: ["Math.sin", "Math.cos"]
    },
    "Math.pow": {
        name: "Math.pow",
        description: "べき乗を計算。",
        syntax: "Math.pow(base, exponent)",
        examples: [
            "Math.pow(2, 3) → 8 (2の3乗)"
        ],
        tips: [
            "ES7以降は ** 演算子が使える (2 ** 3)"
        ]
    },
    "Math.sqrt": {
        name: "Math.sqrt",
        description: "平方根を計算。",
        syntax: "Math.sqrt(number)",
        examples: [
            "Math.sqrt(9) → 3",
            "Math.sqrt(2) → 1.414..."
        ]
    },
    // ==================== RegExp ====================
    "test": {
        name: "test",
        description: "正規表現にマッチするか判定。",
        syntax: "regex.test(string)",
        returns: "true / false",
        examples: [
            "/abc/.test('abcde') → true",
            "/[0-9]/.test('abc') → false"
        ],
        related: ["exec", "match"]
    },
    "exec": {
        name: "exec",
        description: "正規表現で検索し、結果の詳細配列を返す。",
        syntax: "regex.exec(string)",
        returns: "結果配列（なければnull）",
        examples: [
            "const match = /(\\d+)/.exec('No.123');",
            "match[1] // '123'"
        ],
        tips: [
            "グローバルフラグ(/g)がある場合、実行ごとに次のマッチに進む"
        ],
        related: ["test", "match"]
    },
    // ==================== Element Scroll ====================
    "scrollTop": {
        name: "scrollTop",
        description: "要素の上端からのスクロール量。",
        syntax: "element.scrollTop",
        examples: [
            "element.scrollTop = 0; // 最上部へ",
            "console.log(element.scrollTop);"
        ],
        tips: [
            "スクロール可能な要素（overflow: scroll/auto）で有効"
        ],
        related: ["scrollLeft", "scrollHeight", "clientHeight"]
    },
    "scrollLeft": {
        name: "scrollLeft",
        description: "要素の左端からのスクロール量。",
        syntax: "element.scrollLeft",
        related: ["scrollTop", "scrollWidth", "clientWidth"]
    },
    "scrollHeight": {
        name: "scrollHeight",
        description: "要素のコンテンツ全体の高さ（隠れている部分含む）。",
        syntax: "element.scrollHeight",
        examples: [
            "if (elem.scrollTop + elem.clientHeight >= elem.scrollHeight) { /* 最下部到達 */ }"
        ],
        related: ["scrollTop", "clientHeight"]
    },
    "scrollWidth": {
        name: "scrollWidth",
        description: "要素のコンテンツ全体の幅（隠れている部分含む）。",
        syntax: "element.scrollWidth",
        related: ["scrollLeft", "clientWidth"]
    },
    "clientHeight": {
        name: "clientHeight",
        description: "要素の表示領域の高さ（padding含む、border/scrollbar含まない）。",
        syntax: "element.clientHeight",
        related: ["offsetHeight", "scrollHeight"]
    },
    "clientWidth": {
        name: "clientWidth",
        description: "要素の表示領域の幅（padding含む、border/scrollbar含まない）。",
        syntax: "element.clientWidth",
        related: ["offsetWidth", "scrollWidth"]
    },
    "offsetHeight": {
        name: "offsetHeight",
        description: "要素の高さ（padding, border, scrollbar含む）。",
        syntax: "element.offsetHeight",
        related: ["clientHeight", "scrollHeight"]
    },
    "offsetWidth": {
        name: "offsetWidth",
        description: "要素の幅（padding, border, scrollbar含む）。",
        syntax: "element.offsetWidth",
        related: ["clientWidth", "scrollWidth"]
    },
    // ==================== Form & Input ====================
    "value": {
        name: "value",
        description: "入力フォームの現在値。",
        syntax: "input.value",
        examples: [
            "const text = input.value;",
            "input.value = ''; // クリア"
        ],
        tips: [
            "input, textarea, select要素で使用"
        ],
        related: ["defaultValue"]
    },
    "checked": {
        name: "checked",
        description: "チェックボックス・ラジオボタンの選択状態。",
        syntax: "input.checked",
        returns: "true / false",
        examples: [
            "if (checkbox.checked) { ... }"
        ],
        related: ["value"]
    },
    "disabled": {
        name: "disabled",
        description: "要素の無効化状態。",
        syntax: "element.disabled",
        returns: "true / false",
        examples: [
            "button.disabled = true; // クリック不可に"
        ],
        related: ["readOnly"]
    },
    "readOnly": {
        name: "readOnly",
        description: "読み取り専用状態。",
        syntax: "input.readOnly",
        returns: "true / false",
        related: ["disabled"]
    },
    "submit": {
        name: "submit",
        description: "フォームを送信。",
        syntax: "form.submit()",
        related: ["reset"]
    },
    "reset": {
        name: "reset",
        description: "フォームの内容をリセット。",
        syntax: "form.reset()",
        related: ["submit"]
    },
    "files": {
        name: "files",
        description: "ファイル入力で選択されたファイル一覧。",
        syntax: "input.files",
        returns: "FileList",
        examples: [
            "const file = input.files[0];"
        ],
        tips: [
            "type='file' のinputで使用"
        ]
    },
    // ==================== Node Operation ====================
    "parentNode": {
        name: "parentNode",
        description: "親ノードを取得。",
        syntax: "node.parentNode",
        tips: [
            "Element以外のノードも含む（parentElementはElementのみ）"
        ],
        related: ["parentElement"]
    },
    "childNodes": {
        name: "childNodes",
        description: "子ノード一覧を取得（テキストノード等も含む）。",
        syntax: "node.childNodes",
        returns: "NodeList",
        tips: [
            "要素だけ欲しい場合は children を使う"
        ],
        related: ["children"]
    },
    "firstChild": {
        name: "firstChild",
        description: "最初の子ノードを取得（テキスト含む）。",
        related: ["firstElementChild"]
    },
    "lastChild": {
        name: "lastChild",
        description: "最後の子ノードを取得（テキスト含む）。",
        related: ["lastElementChild"]
    },
    "firstElementChild": {
        name: "firstElementChild",
        description: "最初の子要素を取得。",
        related: ["firstChild", "children"]
    },
    "lastElementChild": {
        name: "lastElementChild",
        description: "最後の子要素を取得。",
        related: ["lastChild", "children"]
    },
    "contains": {
        name: "contains",
        description: "指定ノードが子孫に含まれているか判定。",
        syntax: "node.contains(otherNode)",
        returns: "true / false",
        examples: [
            "if (menu.contains(e.target)) { /* メニュー内のクリック */ }"
        ],
        related: ["closest"]
    },
    // ==================== Event Handlers ====================
    "onclick": {
        name: "onclick",
        description: "クリック時の処理を設定。",
        syntax: "element.onclick = function() { ... }",
        tips: [
            "addEventListener('click', ...) の方が推奨（複数を登録可能）"
        ],
        related: ["addEventListener"]
    },
    "onchange": {
        name: "onchange",
        description: "値変更時の処理を設定（確定時）。",
        syntax: "input.onchange = function() { ... }",
        tips: [
            "入力中は発火しない。入力中は 'input' イベントを使う"
        ],
        related: ["oninput"]
    },
    "oninput": {
        name: "oninput",
        description: "入力時の処理を設定（即時反応）。",
        syntax: "input.oninput = function() { ... }",
        tips: [
            "キーを押すたびに発火する"
        ],
        related: ["onchange"]
    },
    "onsubmit": {
        name: "onsubmit",
        description: "フォーム送信時の処理。",
        syntax: "form.onsubmit = function() { ... }",
        tips: [
            "return false で送信キャンセル可能"
        ],
        related: ["submit"]
    },
    "onload": {
        name: "onload",
        description: "読み込み完了時の処理。",
        syntax: "window.onload = function() { ... }",
        examples: [
            "img.onload = () => console.log('画像読み込み完了')"
        ],
        related: ["DOMContentLoaded"]
    }
};
//# sourceMappingURL=jsProperties.js.map