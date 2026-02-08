"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cssProperties = void 0;
exports.analyzeValue = analyzeValue;
exports.cssProperties = {
    // ==================== Display & Layout ====================
    "display": {
        name: "display",
        description: "要素の表示形式を指定。レイアウトの基本。",
        values: [
            "block → 縦に並ぶ、幅100%",
            "inline → 横に並ぶ、幅は内容に応じる",
            "flex → 子要素を横並び/縦並びに配置",
            "grid → 格子状のレイアウト",
            "none → 非表示（スペースも消える）"
        ],
        tips: [
            "flexは1行のレイアウト、gridは2次元のレイアウトに適している"
        ],
        related: ["flex-direction", "grid-template-columns"]
    },
    "position": {
        name: "position",
        description: "要素の配置方法を指定。",
        values: [
            "static → 通常の配置（デフォルト）",
            "relative → 元の位置から相対的に移動",
            "absolute → 親要素を基準に絶対配置",
            "fixed → 画面に固定（スクロールしても動かない）",
            "sticky → スクロールで画面端に固定"
        ],
        tips: [
            "absoluteを使うには親にposition: relativeが必要",
            "top, left, right, bottomと組み合わせて位置を指定"
        ],
        related: ["top", "left", "right", "bottom", "z-index"]
    },
    "flex-direction": {
        name: "flex-direction",
        description: "Flexboxの主軸（並ぶ方向）を指定。",
        values: [
            "row → 横並び（左→右）【デフォルト】",
            "row-reverse → 横並び（右→左）",
            "column → 縦並び（上→下）",
            "column-reverse → 縦並び（下→上）"
        ],
        tips: [
            "columnにするとjustify-contentが縦方向に効く"
        ],
        related: ["display: flex", "justify-content", "align-items"]
    },
    "justify-content": {
        name: "justify-content",
        description: "主軸方向（横並びなら横）の配置を指定。",
        values: [
            "flex-start → 先頭に寄せる",
            "flex-end → 末尾に寄せる",
            "center → 中央に配置",
            "space-between → 両端に寄せて等間隔",
            "space-around → 均等に余白を配置",
            "space-evenly → 完全に等間隔"
        ],
        tips: [
            "space-betweenは両端に余白なし、space-aroundは両端にも余白あり"
        ],
        related: ["align-items", "flex-direction", "gap"]
    },
    "align-items": {
        name: "align-items",
        description: "交差軸方向（横並びなら縦）の配置を指定。",
        values: [
            "stretch → 親の高さいっぱいに伸ばす【デフォルト】",
            "flex-start → 上に寄せる",
            "flex-end → 下に寄せる",
            "center → 縦方向中央に配置",
            "baseline → テキストのベースラインを揃える"
        ],
        tips: [
            "縦方向の中央寄せは align-items: center が定番"
        ],
        related: ["justify-content", "align-self"]
    },
    "gap": {
        name: "gap",
        description: "Flex/Grid要素間の隙間を指定。",
        values: [
            "10px → 10pxの隙間",
            "1rem → 1remの隙間",
            "10px 20px → 行10px、列20px"
        ],
        tips: [
            "marginを使わずに隙間を作れるので便利",
            "row-gap, column-gapで個別指定も可能"
        ],
        related: ["display: flex", "display: grid"]
    },
    // ==================== Transform ====================
    "transform": {
        name: "transform",
        description: "要素を変形（移動・回転・拡大縮小・傾斜）させる。",
        values: [
            "translate(X, Y) → 移動",
            "rotate(角度) → 回転（例: 45deg）",
            "scale(倍率) → 拡大縮小",
            "skew(X, Y) → 傾斜"
        ],
        tips: [
            "複数組み合わせ可能: translateY(-50%) rotate(45deg)",
            "GPU加速されるのでアニメーションに最適",
            "translateY(-50%)で縦方向中央寄せのテクニック"
        ],
        related: ["transform-origin", "transition", "animation"]
    },
    "transform-origin": {
        name: "transform-origin",
        description: "変形の基準点を指定。",
        values: [
            "center center → 中央【デフォルト】",
            "top left → 左上を基準に回転",
            "50% 100% → 下中央を基準"
        ],
        tips: [
            "回転アニメーションの支点を変えたい時に使う"
        ],
        related: ["transform"]
    },
    // ==================== Background ====================
    "background": {
        name: "background",
        description: "背景のショートハンド（一括指定）。",
        values: [
            "#fff → 白背景",
            "url(image.jpg) → 画像背景",
            "linear-gradient(...) → グラデーション"
        ],
        tips: [
            "複数の背景を重ねることも可能"
        ],
        related: ["background-color", "background-image", "background-size"]
    },
    "background-position": {
        name: "background-position",
        description: "背景画像の表示位置を指定。",
        values: [
            "center center → 中央に配置",
            "top left → 左上に配置",
            "50% 50% → 中央（パーセント指定）",
            "10px 20px → 左から10px、上から20px"
        ],
        tips: [
            "background-size: coverと組み合わせて使うことが多い",
            "値は「横位置 縦位置」の順で指定"
        ],
        related: ["background-size", "background-repeat"]
    },
    "background-size": {
        name: "background-size",
        description: "背景画像のサイズを指定。",
        values: [
            "cover → 要素全体を覆う（はみ出しOK）",
            "contain → 画像全体が見える（余白OK）",
            "100% auto → 幅100%、高さ自動",
            "200px 100px → 指定サイズ"
        ],
        tips: [
            "coverはヒーロー画像に最適",
            "containはロゴ等、切れてはいけない画像に"
        ],
        related: ["background-position", "object-fit"]
    },
    // ==================== Size ====================
    "width": {
        name: "width",
        description: "要素の幅を指定。",
        values: [
            "100px → 固定幅",
            "50% → 親の50%",
            "100vw → ビューポート幅100%",
            "auto → 内容に応じる",
            "max-content → 内容の最大幅",
            "fit-content → 内容に合わせる"
        ],
        tips: [
            "max-widthと組み合わせてレスポンシブに"
        ],
        related: ["max-width", "min-width", "height"]
    },
    "height": {
        name: "height",
        description: "要素の高さを指定。",
        values: [
            "100px → 固定高さ",
            "100% → 親の100%（親に高さ指定が必要）",
            "100vh → ビューポート高さ100%",
            "auto → 内容に応じる"
        ],
        tips: [
            "100%が効かない場合、親にも高さ指定が必要",
            "100vhは画面いっぱいのセクションに便利"
        ],
        related: ["max-height", "min-height", "width"]
    },
    "max-width": {
        name: "max-width",
        description: "要素の最大幅を指定。これ以上広がらない。",
        values: [
            "1200px → 最大1200px",
            "100% → 親幅を超えない",
            "none → 制限なし"
        ],
        tips: [
            "コンテナの中央寄せに: max-width + margin: 0 auto"
        ],
        related: ["width", "min-width"]
    },
    // ==================== Margin & Padding ====================
    "margin": {
        name: "margin",
        description: "要素の外側の余白。",
        values: [
            "10px → 上下左右10px",
            "10px 20px → 上下10px、左右20px",
            "10px 20px 30px 40px → 上右下左（時計回り）",
            "0 auto → 中央寄せ（ブロック要素）"
        ],
        tips: [
            "margin: 0 autoで中央寄せ（要width指定）",
            "隣接要素同士のmarginは相殺される（マージンの相殺）"
        ],
        related: ["padding", "gap"]
    },
    "padding": {
        name: "padding",
        description: "要素の内側の余白。",
        values: [
            "10px → 上下左右10px",
            "10px 20px → 上下10px、左右20px",
            "10px 20px 30px 40px → 上右下左（時計回り）"
        ],
        tips: [
            "背景色はpaddingの範囲まで適用される",
            "box-sizing: border-boxなら幅に含まれる"
        ],
        related: ["margin", "box-sizing"]
    },
    // ==================== Typography ====================
    "font-size": {
        name: "font-size",
        description: "文字サイズを指定。",
        values: [
            "16px → 固定サイズ",
            "1rem → ルート要素の1倍",
            "1.5em → 親要素の1.5倍",
            "clamp(14px, 2vw, 18px) → レスポンシブ"
        ],
        tips: [
            "remを使うとアクセシビリティに良い",
            "html { font-size: 62.5% } で 1rem = 10px にする技"
        ],
        related: ["line-height", "font-weight"]
    },
    "line-height": {
        name: "line-height",
        description: "行の高さ（行間）を指定。",
        values: [
            "1.5 → 文字サイズの1.5倍（単位なし推奨）",
            "24px → 固定値",
            "150% → 文字サイズの150%"
        ],
        tips: [
            "本文は1.5〜1.8が読みやすい",
            "単位なしの値が推奨（継承時の計算が安全）"
        ],
        related: ["font-size", "letter-spacing"]
    },
    "color": {
        name: "color",
        description: "文字の色を指定。",
        values: [
            "#333 → 濃いグレー",
            "rgb(0, 0, 0) → 黒",
            "rgba(0, 0, 0, 0.8) → 80%不透明の黒",
            "inherit → 親から継承"
        ],
        tips: [
            "真っ黒(#000)より少しグレー(#333)の方が読みやすい"
        ],
        related: ["background-color", "opacity"]
    },
    // ==================== Object ====================
    "object-fit": {
        name: "object-fit",
        description: "画像・動画のフィット方法を指定。",
        values: [
            "cover → 要素を覆う（はみ出しOK）",
            "contain → 全体が見える（余白OK）",
            "fill → 引き伸ばし【デフォルト】",
            "none → 元サイズのまま"
        ],
        tips: [
            "img要素にwidth/heightを指定してから使う",
            "coverが一番よく使う"
        ],
        related: ["object-position", "background-size"]
    },
    "object-position": {
        name: "object-position",
        description: "画像・動画の表示位置を指定。",
        values: [
            "center center → 中央【デフォルト】",
            "top → 上寄せ（人物写真で顔を見せたい時）",
            "50% 30% → 上から30%の位置"
        ],
        tips: [
            "object-fit: coverと組み合わせて使う"
        ],
        related: ["object-fit"]
    },
    // ==================== Z-index & Overflow ====================
    "z-index": {
        name: "z-index",
        description: "要素の重なり順を指定。大きいほど前面。",
        values: [
            "1 → 手前に",
            "-1 → 奥に",
            "9999 → 最前面（モーダル等）"
        ],
        tips: [
            "position: static以外でないと効かない",
            "親要素のz-indexが低いと子は超えられない（スタッキングコンテキスト）"
        ],
        related: ["position"]
    },
    "overflow": {
        name: "overflow",
        description: "内容がはみ出した時の表示方法。",
        values: [
            "visible → はみ出して表示【デフォルト】",
            "hidden → はみ出た部分を隠す",
            "scroll → 常にスクロールバー表示",
            "auto → 必要な時だけスクロールバー"
        ],
        tips: [
            "border-radiusと組み合わせて角丸クリッピング",
            "hiddenは横スクロール防止にも使える"
        ],
        related: ["overflow-x", "overflow-y"]
    },
    // ==================== Transition & Animation ====================
    "transition": {
        name: "transition",
        description: "プロパティの変化をアニメーションさせる。",
        values: [
            "all 0.3s → 全プロパティを0.3秒で変化",
            "transform 0.3s ease → transformを0.3秒で",
            "opacity 0.3s, transform 0.3s → 複数指定"
        ],
        tips: [
            "hoverと組み合わせてインタラクション追加",
            "allより個別指定の方がパフォーマンスが良い"
        ],
        related: ["animation", "transform"]
    },
    "opacity": {
        name: "opacity",
        description: "要素の不透明度を指定。",
        values: [
            "1 → 完全に見える【デフォルト】",
            "0.5 → 半透明",
            "0 → 完全に透明（要素は存在する）"
        ],
        tips: [
            "display: noneと違い、opacityはスペースを占有する",
            "transitionと組み合わせてフェードイン/アウト"
        ],
        related: ["visibility", "transition"]
    },
    // ==================== Box Model ====================
    "box-sizing": {
        name: "box-sizing",
        description: "幅・高さにpadding/borderを含めるか指定。",
        values: [
            "content-box → 含めない【デフォルト】",
            "border-box → 含める（推奨）"
        ],
        tips: [
            "border-boxにするとwidth: 100%が直感的に動く",
            "リセットCSSで * { box-sizing: border-box } がおすすめ"
        ],
        related: ["width", "padding", "border"]
    },
    "border-radius": {
        name: "border-radius",
        description: "角を丸くする。",
        values: [
            "4px → 軽い丸み",
            "50% → 正円（正方形の場合）",
            "10px 0 → 左上と右下だけ丸く"
        ],
        tips: [
            "50%で円形ボタンやアイコン",
            "overflow: hiddenと組み合わせて画像をクリッピング"
        ],
        related: ["border", "overflow"]
    },
    // ==================== Grid ====================
    "grid-template-columns": {
        name: "grid-template-columns",
        description: "グリッドの列数と幅を指定。",
        values: [
            "1fr 1fr 1fr → 3等分",
            "repeat(3, 1fr) → 3等分（省略記法）",
            "200px 1fr → 左200px固定、残りは伸縮",
            "repeat(auto-fill, minmax(200px, 1fr)) → レスポンシブ"
        ],
        tips: [
            "frは残りスペースを分配する単位",
            "auto-fillで自動的にカラム数が変わる"
        ],
        related: ["grid-template-rows", "gap", "display: grid"]
    }
};
// 値の解析（transformなど）
function analyzeValue(property, value) {
    const tips = [];
    if (property === "transform") {
        if (value.includes("translateY(-50%)")) {
            tips.push("💡 上に50%移動 → 縦方向中央寄せのテクニック");
        }
        if (value.includes("translateX(-50%)")) {
            tips.push("💡 左に50%移動 → 横方向中央寄せのテクニック");
        }
        if (value.includes("rotate")) {
            const match = value.match(/rotate\((-?\d+)deg\)/);
            if (match) {
                const deg = parseInt(match[1]);
                if (deg > 0) {
                    tips.push(`💡 ${deg}度 時計回りに回転`);
                }
                else if (deg < 0) {
                    tips.push(`💡 ${Math.abs(deg)}度 反時計回りに回転`);
                }
            }
        }
        if (value.includes("scale(0)")) {
            tips.push("💡 見えなくなる（アニメーション用）");
        }
        if (value.includes("scale(")) {
            const match = value.match(/scale\(([\d.]+)\)/);
            if (match) {
                const scale = parseFloat(match[1]);
                if (scale > 1) {
                    tips.push(`💡 ${scale}倍に拡大`);
                }
                else if (scale < 1 && scale > 0) {
                    tips.push(`💡 ${scale}倍に縮小`);
                }
            }
        }
    }
    if (property === "display" && value === "flex") {
        tips.push("💡 子要素が横並びになる（flex-direction: row がデフォルト）");
    }
    if (property === "position" && value === "absolute") {
        tips.push("💡 親に position: relative が必要");
    }
    if (property === "margin" && value.includes("auto")) {
        tips.push("💡 autoで中央寄せ（要width指定）");
    }
    return tips;
}
//# sourceMappingURL=cssProperties.js.map