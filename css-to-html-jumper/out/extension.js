"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const cssProperties_1 = require("./cssProperties");
const jsProperties_1 = require("./jsProperties");
const aiHoverProvider_1 = require("./aiHoverProvider");
const overviewGenerator_1 = require("./overviewGenerator");
// ========================================
// メモ検索履歴（最新10件）
// ========================================
let memoSearchHistory = [];
// ========================================
// メモ検索結果（Ctrl+Shift+↓/↑で切り替え用）
// ========================================
let lastMemoResults = [];
let lastMemoResultIndex = 0;
let quizHistoryMap = new Map();
// ========================================
// クイズ回答ドキュメント（セッション通して累積）
// ========================================
let quizAnswerDoc = null;
// ========================================
// クイズ評価待ち状態（ステータスバー用）
// ========================================
let pendingQuizEvaluation = null;
let statusBarItem = null;
// ========================================
// クイズ履歴のファイル保存・読込
// ========================================
function getQuizHistoryPath() {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const memoFilePath = config.get('memoFilePath', '');
    if (!memoFilePath) {
        return null;
    }
    const fs = require('fs');
    const memoDir = path.dirname(memoFilePath);
    const otherDir = path.join(memoDir, 'その他');
    // フォルダがなければ作成
    if (!fs.existsSync(otherDir)) {
        fs.mkdirSync(otherDir, { recursive: true });
    }
    return path.join(otherDir, '.quiz-history.json');
}
function saveQuizHistory() {
    const historyPath = getQuizHistoryPath();
    if (!historyPath) {
        return;
    }
    const fs = require('fs');
    const historyObj = {};
    quizHistoryMap.forEach((value, key) => {
        historyObj[key] = value;
    });
    fs.writeFileSync(historyPath, JSON.stringify(historyObj, null, 2), 'utf8');
    console.log('[Quiz] 履歴をファイルに保存:', historyPath);
}
function loadQuizHistory() {
    const historyPath = getQuizHistoryPath();
    if (!historyPath) {
        return;
    }
    const fs = require('fs');
    if (!fs.existsSync(historyPath)) {
        console.log('[Quiz] 履歴ファイルなし（初回起動）');
        return;
    }
    try {
        const content = fs.readFileSync(historyPath, 'utf8');
        const historyObj = JSON.parse(content);
        quizHistoryMap = new Map(Object.entries(historyObj));
        console.log('[Quiz] 履歴をファイルから読込:', quizHistoryMap.size, '件');
    }
    catch (e) {
        console.error('[Quiz] 履歴ファイル読込エラー:', e.message);
    }
}
// ========================================
// クイズ復習間隔計算（間隔反復学習）
// ========================================
/**
 * 復習回数に応じた最適な復習間隔を返す（単位：日）
 * 科学的根拠に基づく段階的間隔拡大（1日→3日→7日→14日→30日）
 */
function getNextInterval(reviewCount) {
    const intervals = [1, 3, 7, 14, 30]; // 日数
    return intervals[Math.min(reviewCount, intervals.length - 1)];
}
// ========================================
// クイズ評価関連関数（ステータスバー）
// ========================================
/**
 * ステータスバーに評価待ちボタンを表示 + エディタ上部にインフォバー
 */
function showEvaluationStatusBar() {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'cssToHtmlJumper.evaluateLastQuiz';
    }
    statusBarItem.text = '📝 クイズ評価待ち';
    statusBarItem.tooltip = 'クリックして評価を完了（Ctrl+Shift+8）';
    statusBarItem.show();
    // エディタ上部にもインフォメッセージを表示
    vscode.window.showInformationMessage('⚠ クイズの評価待ちです', '評価する', '後で').then(selected => {
        if (selected === '評価する') {
            vscode.commands.executeCommand('cssToHtmlJumper.evaluateLastQuiz');
        }
    });
}
/**
 * ステータスバーの評価待ちボタンを非表示
 */
function hideEvaluationStatusBar() {
    if (statusBarItem) {
        statusBarItem.hide();
    }
    pendingQuizEvaluation = null;
}
/**
 * 評価QuickPickを表示
 */
async function showEvaluationQuickPick(hasFactCheckError = false, isRepeat = false) {
    const items = isRepeat ? [
        { label: '😊 簡単→次へ', description: '覚えた！（回答はそのまま）', eval: 3 },
        { label: '😐 普通→次へ', description: 'まあまあ（回答はそのまま）', eval: 2 },
        { label: '😓 難しい→次へ', description: '要復習（回答はそのまま）', eval: 1 },
    ] : [
        { label: '😊 簡単→削除して次へ', description: '理解済み（回答を保存しない）', eval: 3 },
        { label: '😐 普通→保存して次へ', description: '復習したい（回答を保存）', eval: 2 },
        { label: '😓 難しい→保存して次へ', description: '要復習（回答を保存）', eval: 1 },
    ];
    if (hasFactCheckError) {
        items.push({ label: '📝 メモを修正する', description: 'AIがメモの誤りを自動修正してmemo.mdも更新', action: 'correct' });
    }
    items.push({ label: '✅ 終了', description: '', action: 'exit' });
    const afterAnswer = await vscode.window.showQuickPick(items, {
        placeHolder: hasFactCheckError ? '⚠ ファクトチェックで誤りが検出されました。理解度を評価またはメモを修正してください' : isRepeat ? '復習完了！理解度を評価してください（回答はそのまま保存）' : '理解度を評価してください'
    });
    return afterAnswer;
}
/**
 * 評価を処理（履歴更新、回答削除、次の問題）
 */
async function processEvaluation(evaluation) {
    if (!pendingQuizEvaluation) {
        return;
    }
    const { quiz, quizAnswerDoc: answerDoc } = pendingQuizEvaluation;
    const now = Date.now();
    // 評価を記録
    const history = quizHistoryMap.get(quiz.title);
    // 評価履歴を追加
    if (!history.evaluations) {
        history.evaluations = [];
    }
    history.evaluations.push(evaluation.eval);
    // 評価に応じて復習間隔を調整
    if (evaluation.eval === 3) {
        // 簡単 → 間隔を大幅延長（reviewCount + 2）
        history.reviewCount += 2;
    }
    else if (evaluation.eval === 1) {
        // 難しい → 間隔リセット
        history.reviewCount = 0;
    }
    // 普通（eval === 2）は既に履歴記録時にインクリメント済みなので何もしない
    saveQuizHistory();
    // 簡単評価の場合は回答を削除（初回のみ：2回目以降は書き込んでいないので削除しない）
    if (evaluation.eval === 3 && pendingQuizEvaluation?.claudeAnswer !== '') {
        const currentContent = answerDoc.getText();
        const lines = currentContent.split('\n');
        // 最後の区切り線を探す（なければファイル先頭から）
        let deleteStartLine = 0;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
                deleteStartLine = i - 1; // 区切り線の前の空行から削除
                break;
            }
        }
        // 削除範囲を適用
        const newContent = lines.slice(0, Math.max(0, deleteStartLine)).join('\n');
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(answerDoc.lineCount, 0));
        edit.replace(answerDoc.uri, fullRange, newContent);
        await vscode.workspace.applyEdit(edit);
        await answerDoc.save();
    }
    // ステータスバーを非表示
    hideEvaluationStatusBar();
    // 次の問題へ
    await handleQuiz();
}
// ========================================
// メモ自動修正関数
// ========================================
async function correctMemo() {
    if (!pendingQuizEvaluation) {
        return;
    }
    const { quiz, quizAnswerDoc, claudeAnswer, answerContent } = pendingQuizEvaluation;
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const claudeApiKey = config.get('claudeApiKey', '');
    const memoFilePath = config.get('memoFilePath', '');
    if (!claudeApiKey) {
        vscode.window.showErrorMessage('Claude APIキーが設定されていません');
        return;
    }
    // ファクトチェック部分を抽出
    const factCheckMatch = claudeAnswer.match(/⚠\s*ファクトチェック[：:]([\s\S]*?)$/);
    const factCheckText = factCheckMatch ? factCheckMatch[1].trim() : claudeAnswer;
    // 1. Claudeにメモ修正内容を生成させる
    const correctPrompt = `以下のメモ内容に技術的な誤りがあります。ファクトチェック結果をもとに修正してください。

【元のメモ内容（見出し行を除く本文）】
${answerContent}

【ファクトチェック（誤りの指摘）】
${factCheckText}

【修正要件】
- 元の文章構造（箇条書き・コード例など）を維持する
- 誤っている部分のみ修正し、正しい部分は変えない
- 見出し行（## で始まる行）は出力しない
- 修正後の本文のみ出力（前置き・説明文・見出し不要）`;
    vscode.window.showInformationMessage('⏳ AIがメモを修正中...');
    let correctedContent;
    try {
        correctedContent = await askClaudeAPI('', correctPrompt);
    }
    catch (e) {
        vscode.window.showErrorMessage(`修正エラー: ${e.message}`);
        return;
    }
    const fs = require('fs');
    // 2. 01_memo.md を更新
    if (memoFilePath && fs.existsSync(memoFilePath)) {
        const memoRaw = fs.readFileSync(memoFilePath, 'utf8');
        const memoLines = memoRaw.split('\n');
        // 見出し行のインデックス（quiz.line は1ベース）
        const headingIdx = quiz.line - 1;
        const headingLine = memoLines[headingIdx];
        // 次の同レベル以上の見出しを探してセクション末尾を特定
        const headingLevelMatch = headingLine.match(/^(#+)/);
        const headingLevel = headingLevelMatch ? headingLevelMatch[1].length : 2;
        let sectionEnd = memoLines.length;
        for (let i = headingIdx + 1; i < memoLines.length; i++) {
            const m = memoLines[i].match(/^(#+)\s/);
            if (m && m[1].length <= headingLevel) {
                sectionEnd = i;
                break;
            }
        }
        // 見出し行を維持して本文を置き換え
        const newMemoLines = [
            ...memoLines.slice(0, headingIdx + 1),
            ...correctedContent.split('\n'),
            ...memoLines.slice(sectionEnd)
        ];
        const newMemoContent = newMemoLines.join('\n');
        // VS Codeで開いている場合はWorkspaceEditのみ（fs.writeFileSyncと併用すると競合して未保存マークが残る）
        const memoUri = vscode.Uri.file(memoFilePath);
        const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === memoUri.fsPath);
        if (openDoc) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(memoUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(openDoc.lineCount, 0)), newMemoContent);
            await vscode.workspace.applyEdit(edit);
            await openDoc.save();
        }
        else {
            // 開いていない場合のみ直接書き込み
            fs.writeFileSync(memoFilePath, newMemoContent, 'utf8');
        }
    }
    // 3. クイズ回答.md の⚠ファクトチェック部分を「✅ メモ修正済み」に置き換え
    const answerContent2 = quizAnswerDoc.getText();
    const fixedAnswerContent = answerContent2.replace(/⚠\s*ファクトチェック[：:][\s\S]*?(?=\n━|$)/, '✅ メモ修正済み');
    if (fixedAnswerContent !== answerContent2) {
        const edit2 = new vscode.WorkspaceEdit();
        edit2.replace(quizAnswerDoc.uri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(quizAnswerDoc.lineCount, 0)), fixedAnswerContent);
        await vscode.workspace.applyEdit(edit2);
        await quizAnswerDoc.save();
    }
    vscode.window.showInformationMessage('✅ メモを修正しました（memo.md + クイズ回答.md）');
    // 4. 評価を求める（修正オプションなし）
    const afterCorrect = await showEvaluationQuickPick(false);
    if (!afterCorrect) {
        showEvaluationStatusBar();
        return;
    }
    if (afterCorrect.action === 'exit') {
        hideEvaluationStatusBar();
        return;
    }
    if (afterCorrect.eval) {
        await processEvaluation(afterCorrect);
    }
}
// ========================================
// メモ検索関連関数
// ========================================
/**
 * Fuzzy検索: 部分一致、大小文字無視、スペース無視、単語分割マッチ
 * 例: 「ボックスサイズ」→「ボックス」「サイズ」両方含む行を検索
 */
function fuzzySearch(query, lines) {
    const results = [];
    // クエリを単語分割（スペース・記号で区切る）
    const queryWords = query
        .toLowerCase()
        .split(/[\s　、。・]+/) // 半角・全角スペース、句読点で分割
        .filter(w => w.length > 0);
    if (queryWords.length === 0) {
        return results;
    }
    for (let i = 0; i < lines.length; i++) {
        const normalizedLine = lines[i].toLowerCase();
        // いずれかの単語が含まれているかチェック（OR条件: 0件になりにくい）
        const anyWordMatch = queryWords.some(word => normalizedLine.includes(word));
        if (anyWordMatch) {
            results.push({
                line: i + 1,
                text: lines[i],
                preview: lines[i].trim().substring(0, 100)
            });
        }
    }
    return results;
}
/**
 * Stage1: 見出し行（## ）に対してOR条件でFuzzy絞り込み
 * マッチしたセクションの生テキストを返す（0件なら空文字）
 */
function fuzzyFilterSections(query, memoContent) {
    const lines = memoContent.split('\n');
    const queryWords = query
        .toLowerCase()
        .split(/[\s　、。・]+/)
        .filter(w => w.length > 0);
    if (queryWords.length === 0) { return ''; }
    const result = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('## ')) {
            const headingLower = lines[i].toLowerCase();
            const anyMatch = queryWords.some(word => headingLower.includes(word));
            if (anyMatch) {
                result.push(lines[i]);
                let j = i + 1;
                while (j < lines.length && !lines[j].startsWith('## ')) {
                    result.push(lines[j]);
                    j++;
                }
                i = j;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    return result.join('\n');
}
/**
 * メモのサマリーを生成（見出し行 + 各セクション冒頭3行）
 * 8000行→約1200行に圧縮してトークン削減
 */
function buildMemoSummary(memoContent) {
    const lines = memoContent.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('## ')) {
            // 見出し行
            result.push(`${i + 1}: ${lines[i]}`);
            // 冒頭3行（空行はスキップして実質的な内容を取得）
            let count = 0;
            let j = i + 1;
            while (j < lines.length && count < 3 && !lines[j].startsWith('## ')) {
                if (lines[j].trim() !== '') {
                    result.push(`${j + 1}: ${lines[j]}`);
                    count++;
                }
                j++;
            }
            result.push('---');
            i = j;
        }
        else {
            i++;
        }
    }
    return result.join('\n');
}
/**
 * Gemini Flash API呼び出し
 */
async function searchWithGemini(query, memoContent) {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const apiKey = config.get('geminiApiKey', '');
    if (!apiKey) {
        throw new Error('Gemini API キーが設定されていません。設定 → cssToHtmlJumper.geminiApiKey を確認してください。');
    }
    const summary = buildMemoSummary(memoContent);
    const prompt = `以下のメモファイルから「${query}」に関連する行を検索してください。

【メモファイル】（各セクションの見出し＋冒頭3行のサマリー、行番号付き）
${summary}

【検索クエリ】
${query}

【指示】
- **意味理解を最優先**: 検索クエリの意図を理解し、その目的を達成するコードや説明を探す
- **固有名詞・プラットフォームを最重視**: クエリに「WordPress」「React」「Python」等の固有名詞があれば、**その単語が実際に含まれるセクションのみ**を最優先で選ぶ。含まれないセクションは関連度が高くても下位にすること
- **コードブロックを理解する**: \`\`\`で囲まれたコード例があれば、その機能・目的を解析する
  例: 「配列をソート」→ sort(), sorted() 等のメソッド使用例やソートアルゴリズムの説明を探す
  例: 「ループ処理」→ for文, while文, forEach等の実装例を探す
- **コードと説明のペア**: コード例とその説明文が近い場合、両方を含むセクションを優先
- **技術的な同義語・関連語を考慮**:
  例: 「関数」→「メソッド」「function」「def」も含む
  例: 「繰り返し」→「ループ」「for」「while」も含む
- 単語の順序は問わない、離れていてもOK
- typoや表記ゆれも考慮する
- **最大3件のみ**抽出（関連度が最も高いものだけ、厳選すること）
- **必ず異なるセクション（トピック）から選ぶ**（連続した行番号NG、離れた箇所から）
- 見出し行（##で始まる）やコードブロックの開始行を優先（ジャンプ先として正確なため）
- 類似内容・同じセクションの重複は絶対に避ける

【出力形式】
JSON配列で返す。説明文は不要。必ず3件以内。
- answer: 検索クエリへの直接的な答え（パス・コマンド・値・コードなど、コピーしてすぐ使えるもの）。なければ空文字。
- context: そのセクション内の補足説明（1行）

[
  {"line": 行番号, "keyword": "主要な技術用語", "text": "該当行の内容", "answer": "直接的な答え", "context": "補足説明"},
  ...
]

例:
[
  {"line": 7624, "keyword": "Localテーマフォルダ", "text": "- 場所：wp-content/themes/", "answer": "C:\\Users\\guest04\\Local Sites\\local-test\\app\\public\\wp-content\\themes", "context": "LocalのWordPressテーマ配置場所"},
  {"line": 1052, "keyword": "inline-block", "text": "## テキスト幅に合わせる", "answer": "display: inline-block;", "context": "幅が文字幅に合う"}
]`;
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            contents: [{
                    parts: [{ text: prompt }]
                }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 4096,
                responseMimeType: 'application/json',
                thinkingConfig: {
                    thinkingLevel: 'MINIMAL'
                }
            }
        });
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    // JSON配列を抽出（responseMimeTypeで純粋なJSONが返ってくる想定だが念のため複数パターン対応）
                    let results = null;
                    try {
                        const parsed2 = JSON.parse(text.trim());
                        results = Array.isArray(parsed2) ? parsed2 : null;
                    }
                    catch (_) { }
                    if (!results) {
                        // fallback: 先頭の[から末尾の]までを切り出す（貪欲マッチ回避）
                        const start = text.indexOf('[');
                        const end = text.lastIndexOf(']');
                        if (start !== -1 && end > start) {
                            results = JSON.parse(text.slice(start, end + 1));
                        }
                    }
                    if (results) {
                        const formatted = results.map((r) => ({
                            line: r.line,
                            keyword: r.keyword || '',
                            text: r.text,
                            preview: r.text.substring(0, 100),
                            answer: r.answer || '',
                            context: r.context || ''
                        }));
                        resolve(formatted);
                    }
                    else {
                        resolve([]);
                    }
                }
                catch (e) {
                    reject(new Error(`Gemini APIレスポンス解析エラー: ${e.message}\n\n生レスポンス:\n${data.substring(0, 500)}`));
                }
            });
        });
        req.on('error', (e) => {
            reject(new Error(`Gemini API接続エラー: ${e.message}`));
        });
        req.write(postData);
        req.end();
    });
}
/**
 * メモ検索のメイン処理
 */
async function handleMemoSearch() {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const memoFilePath = config.get('memoFilePath', '');
    if (!memoFilePath) {
        vscode.window.showErrorMessage('メモファイルパスが設定されていません。設定 → cssToHtmlJumper.memoFilePath を確認してください。');
        return;
    }
    // 選択テキストがあれば即検索、なければ入力ボックス
    const activeEditor = vscode.window.activeTextEditor;
    const selection = activeEditor?.selection;
    const selectedText = (selection && !selection.isEmpty)
        ? activeEditor.document.getText(selection).trim()
        : '';
    let query;
    if (selectedText) {
        query = selectedText;
    }
    else {
        // メモファイルから見出し行を抽出（サジェスト用）
        let headingItems = [];
        const historyItems = memoSearchHistory.map(h => ({
            label: `🕐 ${h}`, description: '検索履歴'
        }));
        try {
            const tmpDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(memoFilePath));
            headingItems = tmpDoc.getText().split('\n')
                .filter(line => /^#{1,3}\s/.test(line))
                .map(line => ({ label: line.replace(/^#+\s*/, '').trim(), description: '見出し' }));
        }
        catch { /* 見出し取得失敗時は候補なし */ }
        // CSS辞書 + 追加CSS + JS辞書をサジェスト候補に追加
        const cssQpItems = Object.keys(cssProperties_1.cssProperties).map(k => ({
            label: k, description: cssProperties_1.cssProperties[k].description
        }));
        const extraCssQpProps = [
            'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
            'border-style', 'border-color', 'border-width',
            'font-family', 'font-weight', 'font-style',
            'text-decoration', 'text-align', 'text-transform', 'text-indent',
            'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'text-overflow',
            'list-style', 'list-style-type', 'cursor', 'visibility', 'pointer-events', 'user-select',
            'clip-path', 'filter', 'backdrop-filter',
            'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
            'animation-delay', 'animation-iteration-count', 'animation-fill-mode',
            'flex', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
            'grid', 'grid-template-rows', 'grid-template-areas', 'grid-column', 'grid-row',
            'align-content', 'align-self', 'justify-self', 'place-items',
            'min-height', 'min-width', 'max-height', 'aspect-ratio',
            'outline', 'box-shadow', 'text-shadow', 'float', 'clear', 'vertical-align',
            'scroll-behavior', 'will-change', 'columns', 'column-count'
        ].filter(p => !cssProperties_1.cssProperties[p]);
        const extraCssQpItems = extraCssQpProps.map(p => ({ label: p, description: 'CSS' }));
        const jsQpItems = Object.keys(jsProperties_1.jsMethods).map(k => ({
            label: k, description: jsProperties_1.jsMethods[k].description
        }));
        const memoAllItems = [...historyItems, ...headingItems, ...cssQpItems, ...extraCssQpItems, ...jsQpItems];
        // QuickPick1本で完結：最後の単語で候補表示 → Enter で単語置き換え → 候補なし状態でEnter → 検索
        query = await new Promise((resolve) => {
            const qp = vscode.window.createQuickPick();
            qp.placeholder = 'b→background Enter, i→image Enter, の違いを教えて Enter で検索';
            qp.value = memoSearchHistory[0] || '';
            qp.items = [];
            qp.onDidChangeValue(value => {
                // 最後の単語を取り出してフィルタ
                const lastWord = value.split(/[\s　]+/).pop()?.toLowerCase() || '';
                if (!lastWord || lastWord.length < 1) {
                    qp.items = [];
                    return;
                }
                const starts = memoAllItems.filter(i => i.label.toLowerCase().startsWith(lastWord));
                const contains = memoAllItems.filter(i => !i.label.toLowerCase().startsWith(lastWord) && i.label.toLowerCase().includes(lastWord));
                qp.items = [...starts, ...contains];
            });
            let accepted = false;
            qp.onDidAccept(() => {
                const sel = qp.selectedItems[0];
                if (sel && qp.items.length > 0) {
                    // 候補あり → 最後の単語を選択テキストで置き換え（続けて入力可能）
                    const raw = sel.label.replace(/^🕐\s*/, '');
                    const parts = qp.value.split(/[\s　]+/);
                    parts[parts.length - 1] = raw;
                    qp.value = parts.join(' ') + ' ';
                    qp.items = [];
                }
                else {
                    // 候補なし or 空 → 確定して検索
                    accepted = true;
                    resolve(qp.value.trim());
                    qp.hide();
                }
            });
            qp.onDidHide(() => { qp.dispose(); if (!accepted) {
                resolve('');
            } });
            qp.show();
        });
        if (!query) {
            return;
        }
    }
    // CSSコードが選択された場合、プロパティ名+関数名に変換（例: clip-path: inset(0 0 0 0) → clip-path inset）
    if (selectedText) {
        const cssMatch = query.match(/^([\w-]+)\s*:\s*([\w-]+)\s*\(/);
        if (cssMatch) {
            query = `${cssMatch[1]} ${cssMatch[2]}`;
        }
        else {
            const propOnly = query.match(/^([\w-]+)\s*:/);
            if (propOnly) {
                query = propOnly[1];
            }
        }
    }
    // 前回の検索ワードを保持
    memoSearchHistory = [query];
    try {
        // メモファイル読み込み
        const memoUri = vscode.Uri.file(memoFilePath);
        const memoDoc = await vscode.workspace.openTextDocument(memoUri);
        const memoContent = memoDoc.getText();
        // Stage1: 見出しFuzzy絞り込み → Stage2: Gemini（絞り込み結果のみ送信）
        const filteredContent = fuzzyFilterSections(query, memoContent);
        const contentToSearch = filteredContent || memoContent; // 0件時はフルテキストにフォールバック
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: filteredContent ? '🔍→🤖 絞り込み済みをGeminiで検索中...' : '🤖 Gemini Flashで検索中（全文）...',
            cancellable: false
        }, async () => {
            try {
                const geminiResults = await searchWithGemini(query, contentToSearch);
                if (geminiResults.length > 0) {
                    // Ctrl+Shift+↓/↑ 用に結果を保存
                    lastMemoResults = geminiResults.map(r => ({
                        line: r.line, keyword: r.keyword, preview: r.preview, memoFilePath
                    }));
                    lastMemoResultIndex = 0;
                    const jumpToLine = async (lineNum) => {
                        const editor = await vscode.window.showTextDocument(memoDoc);
                        const position = new vscode.Position(lineNum - 1, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                        const highlight = vscode.window.createTextEditorDecorationType({
                            backgroundColor: 'rgba(255, 255, 0, 0.35)',
                            isWholeLine: true
                        });
                        editor.setDecorations(highlight, [new vscode.Range(position, position)]);
                        setTimeout(() => highlight.dispose(), 3000);
                    };
                    if (selectedText) {
                        // 選択あり → 1件目に即ジャンプ（QuickPickなし）
                        await jumpToLine(geminiResults[0].line);
                    }
                    else {
                        // 選択なし → QuickPickで選択
                        const memoLines = memoContent.split('\n');
                        const extractCodeNear = (lineNum) => {
                            for (let i = lineNum - 1; i < Math.min(lineNum + 30, memoLines.length); i++) {
                                if (memoLines[i].startsWith('```')) {
                                    const codeLines = [];
                                    for (let j = i + 1; j < memoLines.length; j++) {
                                        if (memoLines[j].startsWith('```')) {
                                            break;
                                        }
                                        if (memoLines[j].trim()) {
                                            codeLines.push(memoLines[j].trim());
                                        }
                                        if (codeLines.length >= 3) {
                                            break;
                                        }
                                    }
                                    return codeLines.join(' | ');
                                }
                            }
                            return '';
                        };
                        const items = geminiResults.map(r => {
                            const codePreview = extractCodeNear(r.line);
                            const detailParts = [];
                            if (r.context) {
                                detailParts.push(`→ ${r.context}`);
                            }
                            if (codePreview) {
                                detailParts.push(`📝 ${codePreview}`);
                            }
                            const bracketText = r.answer || r.preview;
                            return { label: `行 ${r.line}: 【${bracketText}】`, description: `🔑 ${r.keyword}`, detail: detailParts.join('    '), line: r.line };
                        });
                        const selected = await vscode.window.showQuickPick(items, { placeHolder: `${geminiResults.length}件見つかりました`, matchOnDetail: true });
                        if (selected) {
                            lastMemoResultIndex = lastMemoResults.findIndex(r => r.line === selected.line);
                            await jumpToLine(selected.line);
                        }
                    }
                }
                else {
                    // 0件時はメッセージなし（静かに終了）
                }
            }
            catch (e) {
                vscode.window.showErrorMessage(`Gemini検索エラー: ${e.message}`);
            }
        });
    }
    catch (e) {
        vscode.window.showErrorMessage(`メモファイル読み込みエラー: ${e.message}`);
    }
}
/**
 * クイズのメイン処理
 */
async function handleQuiz() {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const memoFilePath = config.get('memoFilePath', '');
    if (!memoFilePath) {
        vscode.window.showErrorMessage('メモファイルパスが設定されていません。設定 → cssToHtmlJumper.memoFilePath を確認してください。');
        return;
    }
    try {
        // メモファイル読み込み
        const memoUri = vscode.Uri.file(memoFilePath);
        const memoDoc = await vscode.workspace.openTextDocument(memoUri);
        const memoContent = memoDoc.getText();
        const lines = memoContent.split('\n');
        // 見出し（## xxx）を抽出
        const headings = [];
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^##\s+(.+)/);
            if (match) {
                // 見えない文字や制御文字を除去
                const fullTitle = match[1].trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
                let title = fullTitle;
                let category = '';
                // 登録カテゴリリスト取得
                const categoryList = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML']);
                const defaultCategory = categoryList.length > 0 ? categoryList[0] : 'その他';
                // カテゴリ: 見出し末尾が登録カテゴリに一致（大小文字・全半角空白無視）
                const titleParts = fullTitle.split(/[\s　]+/).filter(p => p.trim()); // 半角\sと全角、空文字列除去
                if (titleParts.length >= 2) {
                    const lastWord = titleParts[titleParts.length - 1];
                    const matchedCategory = categoryList.find(cat => cat.toLowerCase() === lastWord.toLowerCase());
                    if (matchedCategory) {
                        category = lastWord; // 元の表記を保持
                        title = titleParts.slice(0, -1).join(' ');
                    }
                }
                // カテゴリなし → デフォルトカテゴリ（リスト1番目）
                if (!category) {
                    category = defaultCategory;
                }
                const content = [];
                // 内容: 見出しの下（次の見出しまで）
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].match(/^##\s+/)) {
                        break;
                    }
                    if (lines[j].trim()) {
                        content.push(lines[j]);
                    }
                }
                if (content.length > 0) {
                    headings.push({ line: i + 1, title, content, category });
                }
            }
        }
        if (headings.length === 0) {
            vscode.window.showInformationMessage('メモに見出し（##）が見つかりませんでした');
            return;
        }
        // カテゴリフィルタ（大小文字無視）
        const quizCategory = config.get('quizCategory', '全て');
        let filteredHeadings = headings;
        if (quizCategory !== '全て') {
            filteredHeadings = headings.filter(h => h.category.toLowerCase() === quizCategory.toLowerCase());
            if (filteredHeadings.length === 0) {
                vscode.window.showInformationMessage(`カテゴリ「${quizCategory}」の問題が見つかりませんでした`);
                return;
            }
        }
        // 復習優先ロジック
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        // 復習候補: reviewCountに応じた間隔経過した問題（ただし10日間スキップは除外）
        const reviewCandidates = filteredHeadings.filter(h => {
            const history = quizHistoryMap.get(h.title);
            if (!history)
                return false; // 未出題は除外
            // reviewCount === -1 は「別の問題」でスキップされた
            if (history.reviewCount === -1) {
                const daysSince = (now - history.lastReviewed) / ONE_DAY;
                return daysSince >= 10; // 10日経過後のみ復活
            }
            const daysSince = (now - history.lastReviewed) / ONE_DAY;
            const requiredInterval = getNextInterval(history.reviewCount);
            return daysSince >= requiredInterval;
        });
        let quiz;
        const useReview = reviewCandidates.length > 0 && Math.random() < 0.3; // 30%で復習
        if (useReview) {
            // 復習問題（古い順で選出）
            reviewCandidates.sort((a, b) => {
                const historyA = quizHistoryMap.get(a.title);
                const historyB = quizHistoryMap.get(b.title);
                return historyA.lastReviewed - historyB.lastReviewed;
            });
            quiz = reviewCandidates[0];
        }
        else {
            // 70%: 新規（未出題）を優先、なければ全体からランダム
            const unreviewed = filteredHeadings.filter(h => !quizHistoryMap.has(h.title));
            if (unreviewed.length > 0) {
                const randomIndex = Math.floor(Math.random() * unreviewed.length);
                quiz = unreviewed[randomIndex];
            }
            else {
                const randomIndex = Math.floor(Math.random() * filteredHeadings.length);
                quiz = filteredHeadings[randomIndex];
            }
        }
        // 問題文の決定（初回のみGeminiで生成→JSON保存、2回目以降は保存済みを再利用）
        const geminiApiKey = config.get('geminiApiKey', '');
        const savedHistory = quizHistoryMap.get(quiz.title);
        let questionText = quiz.title; // フォールバック
        if (savedHistory?.questionText) {
            // 2回目以降：JSONに保存済みの問題文を再利用（重複防止のため固定）
            questionText = savedHistory.questionText;
            console.log('[Quiz] 保存済み問題文を再利用:', questionText.substring(0, 50));
        }
        else if (geminiApiKey) {
            // 初回：Geminiで問題文を新規生成
            try {
                const contentPreview = quiz.content.slice(0, 10).join('\n');
                const prompt = `以下のメモの見出しと内容から、簡潔なクイズ問題を1つ生成してください。

【見出し】
${quiz.title}

【内容】
${contentPreview}

【要件】
- 50文字以内の質問（明確さを優先、短さは二の次）
- 必ず「？」で終わる
- 前置き・説明文は一切禁止、質問のみ出力
- 主語・述語を明確にする
- 専門用語を使う場合は文脈を含める
- 質問文に答えやキーワードを含めない

悪い例:
× "inline-blockで中身の幅だけの箱を作るには？"（答えが含まれている）
× "display:inline-flexで横並びになる要素の間隔調整は？"（主語不明確）
× "[!INFORMATION]という文字を視覚的に中央に配置するには..."（長すぎ・説明的）

良い例:
○ "中身の幅だけの箱を作るdisplayの値は？"（答えを伏せている）
○ "Flexコンテナ内の子要素同士の間隔を一括設定するプロパティは？"（主語明確）
○ "要素を中央配置するFlexboxプロパティは？"（シンプルで明確）`;
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + geminiApiKey, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });
                if (response.ok) {
                    const data = await response.json();
                    const generatedQuestion = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (generatedQuestion) {
                        questionText = generatedQuestion;
                        console.log('[Quiz] Gemini新規問題文を生成:', questionText.substring(0, 50));
                    }
                }
            }
            catch (e) {
                // エラー時はフォールバック（見出しのみ）
                console.error('Gemini問題生成エラー:', e);
            }
        }
        // QuickPickで問題表示
        const answer = await vscode.window.showQuickPick([
            { label: '💡 答えを見る', description: '', action: 'answer' },
            { label: '🔄 別の問題', description: '', action: 'next' }
        ], {
            placeHolder: `🎯 ${questionText}`
        });
        if (!answer) {
            return; // キャンセル
        }
        if (answer.action === 'answer') {
            // 履歴記録（答えを見た時点で記録）
            const existingHistory = quizHistoryMap.get(quiz.title);
            if (existingHistory) {
                existingHistory.lastReviewed = now;
                existingHistory.reviewCount++;
            }
            else {
                quizHistoryMap.set(quiz.title, {
                    title: quiz.title,
                    line: quiz.line,
                    lastReviewed: now,
                    reviewCount: 1
                });
            }
            // 履歴を即座にファイル保存
            saveQuizHistory();
            // === 1. メモファイルの該当行にジャンプ+ハイライト（左エリア） ===
            const memoEditor = await vscode.window.showTextDocument(memoDoc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true // フォーカスは右パネル（回答）へ
            });
            const memoPosition = new vscode.Position(quiz.line - 1, 0);
            const memoRange = new vscode.Range(memoPosition, new vscode.Position(quiz.line, 0));
            memoEditor.selection = new vscode.Selection(memoPosition, memoPosition);
            memoEditor.revealRange(memoRange, vscode.TextEditorRevealType.InCenter);
            // ハイライト（黄色フラッシュ 1.5秒）
            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.3)'
            });
            memoEditor.setDecorations(decorationType, [memoRange]);
            setTimeout(() => decorationType.dispose(), 1500);
            // === 2. 3秒待機 ===
            console.log('[Quiz] 3秒待機開始...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('[Quiz] 3秒待機完了 → 回答取得開始');
            // === 3. 初回 or 既回答かを判定 ===
            const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
            const claudeApiKey = config.get('claudeApiKey', '');
            const answerContent = quiz.content.join('\n');
            const fs = require('fs');
            const memoDir = path.dirname(memoFilePath);
            const answerFilePath = path.join(memoDir, 'クイズ回答.md');
            // 初回判定：savedHistory が存在しない場合のみ初回扱い（questionText未保存でも既回答は既回答）
            const isFirstTime = !savedHistory;
            if (!isFirstTime) {
                // ===== 2回目以降：既存エントリにジャンプするだけ（Claude呼び出し・md書き込みなし）=====
                console.log('[Quiz] 既回答 → 既存エントリにジャンプ（書き込みなし）');
                if (fs.existsSync(answerFilePath)) {
                    quizAnswerDoc = await vscode.workspace.openTextDocument(answerFilePath);
                    const existingContent = quizAnswerDoc.getText();
                    const jumpMarker = `**Q: ${questionText}**`;
                    const jumpIdx = existingContent.indexOf(jumpMarker);
                    const existingTab = vscode.window.tabGroups.all
                        .flatMap(group => group.tabs)
                        .find(tab => tab.input instanceof vscode.TabInputText &&
                        tab.input.uri.fsPath === answerFilePath);
                    const targetViewColumn = existingTab ? existingTab.group.viewColumn : vscode.ViewColumn.Two;
                    const answerEditor = await vscode.window.showTextDocument(quizAnswerDoc, {
                        viewColumn: targetViewColumn,
                        preview: false,
                        preserveFocus: false
                    });
                    if (jumpIdx !== -1) {
                        // questionText でヒット → 直接ジャンプ
                        const jumpLine = existingContent.slice(0, jumpIdx).split('\n').length - 1;
                        const jumpPosition = new vscode.Position(jumpLine, 0);
                        answerEditor.selection = new vscode.Selection(jumpPosition, jumpPosition);
                        answerEditor.revealRange(new vscode.Range(jumpPosition, jumpPosition), vscode.TextEditorRevealType.InCenter);
                        const jumpDecorationType = vscode.window.createTextEditorDecorationType({
                            backgroundColor: 'rgba(255, 255, 0, 0.3)'
                        });
                        answerEditor.setDecorations(jumpDecorationType, [new vscode.Range(jumpLine, 0, jumpLine + 5, 0)]);
                        setTimeout(() => jumpDecorationType.dispose(), 1500);
                    }
                    else {
                        // 古いエントリで特定できない → quiz.title でCtrl+F自動検索
                        console.log('[Quiz] jumpIdx=-1 → findWithArgs で自動検索:', quiz.title);
                        // 検索しやすいようにquiz.titleの最初の20文字を使う
                        const searchKeyword = quiz.title.substring(0, 20);
                        await vscode.commands.executeCommand('editor.actions.findWithArgs', {
                            searchString: searchKeyword,
                            isRegex: false,
                            isCaseSensitive: false
                        });
                    }
                    pendingQuizEvaluation = {
                        quiz: quiz,
                        quizAnswerDoc: quizAnswerDoc,
                        newAnswerStartLine: 0,
                        claudeAnswer: '',
                        answerContent: answerContent
                    };
                }
                // 評価（2回目以降：文言を変える・削除しない）
                const afterAnswerRepeat = await showEvaluationQuickPick(false, true);
                if (!afterAnswerRepeat) {
                    showEvaluationStatusBar();
                    return;
                }
                if (afterAnswerRepeat.action === 'exit') {
                    hideEvaluationStatusBar();
                    return;
                }
                if (afterAnswerRepeat.eval) {
                    await processEvaluation(afterAnswerRepeat);
                    return;
                }
                return;
            }
            // ===== 初回：Claude呼び出し → md書き込み =====
            let claudeAnswer = '';
            if (claudeApiKey) {
                // Claude API で質問に対する回答生成
                const answerPrompt = `以下の質問に対して、メモの内容をもとに回答してください。また、メモ内容に技術的な誤りがあればファクトチェックとして指摘してください。

【質問】
${questionText}

【メモ内容】
${answerContent}

【回答フォーマット】
答え（1行、核心のみ）

説明（1-2行、理由や用途）

例：（メモにコード例があれば）
\`\`\`言語名
コード
\`\`\`

⚠ ファクトチェック：（メモに技術的誤りがある場合のみ記載）
「〜」は誤りです。正しくは〜

【要件】
- 超シンプルに、核心だけ書く
- 見出し禁止（**答え**、**説明**、**メモの要約：** 等を使わない）
- 箇条書きは最小限（❌⭕は特に必要な時のみ）
- 200文字以内（コード除く）
- 回答内に「# 」で始まる見出しを含めない
- 【重要】「答え」と「説明」は、あなたの知識ではなく100%「メモの内容」を正として出力してください。メモの内容がCSSの仕様と異なっていても、現場の経験則として書かれている場合はそのまま回答として出力してください。
- 【重要】メモの内容に対して「実際には不要です」「これは誤りです」などの否定や訂正を「答え」「説明」の中に絶対に混ぜないでください。
- 仕様との乖離や訂正がある場合は、すべて「⚠ ファクトチェック：」の項目の中だけで行ってください。
- ファクトチェックは誤りがない場合は完全に省略（「問題ありません」等も書かない）
- メモが正確なら回答のみ出力する

【悪い例】
**答え**

vertical-align

**説明**

インライン要素の縦位置を調整するプロパティ。

**メモの要約：**
- ❌ ...
- ⭕ ...

（見出しが多すぎ、長すぎ）

【良い例（誤りなし）】
vertical-align

インライン要素の縦位置を調整。負の値（-0.2rem等）で下方向に微調整できる。

例：
\`\`\`css
.icon {
  vertical-align: -0.2rem;
}
\`\`\`

【良い例（誤りあり）】
z-index

重なり順を制御するプロパティ。positionと併用が必要。

⚠ ファクトチェック：
「子要素も含めて他の要素より前面に配置できる」は誤りです。正しくは、stacking contextが形成されるため、親のz-indexが低いと子は他のstacking context内の要素より後ろになる場合があります。`;
                try {
                    claudeAnswer = await askClaudeAPI('', answerPrompt);
                    // デバッグ: 文字化けチェック
                    console.log('[Quiz] Claude回答:', claudeAnswer.substring(0, 100));
                }
                catch (e) {
                    claudeAnswer = `[Claude API エラー: ${e.message}]\n\n元のメモ内容:\n${answerContent}`;
                }
            }
            else {
                // Claude APIキーなし → メモ内容をそのまま表示
                claudeAnswer = answerContent;
            }
            // === 4. 回答ファイルを開く/作成（メモと同じフォルダ） ===
            // ファイルが存在しない場合は作成
            if (!fs.existsSync(answerFilePath)) {
                fs.writeFileSync(answerFilePath, '', 'utf8');
                console.log('[Quiz] クイズ回答.md を作成:', answerFilePath);
            }
            // 毎回最新のドキュメントを取得（既に開いていれば既存を返す）
            quizAnswerDoc = await vscode.workspace.openTextDocument(answerFilePath);
            const currentContent = quizAnswerDoc.getText();
            const lines = currentContent.split('\n');
            // カテゴリ見出しを探す（最後から検索）
            const categoryHeading = `# ${quiz.category || 'その他'}`;
            let insertPosition = -1;
            let categoryExists = false;
            // 既知のカテゴリ名リスト取得
            const knownCategories = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML']);
            knownCategories.push('全て', 'その他', '不動産', 'html'); // その他のカテゴリも追加
            // 最後の該当カテゴリ見出しを探す
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].trim() === categoryHeading) {
                    categoryExists = true;
                    // 次のカテゴリ見出し（# xxx）または末尾まで探す（既知のカテゴリのみ）
                    let sectionEnd = lines.length;
                    for (let j = i + 1; j < lines.length; j++) {
                        // 既知のカテゴリ見出しのみ検出（Claude回答内の「# 回答」等を誤検出しない）
                        if (lines[j].trim().startsWith('# ') &&
                            knownCategories.some(cat => lines[j].trim() === `# ${cat}`)) {
                            sectionEnd = j;
                            break;
                        }
                    }
                    insertPosition = sectionEnd;
                    break;
                }
            }
            let newContent;
            let newAnswerStartLine;
            // 画像リンク・プレビューリンクを抽出（共通）
            const imageLinks = quiz.content.filter(line => line.match(/!\[.*?\]\(.*?\)/) || // ![](...)
                line.match(/\[プレビュー\]/) // [プレビュー](...)
            );
            const imageLinkSection = imageLinks.length > 0
                ? '\n\n' + imageLinks.join('\n')
                : '';
            const SEP = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            const newEntryContent = `**Q: ${questionText}**\n\n${claudeAnswer}${imageLinkSection}`;
            // 既存エントリをquestionTextで検索（Fix1でquestionText固定のため確実にヒットするはず）
            const prevHistory = quizHistoryMap.get(quiz.title);
            const prevQuestionText = prevHistory?.questionText;
            const prevEntryMarker = prevQuestionText ? `**Q: ${prevQuestionText}**` : null;
            const existingIdx = prevEntryMarker ? currentContent.indexOf(prevEntryMarker) : -1;
            if (existingIdx !== -1) {
                // 同じメモ見出しのエントリが既存 → 重複を避けて上書き
                const nextSep = currentContent.indexOf(SEP, existingIdx);
                const nextCat = currentContent.indexOf('\n# ', existingIdx);
                let endIdx;
                if (nextSep !== -1 && (nextCat === -1 || nextSep < nextCat)) {
                    endIdx = nextSep;
                }
                else if (nextCat !== -1) {
                    endIdx = nextCat;
                }
                else {
                    endIdx = currentContent.length;
                }
                newContent = currentContent.slice(0, existingIdx) + newEntryContent + currentContent.slice(endIdx);
                newAnswerStartLine = currentContent.slice(0, existingIdx).split('\n').length - 1;
            }
            else if (categoryExists && insertPosition !== -1) {
                // 既存カテゴリセクション末尾に追記
                const before = lines.slice(0, insertPosition).join('\n');
                const after = insertPosition < lines.length ? '\n' + lines.slice(insertPosition).join('\n') : '';
                // セクション内に既にQ&Aがあるか確認（見出しの次の行以降）
                let hasContent = false;
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].trim() === categoryHeading) {
                        for (let j = i + 1; j < insertPosition; j++) {
                            if (lines[j].includes('**Q:')) {
                                hasContent = true;
                                break;
                            }
                        }
                        break;
                    }
                }
                const separator = hasContent ? SEP : '';
                newContent = before + separator + newEntryContent + after;
                newAnswerStartLine = insertPosition + (hasContent ? 3 : 0);
            }
            else {
                // 新規カテゴリ見出し作成
                const separator = currentContent.trim() ? '\n\n' : '';
                const newSection = separator + categoryHeading + '\n\n' + newEntryContent;
                newContent = currentContent + newSection;
                newAnswerStartLine = quizAnswerDoc.lineCount + (currentContent.trim() ? 4 : 2);
            }
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(quizAnswerDoc.lineCount, 0));
            edit.replace(quizAnswerDoc.uri, fullRange, newContent);
            await vscode.workspace.applyEdit(edit);
            // ファイル保存
            await quizAnswerDoc.save();
            console.log('[Quiz] クイズ回答.md に保存完了');
            // 既存タブを探す
            const existingTab = vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .find(tab => tab.input instanceof vscode.TabInputText &&
                tab.input.uri.fsPath === answerFilePath);
            console.log('[Quiz] 既存タブ検索:', existingTab ? `見つかった (viewColumn: ${existingTab.group.viewColumn})` : '見つからない');
            console.log('[Quiz] answerFilePath:', answerFilePath);
            // 右エリアに表示（既存タブがあればそれを使う）
            console.log('[Quiz] 回答ドキュメントを右エリアに表示...');
            const targetViewColumn = existingTab ? existingTab.group.viewColumn : vscode.ViewColumn.Two;
            console.log('[Quiz] 使用するviewColumn:', targetViewColumn, existingTab ? '(既存タブ)' : '(新規:固定右エリア)');
            const answerEditor = await vscode.window.showTextDocument(quizAnswerDoc, {
                viewColumn: targetViewColumn,
                preview: false,
                preserveFocus: false
            });
            console.log('[Quiz] 回答表示完了');
            // 最新Q&Aに自動スクロール
            const lastLine = quizAnswerDoc.lineCount - 1;
            const lastPosition = new vscode.Position(lastLine, 0);
            answerEditor.selection = new vscode.Selection(lastPosition, lastPosition);
            answerEditor.revealRange(new vscode.Range(lastLine, 0, lastLine, 0), vscode.TextEditorRevealType.InCenter);
            // 新しく追加された回答範囲をハイライト（1.5秒）
            const highlightRange = new vscode.Range(new vscode.Position(newAnswerStartLine, 0), new vscode.Position(quizAnswerDoc.lineCount - 1, 0));
            const answerDecorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.3)'
            });
            answerEditor.setDecorations(answerDecorationType, [highlightRange]);
            setTimeout(() => answerDecorationType.dispose(), 1500);
            // 評価待ちデータを保存
            pendingQuizEvaluation = {
                quiz: quiz,
                quizAnswerDoc: quizAnswerDoc,
                newAnswerStartLine: newAnswerStartLine,
                claudeAnswer: claudeAnswer,
                answerContent: answerContent
            };
            // questionText を履歴に保存（次回の重複検出用）
            const historyForQ = quizHistoryMap.get(quiz.title);
            if (historyForQ) {
                historyForQ.questionText = questionText;
                saveQuizHistory();
            }
            // ファクトチェックエラー検出
            const hasFactCheckError = claudeAnswer.includes('⚠ ファクトチェック');
            // 答え確認後の評価選択
            const afterAnswer = await showEvaluationQuickPick(hasFactCheckError);
            if (!afterAnswer) {
                // キャンセル → ステータスバーに評価待ち表示
                showEvaluationStatusBar();
                return;
            }
            if (afterAnswer.action === 'exit') {
                // 終了を選択 → 評価待ちクリア
                hideEvaluationStatusBar();
                return;
            }
            if (afterAnswer.action === 'correct') {
                // メモ修正
                await correctMemo();
                return;
            }
            // 評価あり → 処理実行
            if (afterAnswer.eval) {
                await processEvaluation(afterAnswer);
                return; // 評価完了後は次の問題へ（processEvaluation内でhandleQuiz呼出済）
            }
        }
        else if (answer.action === 'next') {
            // 別の問題 → 10日間スキップ
            const skipHistory = quizHistoryMap.get(quiz.title);
            if (skipHistory) {
                skipHistory.lastReviewed = now;
                skipHistory.reviewCount = -1; // スキップマーク
            }
            else {
                quizHistoryMap.set(quiz.title, {
                    title: quiz.title,
                    line: quiz.line,
                    lastReviewed: now,
                    reviewCount: -1 // スキップマーク
                });
            }
            saveQuizHistory();
            await handleQuiz();
        }
    }
    catch (e) {
        vscode.window.showErrorMessage(`クイズエラー: ${e.message}`);
    }
}
// ========================================
// Claude API 呼び出し関数
// ========================================
async function askClaudeAPI(code, question, htmlContext, isStructural, isHtmlGeneration, isSectionQuestion) {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const apiKey = config.get('claudeApiKey', '');
    const model = config.get('claudeModel', 'claude-sonnet-4-5-20250929');
    if (!apiKey) {
        throw new Error('Claude API キーが設定されていません。設定 → cssToHtmlJumper.claudeApiKey を確認してください。');
    }
    let prompt = '';
    if (isSectionQuestion && code.trim() && htmlContext) {
        // セクション質問: HTMLセクション + CSS全体
        prompt = `以下のHTMLセクションとCSSについて質問があります。

【HTMLセクション】
\`\`\`html
${code}
\`\`\`

【リンクされているCSS全体】
\`\`\`css
${htmlContext}
\`\`\`

${question}

日本語で回答してください。`;
    }
    else if (isStructural && code.trim() && htmlContext) {
        prompt = `以下のHTMLファイルの構造改善を依頼します。

【HTMLファイル全体】
\`\`\`html
${code}
\`\`\`

【リンクされているCSS】
\`\`\`css
${htmlContext}
\`\`\`

【依頼】
${question}

日本語で回答してください。`;
    }
    else if (isStructural && code.trim()) {
        prompt = `以下のHTMLファイルの構造改善を依頼します。

【HTMLファイル全体】
\`\`\`html
${code}
\`\`\`

【依頼】
${question}

日本語で回答してください。`;
    }
    else if (code.trim() && htmlContext) {
        prompt = `以下のCSSコードと、それが使われているHTMLについて質問があります。

【CSSコード】
\`\`\`css
${code}
\`\`\`

【HTMLでの使用箇所】
\`\`\`html
${htmlContext}
\`\`\`

【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    else if (code.trim()) {
        prompt = `以下のコードについて質問があります。

【コード】
\`\`\`
${code}
\`\`\`

【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    else {
        prompt = `【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    // サロゲートペア（絵文字等）をエスケープ
    const sanitizedPrompt = prompt.replace(/[\uD800-\uDFFF]/g, (char) => {
        return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });
    const requestBody = JSON.stringify({
        model: model,
        max_tokens: (isStructural || isHtmlGeneration) ? 8192 : 4096,
        messages: [
            { role: 'user', content: sanitizedPrompt }
        ]
    });
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.anthropic.com',
            port: 443,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(json.error.message || 'API エラー'));
                    }
                    else if (json.content && json.content[0] && json.content[0].text) {
                        resolve(json.content[0].text);
                    }
                    else {
                        reject(new Error('予期しないレスポンス形式'));
                    }
                }
                catch (e) {
                    reject(new Error('レスポンスの解析に失敗'));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(requestBody);
        req.end();
    });
}
// ========================================
// Gemini API 呼び出し関数 (thinking_level: MINIMAL)
// ========================================
async function askGeminiAPI(code, question, htmlContext, isStructural) {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const apiKey = config.get('geminiApiKey', '');
    if (!apiKey) {
        throw new Error('Gemini API キーが設定されていません。設定 → cssToHtmlJumper.geminiApiKey を確認してください。');
    }
    let prompt = '';
    if (isStructural && code.trim() && htmlContext) {
        prompt = `以下のHTMLファイルの構造改善を依頼します。

【HTMLファイル全体】
\`\`\`html
${code}
\`\`\`

【リンクされているCSS】
\`\`\`css
${htmlContext}
\`\`\`

【依頼】
${question}

日本語で回答してください。`;
    }
    else if (isStructural && code.trim()) {
        prompt = `以下のHTMLファイルの構造改善を依頼します。

【HTMLファイル全体】
\`\`\`html
${code}
\`\`\`

【依頼】
${question}

日本語で回答してください。`;
    }
    else if (code.trim() && htmlContext) {
        prompt = `以下のCSSコードと、それが使われているHTMLについて質問があります。

【CSSコード】
\`\`\`css
${code}
\`\`\`

【HTMLでの使用箇所】
\`\`\`html
${htmlContext}
\`\`\`

【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    else if (code.trim()) {
        prompt = `以下のコードについて質問があります。

【コード】
\`\`\`
${code}
\`\`\`

【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    else {
        prompt = `【質問】
${question}

日本語で簡潔に回答してください。`;
    }
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            contents: [{
                    parts: [{ text: prompt }]
                }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: isStructural ? 8192 : 4096,
                thinkingConfig: {
                    thinkingLevel: 'MINIMAL' // 高速化：内部推論を最小化
                }
            }
        });
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (!text) {
                        reject(new Error('Gemini APIからレスポンスがありません'));
                    }
                    else {
                        resolve(text);
                    }
                }
                catch (e) {
                    reject(new Error(`Gemini APIレスポンス解析エラー: ${e.message}`));
                }
            });
        });
        req.on('error', (e) => {
            reject(new Error(`Gemini API接続エラー: ${e.message}`));
        });
        req.write(postData);
        req.end();
    });
}
// CSSコードからクラス名/ID名を抽出
function extractSelectorsFromCSS(cssCode) {
    const selectors = [];
    // クラス名を抽出 (.class-name)
    const classMatches = cssCode.match(/\.[\w-]+/g);
    if (classMatches) {
        classMatches.forEach(m => selectors.push(m.substring(1))); // . を除去
    }
    // ID名を抽出 (#id-name)
    const idMatches = cssCode.match(/#[\w-]+/g);
    if (idMatches) {
        idMatches.forEach(m => selectors.push(m.substring(1))); // # を除去
    }
    return [...new Set(selectors)]; // 重複除去
}
// カーソル位置から親のCSSセレクタを検出
function findParentSelector(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    // カーソル位置より前のテキスト
    const beforeCursor = text.substring(0, offset);
    // 最後の { を探す（CSSルールの開始）
    const lastOpenBrace = beforeCursor.lastIndexOf('{');
    if (lastOpenBrace === -1)
        return { selectors: [], selectorText: '', fullRule: '' };
    // { の前のセレクタ部分を取得
    const prevCloseBrace = beforeCursor.lastIndexOf('}', lastOpenBrace);
    const selectorStart = prevCloseBrace === -1 ? 0 : prevCloseBrace + 1;
    const selectorText = beforeCursor.substring(selectorStart, lastOpenBrace).trim();
    // カーソル位置より後の } を探す（CSSルールの終了）
    const afterCursor = text.substring(offset);
    const nextCloseBrace = afterCursor.indexOf('}');
    const ruleEnd = nextCloseBrace === -1 ? text.length : offset + nextCloseBrace + 1;
    // フルルールを取得
    const fullRule = text.substring(selectorStart, ruleEnd).trim();
    // セレクタからクラス名/IDを抽出
    const selectors = extractSelectorsFromCSS(selectorText);
    return { selectors, selectorText, fullRule };
}
// 自動生成HTMLファイルを除外するフィルタ
function filterAutoGeneratedHtml(files) {
    return files.filter(uri => {
        const name = path.basename(uri.fsPath);
        // preview-*.html, *_overview.html を除外
        return !(/^preview-.*\.html$/i.test(name) || /_overview\.html$/i.test(name));
    });
}
// HTMLファイルからセレクタの使用箇所を検索
async function findHtmlUsage(selectors) {
    if (selectors.length === 0)
        return '';
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const targetPattern = config.get('targetFiles', '**/*.html');
    const htmlFiles = filterAutoGeneratedHtml(await vscode.workspace.findFiles(targetPattern, '**/node_modules/**'));
    const results = [];
    const maxResults = 10; // 最大10件まで
    for (const fileUri of htmlFiles) {
        if (results.length >= maxResults)
            break;
        try {
            const htmlDoc = await vscode.workspace.openTextDocument(fileUri);
            const text = htmlDoc.getText();
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults)
                    break;
                for (const selector of selectors) {
                    // class="...selector..." または id="selector" を検索
                    const classPattern = new RegExp(`class\\s*=\\s*["'][^"']*\\b${selector}\\b[^"']*["']`, 'i');
                    const idPattern = new RegExp(`id\\s*=\\s*["']${selector}["']`, 'i');
                    if (classPattern.test(lines[i]) || idPattern.test(lines[i])) {
                        results.push(`${path.basename(fileUri.fsPath)}:${i + 1}: ${lines[i].trim()}`);
                        break;
                    }
                }
            }
        }
        catch (e) {
            // エラー無視
        }
    }
    return results.join('\n');
}
// HTMLからクラス/ID抽出
function extractClassesAndIdsFromHtml(html) {
    const classes = [];
    const ids = [];
    // class="class1 class2" を抽出
    const classMatches = html.matchAll(/class\s*=\s*["']([^"']+)["']/gi);
    for (const match of classMatches) {
        const classList = match[1].split(/\s+/).filter(c => c.trim());
        classes.push(...classList);
    }
    // id="idname" を抽出
    const idMatches = html.matchAll(/id\s*=\s*["']([^"']+)["']/gi);
    for (const match of idMatches) {
        ids.push(match[1].trim());
    }
    return {
        classes: [...new Set(classes)],
        ids: [...new Set(ids)]
    };
}
// HTMLファイルからリンクされているCSSファイルを検出
async function findLinkedCssFiles(htmlDocument) {
    const htmlText = htmlDocument.getText();
    const cssFiles = [];
    // <link rel="stylesheet" href="xxx.css"> を検索
    const linkMatches = htmlText.matchAll(/<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi);
    for (const match of linkMatches) {
        const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch && hrefMatch[1]) {
            let cssPath = hrefMatch[1];
            // 相対パスを絶対パスに変換
            if (!path.isAbsolute(cssPath)) {
                const htmlDir = path.dirname(htmlDocument.uri.fsPath);
                cssPath = path.resolve(htmlDir, cssPath);
            }
            cssFiles.push(cssPath);
        }
    }
    return cssFiles;
}
// CSSにリンクするHTMLファイルをワークスペースから検索（ファイル名で簡易マッチ）
async function findLinkedHtmlFiles(cssDocument) {
    const cssFileName = path.basename(cssDocument.uri.fsPath);
    const result = [];
    const htmlUris = filterAutoGeneratedHtml(await vscode.workspace.findFiles('**/*.html', '**/node_modules/**', 20));
    for (const uri of htmlUris) {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            if (doc.getText().includes(cssFileName)) {
                result.push(doc);
            }
        }
        catch (e) { /* 無視 */ }
    }
    return result;
}
// CSSドキュメント内でセクション名が一致するセクションのテキストを返す（Stage 1）
function findCssSectionByName(cssDoc, targetName) {
    const lines = cssDoc.getText().split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].search(/[┌]/) < 0) {
            continue;
        }
        let sectionName = '';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const pipeIdx = lines[j].search(/[│|]/);
            if (pipeIdx < 0) {
                continue;
            }
            let content = lines[j].substring(pipeIdx + 1).replace(/[│|].*$/, '').trim();
            content = content.replace(/\/\*|\*\//g, '').trim();
            if (content && !/^[─━┈┄┌┐└┘│|]+$/.test(content)) {
                sectionName = content;
                break;
            }
        }
        if (sectionName !== targetName) {
            continue;
        }
        let end = lines.length - 1;
        for (let k = i + 1; k < lines.length; k++) {
            if (lines[k].search(/[┌]/) >= 0) {
                end = k - 1;
                break;
            }
        }
        return lines.slice(i, end + 1).join('\n');
    }
    return null;
}
// CSSドキュメント内でセレクタが含まれるセクションのテキストを返す（Stage 2）
function findCssSectionBySelectors(cssDoc, selectors) {
    if (selectors.length === 0) {
        return null;
    }
    const lines = cssDoc.getText().split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].search(/[┌]/) < 0) {
            continue;
        }
        let end = lines.length - 1;
        for (let k = i + 1; k < lines.length; k++) {
            if (lines[k].search(/[┌]/) >= 0) {
                end = k - 1;
                break;
            }
        }
        const sectionText = lines.slice(i, end + 1).join('\n');
        if (selectors.some(sel => sectionText.includes(sel))) {
            return sectionText;
        }
    }
    return null;
}
// HTMLテキスト内で罫線ボックスセクション名が一致するセクションのテキストを返す（Stage 1）
function findHtmlBoxSectionByName(htmlLines, targetName) {
    for (let i = 0; i < htmlLines.length; i++) {
        if (htmlLines[i].search(/[┌]/) < 0) {
            continue;
        }
        let sectionName = '';
        for (let j = i + 1; j < Math.min(i + 5, htmlLines.length); j++) {
            const pipeIdx = htmlLines[j].search(/[│|]/);
            if (pipeIdx < 0) {
                continue;
            }
            let content = htmlLines[j].substring(pipeIdx + 1).replace(/[│|].*$/, '').trim();
            content = content.replace(/<!--|-->|\/\*|\*\//g, '').trim();
            if (content && !/^[─━┈┄┌┐└┘│|]+$/.test(content)) {
                sectionName = content;
                break;
            }
        }
        if (sectionName !== targetName) {
            continue;
        }
        let end = htmlLines.length - 1;
        for (let k = i + 1; k < htmlLines.length; k++) {
            if (htmlLines[k].search(/[┌]/) >= 0) {
                end = k - 1;
                break;
            }
        }
        return htmlLines.slice(i, end + 1).join('\n');
    }
    return null;
}
// CSSテキストからセレクタ（.class, #id）を抽出
function extractSelectorsFromCss(cssText) {
    const selectors = new Set();
    for (const m of cssText.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
        selectors.add('.' + m[1]);
    }
    for (const m of cssText.matchAll(/#([a-zA-Z_][\w-]*)/g)) {
        selectors.add('#' + m[1]);
    }
    return [...selectors];
}
// HTMLファイルからセクション候補を3段階で検出
function detectHtmlSections(document) {
    const sections = [];
    const text = document.getText();
    const lines = text.split('\n');
    // body直下の <header>, <section>, <footer> のみ検出
    // インデントが最小レベル（body直下）のタグだけ対象
    let bodyIndent = -1;
    for (let i = 0; i < lines.length; i++) {
        const bodyMatch = lines[i].match(/^(\s*)<body\b/);
        if (bodyMatch) {
            bodyIndent = bodyMatch[1].length;
            break;
        }
    }
    // body未検出の場合はインデント0をbody直下とみなす
    const childIndent = bodyIndent >= 0 ? bodyIndent + 2 : 0;
    const tagRegex = /^(\s*)<(header|section|footer)\b[^>]*?(?:class="([^"]*)")?[^>]*?(?:id="([^"]*)")?[^>]*>/;
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(tagRegex);
        if (match) {
            const indent = match[1].length;
            // body直下レベルのみ（インデント差±2まで許容）
            if (Math.abs(indent - childIndent) > 2) {
                continue;
            }
            const tag = match[2];
            const className = match[3] || '';
            const id = match[4] || '';
            let label = `<${tag}>`;
            if (id) {
                label = `<${tag} id="${id}">`;
            }
            else if (className) {
                label = `<${tag} class="${className}">`;
            }
            const icon = tag === 'header' ? '🔝' : tag === 'footer' ? '🔚' : '📦';
            sections.push({ label: `${icon} ${label}`, line: i, type: 'element' });
        }
    }
    return sections;
}
// セクションの終了行を検出（対応する閉じタグを探す）
function findSectionEnd(lines, startLine) {
    // 開始タグ名を取得
    const openMatch = lines[startLine].match(/<(header|section|footer)\b/);
    if (!openMatch) {
        // フォールバック: インデントベース
        const startIndent = lines[startLine].search(/\S/);
        if (startIndent < 0) {
            return startLine;
        }
        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') {
                continue;
            }
            const indent = line.search(/\S/);
            if (indent <= startIndent && i > startLine + 1) {
                if (line.trim().startsWith('</')) {
                    return i;
                }
                return i - 1;
            }
        }
        return lines.length - 1;
    }
    const tagName = openMatch[1];
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        // 開きタグをカウント
        const opens = (line.match(new RegExp(`<${tagName}\\b`, 'g')) || []).length;
        // 閉じタグをカウント
        const closes = (line.match(new RegExp(`</${tagName}>`, 'g')) || []).length;
        depth += opens - closes;
        if (depth <= 0) {
            return i;
        }
    }
    return lines.length - 1;
}
// CSSファイルから指定されたクラス/IDに関連するルールのみを抽出
async function extractRelatedCssRules(htmlContent, cssFilePaths) {
    // HTMLからクラス/ID抽出（既存関数流用）
    const { classes, ids } = extractClassesAndIdsFromHtml(htmlContent);
    if (classes.length === 0 && ids.length === 0) {
        return ''; // クラス/IDがない場合は空
    }
    let relatedCss = '';
    for (const cssPath of cssFilePaths) {
        try {
            const cssUri = vscode.Uri.file(cssPath);
            const cssDoc = await vscode.workspace.openTextDocument(cssUri);
            const cssText = cssDoc.getText();
            const cssLines = cssText.split('\n');
            relatedCss += `/* === ${path.basename(cssPath)} === */\n`;
            // CSSルールを抽出
            let inRule = false;
            let currentRule = '';
            let braceCount = 0;
            for (const line of cssLines) {
                // ルール開始検出（セレクタ行）
                if (!inRule && line.trim() && !line.trim().startsWith('/*') && !line.trim().startsWith('//')) {
                    // クラス/IDが含まれるかチェック
                    const hasClass = classes.some(c => line.includes(`.${c}`));
                    const hasId = ids.some(id => line.includes(`#${id}`));
                    if (hasClass || hasId) {
                        inRule = true;
                        currentRule = line + '\n';
                        braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
                    }
                }
                else if (inRule) {
                    currentRule += line + '\n';
                    braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
                    if (braceCount === 0) {
                        relatedCss += currentRule;
                        inRule = false;
                        currentRule = '';
                    }
                }
            }
        }
        catch (e) {
            // ファイル読み込み失敗は無視
        }
    }
    return relatedCss;
}
// ブラウザハイライト用のセレクタ情報を保持
let currentBrowserSelector = null;
function activate(context) {
    console.log('CSS to HTML Jumper: 拡張機能が有効化されました');
    // AIホバーの有効化
    (0, aiHoverProvider_1.registerAiHoverProvider)(context);
    // JS Overview Generator の有効化
    (0, overviewGenerator_1.registerOverviewGenerator)(context);
    // クイズ履歴をファイルから復元
    loadQuizHistory();
    // 起動時クイズリマインダー（5秒後、1日1回のみ）
    setTimeout(async () => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get('memoFilePath', '');
        if (!memoFilePath || quizHistoryMap.size === 0)
            return;
        // 1日1回チェック
        const lastReminder = context.globalState.get('lastQuizReminder', 0);
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        if (now - lastReminder < ONE_DAY)
            return; // 24時間以内は通知しない
        let reviewCount = 0;
        quizHistoryMap.forEach(history => {
            if (history.reviewCount === -1) {
                if ((now - history.lastReviewed) / ONE_DAY >= 10)
                    reviewCount++;
            }
            else if ((now - history.lastReviewed) / ONE_DAY >= 1) {
                reviewCount++;
            }
        });
        if (reviewCount > 0) {
            context.globalState.update('lastQuizReminder', now);
            const action = await vscode.window.showInformationMessage(`📚 復習すべき問題が ${reviewCount} 件あります`, '🎯 クイズ開始', '❌ あとで');
            if (action === '🎯 クイズ開始') {
                vscode.commands.executeCommand('cssToHtmlJumper.quiz');
            }
        }
    }, 5000);
    // 旧globalStateからの移行（初回のみ）
    const savedHistory = context.globalState.get('quizHistory', []);
    if (savedHistory.length > 0 && quizHistoryMap.size === 0) {
        quizHistoryMap = new Map(savedHistory);
        saveQuizHistory(); // ファイルに保存
        context.globalState.update('quizHistory', []); // globalStateクリア
        console.log('[Quiz] 履歴をglobalStateからファイルに移行しました');
    }
    // ========================================
    // ブラウザハイライト用HTTPサーバー（ポート3848）
    // ========================================
    let browserHighlightServer = null;
    const activeSockets = new Set();
    function forceCloseServer() {
        // 全接続ソケットを強制破棄（ポート即解放）
        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();
        if (browserHighlightServer) {
            browserHighlightServer.close();
            browserHighlightServer = null;
        }
    }
    function createHighlightServer() {
        const server = http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Content-Type', 'application/json');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            // shutdownエンドポイント（古いサーバーを停止させる）
            if (req.url === '/shutdown') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'shutting down' }));
                setTimeout(() => forceCloseServer(), 100);
                return;
            }
            if (req.url === '/selector') {
                const now = Date.now();
                if (currentBrowserSelector && (now - currentBrowserSelector.timestamp) < 30000) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        type: currentBrowserSelector.type,
                        name: currentBrowserSelector.name
                    }));
                }
                else {
                    res.writeHead(200);
                    res.end(JSON.stringify({ type: null, name: null }));
                }
            }
            else if (req.url === '/highlight-line' && req.method === 'POST') {
                // HTMLファイルの該当行をハイライト表示
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const filePath = data.filePath;
                        const lineNumber = data.lineNumber;
                        if (!filePath || !lineNumber) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Missing filePath or lineNumber' }));
                            return;
                        }
                        // 既に開いているエディタを探す
                        const targetUri = vscode.Uri.file(filePath).toString();
                        console.log('CSS to HTML Jumper: ハイライトリクエスト受信', { filePath, lineNumber, targetUri });
                        console.log('CSS to HTML Jumper: 開いているエディタ一覧', vscode.window.visibleTextEditors.map(e => e.document.uri.toString()));
                        let targetEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === targetUri);
                        console.log('CSS to HTML Jumper: エディタ検索結果', targetEditor ? 'found' : 'not found');
                        const applyHighlight = (editor) => {
                            const line = lineNumber - 1; // 0-indexed
                            const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
                            // 黄色背景でハイライト
                            const decorationType = vscode.window.createTextEditorDecorationType({
                                backgroundColor: 'rgba(255, 255, 0, 0.3)',
                                isWholeLine: true
                            });
                            editor.setDecorations(decorationType, [range]);
                            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            console.log('CSS to HTML Jumper: ハイライト適用', filePath, lineNumber);
                            // 3秒後にハイライト削除
                            setTimeout(() => {
                                decorationType.dispose();
                            }, 3000);
                        };
                        if (targetEditor) {
                            // 既に開いている場合はそのエディタにハイライト適用
                            applyHighlight(targetEditor);
                        }
                        else {
                            // 開いていない場合は新しく開く
                            vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then(doc => {
                                vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true }).then(editor => {
                                    applyHighlight(editor);
                                }, (err) => {
                                    console.error('CSS to HTML Jumper: ドキュメント表示エラー', err);
                                });
                            }, (err) => {
                                console.error('CSS to HTML Jumper: ファイルオープンエラー', err);
                            });
                        }
                        res.writeHead(200);
                        res.end(JSON.stringify({ status: 'ok' }));
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    }
                });
            }
            else if (req.url === '/explain-and-jump' && req.method === 'POST') {
                // Ctrl+クリック → CSS説明表示 + ジャンプ
                let body = '';
                req.on('data', (chunk) => body += chunk.toString());
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        console.log('CSS to HTML Jumper: CSS説明リクエスト受信', data);
                        // 1. CSSファイルから該当クラスの定義を検索
                        const targetSelector = data.className
                            ? data.className.toString().split(' ')[0] // 最初のクラス名のみ
                            : data.id;
                        const selectorType = data.className ? 'class' : 'id';
                        const cssMatches = [];
                        let cssFilePath = '';
                        let cssLineNumber = 0;
                        if (vscode.workspace.workspaceFolders) {
                            const cssFiles = await vscode.workspace.findFiles('**/*.css', '**/node_modules/**', 50);
                            for (const cssFile of cssFiles) {
                                const doc = await vscode.workspace.openTextDocument(cssFile);
                                const text = doc.getText();
                                const searchPattern = selectorType === 'class' ? '.' + targetSelector : '#' + targetSelector;
                                const lines = text.split('\n');
                                for (let i = 0; i < lines.length; i++) {
                                    if (lines[i].includes(searchPattern)) {
                                        // CSS定義を抽出（ブレース内）
                                        let braceCount = 0;
                                        let ruleLines = [];
                                        for (let j = i; j < lines.length; j++) {
                                            ruleLines.push(lines[j]);
                                            braceCount += (lines[j].match(/{/g) || []).length;
                                            braceCount -= (lines[j].match(/}/g) || []).length;
                                            if (braceCount === 0 && ruleLines.length > 0) {
                                                break;
                                            }
                                        }
                                        // @media内かチェック（簡易版：上100行を遡って@mediaを探す）
                                        let isInMedia = false;
                                        let mediaOpenBraces = 0;
                                        for (let k = i - 1; k >= Math.max(0, i - 100); k--) {
                                            const line = lines[k];
                                            if (line.includes('@media')) {
                                                // @mediaから現在位置までのブレース数を計算
                                                for (let m = k; m < i; m++) {
                                                    mediaOpenBraces += (lines[m].match(/{/g) || []).length;
                                                    mediaOpenBraces -= (lines[m].match(/}/g) || []).length;
                                                }
                                                if (mediaOpenBraces > 0) {
                                                    isInMedia = true;
                                                }
                                                break;
                                            }
                                        }
                                        // マッチ情報を記録
                                        cssMatches.push({
                                            filePath: cssFile.fsPath,
                                            fileName: cssFile.fsPath.split(/[\\/]/).pop() || 'unknown',
                                            lineNumber: i + 1,
                                            rule: ruleLines.join('\n'),
                                            isInMedia: isInMedia
                                        });
                                        // ジャンプ先は最初のマッチ
                                        if (!cssFilePath) {
                                            cssFilePath = cssFile.fsPath;
                                            cssLineNumber = i + 1;
                                        }
                                    }
                                }
                            }
                        }
                        // 2.5. CSS定義を構造化フォーマットで構築（ファイル名:行番号付き）
                        let cssDefinition = '';
                        if (cssMatches.length > 0) {
                            cssDefinition = cssMatches.map(match => {
                                const mediaLabel = match.isInMedia ? ' (@media内)' : '';
                                return `--- ${match.fileName}:${match.lineNumber}${mediaLabel} ---\n${match.rule}`;
                            }).join('\n\n');
                        }
                        else {
                            cssDefinition = '/* 該当するCSS定義が見つかりませんでした */';
                        }
                        // 3. Claude Sonnet APIでCSS修正案・説明を生成
                        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                        const claudeApiKey = config.get('claudeApiKey', '');
                        let explanation = '';
                        let title = '';
                        if (claudeApiKey) {
                            let prompt = '';
                            if (data.userRequest) {
                                // ユーザーからの修正要望がある場合
                                title = `🛠️ CSS修正案: ${data.userRequest}`;
                                prompt = `あなたは熟練したフロントエンドエンジニアです。
ユーザーの要望に基づいて、提供されたHTMLとCSSを修正してください。

【ユーザーの要望】: ${data.userRequest}

【ターゲット要素のセレクタ】: ${selectorType === 'class' ? '.' : '#'}${targetSelector}
【HTML構造（セクション全体）】:
${data.htmlContext || 'なし'}

【CSS定義（ファイル名・行番号付き）】:
${cssDefinition}

【指示】:
- CSSの「解説」は不要です。
- 「どのコードをどう書き換えるべきか」のみを具体的かつ簡潔に提示してください。
- 既存のCSSを尊重しつつ、要望を実現するための最小限かつ最適な変更を行ってください。
- 他の要素への悪影響（サイドエフェクト）がないか考慮してください。

【出力形式】:
1. **修正内容**
   - ファイル名:行番号 → 変更すべきCSSコード（\`\`\`css ... \`\`\`）
   - ※既存のコードを書き換える場合は、変更前後の違いが分かるように記述してください。
   - ※新規追加の場合は、どのファイルの何行目付近に追加すべきか記述してください。

2. **注意点**（もしあれば1行で）`;
                            }
                            else {
                                // 要望がない場合（従来の説明モード）
                                title = `🔍 CSS説明: ${selectorType === 'class' ? '.' : '#'}${targetSelector}`;
                                prompt = `以下のCSSクラスについて、簡潔に日本語で説明してください。

【セレクタ】: ${selectorType === 'class' ? '.' : '#'}${targetSelector}
【HTML要素】: <${data.tagName}>
【HTMLコンテキスト】:
${data.htmlContext || 'なし'}

【CSS定義（ファイル名・行番号付き）】:
${cssDefinition}

【出力形式】:
- このクラスの役割（1行）
- 主な視覚効果（箇条書き、5つまで）
- 改善のヒント（あれば1行）`;
                            }
                            try {
                                explanation = await askClaudeAPI(prompt, '', undefined, false);
                            }
                            catch (apiErr) {
                                explanation = `❌ API呼び出しエラー: ${apiErr.message}`;
                            }
                        }
                        else {
                            explanation = '⚠️ Claude APIキーが設定されていません。\n設定: cssToHtmlJumper.claudeApiKey';
                        }
                        // 4. 新しいMarkdownタブに説明を表示
                        const matchesSummary = cssMatches.length > 0
                            ? cssMatches.map(m => `- ${m.fileName}:${m.lineNumber}${m.isInMedia ? ' (📱@media内)' : ''}`).join('\n')
                            : '- なし';
                        const mdContent = `# ${title}

## 📋 現在のCSS定義（${cssMatches.length}件）
${matchesSummary}

\`\`\`css
${cssDefinition}
\`\`\`

## 💡 AI提案
${explanation}

---
*ジャンプ先: ${cssFilePath || '不明'} (行: ${cssLineNumber || '不明'})*
*要素: <${data.tagName}> | 生成: ${new Date().toLocaleString('ja-JP')}*
`;
                        const doc = await vscode.workspace.openTextDocument({
                            content: mdContent,
                            language: 'markdown'
                        });
                        await vscode.window.showTextDocument(doc, {
                            viewColumn: vscode.ViewColumn.Beside,
                            preview: true,
                            preserveFocus: true
                        });
                        // 5. CSS定義にジャンプ（メインエディタで）
                        if (cssFilePath && cssLineNumber > 0) {
                            const cssUri = vscode.Uri.file(cssFilePath);
                            const cssDoc = await vscode.workspace.openTextDocument(cssUri);
                            const cssEditor = await vscode.window.showTextDocument(cssDoc, {
                                viewColumn: vscode.ViewColumn.One,
                                preview: false,
                                preserveFocus: false
                            });
                            const line = cssLineNumber - 1;
                            const range = new vscode.Range(line, 0, line, cssDoc.lineAt(line).text.length);
                            cssEditor.selection = new vscode.Selection(range.start, range.end);
                            cssEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            // 黄色ハイライト（3秒）
                            const decorationType = vscode.window.createTextEditorDecorationType({
                                backgroundColor: 'rgba(255, 255, 0, 0.3)',
                                isWholeLine: true
                            });
                            cssEditor.setDecorations(decorationType, [range]);
                            setTimeout(() => decorationType.dispose(), 3000);
                        }
                        res.writeHead(200);
                        res.end(JSON.stringify({ status: 'ok' }));
                    }
                    catch (e) {
                        console.error('CSS to HTML Jumper: explain-and-jump エラー', e);
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            }
            else if (req.url === '/project-path') {
                // Chrome拡張機能用: 現在のワークスペースパスを返す
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const projectPath = workspaceFolders[0].uri.fsPath;
                    res.writeHead(200);
                    res.end(JSON.stringify({ projectPath: projectPath }));
                }
                else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'No workspace folder opened' }));
                }
            }
            else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        });
        // 全接続ソケットを追跡
        server.on('connection', (socket) => {
            activeSockets.add(socket);
            socket.on('close', () => activeSockets.delete(socket));
        });
        return server;
    }
    function startHighlightServer(retries = 5) {
        // 古いサーバーにshutdownリクエストを送る
        const shutdownReq = http.request({
            host: '127.0.0.1', port: 3848, path: '/shutdown', method: 'POST', timeout: 1000
        }, (res) => {
            // shutdownレスポンス受信 → 古いサーバーが停止処理を開始
            res.resume();
        });
        shutdownReq.on('error', () => { }); // 古いサーバーがなくてもOK
        shutdownReq.end();
        // 古いサーバーの停止を待ってから起動
        setTimeout(() => {
            browserHighlightServer = createHighlightServer();
            browserHighlightServer.listen(3848, '127.0.0.1', () => {
                console.log('CSS to HTML Jumper: ブラウザハイライトサーバー起動 (port 3848)');
            });
            browserHighlightServer.on('error', (err) => {
                if (err.code === 'EADDRINUSE' && retries > 0) {
                    console.log('CSS to HTML Jumper: ポート3848使用中、' + (6 - retries) + '回目リトライ...');
                    setTimeout(() => startHighlightServer(retries - 1), 2000);
                }
                else if (err.code === 'EADDRINUSE') {
                    console.log('CSS to HTML Jumper: ポート3848の確保に失敗（リトライ上限）');
                }
                else {
                    console.error('CSS to HTML Jumper: サーバーエラー', err);
                }
            });
        }, 1500); // shutdownリクエスト後1.5秒待ってから起動
    }
    startHighlightServer();
    // 拡張機能終了時にサーバーを強制クローズ
    context.subscriptions.push({
        dispose: () => {
            forceCloseServer();
            console.log('CSS to HTML Jumper: ブラウザハイライトサーバー停止');
        }
    });
    // ========================================
    // CSS専用：ホバー時にブラウザハイライト用セレクタを更新
    // ========================================
    const cssHoverForHighlight = vscode.languages.registerHoverProvider({ scheme: 'file', language: 'css' }, {
        provideHover(document, position) {
            const wordRange = document.getWordRangeAtPosition(position, /[.#][\w-]+/);
            if (!wordRange) {
                currentBrowserSelector = null;
                return null;
            }
            const word = document.getText(wordRange);
            if (word.startsWith('.')) {
                currentBrowserSelector = { type: 'class', name: word.substring(1), timestamp: Date.now() };
            }
            else if (word.startsWith('#')) {
                currentBrowserSelector = { type: 'id', name: word.substring(1), timestamp: Date.now() };
            }
            else {
                currentBrowserSelector = null;
            }
            return null; // ホバー表示は既存のcssSelectorHoverProviderに任せる
        }
    });
    context.subscriptions.push(cssHoverForHighlight);
    // ========================================
    // HTML専用：クリック時にブラウザハイライト用セレクタを更新
    // ========================================
    const onSelectionChange = vscode.window.onDidChangeTextEditorSelection((e) => {
        const editor = e.textEditor;
        if (!editor) {
            return;
        }
        const lang = editor.document.languageId;
        if (lang !== 'html') {
            return;
        } // HTML専用
        const line = editor.document.lineAt(editor.selection.active.line).text;
        const cursorCol = editor.selection.active.character;
        // HTMLモード：カーソル位置のclass/idを抽出
        // class="xxx yyy" の中のカーソル位置の単語を取得
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
                const classes = classMatch[1].split(/\s+/).filter((c) => c);
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
    });
    context.subscriptions.push(onSelectionChange);
    // ========================================
    // ハイライト用の装飾タイプ（グローバルで定義）
    // ========================================
    const jumpHighlightDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(100, 180, 255, 0.25)',
        isWholeLine: true,
        border: '1px solid rgba(100, 180, 255, 0.5)'
    });
    // ========================================
    // URIハンドラ: cssjumper://open?file=...&line=...
    // ========================================
    const uriHandler = vscode.window.registerUriHandler({
        async handleUri(uri) {
            console.log('CSS to HTML Jumper: URIハンドラ受信', uri.toString());
            // cssjumper://open?file=D:/path/to/file.css&line=42
            const params = new URLSearchParams(uri.query);
            const filePath = params.get('file');
            const lineStr = params.get('line');
            if (!filePath) {
                vscode.window.showErrorMessage('ファイルパスが指定されていません');
                return;
            }
            const line = lineStr ? parseInt(lineStr, 10) - 1 : 0; // 1-indexed to 0-indexed
            try {
                const fileUri = vscode.Uri.file(filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                const editor = await vscode.window.showTextDocument(document);
                // 指定行に移動
                const position = new vscode.Position(line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                // 一瞬ハイライト
                const highlightRange = new vscode.Range(position, new vscode.Position(line, 1000));
                editor.setDecorations(jumpHighlightDecorationType, [highlightRange]);
                setTimeout(() => {
                    editor.setDecorations(jumpHighlightDecorationType, []);
                }, 800);
                console.log('CSS to HTML Jumper: ファイルを開きました', filePath, 'line', line + 1);
            }
            catch (e) {
                vscode.window.showErrorMessage(`ファイルを開けませんでした: ${filePath}`);
                console.error('CSS to HTML Jumper: ファイルを開くエラー', e);
            }
        }
    });
    context.subscriptions.push(uriHandler);
    // ========================================
    // 外部からCSSファイルが開かれた時のハイライト
    // ========================================
    let lastActiveFile = '';
    let lastHighlightTime = 0;
    const editorChangeHandler = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor)
            return;
        const doc = editor.document;
        const currentFile = doc.uri.fsPath;
        const now = Date.now();
        // CSSファイルで、前回と違うファイル、かつ1秒以内の変更（外部からの起動を検知）
        if (doc.languageId === 'css' && currentFile !== lastActiveFile) {
            // 少し遅延してからハイライト（ファイルが完全に開かれるのを待つ）
            setTimeout(() => {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.uri.fsPath === currentFile) {
                    const line = activeEditor.selection.active.line;
                    const highlightRange = new vscode.Range(line, 0, line, 1000);
                    activeEditor.setDecorations(jumpHighlightDecorationType, [highlightRange]);
                    setTimeout(() => {
                        activeEditor.setDecorations(jumpHighlightDecorationType, []);
                    }, 800);
                }
            }, 100);
        }
        lastActiveFile = currentFile;
        lastHighlightTime = now;
    });
    context.subscriptions.push(editorChangeHandler);
    // ========================================
    // CSS日本語ホバー機能
    // ========================================
    const cssHoverProvider = vscode.languages.registerHoverProvider({ scheme: 'file', language: 'css' }, {
        provideHover(document, position) {
            // カーソル位置の単語を取得
            const wordRange = document.getWordRangeAtPosition(position, /[\w-]+/);
            if (!wordRange) {
                return null;
            }
            const word = document.getText(wordRange);
            const line = document.lineAt(position.line).text;
            // CSSプロパティかどうかをチェック（プロパティ名: 値 の形式）
            const propertyMatch = line.match(new RegExp(`(^|\\s|;)${word}\\s*:`));
            if (!propertyMatch) {
                return null;
            }
            const propInfo = cssProperties_1.cssProperties[word];
            if (!propInfo) {
                return null;
            }
            // 値を取得して解析
            const valueMatch = line.match(new RegExp(`${word}\\s*:\\s*([^;]+)`));
            const value = valueMatch ? valueMatch[1].trim() : '';
            const analyzedTips = (0, cssProperties_1.analyzeValue)(word, value);
            // Markdown形式でホバーを構築
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`## 📘 ${propInfo.name}\n\n`);
            md.appendMarkdown(`${propInfo.description}\n\n`);
            if (propInfo.values && propInfo.values.length > 0) {
                md.appendMarkdown(`**📍 値の例:**\n`);
                propInfo.values.forEach(v => {
                    md.appendMarkdown(`- \`${v}\`\n`);
                });
                md.appendMarkdown('\n');
            }
            // 値の解析結果を表示
            if (analyzedTips.length > 0) {
                md.appendMarkdown(`**🔍 現在の値の解析:**\n`);
                analyzedTips.forEach(tip => {
                    md.appendMarkdown(`${tip}\n`);
                });
                md.appendMarkdown('\n');
            }
            if (propInfo.tips && propInfo.tips.length > 0) {
                md.appendMarkdown(`**💡 ヒント:**\n`);
                propInfo.tips.forEach(tip => {
                    md.appendMarkdown(`- ${tip}\n`);
                });
                md.appendMarkdown('\n');
            }
            if (propInfo.related && propInfo.related.length > 0) {
                md.appendMarkdown(`**🔗 関連:** ${propInfo.related.join(', ')}\n`);
            }
            return new vscode.Hover(md, wordRange);
        }
    });
    context.subscriptions.push(cssHoverProvider);
    // ========================================
    // CSSセレクタホバー機能（HTML使用箇所表示+ハイライト）
    // ========================================
    const htmlHighlightDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 200, 50, 0.4)',
        isWholeLine: true,
        border: '2px solid rgba(255, 150, 0, 0.8)'
    });
    // ホバー解除時にハイライトをクリアするためのタイマー
    let hoverHighlightTimer = null;
    const cssSelectorHoverProvider = vscode.languages.registerHoverProvider({ scheme: 'file', language: 'css' }, {
        async provideHover(document, position) {
            const line = document.lineAt(position.line).text;
            // セレクタ行かどうかを判定（{ の前、または行頭のセレクタ）
            // プロパティ行（: を含む）は除外
            if (line.includes(':') && !line.includes('{')) {
                // プロパティ行の可能性が高い
                const colonIndex = line.indexOf(':');
                const cursorColumn = position.character;
                // カーソルがプロパティ名部分にある場合はスキップ（cssHoverProviderに任せる）
                if (cursorColumn <= colonIndex + 10) {
                    return null;
                }
            }
            // カーソル位置のセレクタを取得
            const wordRange = document.getWordRangeAtPosition(position, /[.#]?[\w-]+/);
            if (!wordRange) {
                return null;
            }
            let selector = document.getText(wordRange);
            // セレクタのタイプと名前を判定
            let selectorType = null;
            let selectorName = '';
            if (selector.startsWith('.')) {
                selectorType = 'class';
                selectorName = selector.substring(1);
            }
            else if (selector.startsWith('#')) {
                selectorType = 'id';
                selectorName = selector.substring(1);
            }
            else {
                // プレフィックスがない場合、行の内容から判定
                if (line.includes(`.${selector}`)) {
                    selectorType = 'class';
                    selectorName = selector;
                }
                else if (line.includes(`#${selector}`)) {
                    selectorType = 'id';
                    selectorName = selector;
                }
                else if (/^[a-z]+$/i.test(selector) && (line.trim().startsWith(selector) || line.includes(` ${selector}`))) {
                    // 小文字のみでタグっぽい
                    selectorType = 'tag';
                    selectorName = selector;
                }
            }
            if (!selectorType || !selectorName) {
                return null;
            }
            // ブラウザハイライト用にセレクタ情報を保存
            currentBrowserSelector = {
                type: selectorType,
                name: selectorName,
                timestamp: Date.now()
            };
            // HTMLファイルを検索
            const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
            const targetPattern = config.get('targetFiles', '**/*.html');
            const htmlFiles = filterAutoGeneratedHtml(await vscode.workspace.findFiles(targetPattern, '**/node_modules/**'));
            if (htmlFiles.length === 0) {
                return null;
            }
            // 検索パターンを構築
            let searchPattern;
            if (selectorType === 'class') {
                searchPattern = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'gi');
            }
            else if (selectorType === 'id') {
                searchPattern = new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'gi');
            }
            else {
                searchPattern = new RegExp(`<${escapeRegex(selectorName)}[\\s>]`, 'gi');
            }
            // 検索結果
            const results = [];
            for (const fileUri of htmlFiles) {
                try {
                    const htmlDoc = await vscode.workspace.openTextDocument(fileUri);
                    const text = htmlDoc.getText();
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (searchPattern.test(lines[i])) {
                            results.push({
                                uri: fileUri,
                                line: i,
                                text: lines[i].trim().substring(0, 80)
                            });
                        }
                        searchPattern.lastIndex = 0;
                    }
                }
                catch (e) {
                    // エラー無視
                }
            }
            if (results.length === 0) {
                return null;
            }
            // 優先順位: ①画面に見えているHTML → ②CSSと同グループのHTMLタブ → ③同ディレクトリ → ④最初のマッチ
            let firstResult = results[0];
            // ①画面に見えているHTMLエディタ（分割表示中のHTML）
            const visibleHtml = vscode.window.visibleTextEditors.find(e => e.document.languageId === 'html' &&
                results.some(r => r.uri.fsPath.toLowerCase() === e.document.uri.fsPath.toLowerCase()));
            if (visibleHtml) {
                firstResult = results.find(r => r.uri.fsPath.toLowerCase() === visibleHtml.document.uri.fsPath.toLowerCase()) || firstResult;
            }
            else {
                // ②CSSエディタと同じタブグループ内のHTMLタブ（アクティブなものを優先）
                const cssEditor = vscode.window.activeTextEditor;
                if (cssEditor) {
                    const cssGroup = vscode.window.tabGroups.all.find(g => g.tabs.some(t => t.input instanceof vscode.TabInputText &&
                        t.input.uri.fsPath.toLowerCase() === cssEditor.document.uri.fsPath.toLowerCase()));
                    if (cssGroup) {
                        // 同グループ内のHTMLタブを探す
                        for (const tab of cssGroup.tabs) {
                            if (tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.toLowerCase().endsWith('.html')) {
                                const tabPath = tab.input.uri.fsPath.toLowerCase();
                                const match = results.find(r => r.uri.fsPath.toLowerCase() === tabPath);
                                if (match) {
                                    firstResult = match;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            const targetFsPath = firstResult.uri.fsPath.toLowerCase();
            try {
                // 既に開いているエディタを探す（画面に見えているタブ、パス大文字小文字無視）
                let htmlEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath.toLowerCase() === targetFsPath);
                if (!htmlEditor) {
                    // 非表示タブも含めて既に開いているか確認
                    const existingTab = vscode.window.tabGroups.all
                        .flatMap(g => g.tabs)
                        .find(tab => tab.input instanceof vscode.TabInputText &&
                        tab.input.uri.fsPath.toLowerCase() === targetFsPath);
                    // CSSエディタのviewColumnを取得
                    const cssViewColumn = vscode.window.activeTextEditor?.viewColumn;
                    if (existingTab && existingTab.group.viewColumn !== cssViewColumn) {
                        // 別グループにある → そのグループで表示（CSSは隠れない）
                        const htmlDoc = await vscode.workspace.openTextDocument(firstResult.uri);
                        htmlEditor = await vscode.window.showTextDocument(htmlDoc, {
                            viewColumn: existingTab.group.viewColumn,
                            preserveFocus: true,
                            preview: false
                        });
                    }
                    else if (existingTab) {
                        // 同じグループにある → CSSが隠れるのでスキップ（ハイライトなし）
                        return null;
                    }
                    else {
                        // 未オープン → サイドで開く
                        const htmlDoc = await vscode.workspace.openTextDocument(firstResult.uri);
                        htmlEditor = await vscode.window.showTextDocument(htmlDoc, {
                            viewColumn: vscode.ViewColumn.Beside,
                            preserveFocus: true,
                            preview: true
                        });
                    }
                }
                // 該当行にスクロール
                const targetLine = firstResult.line;
                const targetRange = new vscode.Range(targetLine, 0, targetLine, 1000);
                htmlEditor.revealRange(targetRange, vscode.TextEditorRevealType.InCenter);
                // ハイライト適用
                htmlEditor.setDecorations(htmlHighlightDecorationType, [targetRange]);
                // 前のタイマーをクリア
                if (hoverHighlightTimer) {
                    clearTimeout(hoverHighlightTimer);
                }
                // 2秒後にハイライトを消す
                hoverHighlightTimer = setTimeout(() => {
                    htmlEditor?.setDecorations(htmlHighlightDecorationType, []);
                }, 2000);
            }
            catch (e) {
                console.error('CSS to HTML Jumper: HTMLハイライトエラー', e);
            }
            // ホバー内容を構築（赤枠追加リンク）
            const md = new vscode.MarkdownString();
            md.isTrusted = true; // コマンドリンクを有効化
            const selectorDisplay = selectorType === 'class' ? `.${selectorName}` : (selectorType === 'id' ? `#${selectorName}` : selectorName);
            const args = encodeURIComponent(JSON.stringify({ line: position.line }));
            md.appendMarkdown(`[🔴 赤枠を追加](command:cssToHtmlJumper.addRedBorder?${args})\n`);
            return new vscode.Hover(md, wordRange);
        }
    });
    context.subscriptions.push(cssSelectorHoverProvider);
    // ========================================
    // JavaScript日本語ホバー機能
    // ========================================
    const jsHoverProvider = vscode.languages.registerHoverProvider({ scheme: 'file', language: 'javascript' }, {
        provideHover(document, position) {
            // ----------------------------------------
            // 1. 選択範囲のチェック
            // ----------------------------------------
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document) {
                const selection = editor.selection;
                // 選択範囲があり、かつホバー位置が選択範囲内に含まれる場合
                if (!selection.isEmpty && selection.contains(position)) {
                    const selectedText = document.getText(selection);
                    // 選択テキストからキーワードを抽出（辞書にあるものだけ）
                    const foundKeywords = [];
                    // 辞書の全キーに対してチェック（少し重いかもしれないが、キー数はそれほどではない）
                    Object.keys(jsProperties_1.jsMethods).forEach(key => {
                        // 単純検索だと "log" が "dialog" にマッチしてしまうので境界チェックが必要
                        // ただし、メソッドチェーン "console.log" のようなケースもあるため、
                        // 簡易的に "key" が含まれているかチェックし、その後誤検知を除外する
                        if (selectedText.includes(key)) {
                            // キーワードが単独で存在するか、区切り文字( . ( ) space )と隣接しているか簡易チェック
                            // 完全なパースは難しいので、実用的な範囲で判定
                            // 既に登録済みならスキップ（重複防止）
                            if (foundKeywords.includes(key))
                                return;
                            foundKeywords.push(key);
                        }
                    });
                    if (foundKeywords.length > 0) {
                        const md = new vscode.MarkdownString();
                        md.appendMarkdown(`### 🔍 選択範囲のコード解説 (${foundKeywords.length}件)\n\n---\n`);
                        foundKeywords.forEach(key => {
                            const info = jsProperties_1.jsMethods[key];
                            md.appendMarkdown(`#### 📘 ${info.name}\n`);
                            md.appendMarkdown(`${info.description}\n\n`);
                            if (info.syntax) {
                                md.appendCodeblock(info.syntax, 'javascript');
                            }
                            // 関連リンクなどがあれば簡易表示
                            if (info.related) {
                                md.appendMarkdown(`🔗 関連: ${info.related.join(', ')}\n`);
                            }
                            md.appendMarkdown(`\n---\n`);
                        });
                        return new vscode.Hover(md, selection);
                    }
                }
            }
            // ----------------------------------------
            // 2. 通常の単語ホバー（既存ロジック）
            // ----------------------------------------
            const wordRange = document.getWordRangeAtPosition(position, /[\w.]+/);
            if (!wordRange) {
                return null;
            }
            let word = document.getText(wordRange);
            // JSON.parse, JSON.stringify のような形式も対応
            if (!jsProperties_1.jsMethods[word]) {
                // ドットの後の単語だけを試す
                const lastPart = word.split('.').pop();
                if (lastPart && jsProperties_1.jsMethods[lastPart]) {
                    word = lastPart;
                }
            }
            const methodInfo = jsProperties_1.jsMethods[word];
            if (!methodInfo) {
                return null;
            }
            // Markdown形式でホバーを構築
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`## 📘 ${methodInfo.name}\n\n`);
            md.appendMarkdown(`${methodInfo.description}\n\n`);
            if (methodInfo.syntax) {
                md.appendMarkdown(`**📝 構文:**\n`);
                md.appendCodeblock(methodInfo.syntax, 'javascript');
                md.appendMarkdown('\n');
            }
            if (methodInfo.params && methodInfo.params.length > 0) {
                md.appendMarkdown(`**📥 引数:**\n`);
                methodInfo.params.forEach(p => {
                    md.appendMarkdown(`- \`${p}\`\n`);
                });
                md.appendMarkdown('\n');
            }
            if (methodInfo.returns) {
                md.appendMarkdown(`**📤 戻り値:** ${methodInfo.returns}\n\n`);
            }
            if (methodInfo.examples && methodInfo.examples.length > 0) {
                md.appendMarkdown(`**📍 例:**\n`);
                methodInfo.examples.forEach(ex => {
                    md.appendMarkdown(`- \`${ex}\`\n`);
                });
                md.appendMarkdown('\n');
            }
            if (methodInfo.tips && methodInfo.tips.length > 0) {
                md.appendMarkdown(`**💡 ヒント:**\n`);
                methodInfo.tips.forEach(tip => {
                    md.appendMarkdown(`- ${tip}\n`);
                });
                md.appendMarkdown('\n');
            }
            if (methodInfo.related && methodInfo.related.length > 0) {
                md.appendMarkdown(`**🔗 関連:** ${methodInfo.related.join(', ')}\n`);
            }
            return new vscode.Hover(md, wordRange);
        }
    });
    context.subscriptions.push(jsHoverProvider);
    context.subscriptions.push(jsHoverProvider);
    // ========================================
    // GitHub Copilot 連携 (爆速解説)
    // ========================================
    const copilotCommander = vscode.commands.registerCommand('cssToHtmlJumper.askCopilot', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('エディタを開いてください');
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text.trim()) {
            vscode.window.showWarningMessage('解説してほしいコードを選択してください');
            return;
        }
        // Copilot Chat を開くための内部コマンド
        // VS CodeのバージョンやCopilot拡張のバージョンによってIDが異なる可能性があるため、いくつか試行する
        // 基本的には 'workbench.action.chat.open' が標準的
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const customPrompt = config.get('copilotPrompt', 'このコードの目的を簡潔に説明して');
        const prompt = `${customPrompt}\n\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``;
        try {
            // Chatを開く (クエリを渡す)
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
        }
        catch (e) {
            console.error('Copilot Chat open failed', e);
            try {
                // フォールバック: 単にチャットを開くだけ試す
                await vscode.commands.executeCommand('workbench.action.chat.open');
                vscode.window.showInformationMessage('Copilot Chatが開きました。プロンプトを手動で入力してください。');
            }
            catch (e2) {
                vscode.window.showErrorMessage('GitHub Copilot Chat を開けませんでした。拡張機能がインストール・有効化されているか確認してください。');
            }
        }
    });
    context.subscriptions.push(copilotCommander);
    // ========================================
    // Claude AI 質問機能
    // ========================================
    const claudeOutputChannel = vscode.window.createOutputChannel('Claude AI');
    const presetQuestions = [
        { label: '🔧 改善して', prompt: `このコードを改善してください。

【重要な制約】
- シンプルに保つ（HTMLタグをむやみに増やさない）
- タグ名をクラス名に使わない（例: .div, .span は禁止）
- 今の実装をできるだけ活かす（大幅な書き換えは避ける）
- 必要最小限の変更に留める
- クラス名はハイフン(-)ではなくアンダースコア(_)で区切る
- 既存のクラス名の命名規則を踏襲する

【出力形式】
1. 変更した行の右側に短いコメントで変更内容を記載する
   - 例: button#hamburger_btn { /* div→button */
   - 例: <nav class="side_sns"> <!-- div→nav -->
   - 変更のない行にはコメント不要
2. コードの後に「# 主な変更点」としてまとめも記載する`, showBeside: true },
        { label: '🐛 バグチェック', prompt: 'このコードにバグや問題点がないかチェックしてください。', showBeside: true },
        { label: '📖 説明して', prompt: `このコードが何をしているか説明してください。

【重要な制約】
- コメント記号（/* */ や <!-- -->）は絶対に使わない
- コード例を示す場合はバッククォート（\`code\`）を使う
- 説明文のみ出力する
- 見出しは ## で始める`, showBeside: false, model: 'gemini' },
        { label: '🎨 SVGで図解', prompt: `このコードの動作や構造をSVGで図解してください。

【重要な制約】
- できるだけわかりやすく、シンプルな図にする
- 日本語でラベルを付ける
- 色を使って区別をつける
- 矢印やボックスで関係性を示す
- SVGコードのみ出力（説明文は不要）
- 必ず </svg> で終わること`, showBeside: false },
        // { label: '🎨 SVGで図解 (Gemini)', prompt: `このコードの動作や構造をSVGで図解してください。
        // 【重要な制約】
        // - できるだけわかりやすく、シンプルな図にする
        // - 日本語でラベルを付ける
        // - 色を使って区別をつける
        // - 矢印やボックスで関係性を示す
        // - SVGコードのみ出力（説明文は不要）
        // - 必ず </svg> で終わること`, showBeside: false, model: 'gemini' },
        { label: '📝 CSSスケルトン生成', prompt: `以下のHTMLからclass名とid名を抽出し、CSSスケルトン（空のルールセット）を生成してください。

【重要な制約】
- HTMLに含まれるclass名・id名のみ抽出する
- class名は . 、id名は # をつける
- 中身は空（プロパティなし）
- HTML構造の順番通りに出力する
- HTMLコメント（<!-- xxx -->）はそのままCSSコメント（/* xxx */）として同じ位置に出力する
- コメントの文言は一切変更しない（HTMLに書いてあるものと完全に同じ）
- クラス名はそのまま使う（変更しない）
- 説明文は不要、CSSコードのみ出力`, showBeside: false },
        { label: '🏗 HTML構造改善', prompt: `このHTMLの指定セクションの構造をセマンティックに改善してください。

【重要な制約】
- セマンティックHTMLを使う（<ul><li>は本当のリストのみ）
- リストでない内容に<ul><li>を使っている場合は<div>等に変更する
- 用途に合ったタグに変更（住所→<address>、ナビ→<nav>等）
- CSSワークアラウンド（list-style:none等）ではなくタグ自体を変更する
- クラス名はアンダースコア(_)区切り、既存命名規則を踏襲
- 不要なwrapper divは削除
- position: fixedは親1箇所のみ、子はabsolute
- ★マーカーで囲まれた範囲を重点的に改善し、その範囲の改善コードのみ出力する

【出力形式】
1. ★マーカー範囲の改善後HTML（変更行の右側に短いコメント）
   - 例: <address class="footer_address"> <!-- ul→address -->
   - 例: <div class="access_by_detail"> <!-- li→div: リストではない -->
   - 変更のない行にはコメント不要
2. CSS変更点（追加・変更・削除が必要なルール）
   - 不要になったルール（例: list-style:none）は「削除」と明記
   - 新タグに必要なリセットCSSがあれば追記
3. 「# 主な変更点」としてまとめ`, showBeside: true },
        { label: '🎨 見やすいHTML生成', prompt: `選択内容から簡潔で見やすいHTMLを生成。

【必須】
- 完全HTML（<!DOCTYPE>〜、<style>内蔵）
- 配色: #5A8FC4系、背景#EBF1F6
- SVG図解1-2個のみ（核心のみ）
- コードブロック: #2d2d2d、コピーボタン
- フォント游ゴシック、max-width: 900px
- 簡潔に（冗長な説明・重複図・詳細表は削除）
- HTMLの特徴的なクラス名をそのまま使用し、画面の構造をHTMLで表現してください
- 元のHTMLのクラス名・ID名を活かしたリアルな見た目にしてください

【アニメーション】
- 二層構造・フロー図など理解を助ける場合のみシンプルなCSSアニメーション追加OK
- 例: Parallax構造説明→背景固定・前景スクロールの動き
- 過度な装飾は禁止

【禁止】タブ・アコーディオン

【出力】HTMLコードのみ`, showBeside: true },
        { label: '🎬 HTML動画を生成', prompt: `選択内容のCSS/HTML概念を、実際のブラウザ挙動を正確に再現するインタラクティブなデモHTMLとして作成してください。

【最重要：正確な挙動の再現】
- scaleXやscaleYなど見た目だけの変形で「それっぽく」見せるのは禁止
- 実際のCSSプロパティが実際にどう動作するかを、そのプロパティ自体を使って再現すること
- 例: min-widthの説明 → 実際にコンテナ幅を変えてmin-widthの効果を見せる（scaleXで縮小するのはNG）
- 例: flexboxの説明 → 実際にflex-grow/shrinkが動作する状態を見せる
- 例: overflowの説明 → 実際にコンテンツが溢れる/溢れない状態を見せる

【インタラクション方式（優先順位）】
1. ユーザー操作型: スライダー、ボタン、ドラッグでリアルタイムに値を変えて確認できる
2. ステップ再生型: 「再生」ボタンで段階的に変化を見せる（各ステップに説明テキスト付き）
3. 自動アニメ型: 上記が難しい場合のみ。ただし実際のプロパティ値をJSで変更すること（CSS animationでの視覚トリック禁止）

【必須】
- 完全HTML（<!DOCTYPE>〜、<style>内蔵、JavaScript内蔵）
- 日本語ラベル・説明付き
- 立体感のある見た目（box-shadow、transform、perspective等）
- 配色は見やすく美しいもの
- 元のHTMLのクラス名・ID名をそのまま使用
- 変化中の現在値をリアルタイム表示（例: "width: 250px" のように数値が動的に変わる）
- ビフォー/アフターが一目で比較できるレイアウト

【ビフォー/アフター比較の鉄則】
- 「問題あり」と「解決済み」を並べて見せる場合、問題側は本当に問題が起きている状態にすること
- 問題を隠すCSS（overflow: hidden等）を問題側に付けてはいけない。問題側はコンテンツがはみ出す・崩れる等の実際の問題が目に見える状態にすること
- 操作（スライダー等）で値を変えた時、左右で明確に異なる挙動が見えなければデモとして失敗
- 問題側と解決側の「違いが一目でわかる」ことが最優先

【禁止】
- CSSアニメーション（@keyframes）で実際の挙動と異なる動きをさせること
- 見た目だけの装飾アニメーション（pulse、float、bounce等の無意味な動き）
- transformで挙動をごまかすこと
- 問題側にoverflow:hiddenなど問題を隠すプロパティを付けること

【出力】HTMLコードのみ`, showBeside: false }
    ];
    const claudeCommand = vscode.commands.registerCommand('cssToHtmlJumper.askClaude', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('エディタを開いてください');
            return;
        }
        const selection = editor.selection;
        const code = editor.document.getText(selection).trim();
        // Step 1: CSS/JSプロパティサジェスト付きQuickPickで入力
        // CSS辞書（description付き）
        const cssItems = Object.keys(cssProperties_1.cssProperties).map(k => ({
            label: k, description: cssProperties_1.cssProperties[k].description
        }));
        // 辞書にない追加CSSプロパティ
        const extraCssProps = [
            'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
            'border-style', 'border-color', 'border-width',
            'font-family', 'font-weight', 'font-style',
            'text-decoration', 'text-align', 'text-transform', 'text-indent',
            'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'text-overflow',
            'list-style', 'list-style-type', 'list-style-image',
            'cursor', 'visibility', 'pointer-events', 'user-select', 'resize',
            'clip-path', 'filter', 'backdrop-filter', 'mix-blend-mode',
            'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
            'animation-delay', 'animation-iteration-count', 'animation-fill-mode', 'animation-direction',
            'flex', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
            'grid', 'grid-template-rows', 'grid-template-areas', 'grid-column', 'grid-row',
            'align-content', 'align-self', 'justify-self', 'justify-items', 'place-items', 'place-content',
            'column-gap', 'row-gap',
            'min-height', 'min-width', 'max-height',
            'aspect-ratio',
            'outline', 'outline-offset', 'outline-color', 'outline-style', 'outline-width',
            'box-shadow', 'text-shadow',
            'float', 'clear', 'vertical-align',
            'counter-reset', 'counter-increment', 'content',
            'scroll-behavior', 'scroll-snap-type', 'will-change',
            'columns', 'column-count', 'column-width'
        ].filter(p => !cssProperties_1.cssProperties[p]);
        const extraCssItems = extraCssProps.map(p => ({ label: p, description: 'CSS' }));
        // JS辞書（description付き）
        const jsItems = Object.keys(jsProperties_1.jsMethods).map(k => ({
            label: k, description: jsProperties_1.jsMethods[k].description
        }));
        const allSuggestItems = [...cssItems, ...extraCssItems, ...jsItems];
        // QuickPick1本で完結：最後の単語で候補表示 → Enter で単語置き換え → 候補なし状態でEnter → 確定
        const userInput = await new Promise((resolve) => {
            const qp = vscode.window.createQuickPick();
            qp.placeholder = 'b→background Enter, i→image Enter, の違いを教えて Enter で質問';
            qp.items = [];
            qp.onDidChangeValue(value => {
                const lastWord = value.split(/[\s　]+/).pop()?.toLowerCase() || '';
                if (!lastWord || lastWord.length < 1) {
                    qp.items = [];
                    return;
                }
                const starts = allSuggestItems.filter(i => i.label.toLowerCase().startsWith(lastWord));
                const contains = allSuggestItems.filter(i => !i.label.toLowerCase().startsWith(lastWord) && i.label.toLowerCase().includes(lastWord));
                qp.items = [...starts, ...contains];
            });
            let accepted = false;
            qp.onDidAccept(() => {
                const sel = qp.selectedItems[0];
                if (sel && qp.items.length > 0) {
                    // 候補あり → 最後の単語を選択テキストで置き換え
                    const parts = qp.value.split(/[\s　]+/);
                    parts[parts.length - 1] = sel.label;
                    qp.value = parts.join(' ') + ' ';
                    qp.items = [];
                }
                else {
                    // 候補なし → 確定
                    accepted = true;
                    resolve(qp.value.trim() || '');
                    qp.hide();
                }
            });
            qp.onDidHide(() => { qp.dispose(); if (!accepted) {
                resolve(undefined);
            } });
            qp.show();
        });
        if (userInput === undefined) {
            return; // キャンセル
        }
        // Step 2: プリセット選択
        // 入力ありの場合は「直接質問」を先頭に追加
        const presetItems = [...presetQuestions];
        if (userInput.trim()) {
            presetItems.unshift({ label: '💬 直接質問', prompt: '', showBeside: false });
        }
        const result = await new Promise((resolve) => {
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = presetItems;
            quickPick.placeholder = userInput.trim() ? 'プリセットを選択（💬直接質問=プリセットなし）' : 'プリセットを選択';
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                if (selected && selected.label.includes('直接質問')) {
                    // 直接質問: 選択範囲 + userInput のみ送信
                    const directQuestion = code
                        ? `【選択テキスト】\n${code}\n\n【質問】\n${userInput.trim()}`
                        : userInput.trim();
                    resolve({
                        question: directQuestion,
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: true,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: false
                    });
                }
                else if (selected && selected.label.includes('セクション質問')) {
                    // セクション質問: プリセットプロンプト + ユーザー質問
                    const finalQuestion = userInput.trim()
                        ? `${selected.prompt}\n\n【質問】\n${userInput.trim()}`
                        : selected.prompt;
                    resolve({
                        question: finalQuestion,
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: false,
                        isSectionQuestion: true,
                        showBeside: true,
                        useGemini: false
                    });
                }
                else if (selected && selected.label.includes('メモ検索')) {
                    resolve({
                        question: '',
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: true,
                        isQuiz: false,
                        isFreeQuestion: false,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: false
                    });
                }
                else if (selected && selected.label.includes('クイズ')) {
                    resolve({
                        question: '',
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: true,
                        isFreeQuestion: false,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: false
                    });
                }
                else if (selected && selected.prompt) {
                    // プリセット選択 + userInput
                    let finalQuestion = selected.prompt;
                    const isSkeleton = selected.label.includes('スケルトン');
                    const isStructural = selected.label.includes('構造改善');
                    const isHtmlGeneration = selected.label.includes('HTML生成') || selected.label.includes('HTML動画');
                    if (userInput.trim() && code && !isSkeleton && !isStructural) {
                        // 入力あり + 選択範囲あり
                        if (isHtmlGeneration) {
                            // HTML生成: 追加指示として反映
                            finalQuestion = `${selected.prompt}\n\n【追加指示】\n${userInput.trim()}\n\n【選択内容】\n${code}`;
                        }
                        else {
                            // 他プリセット: 踏み込んだ質問形式
                            finalQuestion = `以下のコード内の \`${userInput.trim()}\` について${selected.label.replace(/[📖🎨🔧🐛]/g, '').trim()}ください。\n\n【コード全体】\n${code}`;
                        }
                    }
                    else if (userInput.trim() && isHtmlGeneration && !code) {
                        // HTML生成 + 入力のみ（選択範囲なし）
                        finalQuestion = `${selected.prompt}\n\n【追加指示】\n${userInput.trim()}`;
                    }
                    // 説明して + 選択あり → 選択部分を「注目箇所」として付加
                    const isExplainPreset = selected.label.includes('説明して');
                    if (isExplainPreset && code.trim() && !userInput.trim()) {
                        finalQuestion = `${selected.prompt}\n\n【注目箇所（ここを中心に説明）】\n\`\`\`\n${code}\n\`\`\``;
                    }
                    // スケルトン・構造改善は入力無視、元のプリセットプロンプトのみ使用
                    resolve({
                        question: finalQuestion,
                        isSvg: selected.label.includes('SVG'),
                        isSkeleton: isSkeleton,
                        isStructural: isStructural,
                        isHtmlGeneration: isHtmlGeneration,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: false,
                        isSectionQuestion: false,
                        showBeside: selected.showBeside,
                        useGemini: selected.model === 'gemini' // Geminiモデルを使用するか
                    });
                }
                else {
                    resolve(undefined);
                }
                quickPick.hide();
            });
            quickPick.onDidHide(() => {
                resolve(undefined);
                quickPick.dispose();
            });
            quickPick.show();
        });
        if (!result) {
            return; // キャンセル
        }
        let { question, isSvg, isSkeleton, isStructural, isHtmlGeneration, isMemoSearch, isQuiz, isFreeQuestion, isSectionQuestion, showBeside, useGemini } = result;
        // HTML生成系プリセット + HTMLファイルで選択 → 関連CSSを自動添付
        if (isHtmlGeneration && code && editor.document.languageId === 'html') {
            try {
                const cssFilePaths = await findLinkedCssFiles(editor.document);
                const cssContents = [];
                for (const cssPath of cssFilePaths) {
                    try {
                        const cssDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(cssPath));
                        cssContents.push(`/* === ${path.basename(cssPath)} === */\n${cssDoc.getText()}`);
                    }
                    catch (e) {
                        // CSS読み込みエラーは無視
                    }
                }
                if (cssContents.length > 0) {
                    question += `\n\n【関連CSS（このHTMLに適用されているスタイル）】\n${cssContents.join('\n\n')}`;
                }
            }
            catch (e) {
                // CSS取得失敗時は無視（CSSなしで続行）
            }
        }
        // プログレス表示
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '✨ Claude AIに質問中...',
            cancellable: false
        }, async () => {
            try {
                // コンテキスト収集
                let htmlContext = '';
                let codeToSend = code;
                // CSS/HTMLファイル: セクション全体を自動添付（3段階フォールバック）
                // 特殊プリセット（セクション質問・構造改善・スケルトン・クイズ等）は除外
                const langId = editor.document.languageId;
                const skipSectionEnrich = isSectionQuestion || isStructural || isSkeleton || isMemoSearch || isQuiz || isHtmlGeneration;
                if ((langId === 'css' || langId === 'html') && !skipSectionEnrich) {
                    try {
                        if (langId === 'css') {
                            const sectionRange = getCurrentSectionRange(editor);
                            if (sectionRange) {
                                const cssSection = editor.document.getText(new vscode.Range(new vscode.Position(sectionRange.start, 0), new vscode.Position(sectionRange.end + 1, 0)));
                                let htmlSection = '';
                                const htmlDocs = await findLinkedHtmlFiles(editor.document);
                                // Stage 1: セクション名一致
                                for (const htmlDoc of htmlDocs) {
                                    const match = findHtmlBoxSectionByName(htmlDoc.getText().split('\n'), sectionRange.sectionName);
                                    if (match) {
                                        htmlSection = match;
                                        break;
                                    }
                                }
                                // Stage 2: セレクタでHTML内セクションを検索
                                if (!htmlSection) {
                                    const selectors = extractSelectorsFromCss(cssSection);
                                    for (const htmlDoc of htmlDocs) {
                                        const htmlLines = htmlDoc.getText().split('\n');
                                        outer: for (const sel of selectors) {
                                            const searchStr = sel.startsWith('.') ? sel.slice(1) : sel.slice(1);
                                            for (let li = 0; li < htmlLines.length; li++) {
                                                if (!htmlLines[li].includes(searchStr)) {
                                                    continue;
                                                }
                                                for (let j = li; j >= 0; j--) {
                                                    if (htmlLines[j].search(/[┌]/) >= 0) {
                                                        let end = htmlLines.length - 1;
                                                        for (let k = j + 1; k < htmlLines.length; k++) {
                                                            if (htmlLines[k].search(/[┌]/) >= 0) {
                                                                end = k - 1;
                                                                break;
                                                            }
                                                        }
                                                        htmlSection = htmlLines.slice(j, end + 1).join('\n');
                                                        break outer;
                                                    }
                                                    const tagMatch = htmlLines[j].match(/^\s*<(header|section|footer)\b/);
                                                    if (tagMatch) {
                                                        const endLine = findSectionEnd(htmlLines, j);
                                                        htmlSection = htmlLines.slice(j, endLine + 1).join('\n');
                                                        break outer;
                                                    }
                                                }
                                            }
                                        }
                                        if (htmlSection) {
                                            break;
                                        }
                                    }
                                }
                                // Stage 3: CSSセクションのみ
                                codeToSend = `【CSSセクション: ${sectionRange.sectionName}】\n${cssSection}`;
                                if (htmlSection) {
                                    codeToSend += `\n\n【対応HTMLセクション】\n${htmlSection}`;
                                }
                            }
                        }
                        else if (langId === 'html') {
                            let htmlSectionText = '';
                            let htmlSectionName = '';
                            // 罫線ボックス形式のセクション優先
                            const boxRange = getCurrentSectionRange(editor);
                            if (boxRange) {
                                const lines = editor.document.getText().split('\n');
                                htmlSectionText = lines.slice(boxRange.start, boxRange.end + 1).join('\n');
                                htmlSectionName = boxRange.sectionName;
                            }
                            else {
                                // <header>/<section>/<footer> タグでフォールバック
                                const cursorLine = editor.selection.active.line;
                                const htmlLines = editor.document.getText().split('\n');
                                const sections = detectHtmlSections(editor.document);
                                for (let i = sections.length - 1; i >= 0; i--) {
                                    if (sections[i].line <= cursorLine) {
                                        const endLine = findSectionEnd(htmlLines, sections[i].line);
                                        if (cursorLine <= endLine) {
                                            htmlSectionText = htmlLines.slice(sections[i].line, endLine + 1).join('\n');
                                            htmlSectionName = sections[i].label.replace(/^[🔝📦🔚]\s*/, '');
                                            break;
                                        }
                                    }
                                }
                            }
                            if (htmlSectionText) {
                                let cssSection = '';
                                const cssFilePaths = await findLinkedCssFiles(editor.document);
                                for (const cssPath of cssFilePaths) {
                                    try {
                                        const cssDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(cssPath));
                                        // Stage 1: セクション名一致
                                        const match = findCssSectionByName(cssDoc, htmlSectionName);
                                        if (match) {
                                            cssSection = match;
                                            break;
                                        }
                                    }
                                    catch (e) { /* 無視 */ }
                                }
                                // Stage 2: HTMLのクラス/IDでCSS検索
                                if (!cssSection) {
                                    const classSelectors = [...htmlSectionText.matchAll(/class="([^"]+)"/g)]
                                        .flatMap(m => m[1].split(/\s+/).map(c => '.' + c));
                                    const idSelectors = [...htmlSectionText.matchAll(/id="([^"]+)"/g)]
                                        .map(m => '#' + m[1]);
                                    const selectors = [...classSelectors, ...idSelectors];
                                    for (const cssPath of cssFilePaths) {
                                        try {
                                            const cssDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(cssPath));
                                            const match = findCssSectionBySelectors(cssDoc, selectors);
                                            if (match) {
                                                cssSection = match;
                                                break;
                                            }
                                        }
                                        catch (e) { /* 無視 */ }
                                    }
                                }
                                codeToSend = `【HTMLセクション: ${htmlSectionName}】\n${htmlSectionText}`;
                                if (cssSection) {
                                    codeToSend += `\n\n【対応CSSセクション】\n${cssSection}`;
                                }
                            }
                        }
                        // その他（md等）: codeToSend = code のまま（選択行のみ）
                    }
                    catch (e) {
                        console.error('[SectionContext] エラー:', e);
                        // エラー時は選択行のみで続行
                    }
                }
                if (isSectionQuestion) {
                    // セクション質問: カーソル位置のセクション全体を送信
                    const sectionRange = getCurrentSectionRange(editor);
                    if (!sectionRange) {
                        vscode.window.showWarningMessage('セクションが見つかりません。カーソルを罫線ボックスコメント内に配置してください。');
                        return;
                    }
                    // セクション範囲のテキストを取得
                    const sectionText = editor.document.getText(new vscode.Range(new vscode.Position(sectionRange.start, 0), new vscode.Position(sectionRange.end + 1, 0)));
                    codeToSend = `【セクション名】: ${sectionRange.sectionName}\n\n${sectionText}`;
                    // HTMLファイルの場合、リンクされたCSSファイル全体を取得
                    if (editor.document.languageId === 'html') {
                        const cssFilePaths = await findLinkedCssFiles(editor.document);
                        const cssContents = [];
                        for (const cssPath of cssFilePaths) {
                            try {
                                const cssUri = vscode.Uri.file(cssPath);
                                const cssDoc = await vscode.workspace.openTextDocument(cssUri);
                                const fileName = path.basename(cssPath);
                                cssContents.push(`/* ${fileName} */\n${cssDoc.getText()}`);
                            }
                            catch (e) {
                                console.error(`CSS読み込みエラー: ${cssPath}`, e);
                            }
                        }
                        if (cssContents.length > 0) {
                            htmlContext = cssContents.join('\n\n');
                        }
                    }
                }
                else if (isQuiz) {
                    // クイズ処理
                    return; // 一旦プログレスを終了してクイズ処理へ
                }
                else if (isStructural) {
                    // HTML構造改善: 選択範囲 or セクション選択 + 全体送信 + CSS
                    if (editor.document.languageId !== 'html') {
                        vscode.window.showWarningMessage('HTML構造改善はHTMLファイルで使用してください');
                        return;
                    }
                    const fullHtml = editor.document.getText();
                    // 選択範囲があればそのまま使用、なければセクション選択QuickPick
                    if (code) {
                        // 選択範囲あり → QuickPickスキップ、選択範囲に★マーカー
                        const beforeSelection = editor.document.getText(new vscode.Range(new vscode.Position(0, 0), selection.start));
                        const afterSelection = editor.document.getText(new vscode.Range(selection.end, new vscode.Position(editor.document.lineCount, 0)));
                        codeToSend = beforeSelection
                            + '<!-- ★改善対象ここから -->\n'
                            + code
                            + '\n<!-- ★改善対象ここまで -->'
                            + afterSelection;
                    }
                    else {
                        // 選択範囲なし → セクション選択QuickPick
                        const detectedSections = detectHtmlSections(editor.document);
                        const sectionItems = [
                            { label: '📄 ファイル全体', description: '', line: -1 },
                            ...detectedSections.map(s => ({
                                label: s.label,
                                description: `行 ${s.line + 1}`,
                                line: s.line
                            }))
                        ];
                        const selectedSection = await vscode.window.showQuickPick(sectionItems, {
                            placeHolder: '改善対象のセクションを選択'
                        });
                        if (!selectedSection) {
                            return;
                        }
                        if (selectedSection.line === -1) {
                            codeToSend = fullHtml;
                        }
                        else {
                            const lines = fullHtml.split('\n');
                            const sectionLine = selectedSection.line;
                            const before = lines.slice(0, sectionLine).join('\n');
                            const endLine = findSectionEnd(lines, sectionLine);
                            const sectionContent = lines.slice(sectionLine, endLine + 1).join('\n');
                            const after = lines.slice(endLine + 1).join('\n');
                            codeToSend = before + '\n<!-- ★改善対象ここから -->\n'
                                + sectionContent
                                + '\n<!-- ★改善対象ここまで -->\n' + after;
                        }
                    }
                    // リンクされたCSSファイルから、選択範囲のクラス/IDに関連するルールのみ抽出
                    const cssFiles = await findLinkedCssFiles(editor.document);
                    const targetHtml = code || codeToSend; // 選択範囲 or ★マーカー付き全体
                    const cssContent = await extractRelatedCssRules(targetHtml, cssFiles);
                    htmlContext = cssContent;
                }
                else if (isMemoSearch) {
                    // メモ検索処理
                    return; // 一旦プログレスを終了してメモ検索処理へ
                }
                else if (isFreeQuestion) {
                    // 自由質問: コンテキスト収集不要
                    codeToSend = '';
                    htmlContext = '';
                }
                else if (editor.document.languageId === 'css') {
                    // まず選択範囲からセレクタを探す
                    let selectors = code ? extractSelectorsFromCSS(code) : [];
                    // 選択範囲にセレクタがない場合、親のCSSルールからセレクタを検出
                    if (selectors.length === 0) {
                        const parentInfo = findParentSelector(editor.document, selection.start);
                        selectors = parentInfo.selectors;
                        // 選択範囲が空または親ルール全体を含まない場合、親ルール全体を使用
                        if (!code && parentInfo.fullRule) {
                            codeToSend = parentInfo.fullRule;
                        }
                        else if (code && parentInfo.selectorText) {
                            // セレクタ情報を追加
                            codeToSend = `/* セレクタ: ${parentInfo.selectorText} */\n${code}`;
                        }
                    }
                    if (selectors.length > 0) {
                        htmlContext = await findHtmlUsage(selectors);
                    }
                }
                // デバッグ: 送信プロンプト確認
                console.log('=== 📤 送信プロンプト ===');
                console.log(question);
                console.log('====================');
                // モデルに応じてAPI呼び出しを切り替え
                const answer = useGemini
                    ? await askGeminiAPI(codeToSend, question, htmlContext || undefined, isStructural)
                    : await askClaudeAPI(codeToSend, question, htmlContext || undefined, isStructural, isHtmlGeneration, isSectionQuestion);
                // コードブロック（```css など）を削除
                const cleanAnswer = answer
                    .replace(/```[\w]*\n?/g, '') // ```css, ```html 等を削除
                    .replace(/```/g, '') // 残りの ``` を削除
                    .trim();
                if (isSkeleton) {
                    // スケルトン生成：リンク先CSSファイルに追記
                    const cssFiles = await findLinkedCssFiles(editor.document);
                    if (cssFiles.length === 0) {
                        // CSSファイルが見つからない場合は右側に表示
                        const doc = await vscode.workspace.openTextDocument({
                            content: cleanAnswer,
                            language: 'css'
                        });
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
                    }
                    else {
                        // CSS選択（複数ある場合）
                        let targetCssPath;
                        if (cssFiles.length > 1) {
                            const items = cssFiles.map(f => ({
                                label: path.basename(f),
                                description: f,
                                path: f
                            }));
                            const selected = await vscode.window.showQuickPick(items, {
                                placeHolder: 'CSSファイルを選択'
                            });
                            if (!selected) {
                                return;
                            }
                            targetCssPath = selected.path;
                        }
                        else {
                            targetCssPath = cssFiles[0];
                        }
                        // CSSファイルを開いて末尾に追記
                        const cssUri = vscode.Uri.file(targetCssPath);
                        const cssDoc = await vscode.workspace.openTextDocument(cssUri);
                        const cssEditor = await vscode.window.showTextDocument(cssDoc, vscode.ViewColumn.Beside);
                        const lastLine = cssDoc.lineCount - 1;
                        const lastLineText = cssDoc.lineAt(lastLine).text;
                        const insertPosition = new vscode.Position(lastLine, lastLineText.length);
                        await cssEditor.edit(editBuilder => {
                            editBuilder.insert(insertPosition, `\n${cleanAnswer}\n`);
                        });
                        vscode.window.showInformationMessage(`✅ CSSスケルトンを ${path.basename(targetCssPath)} に追加しました`);
                    }
                }
                else if (isHtmlGeneration) {
                    // HTML生成：クリップボードにコピーのみ（タブ表示なし）
                    await vscode.env.clipboard.writeText(cleanAnswer);
                    vscode.window.showInformationMessage('✅ HTMLをクリップボードにコピーしました');
                }
                else if (isSvg) {
                    // SVG図解：<svg>～</svg>を抽出してクリップボードにコピーのみ
                    const svgMatch = cleanAnswer.match(/<svg[\s\S]*<\/svg>/i);
                    const svgCode = svgMatch ? svgMatch[0] : cleanAnswer;
                    await vscode.env.clipboard.writeText(svgCode);
                    vscode.window.showInformationMessage('✅ SVGをクリップボードにコピーしました');
                }
                else if (showBeside) {
                    // 改善・バグチェック：右側に新しいドキュメントを開く
                    const doc = await vscode.workspace.openTextDocument({
                        content: `✨ Claude AI 回答\n${'='.repeat(40)}\n\n${cleanAnswer}`,
                        language: editor.document.languageId
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
                }
                else {
                    // 説明：コメントとして挿入
                    const endPosition = selection.end;
                    const insertPosition = new vscode.Position(endPosition.line, editor.document.lineAt(endPosition.line).text.length);
                    const lang = editor.document.languageId;
                    let insertText;
                    if (lang === 'html') {
                        insertText = `\n<!-- ✨\n${cleanAnswer}\n-->\n`;
                    }
                    else {
                        insertText = `\n/* ✨\n${cleanAnswer}\n*/\n`;
                    }
                    await editor.edit(editBuilder => {
                        editBuilder.insert(insertPosition, insertText);
                    });
                }
            }
            catch (e) {
                vscode.window.showErrorMessage(`Claude API エラー: ${e.message}`);
            }
        });
        // メモ検索処理（withProgress外で実行）
        if (isMemoSearch) {
            await handleMemoSearch();
        }
        if (isQuiz) {
            await handleQuiz();
        }
    });
    context.subscriptions.push(claudeCommand);
    // ========================================
    // メモ検索専用コマンド
    // ========================================
    const searchMemoCommand = vscode.commands.registerCommand('cssToHtmlJumper.searchMemo', async () => {
        await handleMemoSearch();
    });
    context.subscriptions.push(searchMemoCommand);
    // ========================================
    // メモ検索結果 Ctrl+Shift+↓/↑ で切り替え
    // ========================================
    const jumpToMemoResult = async (delta) => {
        if (lastMemoResults.length === 0) {
            vscode.window.showInformationMessage('メモ検索結果がありません（先にCtrl+Enterで検索してください）');
            return;
        }
        lastMemoResultIndex = (lastMemoResultIndex + delta + lastMemoResults.length) % lastMemoResults.length;
        const result = lastMemoResults[lastMemoResultIndex];
        const memoUri = vscode.Uri.file(result.memoFilePath);
        const memoDoc = await vscode.workspace.openTextDocument(memoUri);
        const editor = await vscode.window.showTextDocument(memoDoc);
        const position = new vscode.Position(result.line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        const highlight = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.35)',
            isWholeLine: true
        });
        editor.setDecorations(highlight, [new vscode.Range(position, position)]);
        setTimeout(() => highlight.dispose(), 3000);
        vscode.window.setStatusBarMessage(`📝 検索結果 ${lastMemoResultIndex + 1}/${lastMemoResults.length}: ${result.keyword}`, 3000);
    };
    context.subscriptions.push(vscode.commands.registerCommand('cssToHtmlJumper.nextMemoResult', () => jumpToMemoResult(1)), vscode.commands.registerCommand('cssToHtmlJumper.prevMemoResult', () => jumpToMemoResult(-1)));
    // ========================================
    // クイズコマンド
    // ========================================
    const quizCommand = vscode.commands.registerCommand('cssToHtmlJumper.quiz', async () => {
        await handleQuiz();
    });
    context.subscriptions.push(quizCommand);
    // ========================================
    // クイズ評価コマンド（ステータスバーから呼び出し）
    // ========================================
    const evaluateLastQuizCommand = vscode.commands.registerCommand('cssToHtmlJumper.evaluateLastQuiz', async () => {
        if (!pendingQuizEvaluation) {
            vscode.window.showWarningMessage('評価待ちのクイズがありません');
            return;
        }
        // 評価QuickPick表示
        const hasFactCheckError = pendingQuizEvaluation.claudeAnswer?.includes('⚠ ファクトチェック') ?? false;
        const afterAnswer = await showEvaluationQuickPick(hasFactCheckError);
        if (!afterAnswer) {
            // キャンセル → ステータスバー再表示
            showEvaluationStatusBar();
            return;
        }
        if (afterAnswer.action === 'exit') {
            // 終了 → 評価待ちクリア
            hideEvaluationStatusBar();
            return;
        }
        if (afterAnswer.action === 'correct') {
            await correctMemo();
            return;
        }
        // 評価あり → 処理実行
        if (afterAnswer.eval) {
            await processEvaluation(afterAnswer);
        }
    });
    context.subscriptions.push(evaluateLastQuizCommand);
    // ========================================
    // クイズ回答ファイル保存時の評価確認（無効化）
    // ========================================
    // ユーザー要望により保存時の評価促進メッセージを無効化
    // ========================================
    // クイズカテゴリ変更コマンド
    // ========================================
    const changeQuizCategoryCommand = vscode.commands.registerCommand('cssToHtmlJumper.changeQuizCategory', async () => {
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const memoFilePath = config.get('memoFilePath', '');
        if (!memoFilePath) {
            vscode.window.showErrorMessage('メモファイルパスが設定されていません');
            return;
        }
        try {
            // メモファイルからカテゴリ抽出
            const memoUri = vscode.Uri.file(memoFilePath);
            const memoDoc = await vscode.workspace.openTextDocument(memoUri);
            const memoContent = memoDoc.getText();
            const lines = memoContent.split('\n');
            const categories = new Set();
            categories.add('全て');
            // 登録カテゴリリスト取得
            const categoryList = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML']);
            for (const line of lines) {
                const match = line.match(/^##\s+(.+)/);
                if (match) {
                    const fullTitle = match[1].trim();
                    const titleParts = fullTitle.split(/[\s　]+/); // 半角\sと全角
                    if (titleParts.length >= 2) {
                        const lastWord = titleParts[titleParts.length - 1];
                        const matchedCategory = categoryList.find(cat => cat.toLowerCase() === lastWord.toLowerCase());
                        if (matchedCategory) {
                            categories.add(matchedCategory); // 登録済みカテゴリ名で統一
                        }
                    }
                }
            }
            // QuickPickで選択
            const selected = await vscode.window.showQuickPick(Array.from(categories), {
                placeHolder: '出題するカテゴリを選択'
            });
            if (selected) {
                await config.update('quizCategory', selected, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`✅ クイズカテゴリ: ${selected}`);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`カテゴリ変更エラー: ${e.message}`);
        }
    });
    context.subscriptions.push(changeQuizCategoryCommand);
    // ========================================
    // 赤枠追加コマンド
    // ========================================
    const addRedBorderCommand = vscode.commands.registerCommand('cssToHtmlJumper.addRedBorder', async (args) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'css') {
            return;
        }
        if (!args || typeof args.line !== 'number') {
            return;
        }
        const document = editor.document;
        const startLine = args.line;
        const text = document.getText();
        const lines = text.split('\n');
        // ホバー行の種類に応じて { を探す
        const currentLine = lines[startLine] || '';
        let braceOpenLine = -1;
        if (currentLine.includes('{')) {
            // セレクタ行にホバー → この行を使う
            braceOpenLine = startLine;
        }
        else if (currentLine.includes(':') && !currentLine.trim().startsWith('/*') && !currentLine.trim().startsWith('//')) {
            // プロパティ行にホバー → 上に向かって { を探す
            let tempBraceCount = 0;
            for (let i = startLine; i >= 0; i--) {
                const lineText = lines[i];
                for (let j = lineText.length - 1; j >= 0; j--) {
                    const char = lineText[j];
                    if (char === '}')
                        tempBraceCount++;
                    if (char === '{') {
                        if (tempBraceCount > 0) {
                            tempBraceCount--;
                        }
                        else {
                            braceOpenLine = i;
                            break;
                        }
                    }
                }
                if (braceOpenLine !== -1)
                    break;
            }
        }
        else {
            // コメント行やセレクタ名のみの行 → 下に向かって { を探す
            for (let i = startLine; i < lines.length; i++) {
                if (lines[i].includes('{')) {
                    braceOpenLine = i;
                    break;
                }
            }
        }
        if (braceOpenLine === -1) {
            return;
        }
        // { から対応する } を探す（シンプル版）
        // braceOpenLine から下に向かって、最初の } を探す
        let braceCloseLine = -1;
        let depth = 0;
        for (let i = braceOpenLine; i < lines.length; i++) {
            const lineText = lines[i];
            for (let j = 0; j < lineText.length; j++) {
                const c = lineText[j];
                if (c === '{')
                    depth++;
                if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        braceCloseLine = i;
                        break;
                    }
                }
            }
            if (braceCloseLine !== -1)
                break;
        }
        if (braceCloseLine === -1) {
            return;
        }
        // } の直前の行にborderを追加
        // インデントを取得
        const prevLine = lines[braceCloseLine - 1] || lines[braceOpenLine];
        const indentMatch = prevLine.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '  ';
        // 既にborder: 0.5rem solid red;があるか確認
        let hasBorder = false;
        for (let i = braceOpenLine; i <= braceCloseLine; i++) {
            if (lines[i].includes('border: 0.5rem solid red') || lines[i].includes('border:0.5rem solid red')) {
                hasBorder = true;
                break;
            }
        }
        if (hasBorder) {
            vscode.window.showInformationMessage('既に赤枠が追加されています');
            return;
        }
        // } の直前に挿入
        const closeBraceLine = lines[braceCloseLine];
        const closeBraceIndex = closeBraceLine.lastIndexOf('}');
        if (closeBraceIndex === -1) {
            return;
        }
        // } の位置に挿入（} を押し出す形で）
        const insertPosition = new vscode.Position(braceCloseLine, closeBraceIndex);
        const newLine = `${indent}border: 0.5rem solid red;\n`;
        const success = await editor.edit(editBuilder => {
            editBuilder.insert(insertPosition, newLine);
        });
        if (success) {
            await document.save();
        }
    });
    context.subscriptions.push(addRedBorderCommand);
    // ========================================
    // 赤枠一括削除コマンド
    // ========================================
    const removeAllRedBordersCommand = vscode.commands.registerCommand('cssToHtmlJumper.removeAllRedBorders', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'css') {
            vscode.window.showWarningMessage('CSSファイルを開いてください');
            return;
        }
        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        // border: 0.5rem solid を含む行を削除
        const linesToDelete = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('border: 0.5rem solid') || lines[i].includes('border:0.5rem solid')) {
                linesToDelete.push(i);
            }
        }
        if (linesToDelete.length === 0) {
            vscode.window.showInformationMessage('削除する赤枠がありません');
            return;
        }
        // 後ろから削除（行番号がずれないように）
        const success = await editor.edit(editBuilder => {
            for (let i = linesToDelete.length - 1; i >= 0; i--) {
                const lineNum = linesToDelete[i];
                const range = new vscode.Range(lineNum, 0, lineNum + 1, 0);
                editBuilder.delete(range);
            }
        });
        if (success) {
            await document.save();
            vscode.window.showInformationMessage(`${linesToDelete.length}件の赤枠を削除しました`);
        }
    });
    context.subscriptions.push(removeAllRedBordersCommand);
    const disposable = vscode.commands.registerCommand('cssToHtmlJumper.findUsage', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('CSSファイルを開いてください');
            return;
        }
        // 選択されたテキストまたはカーソル位置の単語を取得
        const selection = editor.selection;
        let selector = editor.document.getText(selection);
        if (!selector) {
            // 選択がない場合、カーソル位置のセレクタを取得
            const wordRange = editor.document.getWordRangeAtPosition(selection.start, /[.#]?[\w-]+/);
            if (wordRange) {
                selector = editor.document.getText(wordRange);
            }
        }
        if (!selector) {
            vscode.window.showWarningMessage('セレクタを選択してください');
            return;
        }
        // セレクタのタイプと名前を抽出
        let selectorType;
        let selectorName;
        if (selector.startsWith('.')) {
            selectorType = 'class';
            selectorName = selector.substring(1);
        }
        else if (selector.startsWith('#')) {
            selectorType = 'id';
            selectorName = selector.substring(1);
        }
        else {
            // プレフィックスがない場合、行の内容から判定
            const line = editor.document.lineAt(selection.start.line).text;
            // 直前に # があるか確認
            if (line.includes(`#${selector}`)) {
                selectorType = 'id';
            }
            else if (line.includes(`.${selector}`)) {
                selectorType = 'class';
            }
            else {
                // どちらでもなければタグセレクタ
                selectorType = 'tag';
            }
            selectorName = selector;
        }
        console.log(`CSS to HTML Jumper: 検索 - ${selectorType}: ${selectorName}`);
        // 設定から検索対象ファイルパターンを取得
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const targetPattern = config.get('targetFiles', '**/index.html');
        // ワークスペース内のHTMLファイルを検索
        const htmlFiles = filterAutoGeneratedHtml(await vscode.workspace.findFiles(targetPattern, '**/node_modules/**'));
        if (htmlFiles.length === 0) {
            vscode.window.showWarningMessage('HTMLファイルが見つかりません');
            return;
        }
        // 検索結果を格納
        const results = [];
        // 検索パターンを構築
        let searchPattern;
        if (selectorType === 'class') {
            // class="xxx" または class="... xxx ..." にマッチ
            searchPattern = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'gi');
        }
        else if (selectorType === 'id') {
            // id="xxx" にマッチ
            searchPattern = new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'gi');
        }
        else {
            // タグ名にマッチ（例: <body, <div, <section）
            searchPattern = new RegExp(`<${escapeRegex(selectorName)}[\\s>]`, 'gi');
        }
        // 各HTMLファイルを検索
        for (const fileUri of htmlFiles) {
            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const text = document.getText();
                const lines = text.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (searchPattern.test(lines[i])) {
                        results.push({
                            uri: fileUri,
                            line: i,
                            text: lines[i].trim().substring(0, 100) // 100文字まで
                        });
                    }
                    // RegExpのlastIndexをリセット
                    searchPattern.lastIndex = 0;
                }
            }
            catch (e) {
                console.error(`CSS to HTML Jumper: ファイル読み込みエラー: ${fileUri.fsPath}`, e);
            }
        }
        if (results.length === 0) {
            vscode.window.showInformationMessage(`「${selector}」はHTMLで使用されていません`);
            return;
        }
        // 常に最初の結果にジャンプ
        const result = results[0];
        const document = await vscode.workspace.openTextDocument(result.uri);
        const targetEditor = await vscode.window.showTextDocument(document);
        const position = new vscode.Position(result.line, 0);
        targetEditor.selection = new vscode.Selection(position, position);
        targetEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        // 一時的にハイライト
        flashHighlight(targetEditor, new vscode.Range(position, new vscode.Position(result.line, 1000)));
        if (results.length > 1) {
            vscode.window.showInformationMessage(`✓ ${path.basename(result.uri.fsPath)}:${result.line + 1} (他${results.length - 1}件)`);
        }
        else {
            vscode.window.showInformationMessage(`✓ ${path.basename(result.uri.fsPath)}:${result.line + 1}`);
        }
    });
    // ハイライト用の装飾タイプ
    const highlightDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(100, 180, 255, 0.25)', // 薄い青の半透明背景
        isWholeLine: true // 行全体をハイライト
    });
    // 指定した範囲を一瞬ハイライトする関数
    function flashHighlight(editor, range) {
        // ハイライト適用
        editor.setDecorations(highlightDecorationType, [range]);
        // 1.5秒後にハイライト解除
        setTimeout(() => {
            editor.setDecorations(highlightDecorationType, []);
        }, 800);
    }
    // Definition Provider: Alt+Click で動作（editor.multiCursorModifier = ctrlCmd に設定した場合）
    const definitionProvider = vscode.languages.registerDefinitionProvider({ scheme: 'file', language: 'css' }, {
        async provideDefinition(document, position) {
            let selector = '';
            let selectorType = 'unknown';
            let selectorName = '';
            // 1. 選択範囲を優先チェック
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document) {
                const selection = editor.selection;
                // 選択範囲があり、かつF12を押した位置が選択範囲内なら
                if (!selection.isEmpty && selection.contains(position)) {
                    selector = document.getText(selection).trim();
                }
            }
            // 2. 選択範囲がなければカーソル位置の単語を取得
            if (!selector) {
                const wordRange = document.getWordRangeAtPosition(position, /[.#]?[\w-]+/);
                if (wordRange) {
                    selector = document.getText(wordRange);
                }
            }
            if (!selector) {
                return null;
            }
            const line = document.lineAt(position.line).text;
            // セレクタタイプ判定
            if (selector.startsWith('.')) {
                selectorType = 'class';
                selectorName = selector.substring(1);
            }
            else if (selector.startsWith('#')) {
                selectorType = 'id';
                selectorName = selector.substring(1);
            }
            else {
                // プレフィックスがない場合
                // 行の内容から推測するか、選択範囲そのものを使う
                // 明示的な選択の場合は、そのままの名前で検索を試みる
                if (!selector.match(/^[.#]/) && line.includes(`.${selector}`)) {
                    selectorType = 'class';
                    selectorName = selector;
                }
                else if (!selector.match(/^[.#]/) && line.includes(`#${selector}`)) {
                    selectorType = 'id';
                    selectorName = selector;
                }
                else {
                    // 判断つかない、またはタグ
                    selectorType = 'tag';
                    selectorName = selector;
                }
            }
            const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
            const targetPattern = config.get('targetFiles', '**/*.html');
            const htmlFiles = filterAutoGeneratedHtml(await vscode.workspace.findFiles(targetPattern, '**/node_modules/**'));
            // 検索パターンの構築
            // 選択した文字列が class="name" や id="name" にマッチするか
            let searchPatterns = []; // 複数パターン試す
            if (selectorType === 'class') {
                // class="... name ..."
                searchPatterns.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'i'));
            }
            else if (selectorType === 'id') {
                // id="name"
                searchPatterns.push(new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'i'));
            }
            else {
                // タグ、または不明な場合
                // 1. タグとして検索 <name
                searchPatterns.push(new RegExp(`<${escapeRegex(selectorName)}[\\s>]`, 'i'));
                // 2. クラスとして検索 (class="... name ...") - 念のため
                searchPatterns.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'i'));
                // 3. IDとして検索 - 念のため
                searchPatterns.push(new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'i'));
            }
            for (const fileUri of htmlFiles) {
                try {
                    const htmlDoc = await vscode.workspace.openTextDocument(fileUri);
                    const lines = htmlDoc.getText().split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        // パターンにマッチするか
                        for (const pattern of searchPatterns) {
                            if (pattern.test(lines[i])) {
                                // 見つかったら即座に返す
                                return new vscode.Location(fileUri, new vscode.Position(i, 0));
                            }
                            pattern.lastIndex = 0; //念のためリセット
                        }
                    }
                }
                catch (e) {
                    // エラー無視
                }
            }
            return null;
        }
    });
    context.subscriptions.push(disposable);
    context.subscriptions.push(definitionProvider);
    // カーソル位置のセクション範囲を取得（開始行〜終了行）
    function getCurrentSectionRange(editor) {
        const cursorLine = editor.selection.active.line;
        const text = editor.document.getText();
        const lines = text.split('\n');
        // 上に遡って ┌ を探す
        let startLine = -1;
        let sectionName = '';
        for (let i = cursorLine; i >= 0; i--) {
            const line = lines[i];
            if (line.search(/[┌]/) >= 0) {
                startLine = i;
                // セクション名を取得（│ で囲まれた部分）
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    const titleLine = lines[j];
                    const pipeIndex = titleLine.search(/[│|]/);
                    if (pipeIndex !== -1) {
                        let content = titleLine.substring(pipeIndex + 1);
                        const lastPipeIndex = Math.max(content.lastIndexOf('│'), content.lastIndexOf('|'));
                        if (lastPipeIndex !== -1) {
                            content = content.substring(0, lastPipeIndex);
                        }
                        content = content.replace(/\*\/$/, '').trim();
                        if (content && !/^[─━┈┄┌┐└┘│|]+$/.test(content)) {
                            sectionName = content;
                            break;
                        }
                    }
                }
                break;
            }
        }
        if (startLine === -1) {
            return null; // セクションが見つからない
        }
        // 下に └ を探す
        let endLine = lines.length - 1;
        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.search(/[└]/) >= 0) {
                endLine = i;
                break;
            }
        }
        return { start: startLine, end: endLine, sectionName };
    }
    // セクション検出の共通関数
    function findAllSections(editor) {
        const text = editor.document.getText();
        const lines = text.split('\n');
        const sections = [];
        let inMediaQuery = false;
        let mediaQueryType = null;
        let braceDepth = 0;
        let mediaStartDepth = -1;
        let inBox = false;
        let capturedTitle = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            if (/@media\s/.test(line)) {
                mediaStartDepth = braceDepth;
                if (line.includes('max-width')) {
                    mediaQueryType = 'mobile';
                }
                else if (line.includes('min-width')) {
                    mediaQueryType = 'pc';
                }
                else {
                    mediaQueryType = null;
                }
            }
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;
            braceDepth += openBraces;
            inMediaQuery = mediaStartDepth >= 0 && braceDepth > mediaStartDepth;
            const firstBoxChar = line.search(/[┌└│]/);
            const isTopBorder = firstBoxChar !== -1 && line[firstBoxChar] === '┌';
            const isBottomBorder = firstBoxChar !== -1 && line[firstBoxChar] === '└';
            if (isTopBorder) {
                inBox = true;
                capturedTitle = false;
            }
            if (inBox && !capturedTitle) {
                const pipeIndex = line.search(/[│|]/);
                if (pipeIndex !== -1) {
                    const prefix = line.substring(0, pipeIndex).trim();
                    if (prefix === '' || prefix === '/*' || prefix.endsWith('/*')) {
                        let content = line.substring(pipeIndex + 1);
                        const lastPipeIndex = Math.max(content.lastIndexOf('│'), content.lastIndexOf('|'));
                        if (lastPipeIndex !== -1) {
                            content = content.substring(0, lastPipeIndex);
                        }
                        content = content.replace(/\*\/$/, '');
                        const sectionName = content.trim();
                        if (sectionName && sectionName.length > 0 && !/^[─━┈┄]+$/.test(sectionName)) {
                            let icon = '📍';
                            let suffix = '';
                            if (inMediaQuery && mediaQueryType === 'mobile') {
                                icon = '📱';
                                suffix = ' (mobile)';
                            }
                            else if (inMediaQuery && mediaQueryType === 'pc') {
                                icon = '💻';
                                suffix = ' (PC)';
                            }
                            sections.push({
                                label: `${icon} ${sectionName}${suffix}`,
                                line: i
                            });
                            capturedTitle = true;
                        }
                    }
                }
            }
            if (isBottomBorder) {
                inBox = false;
            }
            braceDepth -= closeBraces;
            if (mediaStartDepth >= 0 && braceDepth <= mediaStartDepth) {
                mediaStartDepth = -1;
                mediaQueryType = null;
            }
        }
        return sections;
    }
    // セクションジャンプコマンド
    const sectionJumper = vscode.commands.registerCommand('cssToHtmlJumper.jumpToSection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('ファイルを開いてください');
            return;
        }
        const sections = findAllSections(editor);
        if (sections.length === 0) {
            vscode.window.showInformationMessage('セクションが見つかりませんでした（│ セクション名 │ 形式のコメントを探しています）');
            return;
        }
        // 現在のカーソル位置を保存（キャンセル時に戻すため）
        const originalPosition = editor.selection.active;
        // クイックピックで表示
        const items = sections.map(s => ({
            label: s.label,
            description: `line ${s.line + 1}`,
            line: s.line
        }));
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = items;
        quickPick.placeholder = 'ジャンプするセクションを選択（↑↓でプレビュー、Enterで確定、ESCでキャンセル）';
        let lastPreviewLine = -1;
        // 選択が変わったらプレビュー移動
        quickPick.onDidChangeActive(activeItems => {
            if (activeItems.length > 0) {
                const item = activeItems[0];
                if (item.line !== lastPreviewLine) {
                    lastPreviewLine = item.line;
                    const position = new vscode.Position(item.line, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                }
            }
        });
        // Enterで確定
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected) {
                const position = new vscode.Position(selected.line, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                // ハイライト
                const highlightRange = new vscode.Range(position, new vscode.Position(selected.line, 1000));
                editor.setDecorations(highlightDecorationType, [highlightRange]);
                setTimeout(() => {
                    editor.setDecorations(highlightDecorationType, []);
                }, 800);
            }
            quickPick.hide();
        });
        // ESCでキャンセル → 元の位置に戻る
        quickPick.onDidHide(() => {
            if (!quickPick.selectedItems.length) {
                editor.selection = new vscode.Selection(originalPosition, originalPosition);
                editor.revealRange(new vscode.Range(originalPosition, originalPosition), vscode.TextEditorRevealType.InCenter);
            }
            quickPick.dispose();
        });
        quickPick.show();
        // 最初の項目にプレビュー（show直後）
        if (items.length > 0) {
            const firstItem = items[0];
            lastPreviewLine = firstItem.line;
            const position = new vscode.Position(firstItem.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    });
    context.subscriptions.push(sectionJumper);
    // 次のセクションへ移動
    const jumpToNextSection = vscode.commands.registerCommand('cssToHtmlJumper.jumpToNextSection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const sections = findAllSections(editor);
        if (sections.length === 0) {
            vscode.window.showInformationMessage('セクションが見つかりませんでした');
            return;
        }
        const currentLine = editor.selection.active.line;
        const nextSection = sections.find(s => s.line > currentLine);
        if (nextSection) {
            const position = new vscode.Position(nextSection.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            const highlightRange = new vscode.Range(position, new vscode.Position(nextSection.line, 1000));
            editor.setDecorations(highlightDecorationType, [highlightRange]);
            setTimeout(() => {
                editor.setDecorations(highlightDecorationType, []);
            }, 800);
        }
        else {
            vscode.window.showInformationMessage('次のセクションはありません');
        }
    });
    // 前のセクションへ移動
    const jumpToPrevSection = vscode.commands.registerCommand('cssToHtmlJumper.jumpToPrevSection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const sections = findAllSections(editor);
        if (sections.length === 0) {
            vscode.window.showInformationMessage('セクションが見つかりませんでした');
            return;
        }
        const currentLine = editor.selection.active.line;
        const prevSections = sections.filter(s => s.line < currentLine);
        if (prevSections.length > 0) {
            const prevSection = prevSections[prevSections.length - 1];
            const position = new vscode.Position(prevSection.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            const highlightRange = new vscode.Range(position, new vscode.Position(prevSection.line, 1000));
            editor.setDecorations(highlightDecorationType, [highlightRange]);
            setTimeout(() => {
                editor.setDecorations(highlightDecorationType, []);
            }, 800);
        }
        else {
            vscode.window.showInformationMessage('前のセクションはありません');
        }
    });
    context.subscriptions.push(jumpToNextSection);
    context.subscriptions.push(jumpToPrevSection);
    // ステータスバーアイテムの作成
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    // カーソル位置の変更を監視
    vscode.window.onDidChangeTextEditorSelection(updateStatusBar, null, context.subscriptions);
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar, null, context.subscriptions);
    // 初期更新
    updateStatusBar();
    function updateStatusBar() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'css') {
            statusBarItem.hide();
            return;
        }
        const position = editor.selection.active;
        const cursorLine = position.line;
        const fullText = editor.document.getText();
        const allLines = fullText.split('\n');
        // ========================================
        // セクション名を取得（カーソル位置より前の最後のセクション）
        // ========================================
        let currentSection = '';
        // 罫線ボックス形式のセクションコメントを検出
        // /* ┌───────────────────┐
        //    │ セクション名      │  ← この1行目だけを採用
        //    │ 説明文...         │  ← 除外
        //    └───────────────────┘ */
        let inBox = false;
        let capturedTitle = false;
        for (let i = 0; i <= cursorLine && i < allLines.length; i++) {
            const line = allLines[i];
            // セクションボックスの ┌/└ 検出（行頭が罫線の場合のみ）
            // ネスト図解（│ ┌──┐ │ のように │ 内にある ┌└）は無視する
            const firstBoxChar = line.search(/[┌└│]/);
            const isTopBorder = firstBoxChar !== -1 && line[firstBoxChar] === '┌';
            const isBottomBorder = firstBoxChar !== -1 && line[firstBoxChar] === '└';
            if (isTopBorder) {
                inBox = true;
                capturedTitle = false;
            }
            // ┌～└ 内の │ or | 行からタイトルだけ取得（半角パイプも対応）
            if (inBox && !capturedTitle) {
                const pipeIndex = line.search(/[│|]/);
                if (pipeIndex !== -1) {
                    const prefix = line.substring(0, pipeIndex).trim();
                    if (prefix === '' || prefix === '/*' || prefix.endsWith('/*')) {
                        let content = line.substring(pipeIndex + 1);
                        const lastPipeIndex = Math.max(content.lastIndexOf('│'), content.lastIndexOf('|'));
                        if (lastPipeIndex !== -1) {
                            content = content.substring(0, lastPipeIndex);
                        }
                        content = content.replace(/\*\/$/, '');
                        const sectionName = content.trim();
                        if (sectionName && sectionName.length > 0 && !/^[─━┈┄┌┐└┘├┤┬┴┼\-=]+$/.test(sectionName)) {
                            currentSection = sectionName;
                            capturedTitle = true; // 最初の1行だけ採用
                        }
                    }
                }
            }
            if (isBottomBorder) {
                inBox = false;
            }
        }
        // ========================================
        // メディアクエリ判定
        // ========================================
        let currentMediaQuery = '';
        let foundMedia = false;
        // スタック方式でネストされた@mediaを正確に追跡
        const mediaStack = [];
        let braceDepth = 0;
        for (let i = 0; i <= cursorLine && i < allLines.length; i++) {
            const line = allLines[i];
            // @media の開始を検出（条件部分を抽出）
            const mediaMatch = line.match(/@media\s+(.+?)\s*\{/);
            if (mediaMatch) {
                mediaStack.push({ startDepth: braceDepth, condition: mediaMatch[1] });
            }
            // 波括弧をカウント
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;
            braceDepth += openBraces - closeBraces;
            // 閉じたメディアクエリをスタックから除去
            while (mediaStack.length > 0 && braceDepth <= mediaStack[mediaStack.length - 1].startDepth) {
                mediaStack.pop();
            }
        }
        // スタックに残っている = 現在カーソルが内側にいる@media
        if (mediaStack.length > 0) {
            foundMedia = true;
            // max-widthを優先（📱表示用）
            for (const ctx of mediaStack) {
                if (ctx.condition.includes('max-width')) {
                    currentMediaQuery = ctx.condition;
                    break;
                }
            }
            // max-widthがなければ最も外側を使用
            if (!currentMediaQuery) {
                currentMediaQuery = mediaStack[0].condition;
            }
        }
        // ========================================
        // ステータスバーのテキストを構築
        // - 通常/PC(min-width): 📍 セクション名
        // - スマホ/タブレット(max-width): 📱 セクション名 | メディアクエリ
        // ========================================
        let statusText = '';
        let icon = '📍';
        // セクション名
        const sectionName = currentSection || 'Global CSS';
        // セクション名が長すぎる場合は切り詰め（ステータスバーの幅対策）
        const shortName = sectionName.length > 20 ? sectionName.substring(0, 20) + '…' : sectionName;
        // max-width（スマホ/タブレット）の時だけメディアクエリ表示
        if (foundMedia && currentMediaQuery.includes('max-width')) {
            icon = '📱';
            statusText = `${icon} ${shortName}`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            // 通常時またはPC(min-width)時はセクション名だけ
            statusText = `${icon} ${shortName}`;
            statusBarItem.backgroundColor = undefined;
        }
        statusBarItem.text = statusText;
        statusBarItem.show();
    }
    // ========================================
    // 一時ファイルからSVGリンク挿入 (Ctrl+Alt+S)
    // AHKが保存したSVGファイルへの相対パスリンクをmdに挿入
    // ========================================
    const insertSvgCommand = vscode.commands.registerCommand('cssToHtmlJumper.insertSvgFromTemp', async () => {
        const fs = require('fs');
        const os = require('os');
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const customPath = config.get('svgTempFilePath', '');
        const tempFilePath = customPath || path.join(os.tmpdir(), 'svg_clipboard.svg');
        if (!fs.existsSync(tempFilePath)) {
            vscode.window.showInformationMessage('SVGファイルが見つかりません: ' + tempFilePath);
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        try {
            // 一時ファイルからSVGファイル名を特定（AHKが保存したファイルを探す）
            const currentFilePath = editor.document.uri.fsPath;
            const currentDir = path.dirname(currentFilePath);
            // AHKの保存先: 同じknowledgeルート配下の「その他\SVG一覧」
            // 現在のmdファイルから上位を辿って「その他\SVG一覧」を探す
            let searchDir = currentDir;
            let svgDir = '';
            for (let i = 0; i < 5; i++) {
                const candidate = path.join(searchDir, 'その他', 'SVG一覧');
                if (fs.existsSync(candidate)) {
                    svgDir = candidate;
                    break;
                }
                const parent = path.dirname(searchDir);
                if (parent === searchDir) {
                    break;
                }
                searchDir = parent;
            }
            if (!svgDir) {
                vscode.window.showErrorMessage('「その他/SVG一覧」フォルダが見つかりません');
                return;
            }
            // SVG一覧内の最新ファイルを取得（AHKが直前に保存したもの）
            const svgFiles = fs.readdirSync(svgDir)
                .filter((f) => f.toLowerCase().endsWith('.svg'))
                .map((f) => ({
                name: f,
                mtime: fs.statSync(path.join(svgDir, f)).mtimeMs
            }))
                .sort((a, b) => b.mtime - a.mtime);
            if (svgFiles.length === 0) {
                vscode.window.showErrorMessage('SVG一覧にファイルがありません');
                return;
            }
            const latestSvg = svgFiles[0].name;
            // 現在のmdファイルからの相対パスを計算
            const absoluteSvgPath = path.join(svgDir, latestSvg);
            let relativePath = path.relative(currentDir, absoluteSvgPath).replace(/\\/g, '/');
            // 先頭に ./ を付ける
            if (!relativePath.startsWith('.')) {
                relativePath = './' + relativePath;
            }
            // Markdownリンクをカーソル位置に挿入
            const linkText = `![SVG](${relativePath})`;
            await editor.edit((editBuilder) => {
                const position = editor.selection.active;
                editBuilder.insert(position, linkText + '\n');
            });
            // 挿入後に一時ファイル削除
            try {
                fs.unlinkSync(tempFilePath);
            }
            catch (e) {
                // 削除失敗は無視
            }
            vscode.window.showInformationMessage('✅ SVGリンクを挿入: ' + latestSvg);
        }
        catch (e) {
            vscode.window.showErrorMessage('SVG挿入エラー: ' + e.message);
        }
    });
    context.subscriptions.push(insertSvgCommand);
    // ========================================
    // 【関連】→「keyword」 → メモへのDocumentLink
    // ========================================
    const memoRelatedLinkProvider = vscode.languages.registerDocumentLinkProvider({ scheme: 'file', language: 'markdown' }, {
        provideDocumentLinks(document) {
            const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
            const memoFilePath = config.get('memoFilePath', '');
            if (!memoFilePath || !fs.existsSync(memoFilePath)) {
                return [];
            }
            const memoContent = fs.readFileSync(memoFilePath, 'utf8');
            const memoLines = memoContent.split('\n');
            const links = [];
            const text = document.getText();
            const pattern = /【関連】[^「]*「([^」]+)」/g;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const keyword = match[1];
                const quoteStart = match.index + match[0].indexOf('「') + 1;
                const range = new vscode.Range(document.positionAt(quoteStart), document.positionAt(quoteStart + keyword.length));
                const lower = keyword.toLowerCase();
                // 見出し行を優先、なければ全行
                let foundLine = memoLines.findIndex((l) => l.startsWith('##') && l.toLowerCase().includes(lower));
                if (foundLine === -1) {
                    foundLine = memoLines.findIndex((l) => l.toLowerCase().includes(lower));
                }
                if (foundLine >= 0) {
                    const uri = vscode.Uri.file(memoFilePath).with({ fragment: `L${foundLine + 1}` });
                    links.push(new vscode.DocumentLink(range, uri));
                }
            }
            return links;
        }
    });
    context.subscriptions.push(memoRelatedLinkProvider);
    // 定期保存（10秒ごと）
    const saveInterval = setInterval(saveQuizHistory, 10000);
    context.subscriptions.push({ dispose: () => clearInterval(saveInterval) });
}
async function deactivate() {
    // クイズ回答は自動保存されるため、特に処理なし
}
// 正規表現の特殊文字をエスケープ
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=extension.js.map