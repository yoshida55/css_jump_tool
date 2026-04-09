"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const cssProperties_1 = require("./cssProperties");
const jsProperties_1 = require("./jsProperties");
const aiHoverProvider_1 = require("./aiHoverProvider");
const overviewGenerator_1 = require("./overviewGenerator");
const phpProperties_1 = require("./phpProperties");
const phpCompletionProvider_1 = require("./phpCompletionProvider");
const jsCompletionProvider_1 = require("./jsCompletionProvider");
let memoSuggestIndex = [];
function buildMemoIndex(memoFilePath) {
    if (!memoFilePath || !fs.existsSync(memoFilePath)) {
        return;
    }
    const lines = fs.readFileSync(memoFilePath, 'utf8').split('\n');
    const sections = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/^#{2,3} /.test(line)) {
            const heading = line.replace(/^#{2,3} /, '').trim();
            const sectionLine = i;
            let description = '';
            let code = '';
            let j = i + 1;
            // 見出し直後のテキスト行を取得
            while (j < lines.length && /^#{2,3} /.test(lines[j]) === false) {
                const l = lines[j].trim();
                if (l && !description && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('-')) {
                    description = l;
                }
                if (lines[j].startsWith('```') && !code) {
                    j++;
                    const codeLines = [];
                    while (j < lines.length && !lines[j].startsWith('```')) {
                        if (lines[j].trim()) {
                            codeLines.push(lines[j]);
                        }
                        j++;
                    }
                    code = codeLines.join('\n');
                }
                j++;
                if (j < lines.length && /^#{2,3} /.test(lines[j])) {
                    break;
                }
            }
            if (heading) {
                sections.push({
                    heading,
                    description: description.slice(0, 80),
                    codePreview: code.split('\n')[0] || '',
                    code,
                    line: sectionLine,
                });
            }
            i = j;
            continue;
        }
        i++;
    }
    memoSuggestIndex = sections;
}
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
let lastQuizFilter = { date: '全期間', category: '全カテゴリ' };
let lastTopMode = ''; // 最後に選んだトップモード（today/yesterday/week/history）
let lastPregenTime = 0; // バックグラウンド生成の最終実行時刻（5分に1回制限）
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
    historyObj['_meta'] = { lastFilter: lastQuizFilter };
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
        if (historyObj['_meta']?.lastFilter) {
            lastQuizFilter = historyObj['_meta'].lastFilter;
        }
        const entries = Object.entries(historyObj).filter(([k]) => k !== '_meta');
        quizHistoryMap = new Map(entries);
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
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '🧠 Staging 1: 暗記すべきこと→次へ', description: '要暗記としてStaging 1に登録', action: 'staging1' });
    items.push({ label: '🔵 Staging 2: もう少しで覚えられそう→次へ', description: 'あと少しでStaging 2に登録', action: 'staging2' });
    items.push({ label: '⭐ Staging 3: 完全に理解した→次へ', description: '完全習得としてStaging 3に登録', action: 'staging3' });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '🔍 深掘り質問', description: 'なぜ・応用・例外・比較・具体例をAIが生成してメモに追記', action: 'deepdive' });
    items.push({ label: '✅ 終了', description: '', action: 'exit' });
    const afterAnswer = await vscode.window.showQuickPick(items, {
        placeHolder: hasFactCheckError ? '⚠ ファクトチェックで誤りが検出されました。理解度を評価またはメモを修正してください' : isRepeat ? '復習完了！理解度を評価してください（回答はそのまま保存）' : '理解度を評価してください',
        ignoreFocusOut: true
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
    const wasFromList = pendingQuizEvaluation?.fromList ?? false;
    const todayStr2 = new Date().toISOString().slice(0, 10);
    const answeredHistory = quizHistoryMap.get(pendingQuizEvaluation.quiz.title);
    if (answeredHistory) {
        answeredHistory.lastAnsweredDate = todayStr2;
        saveQuizHistory();
    }
    hideEvaluationStatusBar();
    // 次の問題へ（false = lastTopModeを使いトップ画面スキップ、空なら通常ランダム）
    await handleQuiz(false);
}
// ========================================
// ========================================
// Stagingレベル設定関数
// ========================================
async function addToStaging(level) {
    if (!pendingQuizEvaluation) {
        return;
    }
    const { quiz } = pendingQuizEvaluation;
    const existing = quizHistoryMap.get(quiz.title);
    if (existing) {
        existing.stagingLevel = level;
    }
    else {
        quizHistoryMap.set(quiz.title, {
            title: quiz.title,
            line: quiz.line,
            lastReviewed: Date.now(),
            reviewCount: 0,
            stagingLevel: level,
        });
    }
    saveQuizHistory();
    const labels = { 1: '🧠 Staging 1（暗記すべきこと）', 2: '🔵 Staging 2（もう少しで）', 3: '⭐ Staging 3（完全に理解）' };
    vscode.window.showInformationMessage(`${labels[level]} に登録しました: ${quiz.title}`);
    const todayStr = new Date().toISOString().slice(0, 10);
    const hist = quizHistoryMap.get(quiz.title);
    if (hist) {
        hist.lastAnsweredDate = todayStr;
        saveQuizHistory();
    }
    hideEvaluationStatusBar();
    await handleQuiz(false);
}
// ========================================
// メモサジェスト（Ctrl+M）
// ========================================
async function handleMemoSuggest() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const geminiApiKey = config.get('geminiApiKey', '');
    const memoFilePath = config.get('memoFilePath', '');
    if (!memoFilePath) {
        vscode.window.showErrorMessage('メモファイルが設定されていません（cssToHtmlJumper.memoFilePath）');
        return;
    }
    if (!geminiApiKey) {
        vscode.window.showErrorMessage('Gemini APIキーが設定されていません（cssToHtmlJumper.geminiApiKey）');
        return;
    }
    if (memoSuggestIndex.length === 0) {
        buildMemoIndex(memoFilePath);
        if (memoSuggestIndex.length === 0) {
            vscode.window.showWarningMessage('メモのインデックスが空です');
            return;
        }
    }
    // カーソル位置の単語＋周辺コード（前後3行）を取得
    const position = editor.selection.active;
    const wordRange = editor.document.getWordRangeAtPosition(position);
    const selectedText = editor.document.getText(editor.selection);
    const query = selectedText.trim() || (wordRange ? editor.document.getText(wordRange) : '');
    if (!query) {
        vscode.window.showWarningMessage('検索する単語にカーソルを合わせてからCtrl+Mを押してください');
        return;
    }
    // 周辺コード（前3行＋現在行＋後3行）
    const doc = editor.document;
    const startLine = Math.max(0, position.line - 3);
    const endLine = Math.min(doc.lineCount - 1, position.line + 3);
    const contextLines = [];
    for (let l = startLine; l <= endLine; l++) {
        contextLines.push(doc.lineAt(l).text);
    }
    const surroundingCode = contextLines.join('\n');
    // コンパクトインデックスを作成（見出し＋説明だけ、コードは渡さない）
    const compactIndex = memoSuggestIndex
        .map((s, i) => `[${i}] ${s.heading}${s.description ? ' / ' + s.description : ''}`)
        .join('\n');
    const prompt = `あなたはCSSコーディングのアドバイザーです。ユーザーが「${query}」を書いており、周辺コードは以下です。\n\`\`\`\n${surroundingCode}\n\`\`\`\n\n以下のメモインデックスから関連性の高い順に最大5個選び、提案文となぜそうするかの理由を返してください。関連がなければ「none」とだけ返してください。\n形式: 番号: 提案文20文字以内 | 理由25文字以内\n例: 0: カスタムプロパティで管理する | 値が1箇所で変更できるため\n\n${compactIndex}`;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `💡 「${query}」の関連メモを検索中...` }, async () => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        if (!text || text === 'none') {
            vscode.window.showInformationMessage(`「${query}」に関連するメモが見つかりませんでした`);
            return;
        }
        // "0: 提案文 | 理由" 形式をパース
        const lineRegex = /^(\d+)\s*[:：]\s*(.+)$/;
        const parsed = text.split('\n')
            .map((line) => line.trim())
            .map((line) => {
            const m = line.match(lineRegex);
            if (!m) {
                return null;
            }
            const idx = parseInt(m[1], 10);
            if (isNaN(idx) || idx >= memoSuggestIndex.length) {
                return null;
            }
            const parts = m[2].split('|');
            return { idx, summary: parts[0].trim(), reason: (parts[1] || '').trim() };
        })
            .filter((x) => x !== null);
        if (parsed.length === 0) {
            vscode.window.showInformationMessage(`「${query}」に関連するメモが見つかりませんでした`);
            return;
        }
        const items = parsed.map(({ idx, summary, reason }) => {
            const s = memoSuggestIndex[idx];
            const detailParts = [reason, s.codePreview].filter(Boolean);
            return {
                label: `💡 ${summary}`,
                detail: detailParts.length ? `  ${detailParts.join('  /  ')}` : '',
                code: s.code,
            };
        });
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: `「${query}」の関連メモ（選択するとコードを挿入）`,
            matchOnDescription: true,
            ignoreFocusOut: false,
        });
        if (!picked || !picked.code) {
            return;
        }
        // カーソル位置にコードを挿入
        editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, picked.code);
        });
    });
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
// 深掘り質問生成・メモ追記
// ========================================
async function generateDeepDiveQuestion() {
    if (!pendingQuizEvaluation) {
        return;
    }
    const { quiz, claudeAnswer, answerContent } = pendingQuizEvaluation;
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const geminiApiKey = config.get('geminiApiKey', '');
    const memoFilePath = config.get('memoFilePath', '');
    if (!geminiApiKey) {
        vscode.window.showErrorMessage('Gemini APIキーが設定されていません。');
        showEvaluationStatusBar();
        return;
    }
    if (!memoFilePath) {
        vscode.window.showErrorMessage('メモファイルパスが設定されていません。');
        showEvaluationStatusBar();
        return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    // Step1: 深掘り質問を生成
    const prompt = `以下のクイズと正解を見て、理解を深める追加質問を1〜2個作ってください。

【元の問題】
${quiz.title}

【メモ内容・正解】
${claudeAnswer || answerContent}

ルール：
- 質問は以下の種類から選ぶ（なるべく違う種類を混ぜる）
  1. なぜそうなるか（理由）
  2. どんな場面で使うか（応用）
  3. 使わない・逆効果な場面（例外）
  4. 似ているものとの違い（比較）
  5. 具体的な例（具体化）
- 【重要】元の問題に出てきた言葉だけで質問を作る（新しい専門用語を使わない）
- 「○○とは何ですか？」のような定義を聞く質問はNG（知らない言葉が出てしまうため）
- 中学生でもわかる言葉で
- 質問だけ出す（答えは出さない）
- 形式：「Q1. ～？」のように番号付き
- 挨拶・説明文は一切不要`;
    const postData = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    let deepDiveQuestions = '';
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '🔍 深掘り質問を生成中...',
        cancellable: false
    }, async () => {
        const raw = await callGeminiApi(geminiApiKey, 'gemini-2.0-flash', postData);
        const parsed = JSON.parse(raw);
        deepDiveQuestions = parsed.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    });
    if (!deepDiveQuestions) {
        vscode.window.showErrorMessage('深掘り質問の生成に失敗しました。');
        showEvaluationStatusBar();
        return;
    }
    // Step2: QuickPickで質問を選択
    const questionLines = deepDiveQuestions.split('\n').filter(l => l.trim().match(/^Q\d*\./));
    if (questionLines.length === 0) {
        vscode.window.showErrorMessage('深掘り質問の解析に失敗しました。');
        showEvaluationStatusBar();
        return;
    }
    const selectedQuestion = await vscode.window.showQuickPick(questionLines.map(q => ({ label: q, description: 'この質問をメモに追記する' })), { placeHolder: 'メモに追記する深掘り質問を選んでください', ignoreFocusOut: true });
    if (!selectedQuestion) {
        showEvaluationStatusBar();
        return;
    }
    const chosenQuestion = selectedQuestion.label.replace(/^Q\d+\.\s*/, '').trim();
    // Step3: AIで見出し・説明・関連リンクを生成
    const memoPrompt = `以下の深掘り質問について、メモ形式で回答を作ってください。

【深掘り質問】
${chosenQuestion}

【元の問題・背景知識】
${quiz.title}
${claudeAnswer || answerContent}

出力フォーマット（必ずこの形式で）：
## [詳しい見出し：質問内容＋キーワードを含める]
[説明：箇条書き・中学生でもわかる言葉・3〜5行程度]

ルール：
- 見出しは質問の意味とキーワードが一目でわかるように詳しく書く
- 説明は簡潔に、箇条書き推奨
- 挨拶・余計な文章は一切不要
- 関連リンク行は出力しない（コードで自動付与するため）`;
    const memoPostData = JSON.stringify({ contents: [{ parts: [{ text: memoPrompt }] }] });
    let memoEntry = '';
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '📝 メモ追記内容を生成中...',
        cancellable: false
    }, async () => {
        const raw2 = await callGeminiApi(geminiApiKey, 'gemini-2.0-flash', memoPostData);
        const parsed2 = JSON.parse(raw2);
        memoEntry = parsed2.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    });
    if (!memoEntry) {
        vscode.window.showErrorMessage('メモ追記内容の生成に失敗しました。');
        showEvaluationStatusBar();
        return;
    }
    // 見出しの直下に【日付】形式で日付を挿入
    memoEntry = memoEntry.replace(/^(##[^\n]+)\n/, `$1\n【日付】${todayStr}\n`);
    // 末尾にある 関連: [[...]] 形式を除去（コード側で付与するため）
    memoEntry = memoEntry.replace(/\n関連:.*$/s, '').trimEnd();
    // 【関連】リンクをコード側で生成して付与（#アンカー形式）
    const relatedAnchor = quiz.title
        .toLowerCase()
        .replace(/[^\w\s\u3040-\u30FF\u4E00-\u9FFF-]/g, '')
        .replace(/\s+/g, '-');
    memoEntry = memoEntry + `\n\n【関連】→ [${quiz.title}](#${relatedAnchor})`;
    // Step4: memo.md に追記
    const fs = require('fs');
    try {
        const existing = fs.readFileSync(memoFilePath, 'utf8');
        const appended = existing.trimEnd() + '\n\n' + memoEntry + '\n';
        fs.writeFileSync(memoFilePath, appended, 'utf8');
    }
    catch (e) {
        vscode.window.showErrorMessage(`メモへの追記に失敗しました: ${e}`);
        showEvaluationStatusBar();
        return;
    }
    vscode.window.showInformationMessage(`✅ メモに追記しました（${todayStr}）`);
    // Step4.5: memo.mdを開いて追記箇所をハイライト
    try {
        const memoDoc = await vscode.workspace.openTextDocument(memoFilePath);
        const memoEditor = await vscode.window.showTextDocument(memoDoc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: true
        });
        const memoLineCount = memoDoc.lineCount;
        const newEntryLines = memoEntry.split('\n').length;
        const startLine = Math.max(0, memoLineCount - newEntryLines - 1);
        const memoHighlightRange = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(memoLineCount - 1, 0));
        memoEditor.selection = new vscode.Selection(new vscode.Position(startLine, 0), new vscode.Position(startLine, 0));
        memoEditor.revealRange(memoHighlightRange, vscode.TextEditorRevealType.InCenter);
        const memoDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.3)',
            isWholeLine: true
        });
        memoEditor.setDecorations(memoDecorationType, [memoHighlightRange]);
        setTimeout(() => memoDecorationType.dispose(), 3000);
    }
    catch (e) {
        console.error('[Quiz] memo.mdハイライト失敗:', e);
    }
    // Step4.6: クイズ回答.mdにも深掘りQ&Aを追記
    try {
        const memoDir = path.dirname(memoFilePath);
        const answerFilePath = path.join(memoDir, 'クイズ回答.md');
        if (!fs.existsSync(answerFilePath)) {
            fs.writeFileSync(answerFilePath, '', 'utf8');
        }
        const answerDoc = await vscode.workspace.openTextDocument(answerFilePath);
        const currentContent = answerDoc.getText();
        // クイズ回答.md用に簡潔な回答をGeminiで別途生成（通常クイズと同じ形式）
        let answerBody = '';
        const concisePrompt = `以下の深掘り質問に対して、シンプルな回答を作ってください。

【深掘り質問】
${chosenQuestion}

【背景・元の問題】
${quiz.title}

【詳細内容】
${memoEntry}

【回答フォーマット】
答え（1行、核心のみ）

説明（1〜2行、理由や用途）

【要件】
- 超シンプルに、核心だけ書く
- 見出し禁止（**答え**、**説明** 等を使わない）
- 200文字以内
- 中学生でもわかる言葉で
- 知らない言葉を使って説明しない`;
        try {
            const concisePostData = JSON.stringify({ contents: [{ parts: [{ text: concisePrompt }] }] });
            const raw3 = await callGeminiApi(geminiApiKey, 'gemini-2.0-flash', concisePostData);
            const parsed3 = JSON.parse(raw3);
            answerBody = parsed3.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
        catch (e) {
            console.error('[Quiz] クイズ回答.md用簡潔回答生成エラー:', e);
        }
        // 生成失敗時はmemoEntryから見出し・日付・関連行を除去したものをフォールバックに使用
        if (!answerBody) {
            answerBody = memoEntry
                .replace(/^##[^\n]*\n/, '')
                .replace(/^【日付】[^\n]*\n/, '')
                .replace(/\n【関連】.*$/, '')
                .trim();
        }
        const deepDiveQ = `**Q: [深掘り] ${chosenQuestion}**`;
        const SEP = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        const newEntry = `${deepDiveQ}\n\n${answerBody}`;
        const separator = !currentContent.trim() ? '' : SEP;
        const newContent = currentContent.trimEnd() + separator + newEntry + '\n';
        const newAnswerStartLine = answerDoc.lineCount;
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(answerDoc.lineCount, 0));
        edit.replace(answerDoc.uri, fullRange, newContent);
        await vscode.workspace.applyEdit(edit);
        await answerDoc.save();
        console.log('[Quiz] クイズ回答.md に深掘りQ&Aを追記完了');
        // クイズ回答.mdを右エリアで表示してハイライト
        const existingTab = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .find(tab => tab.input instanceof vscode.TabInputText &&
            tab.input.uri.fsPath === answerFilePath);
        const targetViewColumn = existingTab ? existingTab.group.viewColumn : vscode.ViewColumn.Two;
        const answerEditor = await vscode.window.showTextDocument(answerDoc, {
            viewColumn: targetViewColumn,
            preview: false,
            preserveFocus: false
        });
        const lastLine = answerDoc.lineCount - 1;
        answerEditor.selection = new vscode.Selection(new vscode.Position(newAnswerStartLine, 0), new vscode.Position(newAnswerStartLine, 0));
        answerEditor.revealRange(new vscode.Range(newAnswerStartLine, 0, lastLine, 0), vscode.TextEditorRevealType.InCenter);
        const answerDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 255, 0, 0.3)',
            isWholeLine: true
        });
        answerEditor.setDecorations(answerDecorationType, [new vscode.Range(newAnswerStartLine, 0, lastLine, 0)]);
        setTimeout(() => answerDecorationType.dispose(), 3000);
    }
    catch (e) {
        console.error('[Quiz] クイズ回答.md追記失敗:', e);
    }
    // Step5: 評価QuickPickを再表示
    const hasFactCheckError = pendingQuizEvaluation.claudeAnswer?.includes('⚠ ファクトチェック') ?? false;
    const afterDeepDive = await showEvaluationQuickPick(hasFactCheckError);
    if (!afterDeepDive) {
        showEvaluationStatusBar();
        return;
    }
    if (afterDeepDive.action === 'exit') {
        hideEvaluationStatusBar();
        return;
    }
    if (afterDeepDive.action === 'correct') {
        await correctMemo();
        return;
    }
    if (afterDeepDive.eval) {
        await processEvaluation(afterDeepDive);
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
/**
 * クエリに関連するセクションだけ抽出しサマリーを生成
 * 見出し+本文でフィルタリング → 元ファイルの行番号を保持したまま圧縮
 * 0件のときは全セクションのサマリーを返す（フォールバック）
 */
/**
 * ## 区切りでセクション分割
 */
function parseSections(memoContent) {
    const lines = memoContent.split('\n');
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
            let j = i + 1;
            while (j < lines.length && !lines[j].startsWith('## ')) {
                j++;
            }
            sections.push({ heading: lines[i], lineStart: i, lineEnd: j });
            i = j - 1;
        }
    }
    return sections;
}
/**
 * Gemini API 生呼び出し（共通ヘルパー）
 */
function callGeminiApi(apiKey, modelPath, postData) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/${modelPath}:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => reject(new Error(`Gemini API接続エラー: ${e.message}`)));
        req.write(postData);
        req.end();
    });
}
/**
 * Stage1: 見出し一覧をGeminiに送り、関連セクションのインデックスを返す
 */
/**
 * クエリを3つの言い換えに展開する（動的クエリ拡張）
 */
async function expandQuery(query, apiKey, modelPath) {
    const prompt = `以下の検索クエリが持つ「異なる解釈」を3つ出してください。
同じ意味の言い換えではなく、クエリが指し得る異なる対象・文脈を考えること。

例: 「カテゴリPHP」の場合
→ ["get_the_category等のPHP関数", "category.phpテンプレートファイル", "WordPressカテゴリページの仕組み"]
例: 「画像が表示されない」の場合
→ ["CSS background-imageが効かない", "HTMLのimgタグのパスが間違い", "WordPressアイキャッチ画像が出ない"]

元クエリ: 「${query}」
JSON文字列配列のみ返す`;
    const postData = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 256, responseMimeType: 'application/json' }
    });
    try {
        const raw = await callGeminiApi(apiKey, modelPath, postData);
        const parsed = JSON.parse(raw);
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        const arr = JSON.parse(text.trim());
        if (Array.isArray(arr)) {
            return arr.filter((s) => typeof s === 'string').slice(0, 3);
        }
    }
    catch { }
    return [];
}
async function selectRelevantSections(query, sections, apiKey, modelPath, lines = []) {
    // 新しいメモ（ファイル末尾）を優先するため逆順で送る（インデックスは元の位置を維持）
    const headingList = [...sections].reverse().map((s) => {
        const i = sections.indexOf(s);
        const snippet = lines.slice(s.lineStart + 1, s.lineStart + 7)
            .filter(l => l.trim())
            .slice(0, 3)
            .map(l => `  ${l.trim()}`)
            .join('\n');
        // ### サブ見出しをリストに含める（インデックスは親 ## のまま）
        const subHeadings = lines.slice(s.lineStart + 1, s.lineEnd)
            .filter(l => l.startsWith('### '))
            .map(l => `  └ ${l}`)
            .join('\n');
        let text = `${i}: ${s.heading}`;
        if (snippet) {
            text += `\n${snippet}`;
        }
        if (subHeadings) {
            text += `\n${subHeadings}`;
        }
        return text;
    }).join('\n');
    const queryText = query.map((q, i) => `解釈${i + 1}: 「${q}」`).join('\n');
    const prompt = `以下の見出し一覧から、検索クエリのいずれかの解釈に意味的に関連する見出しのインデックスを選んでください。

【見出し一覧】
${headingList}

【検索クエリ（いずれかの解釈に関連すればOK）】
${queryText}

【指示】
- 単語の一致だけでなく、意味・目的・同義語・関連語でも判断する
- **複数の解釈がある場合はそれぞれの解釈に対応するセクションを選ぶ**（解釈ごとに少なくとも1件）
- 最大7件、関連度の高いものだけ選ぶ
- **同じ関数・コマンド・概念を扱うセクションは1つだけ選ぶ**（同系統の重複禁止）
- **CSS・HTML・JavaScript・PHP・Python など異なる言語・カテゴリがある場合は分散して選ぶ**（同じ言語だけで5枠を埋めない）
- インデックス番号の配列のみ返す（例: [0, 3, 7]）`;
    const postData = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
            responseMimeType: 'application/json'
        }
    });
    const raw = await callGeminiApi(apiKey, modelPath, postData);
    const parsed = JSON.parse(raw);
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    try {
        const arr = JSON.parse(text.trim());
        if (Array.isArray(arr)) {
            return arr.filter((n) => typeof n === 'number');
        }
    }
    catch (_) { }
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) {
        const arr = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number') : [];
    }
    return [];
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
    const modelPath = 'gemini-3.1-flash-lite-preview';
    const lines = memoContent.split('\n');
    // クエリ展開: 元クエリ + 3つの言い換えを生成
    const expandedQueries = await expandQuery(query, apiKey, modelPath);
    const allQueries = [query, ...expandedQueries];
    // Stage1: 見出し一覧をGeminiに送ってセマンティックに絞り込む
    const sections = parseSections(memoContent);
    const selectedIndices = await selectRelevantSections(allQueries, sections, apiKey, modelPath, lines);
    // マッチなし → 終了（全件フォールバック禁止・料金節約）
    if (selectedIndices.length === 0) {
        return { aiAnswer: '', results: [] };
    }
    const targets = selectedIndices.filter(i => i >= 0 && i < sections.length).map(i => sections[i]);
    // Stage2用: 絞り込んだセクションの全行を行番号付きで構築（最大500行）
    const summaryLines = [];
    for (const sec of targets) {
        for (let k = sec.lineStart; k < sec.lineEnd; k++) {
            if (summaryLines.length >= 500)
                break;
            summaryLines.push(`${k + 1}: ${lines[k]}`);
        }
        if (summaryLines.length >= 500)
            break;
        summaryLines.push('---');
    }
    const summary = summaryLines.join('\n');
    // クエリ展開の結果もStage2に渡す（多角的に選ばせるため）
    const queryInterpretations = allQueries.length > 1
        ? `\n\n【クエリの複数解釈】\n${allQueries.map((q, i) => `解釈${i}: ${q}`).join('\n')}\n→ 異なる解釈がある場合、それぞれの解釈に対応する結果を最低1件ずつ含めること`
        : '';
    const prompt = `以下のメモファイルから「${query}」に関連する行を検索してください。

【メモファイル】（関連セクションの全行、行番号付き）
${summary}

【検索クエリ】
${query}${queryInterpretations}

【指示】
- **クエリの意図を判断して、意図に合った行を優先する**:
  - 「〜とは」「〜って何」→ 定義・説明文を優先（コード例ではなく概念説明を選ぶ）
  - 「〜の書き方」「〜の使い方」「〜を取得」→ コード例・実装を優先
  - 「なぜ〜」「どうして〜」→ 理由・背景の説明を優先
  - 「〜が動かない」「〜できない」→ トラブルシューティング・原因と対策を優先
  - 上記に当てはまらない場合はGeminiが意図を推測して判断する
- **意味理解を最優先**: 検索クエリの意図を理解し、その目的を達成するコードや説明を探す
- **見出し一致に騙されない**: 見出しテキストがクエリと一致していても、本文の内容がクエリの意図に合っているかで判断する。見出しが同じでも本文が違えば、より意図に合う方を選ぶ
- **異なる解釈への分散**: クエリに複数の解釈がある場合、**同じ解釈の結果だけで3件を埋めない**。各解釈から最低1件選ぶ
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
- **最大5件**抽出（関連度が最も高いものだけ、厳選すること）
- **関連度の高い順に並べる**（1番目が最も関連性が高いものにすること）
- **必ず異なるセクション（トピック）から選ぶ**（連続した行番号NG、離れた箇所から）
- 見出し行（##で始まる）やコードブロックの開始行を優先（ジャンプ先として正確なため）
- 類似内容・同じセクションの重複は絶対に避ける
- **同じ解釈・同じトピックの結果を複数選ばない**（異なる角度の結果を優先する）

【出力形式】
JSONオブジェクトで返す。説明文は不要。
- aiAnswer: 検索クエリへの直接的な答え（コード・コマンド・値など、コピーしてすぐ使えるもの）。メモに書いていなくてもGemini自身の知識で回答する。答えられない場合のみ空文字。
- results: 関連行のリスト（最大5件）
  - answer: メモ内から抽出した直接的な答え。なければ空文字。
  - context: そのセクション内の補足説明（1行）

{
  "aiAnswer": "直接的な答え（メモになくてもGeminiの知識で回答）",
  "results": [
    {"line": 行番号, "keyword": "主要な技術用語", "text": "該当行の内容", "answer": "直接的な答え", "context": "補足説明"},
    ...
  ]
}

例:
{
  "aiAnswer": "display: flex; justify-content: center; align-items: center;",
  "results": [
    {"line": 7624, "keyword": "Localテーマフォルダ", "text": "- 場所：wp-content/themes/", "answer": "C:\\Users\\guest04\\Local Sites\\local-test\\app\\public\\wp-content\\themes", "context": "LocalのWordPressテーマ配置場所"},
    {"line": 1052, "keyword": "inline-block", "text": "## テキスト幅に合わせる", "answer": "display: inline-block;", "context": "幅が文字幅に合う"}
  ]
}`;
    const postData = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json'
        }
    });
    const data = await callGeminiApi(apiKey, modelPath, postData);
    try {
        const parsed = JSON.parse(data);
        const parts = parsed.candidates?.[0]?.content?.parts || [];
        const text = (parts.find((p) => !p.thought && p.text) || parts[0])?.text || '';
        let obj = null;
        try {
            obj = JSON.parse(text.trim());
        }
        catch (_) { }
        if (!obj) {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end > start) {
                obj = JSON.parse(text.slice(start, end + 1));
            }
        }
        const aiAnswer = obj?.aiAnswer || '';
        const rawResults = Array.isArray(obj?.results) ? obj.results : [];
        // 100行以内の重複を除去してから上位3件に絞る
        const deduped = [];
        for (const r of rawResults) {
            const tooClose = deduped.some(d => Math.abs(d.line - r.line) <= 100);
            if (!tooClose) {
                deduped.push(r);
            }
            if (deduped.length >= 3) {
                break;
            }
        }
        return {
            aiAnswer,
            results: deduped.map((r) => ({
                line: r.line,
                keyword: r.keyword || '',
                text: r.text,
                preview: r.text.substring(0, 100),
                answer: r.answer || '',
                context: r.context || ''
            }))
        };
    }
    catch (e) {
        // レスポンスが途中で切れた場合も空結果で続行（エラーで止まらないように）
        vscode.window.showWarningMessage(`Gemini応答が不完全でした（再検索してください）`);
        return { aiAnswer: '', results: [] };
    }
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
    {
        // QuickPickでクエリ入力（選択テキストがあれば初期値にセット）
        // メモファイルから見出し行を抽出（サジェスト用）
        let headingItems = [];
        let contentItems = [];
        let termItems = [];
        const historyItems = memoSearchHistory.map(h => ({
            label: `🕐 ${h}`, description: '検索履歴'
        }));
        try {
            const tmpDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(memoFilePath));
            const tmpLines = tmpDoc.getText().split('\n');
            headingItems = tmpLines
                .map((line, idx) => ({ line, idx }))
                .filter(x => /^#{1,3}\s/.test(x.line))
                .map(x => ({ label: x.line.replace(/^#+\s*/, '').trim(), description: '見出し', _lineNum: x.idx }));
            // メモ本文行を候補に追加（コードブロック・空行・区切り線等を除外）
            let inCodeBlock = false;
            tmpLines.forEach((line, idx) => {
                const t = line.trim();
                if (t.startsWith('```')) {
                    inCodeBlock = !inCodeBlock;
                    return;
                }
                if (inCodeBlock) {
                    return;
                }
                if (t.length < 5) {
                    return;
                }
                if (/^#{1,6}\s/.test(t)) {
                    return;
                } // 見出しは別管理
                if (/^[-*]{3,}$/.test(t)) {
                    return;
                } // 水平線
                if (/^\|[-:| ]+\|/.test(t)) {
                    return;
                } // テーブル区切り
                contentItems.push({
                    label: t.length > 80 ? t.substring(0, 80) + '…' : t,
                    description: 'メモ',
                    _lineNum: idx
                });
            });
            // メモから技術用語・関数名を抽出して常時サジェスト候補にする
            // （PHPファイル以外でも has_post_thumbnail 等が "has" で候補に出るように）
            const termSet = new Set();
            tmpLines.forEach(line => {
                // バッククォート内のコード: `has_post_thumbnail()` など
                const backtickMatches = line.match(/`([^`\n]{2,40})`/g);
                if (backtickMatches) {
                    backtickMatches.forEach(m => {
                        const term = m.replace(/`/g, '').trim();
                        if (/^[a-zA-Z_$]/.test(term)) {
                            termSet.add(term);
                        }
                    });
                }
                // 関数呼び出し: word() / word_name() / WordName()
                const funcMatches = line.match(/\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\(\)/g);
                if (funcMatches) {
                    funcMatches.forEach(m => termSet.add(m));
                }
                // snake_case 識別子: has_post_thumbnail, get_the_title 等
                const snakeMatches = line.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/g);
                if (snakeMatches) {
                    snakeMatches.forEach(m => { if (m.length >= 5) {
                        termSet.add(m);
                    } });
                }
            });
            termItems = Array.from(termSet).map(term => ({ label: term, description: '📌 用語' }));
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
        // PHP関数サジェスト（PHPファイルのとき）
        const phpFunctionInsertMap = new Map(); // label → 挿入テキスト
        let phpFunctionItems = [];
        let currentWordForPhp = '';
        if (activeEditor && activeEditor.document.languageId === 'php') {
            const wordRange = activeEditor.document.getWordRangeAtPosition(activeEditor.selection.active, /[\w_]+/);
            currentWordForPhp = wordRange ? activeEditor.document.getText(wordRange).toLowerCase() : '';
            let phpFuncs = (0, phpCompletionProvider_1.getCachedPhpFunctions)();
            if (!phpFuncs) {
                try {
                    const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
                    phpFuncs = (0, phpCompletionProvider_1.extractPhpFunctionsFromMemo)(memoContent);
                }
                catch {
                    phpFuncs = [];
                }
            }
            phpFunctionItems = phpFuncs
                .filter(f => !f.insertText) // エイリアスは除外（QuickPickでは部分一致で十分）
                .filter(f => currentWordForPhp.length < 2 || f.name.toLowerCase().includes(currentWordForPhp))
                .map(f => {
                const insertText = f.name;
                const label = f.name;
                phpFunctionInsertMap.set(label, insertText);
                // 辞書優先 → なければメモ文脈
                const dictInfo = phpProperties_1.phpFunctions[insertText];
                const meaning = dictInfo
                    ? dictInfo.description
                    : (f.description?.split('\n')[0] || '');
                // description=ラベル横（短め）、detail=2行目（フル）
                return { label, description: '📖 PHP関数', detail: meaning || undefined, _isPhp: true };
            });
        }
        const memoAllItems = [...phpFunctionItems, ...historyItems, ...headingItems, ...termItems, ...contentItems, ...cssQpItems, ...extraCssQpItems, ...jsQpItems];
        // QuickPick1本で完結：最後の単語で候補表示 → Enter で単語置き換え → 候補なし状態でEnter → 検索
        query = await new Promise((resolve) => {
            const qp = vscode.window.createQuickPick();
            qp.sortByLabel = false; // カスタムソートを維持（VSCodeの自動ソートを無効化）
            qp.matchOnDetail = true; // detail行を表示＆検索対象に
            qp.placeholder = 'b→background Enter, i→image Enter, の違いを教えて Enter で検索';
            qp.items = phpFunctionItems.length > 0 ? phpFunctionItems : [];
            // 見出し/メモ補完直後のフラグ（onDidChangeValue で即座に同じ項目が再表示されるのを防ぐ）
            let suppressMemoItems = false;
            qp.onDidChangeValue(value => {
                suppressMemoItems = false; // ユーザーが文字を打ったらリセット
                const lastWord = value.split(/[\s　]+/).pop()?.toLowerCase() || '';
                const fullQuery = value.trim().toLowerCase();
                if (!lastWord && !fullQuery) {
                    qp.items = [];
                    return;
                }
                // ひらがな→カタカナ変換
                const toKatakana = (s) => s.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
                const kataLast = toKatakana(lastWord);
                const kataFull = toKatakana(fullQuery);
                // fuzzy match（文字が順番に含まれるか）
                const fuzzyMatch = (target, q) => {
                    let idx = 0;
                    for (const ch of q) {
                        idx = target.indexOf(ch, idx);
                        if (idx === -1) {
                            return false;
                        }
                        idx++;
                    }
                    return true;
                };
                const score = (item) => {
                    const lbl = item.label.toLowerCase();
                    const desc = (item.description || '').toLowerCase();
                    const katLbl = toKatakana(lbl);
                    // メモ本文・見出しは全体フレーズで検索、CSS/JS/PHPは最後の単語で検索
                    const isMemoItem = desc === 'メモ' || desc === '見出し';
                    // 見出し/メモ補完直後は同じ項目が再表示されないよう非表示
                    if (isMemoItem && suppressMemoItems) {
                        return 0;
                    }
                    // メモ項目は2文字以上のときだけ有効（短すぎると大量ヒットで見づらい）
                    if (isMemoItem && fullQuery.length < 2) {
                        return 0;
                    }
                    const q = isMemoItem ? fullQuery : lastWord;
                    const kata = isMemoItem ? kataFull : kataLast;
                    if (!q) {
                        return 0;
                    }
                    let s = 0;
                    if (lbl.startsWith(q) || katLbl.startsWith(kata)) {
                        s = 4;
                    }
                    else if (lbl.includes(q) || katLbl.includes(kata)) {
                        s = 3;
                    }
                    else if (desc.includes(q) || toKatakana(desc).includes(kata)) {
                        s = 2;
                    }
                    else if (fuzzyMatch(lbl, q) || fuzzyMatch(katLbl, kata)) {
                        s = 1;
                    }
                    return s;
                };
                const allScored = memoAllItems.map(i => ({ item: i, s: score(i) })).filter(x => x.s > 0);
                if (phpFunctionItems.length > 0) {
                    // PHPファイル：PHP関数を先頭に、ラベル重複は完全除去
                    const phpItems = allScored.filter(x => x.item._isPhp).sort((a, b) => b.s - a.s);
                    const otherItems = allScored.filter(x => !x.item._isPhp).sort((a, b) => b.s - a.s);
                    const seenLabels = new Set();
                    const deduped = [];
                    for (const x of [...phpItems, ...otherItems]) {
                        if (!seenLabels.has(x.item.label)) {
                            seenLabels.add(x.item.label);
                            deduped.push({ ...x.item, filterText: value });
                        }
                    }
                    qp.items = deduped;
                }
                else {
                    qp.items = allScored.sort((a, b) => b.s - a.s).map(x => ({ ...x.item, filterText: value }));
                }
            });
            let accepted = false;
            qp.onDidAccept(async () => {
                const sel = qp.selectedItems[0];
                // PHP関数が選択された場合 → カーソル位置に挿入してQuickPickを閉じる
                if (sel && phpFunctionInsertMap.has(sel.label)) {
                    const insertText = phpFunctionInsertMap.get(sel.label);
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[\w_]+/);
                        editor.edit(editBuilder => {
                            if (wordRange) {
                                editBuilder.replace(wordRange, insertText);
                            }
                            else {
                                editBuilder.insert(editor.selection.active, insertText);
                            }
                        });
                    }
                    accepted = true;
                    resolve('');
                    qp.hide();
                }
                else if (sel && qp.items.length > 0) {
                    if ((sel.description === '見出し' || sel.description === 'メモ') && sel._lineNum !== undefined) {
                        // 見出し・メモ行 → ボックスに補完するだけ（検索・ジャンプしない）
                        suppressMemoItems = true; // 補完直後に同じ項目が再表示されるのを防ぐ
                        qp.value = sel.label + ' ';
                        qp.items = [];
                    }
                    else if (sel.description === '検索履歴') {
                        const raw = sel.label.replace(/^🕐\s*/, '');
                        accepted = true;
                        resolve(raw);
                        qp.hide();
                    }
                    else if (sel.description === '📌 用語') {
                        // 📌 用語 → lastWordが用語の先頭と一致するときだけ置き換え、そうでなければ検索へ
                        const raw = sel.label;
                        const parts = qp.value.split(/[\s　]+/);
                        const lastW = (parts[parts.length - 1] || '').toLowerCase();
                        if (raw.toLowerCase().startsWith(lastW) && lastW.length > 0) {
                            // 例: "has" → "has_post_thumbnail" に置き換えて続けて入力可能
                            parts[parts.length - 1] = raw;
                            qp.value = parts.join(' ') + ' ';
                            qp.items = [];
                        }
                        else {
                            // 例: "get_theme_file_uri とは" でEnter → そのまま検索
                            accepted = true;
                            resolve(qp.value.trim());
                            qp.hide();
                        }
                    }
                    else {
                        // CSS/JSプロパティ → 最後の単語を選択テキストで置き換え（続けて入力可能）
                        const raw = sel.label.replace(/^🕐\s*/, '');
                        const parts = qp.value.split(/[\s　]+/);
                        parts[parts.length - 1] = raw;
                        qp.value = parts.join(' ') + ' ';
                        qp.items = [];
                    }
                }
                else {
                    // 候補なし or 空 → 確定して検索
                    accepted = true;
                    resolve(qp.value.trim());
                    qp.hide();
                }
            });
            qp.onDidHide(() => {
                // ESCで閉じた時も入力テキストを履歴に保存（途中入力を拾う）
                const lastTyped = qp.value.trim();
                if (!accepted && lastTyped) {
                    memoSearchHistory = [lastTyped, ...memoSearchHistory.filter(h => h !== lastTyped)].slice(0, 10);
                }
                qp.dispose();
                if (!accepted) {
                    resolve('');
                }
            });
            // PHP補完用（カーソル末尾） → show()後にvalue設定
            // メモ検索用（全選択） → show()前にvalue設定
            if (currentWordForPhp) {
                qp.show();
                qp.value = currentWordForPhp;
            }
            else {
                // 選択テキスト優先 → なければ検索履歴
                const initVal = selectedText || memoSearchHistory[0] || '';
                if (initVal) {
                    qp.value = initVal;
                }
                qp.show();
            }
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
    // 検索履歴に追加（最新10件・重複除去）
    memoSearchHistory = [query, ...memoSearchHistory.filter(h => h !== query)].slice(0, 10);
    try {
        // メモファイル読み込み
        const memoUri = vscode.Uri.file(memoFilePath);
        const memoDoc = await vscode.workspace.openTextDocument(memoUri);
        const memoContent = memoDoc.getText();
        // withProgress は searchWithGemini だけ（QuickPick以降は外で実行）
        let geminiResults = [];
        let aiAnswer = '';
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '🔍→🤖 Geminiで検索中...',
                cancellable: false
            }, async () => {
                const geminiResponse = await searchWithGemini(query, memoContent);
                geminiResults = geminiResponse.results;
                aiAnswer = geminiResponse.aiAnswer;
            });
        }
        catch (e) {
            vscode.window.showErrorMessage(`Gemini検索エラー: ${e.message}`);
            return;
        }
        if (geminiResults.length === 0) {
            return;
        }
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
        // QuickPickで選択
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
            return { label: `行 ${r.line}: 【${bracketText}】`, description: `🔑 ${r.keyword}`, detail: detailParts.join('    '), line: r.line, answer: r.answer };
        });
        if (aiAnswer) {
            const line1 = aiAnswer.length > 80 ? aiAnswer.slice(0, 80) + '…' : aiAnswer;
            const line2 = aiAnswer.length > 80 ? aiAnswer.slice(80) : '';
            items.splice(2, 0, { label: `🤖 ${line1}`, description: '', detail: line2 || undefined, line: -1 });
        }
        const selected = await vscode.window.showQuickPick(items, { placeHolder: `${geminiResults.length}件見つかりました`, matchOnDetail: true });
        if (!selected) {
            return;
        }
        // セクション境界取得ヘルパー（## 単位）
        const getSectionBounds = (refLineIdx) => {
            let start = refLineIdx;
            for (let i = refLineIdx; i >= 0; i--) {
                if (/^##?\s/.test(memoLines[i])) {
                    start = i;
                    break;
                }
            }
            let end = memoLines.length;
            for (let i = start + 1; i < memoLines.length; i++) {
                if (/^##?\s/.test(memoLines[i])) {
                    end = i;
                    break;
                }
            }
            return { start, end };
        };
        if (selected.line !== -1) {
            lastMemoResultIndex = lastMemoResults.findIndex(r => r.line === selected.line);
            await jumpToLine(selected.line);
        }
        else if (aiAnswer) {
            // AI回答アイテム選択 → 関連セクションに追記
            const { start: secStart, end: secEnd } = getSectionBounds(geminiResults[0].line - 1);
            const fullSec = memoLines.slice(secStart, secEnd).join('\n');
            if (!fullSec.includes(`### ${query}`)) {
                const edit = new vscode.WorkspaceEdit();
                edit.insert(memoDoc.uri, new vscode.Position(secEnd, 0), `\n### ${query}\n${aiAnswer}\n`);
                await vscode.workspace.applyEdit(edit);
                await memoDoc.save();
                await jumpToLine(secEnd + 1);
            }
        }
    }
    catch (e) {
        vscode.window.showErrorMessage(`メモファイル読み込みエラー: ${e.message}`);
    }
}
/**
 * 一括カテゴリ判定（未分類の見出しをGeminiで一括分類してjsonに保存）
 */
async function handleBatchCategorize() {
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const memoFilePath = config.get('memoFilePath', '');
    const geminiApiKey = config.get('geminiApiKey', '');
    const categoryList = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML', 'WordPress']);
    if (!memoFilePath) {
        vscode.window.showErrorMessage('メモファイルパスが設定されていません。');
        return;
    }
    if (!geminiApiKey) {
        vscode.window.showErrorMessage('Gemini APIキーが設定されていません。');
        return;
    }
    try {
        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
        const lines = memoContent.split('\n');
        // 未分類の見出しを抽出
        const uncategorized = [];
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^#{2,3}\s+(.+)/);
            if (!match) {
                continue;
            }
            const fullTitle = match[1].trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
            const title = fullTitle.replace(/【日付】\d{4}-\d{2}-\d{2}\s*/g, '').trim()
                .split(/[\s　]+/).filter(p => p.trim())
                .reduce((acc, word, idx, arr) => {
                const isCat = categoryList.find(c => c.toLowerCase() === word.toLowerCase());
                return (isCat && idx === arr.length - 1) ? arr.slice(0, -1).join(' ') : acc + (acc ? ' ' : '') + word;
            }, '');
            // 見出し以下3行をプレビューとして取得（次の見出しは除く）
            const previewLines = [];
            for (let j = i + 1; j < lines.length && previewLines.length < 3; j++) {
                if (/^#{2,3}\s+/.test(lines[j])) {
                    break;
                }
                const l = lines[j].trim();
                if (l) {
                    previewLines.push(l);
                }
            }
            const preview = previewLines.join(' / ');
            uncategorized.push({ index: uncategorized.length, title, preview });
        }
        if (uncategorized.length === 0) {
            vscode.window.showInformationMessage('✅ 全ての見出しは既にカテゴリ判定済みです');
            return;
        }
        // 100件ずつバッチ処理
        const BATCH_SIZE = 100;
        let processed = 0;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `🔍 カテゴリ一括判定中... 未分類 ${uncategorized.length} 件`,
            cancellable: false
        }, async () => {
            for (let i = 0; i < uncategorized.length; i += BATCH_SIZE) {
                const batch = uncategorized.slice(i, i + BATCH_SIZE);
                // ローカルインデックス（0始まり）でプロンプトを作成
                const titleList = batch.map((h, localIdx) => h.preview ? `${localIdx}: ${h.title}（内容: ${h.preview}）` : `${localIdx}: ${h.title}`).join('\n');
                const prompt = `以下の見出し一覧を、カテゴリ候補に従って分類してください。

【カテゴリ候補】
${categoryList.join(' / ')}

【見出し一覧】
${titleList}

【指示】
- 各見出しを最も近いカテゴリに分類する
- 候補に合わない場合は先頭のカテゴリ（${categoryList[0]}）にする
- JSON配列のみ返す（他のテキスト禁止）

出力形式: [{"i":0,"c":"その他"},{"i":1,"c":"WordPress"}]`;
                const postData = JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' }
                });
                const raw = await callGeminiApi(geminiApiKey, 'gemini-3.1-flash-lite-preview', postData);
                const parsed = JSON.parse(raw);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
                try {
                    const results = JSON.parse(text);
                    for (const r of results) {
                        const heading = batch[r.i]; // ローカルインデックスで参照
                        if (!heading) {
                            continue;
                        }
                        const existing = quizHistoryMap.get(heading.title);
                        if (existing) {
                            existing.aiCategory = r.c;
                        }
                        else {
                            quizHistoryMap.set(heading.title, {
                                title: heading.title, line: 0, lastReviewed: 0, reviewCount: 0, aiCategory: r.c
                            });
                        }
                        processed++;
                    }
                }
                catch (e) {
                    console.error('[BatchCategorize] JSON解析エラー:', e);
                }
            }
            saveQuizHistory();
        });
        vscode.window.showInformationMessage(`✅ ${processed} 件のカテゴリを判定・保存しました`);
    }
    catch (e) {
        vscode.window.showErrorMessage(`一括カテゴリ判定エラー: ${e.message}`);
    }
}
// ========================================
// クイズ Webview パネル
// ========================================
let quizWebviewPanel;
let quizWebviewResolve;
function mapWebviewChoice(choice) {
    switch (choice) {
        case 'easy': return { eval: 3 };
        case 'normal': return { eval: 2 };
        case 'hard': return { eval: 1 };
        case 'deepdive': return { action: 'deepdive' };
        case 'correct': return { action: 'correct' };
        case 'exit': return { action: 'exit' };
        default: return null;
    }
}
function getQuizWebviewHtml(question, rawAnswer, category, isRepeat) {
    // マークダウン → HTML 簡易変換
    function renderAnswer(text) {
        const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
        return parts.map((part, idx) => {
            if (idx % 2 === 1) {
                const m = part.match(/```(\w*)\n([\s\S]*?)```/);
                if (m) {
                    const code = m[2].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `<pre><code>${code}</code></pre>`;
                }
            }
            const html = part
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
                .replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
            return `<span class="text-part">${html}</span>`;
        }).join('');
    }
    const answerHtml = renderAnswer(rawAnswer);
    const repeatBadge = isRepeat ? '<span class="badge badge-repeat">復習</span>' : '<span class="badge badge-first">初回</span>';
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 14px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px;
    max-width: 900px;
    margin: 0 auto;
    line-height: 1.6;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .category {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: bold;
  }
  .badge-first  { background: #1a6b3a; color: #cfffdf; }
  .badge-repeat { background: #2c4a8a; color: #cce0ff; }
  .question {
    font-size: 18px;
    font-weight: bold;
    padding: 14px 18px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-left: 4px solid var(--vscode-focusBorder, #007acc);
    border-radius: 0 6px 6px 0;
    margin-bottom: 20px;
  }
  .answer-box {
    background: var(--vscode-editorWidget-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 20px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .answer-box .text-part { white-space: pre-wrap; }
  pre {
    background: var(--vscode-textCodeBlock-background, #0a0a0a);
    border-radius: 4px;
    padding: 12px;
    overflow-x: auto;
    margin: 8px 0;
    white-space: pre;
  }
  code { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
  code.inline {
    background: var(--vscode-textCodeBlock-background, #0a0a0a);
    padding: 1px 5px;
    border-radius: 3px;
  }
  strong { font-weight: bold; color: var(--vscode-charts-yellow, #daa520); }
  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
  }
  .eval-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  button {
    padding: 8px 16px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    transition: filter 0.15s;
  }
  button:hover { filter: brightness(1.2); }
  .btn-easy   { background: #1a5c1a; color: #ccffcc; }
  .btn-normal { background: #5a4a00; color: #fff3cc; }
  .btn-hard   { background: #6a1a1a; color: #ffcccc; }
  .btn-special {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  .divider { border: none; border-top: 1px solid var(--vscode-panel-border, #444); margin: 14px 0; }
</style>
</head>
<body>
  <div class="header">
    <span class="category">📂 ${category}</span>
    ${repeatBadge}
  </div>
  <div class="question">🎯 ${question.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  <div class="section-label">📝 答え</div>
  <div class="answer-box">${answerHtml}</div>
  <hr class="divider">
  <div class="section-label">理解度を評価してください</div>
  <div class="eval-buttons">
    <button class="btn-easy"   onclick="send('easy')">😊 簡単</button>
    <button class="btn-normal" onclick="send('normal')">😐 普通</button>
    <button class="btn-hard"   onclick="send('hard')">😓 難しい</button>
  </div>
  <div class="eval-buttons">
    <button class="btn-special" onclick="send('deepdive')">🔍 深掘り質問</button>
    <button class="btn-special" onclick="send('exit')">✅ 終了</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  function send(action) { vscode.postMessage({ action }); }
</script>
</body>
</html>`;
}
function showQuizAnswerWebview(question, answer, category, isRepeat) {
    return new Promise((resolve) => {
        quizWebviewResolve = resolve;
        if (!quizWebviewPanel) {
            quizWebviewPanel = vscode.window.createWebviewPanel('quizAnswer', '🎯 クイズ回答', { viewColumn: vscode.ViewColumn.Two, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
            quizWebviewPanel.webview.onDidReceiveMessage(message => {
                if (quizWebviewResolve) {
                    const cb = quizWebviewResolve;
                    quizWebviewResolve = undefined;
                    cb(message.action);
                }
            });
            quizWebviewPanel.onDidDispose(() => {
                quizWebviewPanel = undefined;
                if (quizWebviewResolve) {
                    const cb = quizWebviewResolve;
                    quizWebviewResolve = undefined;
                    cb('exit');
                }
            });
        }
        quizWebviewPanel.webview.html = getQuizWebviewHtml(question, answer, category, isRepeat);
        quizWebviewPanel.reveal(vscode.ViewColumn.Two, true);
    });
}
/**
 * クイズのメイン処理
 * @param showFilterPick trueのときフィルタQuickPickを表示（デフォルトfalse）
 */
async function handleQuiz(showFilterPick = false) {
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
        // 見出し（## / ### xxx）を抽出
        const categoryList = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML', 'WordPress']);
        const defaultCategory = categoryList.length > 0 ? categoryList[0] : 'その他';
        const headings = [];
        let parentH2Title = ''; // ### 見出しの親テーマ（直前の ## タイトル）を追跡
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^#{2,3}\s+(.+)/);
            if (match) {
                const isH3 = lines[i].startsWith('### ');
                // ## 見出しなら親テーマとして記録（### には引き継ぐだけ）
                if (!isH3) {
                    // ## の生タイトルを parentH2Title として保持（カテゴリ除去・日付除去前）
                    parentH2Title = match[1].trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
                }
                // 見えない文字や制御文字を除去
                const fullTitle = match[1].trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
                // 【日付】yyyy-MM-dd または yyyy-MM-dd を抽出（見出し行 OR 直後5行以内）
                let headingDate = null;
                const inlineDateMatch = fullTitle.match(/(?:【日付】)?(\d{4}-\d{2}-\d{2})/);
                if (inlineDateMatch) {
                    headingDate = inlineDateMatch[1];
                }
                else {
                    // 見出し直後5行以内を検索（【日付】付き or 日付のみの行）
                    for (let k = i + 1; k < Math.min(i + 6, lines.length); k++) {
                        if (lines[k].match(/^#{2,3}\s+/)) {
                            break;
                        }
                        const nearDateMatch = lines[k].match(/(?:【日付】)?(\d{4}-\d{2}-\d{2})/);
                        if (nearDateMatch) {
                            headingDate = nearDateMatch[1];
                            break;
                        }
                    }
                }
                const titleWithoutDate = fullTitle.replace(/【日付】\d{4}-\d{2}-\d{2}\s*/g, '').trim();
                let title = titleWithoutDate;
                let category = '';
                // カテゴリ: 見出し末尾が登録カテゴリに一致（大小文字・全半角空白無視）
                const titleParts = titleWithoutDate.split(/[\s　]+/).filter(p => p.trim());
                if (titleParts.length >= 2) {
                    const lastWord = titleParts[titleParts.length - 1];
                    const matchedCategory = categoryList.find(cat => cat.toLowerCase() === lastWord.toLowerCase());
                    if (matchedCategory) {
                        category = lastWord;
                        title = titleParts.slice(0, -1).join(' ');
                    }
                }
                // aiCategoryが最優先（一括判定で修正済みの場合）、なければ末尾キーワード、それもなければデフォルト
                const savedAiCat = quizHistoryMap.get(title)?.aiCategory;
                if (savedAiCat) {
                    category = savedAiCat;
                }
                else if (!category) {
                    category = defaultCategory;
                }
                const content = [];
                // ### 見出しの場合：親の ## タイトルをテーマとして冒頭に付与（主語補完）
                if (isH3 && parentH2Title) {
                    // 親タイトルからカテゴリ語・日付を除去してシンプル化
                    const cleanParentTitle = parentH2Title
                        .replace(/【日付】\d{4}-\d{2}-\d{2}\s*/g, '')
                        .split(/[\s　]+/)
                        .filter(p => p.trim() && !categoryList.some(cat => cat.toLowerCase() === p.toLowerCase()))
                        .join(' ')
                        .trim();
                    if (cleanParentTitle) {
                        content.push(`【テーマ: ${cleanParentTitle}】`);
                    }
                }
                // 内容: 見出しの下（次の見出しまで）
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].match(/^#{2,3}\s+/)) {
                        break;
                    }
                    if (lines[j].trim()) {
                        content.push(lines[j]);
                    }
                }
                if (content.length > 0) {
                    headings.push({ line: i + 1, title, content, category, date: headingDate });
                }
            }
        }
        if (headings.length === 0) {
            vscode.window.showInformationMessage('メモに見出し（##/###）が見つかりませんでした');
            return;
        }
        // === バックグラウンド生成: questionText がない見出しを10件まで並列生成（5分に1回・待ち時間ゼロ） ===
        const pregenApiKey = config.get('geminiApiKey', '');
        const PREGEN_INTERVAL = 5 * 60 * 1000; // 5分
        if (pregenApiKey && Date.now() - lastPregenTime >= PREGEN_INTERVAL) {
            lastPregenTime = Date.now();
            // 直近の日付順（新しい順）で未生成のものを10件取得
            const needsGen = headings
                .filter(h => !quizHistoryMap.get(h.title)?.questionText)
                .sort((a, b) => {
                if (!a.date && !b.date) {
                    return 0;
                }
                if (!a.date) {
                    return 1;
                }
                if (!b.date) {
                    return -1;
                }
                return b.date.localeCompare(a.date); // 新しい順
            })
                .slice(0, 3);
            if (needsGen.length > 0) {
                const buildPregenPrompt = (h) => {
                    const filteredContent = h.content.filter(line => !/^\s*```/.test(line));
                    const contentPreview = filteredContent.slice(0, 10).join('\n');
                    const currentCategory = h.category || '';
                    const categoryHint = currentCategory ? `\n\n【このメモのカテゴリ】\n${currentCategory}\n→ コードの細部ではなく「${currentCategory}の概念・仕組み・使い方」を問う問題にすること` : '';
                    return `以下のメモの見出しをもとに、クイズ問題とカテゴリをJSON形式で返してください。\n\n【見出しのフォーマット説明】\n見出しは「条件 → 結果（解決策）」の形式で書かれていることがあります。\n例：「mix-blend-mode: screen → 動画の黒が透過する（炎素材に使う）」\nこの形式の場合、「条件（何をしたとき）」を問う問題を作ってください。\n\n【見出し】（これを問題にする）\n${h.title}\n\n【内容】（見出しの意味理解のためだけに使う。内容の細部から問題を作らない）\n${contentPreview}\n\n【カテゴリ候補】\n${categoryList.join(' / ')}${categoryHint}\n\n【要件】\n- questionは【見出し】を問い形式にしたもの\n- 見出しが既に「？」で終わる場合はそのまま使ってよい\n- questionは50文字以内（明確さ優先）\n- questionは必ず「？」で終わる\n- questionは質問のみ（前置き禁止）\n- categoryはカテゴリ候補から1つ選ぶ\n\n出力形式（JSONのみ）:\n{"question": "質問文？", "category": "CSS"}`;
                };
                // バックグラウンドで並列実行（await しない → リスト表示をブロックしない）
                const pregenStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
                pregenStatus.text = `$(sync~spin) 問題生成中 0/${needsGen.length}件`;
                pregenStatus.show();
                let pregenDone = 0;
                Promise.all(needsGen.map(async (h) => {
                    try {
                        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${pregenApiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ contents: [{ parts: [{ text: buildPregenPrompt(h) }] }], generationConfig: { responseMimeType: 'application/json' } })
                        });
                        if (resp.ok) {
                            const data = await resp.json();
                            const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                            if (raw) {
                                const parsed = JSON.parse(raw);
                                if (parsed.question) {
                                    const existing = quizHistoryMap.get(h.title);
                                    if (existing) {
                                        existing.questionText = parsed.question;
                                        if (!existing.aiCategory && parsed.category) {
                                            existing.aiCategory = parsed.category;
                                        }
                                    }
                                    else {
                                        quizHistoryMap.set(h.title, { title: h.title, line: h.line, lastReviewed: 0, reviewCount: 0, questionText: parsed.question, aiCategory: parsed.category || '' });
                                    }
                                }
                            }
                        }
                    }
                    catch (_e) { /* 失敗しても無視 */ }
                    pregenDone++;
                    pregenStatus.text = `$(sync~spin) 問題生成中 ${pregenDone}/${needsGen.length}件`;
                })).then(() => {
                    saveQuizHistory();
                    pregenStatus.text = `$(check) 問題生成完了 ${pregenDone}件`;
                    setTimeout(() => pregenStatus.dispose(), 4000);
                });
            }
        }
        // ========================================
        // リストモード（USE_QUIZ_LIST_MODE = true のとき）
        // false にすると元のフィルタQuickPickに戻る
        // ========================================
        const USE_QUIZ_LIST_MODE = true;
        let preSelectedQuiz = undefined;
        if (USE_QUIZ_LIST_MODE && (showFilterPick || lastTopMode)) {
            // 日付計算（メモ絞り込み用）
            const _now = Date.now();
            const _pad2 = (n) => String(n).padStart(2, '0');
            const _today = new Date(_now);
            const _todayStr = `${_today.getFullYear()}-${_pad2(_today.getMonth() + 1)}-${_pad2(_today.getDate())}`;
            const _yesterday = new Date(_now - 24 * 60 * 60 * 1000);
            const _yesterdayStr = `${_yesterday.getFullYear()}-${_pad2(_yesterday.getMonth() + 1)}-${_pad2(_yesterday.getDate())}`;
            const _weekAgo = new Date(_now);
            _weekAgo.setDate(_weekAgo.getDate() - 6);
            const _weekAgoStr = `${_weekAgo.getFullYear()}-${_pad2(_weekAgo.getMonth() + 1)}-${_pad2(_weekAgo.getDate())}`;
            const _monthAgo = new Date(_now);
            _monthAgo.setDate(_monthAgo.getDate() - 29);
            const _monthAgoStr = `${_monthAgo.getFullYear()}-${_pad2(_monthAgo.getMonth() + 1)}-${_pad2(_monthAgo.getDate())}`;
            let selectedMode = '';
            // stagingLevel が設定済みの問題はすべて日付フィルターから除外（Stagingへ移動扱い）
            const stagedTitles = new Set([...quizHistoryMap.values()].filter(h => h.stagingLevel).map(h => h.title));
            if (showFilterPick) {
                const unstagedHeadings = headings.filter(h => !stagedTitles.has(h.title));
                const todayCount = unstagedHeadings.filter(h => h.date === _todayStr).length;
                const yesterdayCount = unstagedHeadings.filter(h => h.date === _yesterdayStr).length;
                const weekCount = unstagedHeadings.filter(h => h.date && h.date >= _weekAgoStr).length;
                const monthCount = unstagedHeadings.filter(h => h.date && h.date >= _monthAgoStr).length;
                const historyCount = [...quizHistoryMap.values()].filter(h => h.lastReviewed >= _now - 7 * 24 * 60 * 60 * 1000).length;
                const staging1Count = [...quizHistoryMap.values()].filter(h => h.stagingLevel === 1).length;
                const staging2Count = [...quizHistoryMap.values()].filter(h => h.stagingLevel === 2).length;
                // 統計: 総問題数・回答済み・今日・連続日数
                const totalQuestions = headings.length;
                const answeredTotal = [...quizHistoryMap.values()].filter(h => h.lastAnsweredDate).length;
                const todayAnswered = [...quizHistoryMap.values()].filter(h => h.lastAnsweredDate === _todayStr).length;
                const allAnsweredDates = new Set([...quizHistoryMap.values()].filter(h => h.lastAnsweredDate).map(h => h.lastAnsweredDate));
                let streak = 0;
                const streakStart = new Date(_todayStr);
                if (!allAnsweredDates.has(_todayStr)) {
                    streakStart.setDate(streakStart.getDate() - 1);
                }
                for (let si = 0; si < 365; si++) {
                    const d = new Date(streakStart);
                    d.setDate(streakStart.getDate() - si);
                    if (allAnsweredDates.has(d.toISOString().slice(0, 10))) {
                        streak++;
                    }
                    else {
                        break;
                    }
                }
                const streakLabel = streak > 0 ? `  🔥${streak}日連続` : '';
                const staging3Count = [...quizHistoryMap.values()].filter(h => h.stagingLevel === 3).length;
                const htmlCount = unstagedHeadings.filter(h => h.category?.toLowerCase() === 'html').length;
                const wpCount = unstagedHeadings.filter(h => h.category?.toLowerCase().includes('wordpress')).length;
                const topItems = [
                    { label: `📅 今日のメモから出題`, description: `${todayCount}件`, mode: 'today' },
                    { label: `📅 昨日のメモから出題`, description: `${yesterdayCount}件`, mode: 'yesterday' },
                    { label: `📅 今週のメモから出題`, description: `${weekCount}件`, mode: 'week' },
                    { label: `📅 ここ1ヶ月のメモから出題`, description: `${monthCount}件`, mode: 'month' },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    { label: `📚 クイズ履歴から選ぶ（1週間）`, description: `${historyCount}件`, mode: 'history' },
                    { label: '🎲 ランダムで出題', description: '通常モード', mode: 'random' },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    { label: `🌐 HTML のみ`, description: `${htmlCount}件`, mode: 'html-only' },
                    { label: `🟦 WordPress のみ`, description: `${wpCount}件`, mode: 'wordpress-only' },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    { label: `🧠 暗記すべきこと`, description: `Staging 1  ${staging1Count}件`, mode: 'staging1' },
                    { label: `🔵 もう少しで覚えられそう`, description: `Staging 2  ${staging2Count}件`, mode: 'staging2' },
                    { label: `⭐ 完全に理解した`, description: `Staging 3  ${staging3Count}件`, mode: 'staging3' },
                ];
                const topPicked = await vscode.window.showQuickPick(topItems, {
                    placeHolder: '出題方法を選んでください',
                    title: `📊 ${totalQuestions}問中 ${answeredTotal}問回答済  |  今日 ${todayAnswered}問${streakLabel}`,
                });
                if (!topPicked) {
                    return;
                }
                selectedMode = topPicked.mode || '';
                if (selectedMode && selectedMode !== 'random') {
                    lastTopMode = selectedMode; // 次回の評価後に再利用（staging1/2/3も保持）
                }
            }
            else {
                // 評価後 → トップ画面スキップ、前回のモードをそのまま使用
                selectedMode = lastTopMode;
            }
            if (selectedMode === 'random' || selectedMode === '') {
                // そのまま下のランダムロジックへ
            }
            else if (selectedMode === 'html-only' || selectedMode === 'wordpress-only') {
                // カテゴリ別一覧から選ぶ
                const targetCat = selectedMode === 'wordpress-only' ? 'wordpress' : 'html';
                const filtered = headings.filter(h => {
                    if (stagedTitles.has(h.title)) {
                        return false;
                    }
                    return h.category?.toLowerCase().includes(targetCat);
                });
                if (filtered.length === 0) {
                    vscode.window.showInformationMessage('該当するカテゴリのメモが見つかりませんでした。出題方法を選び直してください。');
                    lastTopMode = '';
                    await handleQuiz(true);
                    return;
                }
                const memoItems = filtered.map(h => {
                    const hist = quizHistoryMap.get(h.title);
                    let mark = '';
                    if (hist?.lastAnsweredDate) {
                        const lastEval = hist.evaluations?.[hist.evaluations.length - 1];
                        mark = lastEval === 3 ? '✓ ' : '↺ ';
                    }
                    const stagingMark = hist?.stagingLevel === 1 ? '🧠 ' : hist?.stagingLevel === 2 ? '🔵 ' : hist?.stagingLevel === 3 ? '⭐ ' : '';
                    const displayLabel = hist?.questionText || h.title;
                    return {
                        label: mark + stagingMark + displayLabel,
                        description: `${h.date || ''}  ${h.category || ''}`,
                        heading: h,
                    };
                });
                const memoPicked = await vscode.window.showQuickPick(memoItems, {
                    placeHolder: '出題する問題を選んでください',
                    matchOnDescription: true,
                });
                if (!memoPicked) {
                    await handleQuiz(true);
                    return;
                }
                preSelectedQuiz = memoPicked.heading;
            }
            else if (selectedMode === 'today' || selectedMode === 'yesterday' || selectedMode === 'week' || selectedMode === 'month') {
                // メモ一覧から選ぶ
                const filtered = headings.filter(h => {
                    if (!h.date) {
                        return false;
                    }
                    if (stagedTitles.has(h.title)) {
                        return false;
                    } // staging済みは除外
                    if (selectedMode === 'today') {
                        return h.date === _todayStr;
                    }
                    if (selectedMode === 'yesterday') {
                        return h.date === _yesterdayStr;
                    }
                    if (selectedMode === 'month') {
                        return h.date >= _monthAgoStr;
                    }
                    return h.date >= _weekAgoStr;
                });
                if (filtered.length === 0) {
                    vscode.window.showInformationMessage('該当する期間のメモが見つかりませんでした。出題方法を選び直してください。');
                    lastTopMode = ''; // リセットしてトップ画面へ
                    await handleQuiz(true);
                    return;
                }
                const memoItems = filtered.map(h => {
                    const hist = quizHistoryMap.get(h.title);
                    let mark = '';
                    if (hist?.lastAnsweredDate) {
                        const lastEval = hist.evaluations?.[hist.evaluations.length - 1];
                        mark = lastEval === 3 ? '✓ ' : '↺ ';
                    }
                    const displayLabel = hist?.questionText || h.title;
                    if (!mark && hist?.questionText && !hist?.lastAnsweredDate) {
                        mark = '🆕 ';
                    }
                    const stagingMark = hist?.stagingLevel === 1 ? '🧠 ' : hist?.stagingLevel === 2 ? '🔵 ' : hist?.stagingLevel === 3 ? '⭐ ' : '';
                    return {
                        label: mark + stagingMark + displayLabel,
                        description: `${h.date || ''}  ${h.category || ''}`,
                        heading: h,
                    };
                });
                const memoPicked = await vscode.window.showQuickPick(memoItems, {
                    placeHolder: '出題する問題を選んでください',
                    matchOnDescription: true,
                });
                if (!memoPicked) {
                    await handleQuiz(true);
                    return;
                }
                preSelectedQuiz = memoPicked.heading;
            }
            else if (selectedMode === 'history') {
                // クイズ履歴リスト（1週間）
                const oneWeekAgo = _now - 7 * 24 * 60 * 60 * 1000;
                const recentHistory = [...quizHistoryMap.entries()]
                    .filter(([_, h]) => h.lastReviewed >= oneWeekAgo)
                    .sort((a, b) => b[1].lastReviewed - a[1].lastReviewed);
                const HIDE_BTN = { iconPath: new vscode.ThemeIcon('eye-closed'), tooltip: 'リストから非表示にする' };
                const SHOW_BTN = { iconPath: new vscode.ThemeIcon('eye'), tooltip: 'リストに戻す' };
                let showHidden = false;
                function buildListItems() {
                    const items = [];
                    const visible = recentHistory.filter(([_, h]) => showHidden ? h.hiddenFromList : !h.hiddenFromList);
                    if (visible.length === 0) {
                        items.push({ label: showHidden ? '（非表示の項目なし）' : '（過去1週間の履歴なし）', description: '' });
                    }
                    else {
                        for (const [title, history] of visible) {
                            const date = new Date(history.lastReviewed).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
                            let answeredMark = '';
                            if (history.lastAnsweredDate) {
                                const lastEval = history.evaluations?.[history.evaluations.length - 1];
                                answeredMark = lastEval === 3 ? '✓ ' : '↺ ';
                            }
                            const stagingMark = history.stagingLevel === 1 ? '🧠 ' : history.stagingLevel === 2 ? '🔵 ' : history.stagingLevel === 3 ? '⭐ ' : '';
                            items.push({
                                label: answeredMark + (history.hiddenFromList ? '🙈 ' : '') + stagingMark + (history.questionText || title),
                                description: `${date}  ${history.aiCategory || ''}`,
                                quizTitle: title,
                                buttons: [history.hiddenFromList ? SHOW_BTN : HIDE_BTN],
                            });
                        }
                    }
                    const hiddenCount = recentHistory.filter(([_, h]) => h.hiddenFromList).length;
                    if (hiddenCount > 0) {
                        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                        items.push({
                            label: showHidden ? '📋 通常の一覧に戻す' : `📋 非表示の項目を表示 (${hiddenCount}件)`,
                            description: '',
                            isShowHidden: true,
                        });
                    }
                    return items;
                }
                const qp = vscode.window.createQuickPick();
                qp.placeholder = '復習したい問題を選ぶ（ESCでキャンセル）';
                qp.matchOnDescription = true;
                qp.items = buildListItems();
                const picked = await new Promise(resolve => {
                    qp.onDidTriggerItemButton(e => {
                        const item = e.item;
                        if (!item.quizTitle) {
                            return;
                        }
                        const h = quizHistoryMap.get(item.quizTitle);
                        if (!h) {
                            return;
                        }
                        h.hiddenFromList = !h.hiddenFromList;
                        saveQuizHistory();
                        qp.items = buildListItems();
                    });
                    qp.onDidAccept(() => {
                        const sel = qp.activeItems[0];
                        if (sel?.isShowHidden) {
                            showHidden = !showHidden;
                            qp.items = buildListItems();
                            return;
                        }
                        resolve(sel);
                        qp.dispose();
                    });
                    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
                    qp.show();
                });
                if (!picked) {
                    await handleQuiz(true);
                    return;
                }
                if (picked.quizTitle) {
                    preSelectedQuiz = headings.find(h => h.title === picked.quizTitle);
                    if (!preSelectedQuiz) {
                        vscode.window.showWarningMessage('メモから該当の問題が見つかりませんでした');
                        await handleQuiz(true);
                        return;
                    }
                }
            }
            else if (selectedMode === 'staging1' || selectedMode === 'staging2' || selectedMode === 'staging3') {
                // Stagingリストから選ぶ
                const stagingLevelNum = selectedMode === 'staging1' ? 1 : selectedMode === 'staging2' ? 2 : 3;
                const stagingTitles = new Set([...quizHistoryMap.entries()]
                    .filter(([_, h]) => h.stagingLevel === stagingLevelNum)
                    .map(([title]) => title));
                const stagingFiltered = headings.filter(h => stagingTitles.has(h.title));
                if (stagingFiltered.length === 0) {
                    const labels = { 1: '🧠 Staging 1（暗記すべきこと）', 2: '🔵 Staging 2（もう少しで）', 3: '⭐ Staging 3（完全に理解）' };
                    vscode.window.showInformationMessage(`${labels[stagingLevelNum]} にまだ項目がありません。`);
                    lastTopMode = '';
                    await handleQuiz(true);
                    return;
                }
                const stagingItems = stagingFiltered.map(h => {
                    const hist = quizHistoryMap.get(h.title);
                    let mark = '';
                    if (hist?.lastAnsweredDate) {
                        const lastEval = hist.evaluations?.[hist.evaluations.length - 1];
                        mark = lastEval === 3 ? '✓ ' : '↺ ';
                    }
                    const displayLabel = hist?.questionText || h.title;
                    return {
                        label: mark + displayLabel,
                        description: `${h.date || ''}  ${h.category || ''}`,
                        heading: h,
                    };
                });
                const stagingPicked = await vscode.window.showQuickPick(stagingItems, {
                    placeHolder: '出題する問題を選んでください',
                    matchOnDescription: true,
                });
                if (!stagingPicked) {
                    await handleQuiz(true);
                    return;
                }
                preSelectedQuiz = stagingPicked.heading;
            }
        }
        // フィルタQuickPick（USE_QUIZ_LIST_MODE が false のときのみ表示）
        const allCategories = ['全カテゴリ', ...categoryList];
        const dateOptions = ['全期間', '今日', '昨日', '今週'];
        const filterItems = [];
        if (!showFilterPick || (USE_QUIZ_LIST_MODE && !preSelectedQuiz)) {
            // フィルタQuickPickをスキップ → lastQuizFilterをそのまま使用
            // （リストモードでランダム選択時もlastQuizFilterをそのまま使う）
        }
        else if (!USE_QUIZ_LIST_MODE) {
            // 前回の選択を一番上に
            const isDefaultFilter = lastQuizFilter.date === '全期間' && lastQuizFilter.category === '全カテゴリ';
            if (!isDefaultFilter) {
                filterItems.push({ label: `⭐ 前回: ${lastQuizFilter.date} × ${lastQuizFilter.category}`, description: '前回の絞り込み' });
                filterItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            }
            // カテゴリのみ
            for (const cat of allCategories) {
                filterItems.push({ label: `📂 ${cat}`, description: 'カテゴリのみ（日付絞り込みなし）' });
            }
            filterItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            // 日付 × カテゴリ
            for (const date of dateOptions) {
                for (const cat of allCategories) {
                    filterItems.push({ label: `${date} × ${cat}`, description: '' });
                }
            }
            // 一括判定は一番下
            filterItems.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            filterItems.push({ label: '🗂 カテゴリ一括判定を実行', description: '未分類の見出しをGeminiで一括分類' });
            const selectedFilter = await vscode.window.showQuickPick(filterItems, {
                placeHolder: '絞り込みを選択（Escで全期間 × 全カテゴリ）',
                matchOnDescription: true
            });
            let filterDate = '全期間';
            let filterCategory = '全カテゴリ';
            if (selectedFilter) {
                if (selectedFilter.label.startsWith('🗂')) {
                    await handleBatchCategorize();
                    return;
                }
                else if (selectedFilter.label.startsWith('⭐')) {
                    filterDate = lastQuizFilter.date;
                    filterCategory = lastQuizFilter.category;
                }
                else if (selectedFilter.description === 'カテゴリのみ（日付絞り込みなし）') {
                    filterCategory = selectedFilter.label.replace('📂 ', '');
                    filterDate = '全期間';
                }
                else {
                    const parts = selectedFilter.label.split(' × ');
                    if (parts.length === 2) {
                        filterDate = parts[0].trim();
                        filterCategory = parts[1].trim();
                    }
                }
                lastQuizFilter = { date: filterDate, category: filterCategory };
                saveQuizHistory();
            }
        } // end showFilterPick
        const filterDate = lastQuizFilter.date;
        const filterCategory = lastQuizFilter.category;
        // 日付フィルタ用ヘルパー
        // ローカル時間で日付を生成（toISOStringはUTCなのでズレる）
        const now2 = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const todayStr = `${now2.getFullYear()}-${pad2(now2.getMonth() + 1)}-${pad2(now2.getDate())}`;
        const yesterday = new Date(now2);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
        const weekAgo = new Date(now2);
        weekAgo.setDate(weekAgo.getDate() - 6);
        function isInDateRange(dateStr, filter) {
            if (filter === '全期間') {
                return true;
            }
            if (!dateStr) {
                return false;
            } // 日付なしは全期間のみ対象（今日/昨日/今週では除外）
            if (filter === '今日') {
                return dateStr === todayStr;
            }
            if (filter === '昨日') {
                return dateStr === yesterdayStr;
            }
            if (filter === '今週') {
                return dateStr >= `${weekAgo.getFullYear()}-${pad2(weekAgo.getMonth() + 1)}-${pad2(weekAgo.getDate())}`;
            }
            return true;
        }
        let filteredHeadings = headings;
        // カテゴリフィルタ
        if (filterCategory !== '全カテゴリ') {
            filteredHeadings = filteredHeadings.filter(h => h.category.toLowerCase() === filterCategory.toLowerCase());
        }
        // 日付フィルタ
        if (filterDate !== '全期間') {
            filteredHeadings = filteredHeadings.filter(h => isInDateRange(h.date, filterDate));
        }
        if (!preSelectedQuiz && filteredHeadings.length === 0) {
            vscode.window.showWarningMessage(`「${filterDate} × ${filterCategory}」に一致する問題がまだありません。別の条件を選択してください。`);
            await handleQuiz(true);
            return;
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
        let quiz = preSelectedQuiz;
        if (!quiz) {
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
                // スキップ済み（10日以内）＆最近回答済みを除外した候補
                const available = filteredHeadings.filter(h => {
                    const hist = quizHistoryMap.get(h.title);
                    if (!hist) {
                        return true;
                    }
                    // スキップ済み（10日以内）除外
                    if (hist.reviewCount === -1) {
                        return (now - hist.lastReviewed) / ONE_DAY >= 10;
                    }
                    // 復習間隔が来ていない問題は除外（さっき答えた問題が再出題されない）
                    const daysSince = (now - hist.lastReviewed) / ONE_DAY;
                    const requiredInterval = getNextInterval(hist.reviewCount);
                    if (hist.lastReviewed > 0 && daysSince < requiredInterval) {
                        return false;
                    }
                    return true;
                });
                if (available.length === 0) {
                    vscode.window.showWarningMessage('現在の絞り込み条件で、いま出題できる問題がありません（復習待ちなど）。別の条件を選択してください。');
                    await handleQuiz(true);
                    return;
                }
                // 70%: 新規（未出題）を優先、なければ全体からランダム
                const unreviewed = available.filter(h => !quizHistoryMap.has(h.title));
                if (unreviewed.length > 0) {
                    const randomIndex = Math.floor(Math.random() * unreviewed.length);
                    quiz = unreviewed[randomIndex];
                }
                else {
                    const randomIndex = Math.floor(Math.random() * available.length);
                    quiz = available[randomIndex];
                }
            }
        } // end if (!quiz)
        if (!quiz) {
            return;
        }
        // 問題文の決定（初回のみGeminiで生成→JSON保存、2回目以降は保存済みを再利用）
        const geminiApiKey = config.get('geminiApiKey', '');
        const savedHistory = quizHistoryMap.get(quiz.title);
        // 初回かどうかの判定を、回答による状態変更前に確定しておく
        // lastReviewed > 0 でチェック（バックグラウンド事前生成は lastReviewed: 0 なので初回扱いになる）
        const wasAnsweredBefore = savedHistory ? savedHistory.lastReviewed > 0 : false;
        console.log('[Quiz][DEBUG] quiz.title:', quiz.title);
        console.log('[Quiz][DEBUG] savedHistory:', savedHistory ? JSON.stringify({ lastReviewed: savedHistory.lastReviewed, reviewCount: savedHistory.reviewCount, questionText: savedHistory.questionText?.substring(0, 30), aiCategory: savedHistory.aiCategory }) : 'undefined');
        console.log('[Quiz][DEBUG] wasAnsweredBefore:', wasAnsweredBefore);
        let questionText = quiz.title; // フォールバック
        if (savedHistory?.questionText) {
            // 2回目以降：JSONに保存済みの問題文を再利用（重複防止のため固定）
            questionText = savedHistory.questionText;
            console.log('[Quiz] 保存済み問題文を再利用:', questionText.substring(0, 50));
        }
        else if (geminiApiKey) {
            // 初回：Geminiで問題文を新規生成
            try {
                // コードブロック（```...```）を除いた先頭10行をプレビューとして使用
                const filteredContent = quiz.content.filter(line => !/^\s*```/.test(line));
                const contentPreview = filteredContent.slice(0, 10).join('\n');
                const currentCategory = quiz.category || '';
                const categoryHint = currentCategory ? `\n\n【このメモのカテゴリ】\n${currentCategory}\n→ コードの細部ではなく「${currentCategory}の概念・仕組み・使い方」を問う問題にすること` : '';
                const prompt = `以下のメモの見出しをもとに、クイズ問題とカテゴリをJSON形式で返してください。

【見出しのフォーマット説明】
見出しは「条件 → 結果（解決策）」の形式で書かれていることがあります。
例：「mix-blend-mode: screen → 動画の黒が透過する（炎素材に使う）」
この形式の場合、「条件（何をしたとき）」を問う問題を作ってください。

【見出し】（これを問題にする）
${quiz.title}

【内容】（見出しの意味理解のためだけに使う。内容の細部から問題を作らない）
${contentPreview}

【カテゴリ候補】
${categoryList.join(' / ')}${categoryHint}

【要件】
- questionは【見出し】を問い形式にしたもの（内容の細部から出題しない）
- 見出しが既に「？」で終わる場合はそのまま使ってよい
- questionは50文字以内（明確さを優先、短さは二の次）
- questionは必ず「？」で終わる
- questionは前置き・説明文は一切禁止、質問のみ
- categoryはカテゴリ候補から最も近いものを1つ選ぶ（候補に合わなければ「その他」）

悪い例:
× "inline-blockで中身の幅だけの箱を作るには？"（答えが含まれている）
× "display:inline-flexで横並びになる要素の間隔調整は？"（主語不明確）

良い例:
○ "中身の幅だけの箱を作るdisplayの値は？"
○ "Flexコンテナ内の子要素同士の間隔を一括設定するプロパティは？"
○ "動画の黒を透過させたいとき使うCSSプロパティと値は？"

出力形式（JSONのみ、他のテキスト禁止）:
{"question": "質問文？", "category": "CSS"}`;
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=' + geminiApiKey, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: 'application/json' }
                    })
                });
                if (response.ok) {
                    const data = await response.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                    if (rawText) {
                        try {
                            const parsed = JSON.parse(rawText);
                            if (parsed.question) {
                                questionText = parsed.question;
                                console.log('[Quiz] Gemini新規問題文を生成:', questionText.substring(0, 50));
                            }
                            if (parsed.category && !quizHistoryMap.get(quiz.title)?.aiCategory) {
                                // aiCategoryを履歴に保存
                                const existing = quizHistoryMap.get(quiz.title);
                                if (existing) {
                                    existing.aiCategory = parsed.category;
                                }
                                quiz.category = parsed.category;
                                console.log('[Quiz] Geminiカテゴリ判定:', parsed.category);
                            }
                        }
                        catch {
                            // JSON解析失敗時はテキストをそのまま問題文に
                            questionText = rawText;
                        }
                    }
                }
            }
            catch (e) {
                // エラー時はフォールバック（見出しのみ）
                console.error('Gemini問題生成エラー:', e);
            }
        }
        // QuickPickで問題表示（リストから選んだ場合はスキップして直接答えへ）
        let answerAction;
        if (preSelectedQuiz) {
            answerAction = 'answer';
        }
        else {
            const answer = await vscode.window.showQuickPick([
                { label: '💡 答えを見る', description: '', action: 'answer' },
                { label: '🔄 別の問題', description: '', action: 'next' }
            ], {
                placeHolder: `🎯 ${questionText}`,
                ignoreFocusOut: true
            });
            if (!answer) {
                return;
            } // キャンセル
            answerAction = answer.action;
        }
        if (answerAction === 'answer') {
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
            memoEditor.revealRange(memoRange, vscode.TextEditorRevealType.AtTop);
            // ハイライト（黄色フラッシュ 1.5秒）
            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: 'rgba(255, 255, 0, 0.3)'
            });
            memoEditor.setDecorations(decorationType, [memoRange]);
            setTimeout(() => decorationType.dispose(), 1500);
            // === 3. 初回 or 既回答かを判定 ===
            const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
            const claudeApiKey = config.get('claudeApiKey', '');
            const answerContent = quiz.content.join('\n');
            const fs = require('fs');
            const memoDir = path.dirname(memoFilePath);
            const answerFilePath = path.join(memoDir, 'クイズ回答.md');
            // 初回判定：以前に回答したことがあるか（questionText未保存でも既回答は既回答）
            const isFirstTime = !wasAnsweredBefore;
            console.log('[Quiz][DEBUG] isFirstTime:', isFirstTime, '| wasAnsweredBefore:', wasAnsweredBefore);
            console.log('[Quiz][DEBUG] claudeApiKey存在:', !!claudeApiKey);
            if (!isFirstTime) {
                // ===== 2回目以降：既存エントリにジャンプするだけ（Claude呼び出し・md書き込みなし）=====
                console.log('[Quiz][DEBUG] ★★★ 2回目以降ブランチに入りました → ジャンプのみ ★★★');
                if (!fs.existsSync(answerFilePath)) {
                    // ファイルが存在しない場合は初回パスへフォールスルー（ファイルが削除された等）
                    console.log('[Quiz][DEBUG] 2回目だがファイルなし → 初回パスへフォールスルー');
                }
                else {
                    quizAnswerDoc = await vscode.workspace.openTextDocument(answerFilePath);
                    const existingContent = quizAnswerDoc.getText();
                    const lines = existingContent.split('\n');
                    // 1. quiz-idマーカーで検索（Q:の文字を変えても壊れない・最優先）
                    const quizIdJumpMarker = `<!-- quiz-id: ${quiz.title} -->`;
                    let jumpLine = lines.findIndex(line => line.trim() === quizIdJumpMarker);
                    // 2. マーカーがなければ旧形式の完全一致検索（後方互換）
                    if (jumpLine === -1) {
                        const qMarker = `**Q: ${questionText.trim()}**`;
                        jumpLine = lines.findIndex(line => line.trim() === qMarker);
                    }
                    // 3. それもダメなら部分一致（最終フォールバック）
                    if (jumpLine === -1) {
                        jumpLine = lines.findIndex(line => line.includes(questionText.trim()));
                    }
                    console.log('[Quiz][DEBUG] ジャンプ検索:', { quizTitle: quiz.title, questionText, jumpLine });
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
                    if (jumpLine !== -1) {
                        const jumpPosition = new vscode.Position(jumpLine, 0);
                        answerEditor.selection = new vscode.Selection(jumpPosition, jumpPosition);
                        const revealPos = new vscode.Position(Math.max(0, jumpLine - 2), 0);
                        answerEditor.revealRange(new vscode.Range(revealPos, revealPos), vscode.TextEditorRevealType.AtTop);
                        const jumpDecorationType = vscode.window.createTextEditorDecorationType({
                            backgroundColor: 'rgba(255, 255, 0, 0.4)',
                            isWholeLine: true
                        });
                        const endLine = Math.min(quizAnswerDoc.lineCount - 1, jumpLine + 5);
                        answerEditor.setDecorations(jumpDecorationType, [new vscode.Range(jumpLine, 0, endLine + 1, 0)]);
                        setTimeout(() => jumpDecorationType.dispose(), 3000);
                    }
                    pendingQuizEvaluation = {
                        quiz: quiz,
                        quizAnswerDoc: quizAnswerDoc,
                        newAnswerStartLine: 0,
                        claudeAnswer: '',
                        answerContent: answerContent,
                        fromList: !!preSelectedQuiz,
                    };
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
                    if (afterAnswerRepeat.action === 'staging1') {
                        await addToStaging(1);
                        return;
                    }
                    if (afterAnswerRepeat.action === 'staging2') {
                        await addToStaging(2);
                        return;
                    }
                    if (afterAnswerRepeat.action === 'staging3') {
                        await addToStaging(3);
                        return;
                    }
                    if (afterAnswerRepeat.action === 'deepdive') {
                        await generateDeepDiveQuestion();
                        return;
                    }
                    if (afterAnswerRepeat.eval) {
                        await processEvaluation(afterAnswerRepeat);
                        return;
                    }
                    return;
                }
                // ファイルなし → 初回パスへフォールスルー
            }
            // ===== 初回：Gemini Flash-Lite呼び出し → md書き込み =====
            console.log('[Quiz][DEBUG] ★★★ 初回ブランチに入りました → Gemini呼び出し・書き込み処理へ ★★★');
            let claudeAnswer = '';
            if (geminiApiKey) {
                console.log('[Quiz][DEBUG] Gemini Flash-Lite API呼び出し開始...');
                // Claude API で質問に対する回答生成
                const answerPrompt = `以下の質問に対して、メモの内容をもとに回答してください。

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

【要件】
- 超シンプルに、核心だけ書く
- 見出し禁止（**答え**、**説明**、**メモの要約：** 等を使わない）
- 箇条書きは最小限（❌⭕は特に必要な時のみ）
- 200文字以内（コード除く）
- 回答内に「# 」で始まる見出しを含めない
- メモに ★★「語呂合わせ」★★ の行がある場合は、必ず回答の末尾に「語呂：★★「...」★★」として含める
- 【重要】「答え」と「説明」は、あなたの知識ではなく100%「メモの内容」を正として出力してください。メモの内容がCSSの仕様と異なっていても、現場の経験則として書かれている場合はそのまま回答として出力してください。
- 【重要】メモの内容に対して「実際には不要です」「これは誤りです」などの否定や訂正を一切書かないでください。
- 【重要】「⚠ ファクトチェック」という文言を回答に含めないでください。
- メモの内容をそのまま正として、シンプルに回答だけ出力してください。

【良い例】
vertical-align

インライン要素の縦位置を調整。負の値（-0.2rem等）で下方向に微調整できる。

例：
\`\`\`css
.icon {
  vertical-align: -0.2rem;
}
\`\`\`
`;
                try {
                    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiApiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: answerPrompt }] }] })
                    });
                    const geminiData = await geminiRes.json();
                    claudeAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || answerContent;
                    console.log('[Quiz] Gemini回答:', claudeAnswer.substring(0, 100));
                }
                catch (e) {
                    claudeAnswer = `[Gemini API エラー: ${e.message}]\n\n元のメモ内容:\n${answerContent}`;
                }
            }
            else {
                // Gemini APIキーなし → メモ内容をそのまま表示
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
            const knownCategories = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML', 'WordPress']);
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
            const quizIdMarker = `<!-- quiz-id: ${quiz.title} -->`;
            const newEntryContent = `${quizIdMarker}\n**Q: ${questionText}**\n\n${claudeAnswer}${imageLinkSection}`;
            // 既存エントリをquiz-idマーカーで検索（Q:の文字を変えても壊れない）
            const prevHistory = quizHistoryMap.get(quiz.title);
            const prevEntryMarker = `<!-- quiz-id: ${quiz.title} -->`;
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
            else {
                // 【変更】カテゴリ途中への挿入をやめ、常にファイルの一番最後に追記する
                let separator = SEP;
                if (!currentContent.trim()) {
                    separator = ''; // ファイルが空の場合はセパレータなし
                }
                else if (!currentContent.endsWith('\n\n')) {
                    separator = currentContent.endsWith('\n') ? '\n' + SEP : '\n\n' + SEP;
                }
                // （任意）なんのカテゴリの問題だったか見出しを付ける
                const categoryHeader = `# ${quiz.category || 'その他'}\n\n`;
                const newSection = separator + categoryHeader + newEntryContent;
                newContent = currentContent + newSection;
                newAnswerStartLine = quizAnswerDoc.lineCount + (separator.split('\n').length - 1) + 2; // おおよその開始行
            }
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(quizAnswerDoc.lineCount, 0));
            edit.replace(quizAnswerDoc.uri, fullRange, newContent);
            await vscode.workspace.applyEdit(edit);
            // ファイル保存
            await quizAnswerDoc.save();
            console.log('[Quiz] クイズ回答.md に保存完了');
            // 既存タブを探す
            const existingTab2 = vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .find(tab => tab.input instanceof vscode.TabInputText &&
                tab.input.uri.fsPath === answerFilePath);
            const targetViewColumn2 = existingTab2 ? existingTab2.group.viewColumn : vscode.ViewColumn.Two;
            const answerEditor = await vscode.window.showTextDocument(quizAnswerDoc, {
                viewColumn: targetViewColumn2,
                preview: false,
                preserveFocus: false
            });
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
                answerContent: answerContent,
                fromList: !!preSelectedQuiz,
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
            if (afterAnswer.action === 'staging1') {
                await addToStaging(1);
                return;
            }
            if (afterAnswer.action === 'staging2') {
                await addToStaging(2);
                return;
            }
            if (afterAnswer.action === 'staging3') {
                await addToStaging(3);
                return;
            }
            if (afterAnswer.action === 'deepdive') {
                // 深掘り質問生成・メモ追記
                await generateDeepDiveQuestion();
                return;
            }
            // 評価あり → 処理実行
            if (afterAnswer.eval) {
                await processEvaluation(afterAnswer);
                return; // 評価完了後は次の問題へ（processEvaluation内でhandleQuiz呼出済）
            }
        }
        else if (answerAction === 'next') {
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
            await handleQuiz(false);
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
            path: `/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
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
    // PHP補完プロバイダーの有効化（メモから途中一致補完）
    (0, phpCompletionProvider_1.registerPhpCompletionProvider)(context);
    // PHPゴーストテキスト補完（Intelephenseと競合しない）
    (0, phpCompletionProvider_1.registerPhpInlineCompletionProvider)(context);
    // JS/TS補完プロバイダーの有効化（メモ + jsProperties辞書から途中一致補完）
    (0, jsCompletionProvider_1.registerJsCompletionProvider)(context);
    // JS/TSゴーストテキスト補完
    (0, jsCompletionProvider_1.registerJsInlineCompletionProvider)(context);
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
            else if (req.url === '/save-xd-json' && req.method === 'POST') {
                // Chrome拡張からXDデザインデータをJSONファイルとして保存
                // 保存先: 現在のワークスペースフォルダ/xd_data/
                let body = '';
                req.on('data', (chunk) => body += chunk.toString());
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        const json = data.json;
                        const filename = data.filename || 'xd_design.json';
                        if (!json) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Missing json' }));
                            return;
                        }
                        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                        if (!workspaceFolder) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: 'No workspace folder open' }));
                            return;
                        }
                        const fs = require('fs');
                        const path = require('path');
                        const saveDir = path.join(workspaceFolder, 'xd_data');
                        if (!fs.existsSync(saveDir)) {
                            fs.mkdirSync(saveDir, { recursive: true });
                        }
                        const filePath = path.join(saveDir, filename);
                        fs.writeFileSync(filePath, json, 'utf8');
                        console.log('CSS to HTML Jumper: XD JSONを保存しました', filePath);
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, filePath }));
                    }
                    catch (e) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
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
            // @media ブロックの中かどうかをチェック
            function isInsideMediaQuery(doc, pos) {
                let depth = 0;
                let inMedia = false;
                for (let i = 0; i <= pos.line; i++) {
                    const l = doc.lineAt(i).text;
                    if (/@media\b/.test(l)) {
                        inMedia = true;
                    }
                    if (inMedia) {
                        for (const ch of l) {
                            if (ch === '{') {
                                depth++;
                            }
                            if (ch === '}') {
                                depth--;
                                if (depth <= 0) {
                                    inMedia = false;
                                    depth = 0;
                                }
                            }
                        }
                    }
                }
                return inMedia;
            }
            if (!isInsideMediaQuery(document, position)) {
                return null;
            }
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
                        // 同じグループにある → CSSが隠れるのでHTMLハイライトなし（ホバーツールチップは表示）
                    }
                    else {
                        // 未オープン → タブを開かない（何もしない）
                    }
                }
                // タブが開いている場合のみハイライト
                if (htmlEditor) {
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
        { label: '📋 ファイル全体をレビュー', prompt: `__FILE_REVIEW__`, showBeside: true, model: 'gemini' },
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
        // カーソル下の単語（選択なし時）
        const cursorWord = code ? '' : (() => {
            const wr = editor.document.getWordRangeAtPosition(selection.active, /[a-zA-Z_][a-zA-Z0-9_]*/);
            return wr ? editor.document.getText(wr) : '';
        })();
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
        // PHP/WordPress辞書（PHPファイルの場合のみ）
        let phpFunctionItems = [];
        if (editor.document.languageId === 'php') {
            let phpFuncs = (0, phpCompletionProvider_1.getCachedPhpFunctions)();
            if (!phpFuncs) {
                const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                const memoFilePath = config.get('memoFilePath', '');
                if (memoFilePath) {
                    try {
                        const memoContent = fs.readFileSync(memoFilePath, 'utf-8');
                        phpFuncs = (0, phpCompletionProvider_1.extractPhpFunctionsFromMemo)(memoContent);
                    }
                    catch {
                        phpFuncs = [];
                    }
                }
                else {
                    phpFuncs = [];
                }
            }
            phpFunctionItems = phpFuncs
                .filter(f => !f.insertText) // エイリアスは除外
                .map(f => {
                const dictInfo = phpProperties_1.phpFunctions[f.name];
                const meaning = dictInfo ? dictInfo.description : (f.description?.split('\n')[0] || '');
                return { label: f.name, description: '📖 PHP/WP関数', detail: meaning || undefined };
            });
        }
        const allSuggestItems = [...cssItems, ...extraCssItems, ...jsItems, ...phpFunctionItems];
        // QuickPick1本で完結：最後の単語で候補表示 → Enter で単語置き換え → 候補なし状態でEnter → 確定
        const userInput = await new Promise((resolve) => {
            const qp = vscode.window.createQuickPick();
            qp.placeholder = 'b→background Enter, i→image Enter, の違いを教えて Enter で質問';
            qp.value = code ? code : (cursorWord ? cursorWord + ' って何？' : '');
            qp.items = [];
            qp.onDidChangeValue(value => {
                const lastWord = value.split(/[\s　]+/).pop()?.toLowerCase() || '';
                if (!lastWord || lastWord.length < 1) {
                    qp.items = [];
                    return;
                }
                // 前方一致
                const starts = allSuggestItems.filter(i => i.label.toLowerCase().startsWith(lastWord));
                // 部分一致（前方一致を含まない）
                const contains = allSuggestItems.filter(i => !i.label.toLowerCase().startsWith(lastWord) && i.label.toLowerCase().includes(lastWord));
                // 説明文（detail/description）での部分一致（ラベルでの一致を含まない）
                const descMatch = allSuggestItems.filter(i => !i.label.toLowerCase().includes(lastWord) &&
                    ((i.description && i.description.toLowerCase().includes(lastWord)) ||
                        (i.detail && i.detail.toLowerCase().includes(lastWord))));
                qp.items = [...starts, ...contains, ...descMatch];
            });
            let accepted = false;
            qp.onDidAccept(() => {
                // 末尾 s/S/ｓ/Ｓ/し → その場置換トリガー（候補の有無に関わらず即確定）
                if (/[sSｓＳし]$/.test(qp.value)) {
                    accepted = true;
                    resolve(qp.value.trim() || '');
                    qp.hide();
                    return;
                }
                // 末尾 n/ｎ/な → 間違いチェックトリガー（コメント挿入）
                if (/[nｎな]$/.test(qp.value)) {
                    accepted = true;
                    resolve(qp.value.trim() || '');
                    qp.hide();
                    return;
                }
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
        // 末尾が n / ｎ / な → Step2スキップ・間違いチェックモード（コメント挿入）
        if (/[nｎな]$/.test(userInput)) {
            const codeContext = code ? `【コード】\n${code}\n\n` : '';
            const checkQuestion = `${codeContext}このコードに何か間違っている部分・改善すべき問題はありますか？\n問題点があれば「どこが・なぜ問題か」を日本語で教えてください。問題なければ「問題なし」と一言だけ答えてください。`;
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '🔍 チェック中...', cancellable: false }, async () => {
                try {
                    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                    const apiKey = config.get('claudeApiKey', '');
                    if (!apiKey) {
                        vscode.window.showErrorMessage('APIキーが設定されていません');
                        return;
                    }
                    const model = config.get('claudeModel', 'claude-sonnet-4-5');
                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                        body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: checkQuestion }] })
                    });
                    const data = await response.json();
                    const cleanAnswer = (data?.content?.[0]?.text || '').trim();
                    const lang = editor.document.languageId;
                    const endPosition = selection.end;
                    const insertPosition = new vscode.Position(endPosition.line, editor.document.lineAt(endPosition.line).text.length);
                    const insertText = lang === 'html'
                        ? `\n<!-- 🔍 チェック結果\n${cleanAnswer}\n-->\n`
                        : `\n/* 🔍 チェック結果\n${cleanAnswer}\n*/\n`;
                    await editor.edit(editBuilder => { editBuilder.insert(insertPosition, insertText); });
                }
                catch (e) {
                    vscode.window.showErrorMessage(`エラー: ${e.message}`);
                }
            });
            return;
        }
        // 末尾が s / S / ｓ / Ｓ / し → Step2スキップ・その場置換モード
        if (/[sSｓＳし]$/.test(userInput)) {
            const promptText = userInput.replace(/[sSｓＳし]$/, '').trim();
            const instruction = promptText || 'このコードを改善してください';
            const codeContext = code ? `【選択コード】\n${code}\n\n` : '';
            const replaceQuestion = `${codeContext}【指示】\n${instruction}\n\n【重要】コードのみを出力してください。説明・変更点コメント・\`\`\` 等は一切不要。`;
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '⚡ 置換中...', cancellable: false }, async () => {
                try {
                    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
                    const apiKey = config.get('claudeApiKey', '');
                    if (!apiKey) {
                        vscode.window.showErrorMessage('APIキーが設定されていません');
                        return;
                    }
                    const model = config.get('claudeModel', 'claude-sonnet-4-5');
                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                        body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: replaceQuestion }] })
                    });
                    const data = await response.json();
                    const rawAnswer = data?.content?.[0]?.text || '';
                    // コードブロック記号を除去
                    const cleanAnswer = rawAnswer.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
                    if (!selection.isEmpty) {
                        await editor.edit(editBuilder => { editBuilder.replace(selection, cleanAnswer); });
                        vscode.window.showInformationMessage('✅ 置換しました');
                    }
                }
                catch (e) {
                    vscode.window.showErrorMessage(`エラー: ${e.message}`);
                }
            });
            return;
        }
        // Step 2: プリセット選択
        // 入力ありの場合は「直接質問」を先頭に追加
        const presetItems = [...presetQuestions];
        if (userInput.trim()) {
            presetItems.unshift({ label: '💬 直接質問', prompt: '', showBeside: false });
        }
        presetItems.push({ label: '🎮 問題を出す', prompt: '', showBeside: false });
        presetItems.push({ label: '📂 複数ファイルを選択して質問', prompt: '', showBeside: false });
        presetItems.push({ label: '🗑 レビューコメントを削除', prompt: '', showBeside: false });
        const result = await new Promise((resolve) => {
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = presetItems;
            quickPick.placeholder = userInput.trim() ? 'プリセットを選択（💬直接質問=プリセットなし）' : 'プリセットを選択';
            let acceptHandled = false;
            quickPick.onDidAccept(async () => {
                acceptHandled = true;
                const inputValue = quickPick.value;
                // 末尾が s / S / ｓ / Ｓ / し → その場置換モード（プリセット不要）
                if (/[sSｓＳし]$/.test(inputValue)) {
                    const promptText = inputValue.replace(/[sSｓＳし]$/, '').trim();
                    const instruction = promptText || 'このコードを改善してください';
                    const codeContext = code ? `【選択コード】\n${code}\n\n` : '';
                    resolve({
                        question: `${codeContext}【指示】\n${instruction}\n\n【重要】コードのみを出力してください。説明・変更点コメント・\`\`\` 等は一切不要。`,
                        isSvg: false, isSkeleton: false, isStructural: false, isHtmlGeneration: false,
                        isMemoSearch: false, isQuiz: false, isFreeQuestion: true, isSectionQuestion: false,
                        showBeside: false, useGemini: false, replaceInline: true
                    });
                    quickPick.hide();
                    return;
                }
                const selected = quickPick.selectedItems[0];
                if (selected && selected.label.includes('直接質問')) {
                    // 直接質問: 選択範囲 + userInput のみ送信
                    const directQuestion = code
                        ? `【選択テキスト】\n${code}\n\n【質問】\n${userInput.trim()}`
                        : userInput.trim();
                    resolve({
                        question: directQuestion,
                        userInputText: userInput.trim(),
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: true,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: true
                    });
                }
                else if (selected && selected.label.includes('ファイル全体をレビュー')) {
                    // ファイル全体をGeminiでレビュー
                    const fullText = editor.document.getText();
                    const lang = editor.document.languageId;
                    const langLabel = lang === 'css' ? 'CSS' : lang === 'php' ? 'PHP' : lang === 'html' ? 'HTML' : lang;
                    const reviewPrompt = `以下の${langLabel}ファイルをレビューしてください。指摘のみ・修正は不要です。

## ① 不要ルール
- HTMLから削除されたクラスのCSSが残っていないか
- display: none 等で永久に見えない要素のスタイルがないか
- animation-delay: 0s 等デフォルト値の無駄な記述
- PCと全く同じ @keyframes / CSS規則が @media内に重複していないか
- ::before / ::after に content: "" があるのに position や width/height が未指定で機能していないか

## ② 重複セレクタ
- 同一セレクタが2回定義されていないか（後ろが前を上書きしてバグになる）

## ③ マジックナンバー
- 同じ数値（2rem・1.5s等）が3箇所以上繰り返されていないか → CSS変数化を提案

## ④ CSSプロパティ順
推奨: 配置(position/top/left/z-index) → サイズ(display/width/height/margin/padding) → 見た目(background/border/color) → テキスト(font) → アニメーション(transition/animation)
大きくズレている箇所のみ指摘

## ⑤ コメント不整合
- コメント内容と実際のコードが一致しているか

## ⑥ セマンティックHTML
- クリック要素が <div> になっていないか（<button>に）
- ナビゲーションに <nav> が使われているか
- 見出し階層(h1→h2→h3)が正しいか
- 不要なラッパー <div> が挟まっていないか

## ⑦ 効いていないプロパティ
- display: flex なのに子要素が1つ以下
- width: 100% をブロック要素に指定（デフォルトで100%のため不要）
- display: block をブロック要素に指定（デフォルト値のため不要）
- position: relative だけで座標も子要素の基準にもなっていない

## ⑧ 仮クラス名
- aaa / test / tmp / xxx 等の仮名クラスが残っていないか

## ⑨ AIっぽいコメント【必ず全コメントを1つずつ確認・絶対スキップしない】
以下のパターンに当てはまるコメントを全部列挙すること。1つでも見つかったら全て指摘する。
- 作業記録系（何をしたか・どう変えたかを書いたもの）
  例: /* 復活させる */ /* height は削除 */ /* コメント外す */ /* space-between → center に変更 */ /* ここを追加 */ /* 削除した */
- 変更履歴系: 「← 追加」「← 変更」「← 修正」等の矢印コメント
- 指示・命令系: 「★ これを追加！」「// TODO」「// FIXME」等
- 過剰説明系: AIが書いたような冗長な長文説明（「このプロパティは〜を実現します。また〜することで...」のような文体、または1つのプロパティに5行以上のコメント）
- 日付コメント: /* 2024-01-01 */ 等
良いコメントの基準（これらは指摘しない）: 「なぜこの値か」「なぜこのプロパティが必要か」「何をする設定か」を1〜2行で簡潔に説明するもの。例: /* opacity でふわっとさせるための設定 */ のような短い説明は問題なし。「何をしたか（作業記録）」を説明するものが削除推奨。

## ⑩ 日本語コメントの誤字・文法
- 誤字脱字・助詞の誤りがないか

## ⑪ 英語スペルミス
- コメント・クラス名・変数名の英語が正しいか
- 例: Descrption → Description / haeder → header / backgroud → background
- 指摘形式: 「行N: "xxx" → "yyy"（正しいスペル）」

## ⑫ アクセシビリティ
- <img> に alt 属性があるか
- <button> にテキストまたは aria-label があるか

---
【出力フォーマット】
問題がある観点のみ出力（問題なしの観点はスキップ）。ただし⑨は必ず全コメントを確認して1件でもあれば列挙すること。
行番号は使わない。各指摘は以下の2行形式で出力:
  ⚠ \`[ファイル内に存在するコードをそのまま短く抜粋（1行・改変しない）]\` → 問題の内容（1行で簡潔に）
    修正例: \`[修正後コード]\`（1行・短く）
最後に「優先度高: 不要ルール・マジックナンバー / 優先度中: プロパティ順 / 優先度低: 仮クラス名」のように**観点名の言葉**でまとめる（番号だけは使わない）。

【ファイル内容】
${fullText}`;
                    // XDデータJSONファイルを選択して添付（任意）
                    let finalPrompt = reviewPrompt;
                    const attach = await vscode.window.showQuickPick(['📂 XDデータを添付する', '⏭ スキップ'], { placeHolder: 'デザインカンプ（XD）のJSONファイルを添付しますか？' });
                    if (attach && attach.startsWith('📂')) {
                        const uris = await vscode.window.showOpenDialog({
                            canSelectMany: false,
                            filters: { 'JSON': ['json'] },
                            title: 'XDデータJSONを選択'
                        });
                        if (uris && uris.length > 0) {
                            try {
                                const jsonText = fs.readFileSync(uris[0].fsPath, 'utf8');
                                const xdData = JSON.parse(jsonText);
                                if (Array.isArray(xdData) && xdData.length > 0 && 'text' in xdData[0]) {
                                    const xdSummary = xdData.map((d) => `・${d.text}  font-size:${d.fontSize || '—'}  font-family:${d.fontFamily || '—'}  font-weight:${d.fontWeight || '—'}  line-height:${d.lineHeight || '—'}  color:${d.color || '—'}`).join('\n');
                                    finalPrompt += `\n\n---\n【デザインカンプ（XD）の指定値】\n以下はデザインカンプから取得したフォント・色の指定値です。CSSの実装値と照合して、ズレがあれば指摘してください。\n${xdSummary}`;
                                }
                            }
                            catch (_) {
                                vscode.window.showWarningMessage('JSONの読み込みに失敗しました。スキップします。');
                            }
                        }
                    }
                    resolve({
                        question: finalPrompt,
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: true,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: true,
                        isInlineReview: true
                    });
                }
                else if (selected && selected.label.includes('レビューコメントを削除')) {
                    // ⚠ REVIEW: コメントを一括削除（API不要）
                    resolve({
                        question: '',
                        isSvg: false, isSkeleton: false, isStructural: false, isHtmlGeneration: false,
                        isMemoSearch: false, isQuiz: false, isFreeQuestion: false, isSectionQuestion: false,
                        showBeside: false, useGemini: false, isDeleteReview: true
                    });
                }
                else if (selected && selected.label.includes('問題を出す')) {
                    resolve({
                        question: '',
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: false,
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: false,
                        isCodingChallenge: true
                    });
                }
                else if (selected && selected.label.includes('複数ファイルを選択')) {
                    resolve({
                        question: '',
                        isSvg: false,
                        isSkeleton: false,
                        isStructural: false,
                        isHtmlGeneration: false,
                        isMemoSearch: false,
                        isQuiz: false,
                        isFreeQuestion: true, // 自由質問として扱う
                        isSectionQuestion: false,
                        showBeside: false,
                        useGemini: false,
                        isMultiFile: true // 複数ファイルフラグ
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
                        userInputText: userInput.trim(),
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
                if (!acceptHandled) {
                    resolve(undefined);
                }
                quickPick.dispose();
            });
            quickPick.show();
        });
        if (!result) {
            return; // キャンセル
        }
        let { question, userInputText, isSvg, isSkeleton, isStructural, isHtmlGeneration, isMemoSearch, isQuiz, isFreeQuestion, isSectionQuestion, showBeside, useGemini, isMultiFile, replaceInline, isInlineReview, isDeleteReview, isCodingChallenge } = result;
        // isInlineReview + CSSファイルの場合、HTMLファイルを追加で選択させる
        let reviewHtmlUri = null;
        if (isInlineReview && editor.document.languageId === 'css') {
            const htmlFiles = await vscode.workspace.findFiles('**/*.html', '{**/node_modules/**,**/.git/**}');
            const htmlItems = htmlFiles.map(f => ({
                label: vscode.workspace.asRelativePath(f),
                description: f.fsPath,
                uri: f
            })).sort((a, b) => a.label.localeCompare(b.label));
            const selectedHtml = await vscode.window.showQuickPick([{ label: '(スキップ)', description: 'HTMLなしでCSSのみレビュー', uri: null }, ...htmlItems], { placeHolder: '一緒にレビューするHTMLファイルを選んでください（Escでスキップ）' });
            if (selectedHtml && selectedHtml.label !== '(スキップ)' && selectedHtml.uri) {
                reviewHtmlUri = selectedHtml.uri;
                const htmlContent = fs.readFileSync(selectedHtml.uri.fsPath, 'utf8');
                question = question
                    .replace('以下のCSSファイルをレビューしてください。', '以下のCSSファイルとHTMLファイルをレビューしてください。')
                    .replace('【ファイル内容】', '【CSSファイル内容】')
                    .replace('---\n【出力フォーマット】\n', '---\n【出力フォーマット】\n各指摘の先頭に【CSS】または【HTML】を付けて、どちらのファイルの問題かを明示してください。\n')
                    + `\n\n【HTMLファイル内容】\n${htmlContent}`;
            }
        }
        // ⚠ REVIEW: コメント一括削除（API呼び出し不要）
        if (isDeleteReview) {
            const docLines = editor.document.getText().split('\n');
            const deleteNums = [];
            for (let i = 0; i < docLines.length; i++) {
                const t = docLines[i].trim();
                if (t.match(/^\/\/ ⚠ REVIEW:|^<!-- ⚠ REVIEW:/)) {
                    deleteNums.push(i);
                }
            }
            if (deleteNums.length === 0) {
                vscode.window.showInformationMessage('レビューコメントはありません');
                return;
            }
            await editor.edit(editBuilder => {
                for (let i = deleteNums.length - 1; i >= 0; i--) {
                    editBuilder.delete(editor.document.lineAt(deleteNums[i]).rangeIncludingLineBreak);
                }
            });
            vscode.window.showInformationMessage(`✅ レビューコメントを${deleteNums.length}箇所削除しました`);
            return;
        }
        // 🎮 問題を出す（選択テキストをメモとしてGeminiに渡しHTMLチャレンジ生成）
        if (isCodingChallenge) {
            const geminiApiKey = vscode.workspace.getConfiguration('cssToHtmlJumper').get('geminiApiKey', '');
            if (!geminiApiKey) {
                vscode.window.showErrorMessage('Gemini APIキーが設定されていません（cssToHtmlJumper.geminiApiKey）');
                return;
            }
            // 選択なしの場合はカーソル位置のセクションを自動取得
            let memoContent = code.trim();
            if (!memoContent) {
                const docLines = editor.document.getText().split('\n');
                const cursorLine = editor.selection.active.line;
                let sectionStart = cursorLine;
                for (let i = cursorLine; i >= 0; i--) {
                    if (/^##?\s/.test(docLines[i])) {
                        sectionStart = i;
                        break;
                    }
                }
                let sectionEnd = docLines.length;
                for (let i = sectionStart + 1; i < docLines.length; i++) {
                    if (/^##?\s/.test(docLines[i])) {
                        sectionEnd = i;
                        break;
                    }
                }
                memoContent = docLines.slice(sectionStart, sectionEnd).join('\n').trim();
            }
            if (!memoContent) {
                vscode.window.showErrorMessage('セクション内容が見つかりません。テキストを選択するか、メモのセクション内にカーソルを置いてください');
                return;
            }
            const challengePrompt = '以下のメモ内容を参考に、HTML+CSSの実践問題を1つ作成してください。\n\n'
                + '【ルール】\n'
                + '- 出力は1つのHTMLファイルのみ（```html ... ``` のコードブロックで囲む）\n'
                + '- <style> タグをHTMLの中に含める（外部ファイル不要）\n'
                + '- ファイル冒頭に <!-- 問題: ... --> コメントで問題文を書く\n'
                + '- ファイル末尾に <!-- ヒント: ... --> コメントでヒントを書く\n'
                + '- HTMLのスケルトンだけ作り、CSSは空のルールセット（プロパティなし）を用意する\n'
                + '- ユーザーが自分でCSSを埋めて完成させる形にする\n'
                + '- 問題はメモの内容に直結した実践的なもの（flex, grid, position等）\n\n'
                + '【メモ内容】\n'
                + memoContent;
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '🎮 問題を生成中...', cancellable: false }, async () => {
                try {
                    const postData = JSON.stringify({ contents: [{ parts: [{ text: challengePrompt }] }] });
                    const raw = await callGeminiApi(geminiApiKey, 'gemini-3.1-flash-lite-preview', postData);
                    const parsed = JSON.parse(raw);
                    const responseText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                    // コードブロックからHTMLを抽出
                    const htmlMatch = responseText.match(/```html\s*([\s\S]*?)```/);
                    const htmlContent = htmlMatch ? htmlMatch[1].trim() : responseText.trim();
                    if (!htmlContent) {
                        vscode.window.showErrorMessage('問題の生成に失敗しました');
                        return;
                    }
                    const tmpPath = path.join(os.tmpdir(), 'css_challenge.html');
                    fs.writeFileSync(tmpPath, htmlContent, 'utf8');
                    const doc = await vscode.workspace.openTextDocument(tmpPath);
                    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                    await vscode.env.openExternal(vscode.Uri.file(tmpPath));
                }
                catch (e) {
                    vscode.window.showErrorMessage(`問題生成エラー: ${e.message}`);
                }
            });
            return;
        }
        let codeToSend = code;
        let htmlContext = '';
        // 複数ファイル選択モードの場合の特別処理
        if (isMultiFile) {
            // プロジェクト内のテキストベースのファイルを検索 (一部バイナリ等は除外)
            const allFiles = await vscode.workspace.findFiles('**/*.{html,css,js,ts,jsx,tsx,php,py,json,md,txt}', '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/vendor/**}');
            const validFiles = [];
            for (const f of allFiles) {
                try {
                    const stat = fs.lstatSync(f.fsPath);
                    if (!stat.isSymbolicLink()) {
                        validFiles.push(f);
                    }
                }
                catch (e) {
                    // ignore
                }
            }
            const fileItems = validFiles.map(f => ({
                label: vscode.workspace.asRelativePath(f),
                description: f.fsPath,
                uri: f
            }));
            fileItems.sort((a, b) => a.label.localeCompare(b.label));
            const selectedFiles = await vscode.window.showQuickPick(fileItems, {
                canPickMany: true,
                placeHolder: 'AIにコンテキストとして送信するファイルを選択してください（複数可）'
            });
            if (!selectedFiles || selectedFiles.length === 0) {
                return; // キャンセル
            }
            let finalQuestionText = userInput.trim();
            if (!finalQuestionText) {
                const q = await vscode.window.showInputBox({
                    prompt: '質問を入力してください',
                    placeHolder: '例: これらのファイルの関係性は？'
                });
                if (!q)
                    return;
                finalQuestionText = q.trim();
            }
            question = `【質問】\n${finalQuestionText}`;
            codeToSend = "";
            for (const item of selectedFiles) {
                try {
                    const content = fs.readFileSync(item.uri.fsPath, 'utf8');
                    codeToSend += `\n\n【ファイル：${item.label}】\n\`\`\`\n${content}\n\`\`\`\n`;
                }
                catch (e) {
                    // ignore
                }
            }
            // 以降のファイルコンテキスト自動追加をスキップするため、拡張子偽装のような形で対応
            // または以下のフラグでガード
        }
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
            title: useGemini ? '✨ Geminiに質問中...' : '✨ Claude AIに質問中...',
            cancellable: false
        }, async () => {
            try {
                // コンテキスト収集 (複数ファイル選択モードでない時のみ)
                if (!isMultiFile) {
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
                    // JS/TS/PHP: ファイル全体 + 選択箇所を送信（MD等は選択範囲のみ）
                    if ((langId === 'javascript' || langId === 'typescript' || langId === 'php') && !skipSectionEnrich) {
                        const fullFileContent = editor.document.getText();
                        const fileName = path.basename(editor.document.fileName);
                        if (code) {
                            codeToSend = `【ファイル全体（${fileName}）】\n${fullFileContent}\n\n【選択箇所（ここを中心に質問）】\n${code}`;
                        }
                        else {
                            codeToSend = `【ファイル全体（${fileName}）】\n${fullFileContent}`;
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
                        // 自由質問: JS/TS/PHP/HTML/CSS はファイルコンテキストを維持、それ以外（MDなど）はクリア
                        if (langId !== 'javascript' && langId !== 'typescript' && langId !== 'php' && langId !== 'html' && langId !== 'css') {
                            codeToSend = '';
                            htmlContext = '';
                        }
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
                } // isMultiFile分岐の終了
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
                else if (replaceInline) {
                    // その場置換モード（末尾 s/S/し で発動）
                    if (!selection.isEmpty) {
                        await editor.edit(editBuilder => {
                            editBuilder.replace(selection, cleanAnswer);
                        });
                        vscode.window.showInformationMessage('✅ 選択範囲を置換しました');
                    }
                    else {
                        vscode.window.showWarningMessage('置換するにはコードを選択してください');
                    }
                }
                else if (isInlineReview) {
                    // レビュー結果をソースファイルに ⚠ REVIEW: コメントとして挿入
                    const responseLines = cleanAnswer.split('\n');
                    const lang = editor.document.languageId;
                    const docText = editor.document.getText();
                    const docLines = docText.split('\n');
                    // HTML ファイルの行データを用意（指定がある場合）
                    let htmlDocLines = [];
                    let htmlDoc = null;
                    if (reviewHtmlUri) {
                        htmlDoc = await vscode.workspace.openTextDocument(reviewHtmlUri);
                        htmlDocLines = htmlDoc.getText().split('\n');
                    }
                    const reviewItems = [];
                    for (let i = 0; i < responseLines.length; i++) {
                        const line = responseLines[i];
                        // 【CSS】/【HTML】プレフィックスが付く場合も含めて ⚠ を検出
                        if (!line.includes('⚠') || !line.includes('`')) {
                            continue;
                        }
                        const codeMatch = line.match(/`([^`]+)`/);
                        if (!codeMatch) {
                            continue;
                        }
                        const code = codeMatch[1].trim();
                        const arrowMatch = line.match(/→\s*(.+)$/);
                        const desc = arrowMatch ? arrowMatch[1].trim() : '';
                        let fix = '';
                        if (i + 1 < responseLines.length && responseLines[i + 1].trim().startsWith('修正例:')) {
                            fix = responseLines[i + 1].trim().replace(/^修正例:\s*/, '');
                        }
                        const fullComment = fix ? `${desc} → 修正例: ${fix}` : desc;
                        reviewItems.push({ code, comment: fullComment });
                    }
                    if (reviewItems.length === 0) {
                        // パース失敗 → カーソル行の上にコメントとして挿入
                        const cursorLine = editor.selection.active.line;
                        const insertPos = new vscode.Position(cursorLine, 0);
                        const commentText = lang === 'html'
                            ? `<!-- ✨ レビュー結果\n${cleanAnswer}\n-->\n`
                            : `/* ✨ レビュー結果\n${cleanAnswer}\n*/\n`;
                        await editor.edit(editBuilder => { editBuilder.insert(insertPos, commentText); });
                        vscode.window.showInformationMessage('レビュー結果をカーソル行の上に挿入しました');
                    }
                    else {
                        const cssEdits = [];
                        const htmlEdits = [];
                        for (const item of reviewItems) {
                            // まず CSS ファイルで検索
                            let foundInCss = false;
                            for (let i = 0; i < docLines.length; i++) {
                                if (docLines[i].includes(item.code)) {
                                    cssEdits.push({ line: i, comment: item.comment });
                                    foundInCss = true;
                                    break;
                                }
                            }
                            // CSS で見つからなければ HTML ファイルで検索
                            if (!foundInCss && htmlDocLines.length > 0) {
                                for (let i = 0; i < htmlDocLines.length; i++) {
                                    if (htmlDocLines[i].includes(item.code)) {
                                        htmlEdits.push({ line: i, comment: item.comment });
                                        break;
                                    }
                                }
                            }
                        }
                        if (cssEdits.length === 0 && htmlEdits.length === 0) {
                            // マッチ失敗 → カーソル行の上にコメントとして挿入
                            const cursorLine = editor.selection.active.line;
                            const insertPos = new vscode.Position(cursorLine, 0);
                            const commentText = lang === 'html'
                                ? `<!-- ✨ レビュー結果\n${cleanAnswer}\n-->\n`
                                : `/* ✨ レビュー結果\n${cleanAnswer}\n*/\n`;
                            await editor.edit(editBuilder => { editBuilder.insert(insertPos, commentText); });
                            vscode.window.showInformationMessage('レビュー結果をカーソル行の上に挿入しました');
                        }
                        else {
                            // CSS ファイルへの挿入
                            if (cssEdits.length > 0) {
                                cssEdits.sort((a, b) => b.line - a.line);
                                await editor.edit(editBuilder => {
                                    for (const edit of cssEdits) {
                                        const lineText = editor.document.lineAt(edit.line).text;
                                        const indent = (lineText.match(/^(\s*)/) || ['', ''])[1];
                                        const pos = new vscode.Position(edit.line, 0);
                                        const commentLine = lang === 'html'
                                            ? `${indent}<!-- ⚠ REVIEW: ${edit.comment} -->\n`
                                            : `${indent}// ⚠ REVIEW: ${edit.comment}\n`;
                                        editBuilder.insert(pos, commentLine);
                                    }
                                });
                            }
                            // HTML ファイルへの挿入（WorkspaceEdit でフォーカスを変えずに挿入）
                            if (htmlDoc && htmlEdits.length > 0) {
                                htmlEdits.sort((a, b) => b.line - a.line);
                                const workspaceEdit = new vscode.WorkspaceEdit();
                                for (const edit of htmlEdits) {
                                    const lineText = htmlDoc.lineAt(edit.line).text;
                                    const indent = (lineText.match(/^(\s*)/) || ['', ''])[1];
                                    const pos = new vscode.Position(edit.line, 0);
                                    workspaceEdit.insert(htmlDoc.uri, pos, `${indent}<!-- ⚠ REVIEW: ${edit.comment} -->\n`);
                                }
                                await vscode.workspace.applyEdit(workspaceEdit);
                            }
                            const total = cssEdits.length + htmlEdits.length;
                            const msg = htmlEdits.length > 0
                                ? `✅ ${total}件挿入（CSS: ${cssEdits.length}件 / HTML: ${htmlEdits.length}件）`
                                : `✅ ${cssEdits.length}件のレビューコメントを挿入しました`;
                            vscode.window.showInformationMessage(msg);
                        }
                    }
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
                    // 質問文を先頭に付ける（直接入力またはプリセット+入力の場合）
                    const questionPrefix = userInputText ? `Q: ${userInputText}\n\n` : '';
                    let insertText;
                    if (lang === 'html') {
                        insertText = `\n<!-- ✨\n${questionPrefix}${cleanAnswer}\n-->\n`;
                    }
                    else {
                        insertText = `\n/* ✨\n${questionPrefix}${cleanAnswer}\n*/\n`;
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
            await handleQuiz(false);
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
        await handleQuiz(true); // Ctrl+Shift+7からはフィルタQuickPickを表示
    });
    const batchCategorizeCommand = vscode.commands.registerCommand('cssToHtmlJumper.batchCategorize', async () => {
        await handleBatchCategorize();
    });
    context.subscriptions.push(quizCommand, batchCategorizeCommand);
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
        if (afterAnswer.action === 'deepdive') {
            await generateDeepDiveQuestion();
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
            const categoryList = config.get('quizCategories', ['CSS', 'JavaScript', 'Python', 'HTML', 'WordPress']);
            for (const line of lines) {
                const match = line.match(/^#{2,3}\s+(.+)/);
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
            // 検索パターンの構築
            let searchPatterns = [];
            if (selectorType === 'class') {
                searchPatterns.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'i'));
            }
            else if (selectorType === 'id') {
                searchPatterns.push(new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'i'));
            }
            else {
                searchPatterns.push(new RegExp(`<${escapeRegex(selectorName)}[\\s>]`, 'i'));
                searchPatterns.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'i'));
                searchPatterns.push(new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'i'));
            }
            // PHPを先に、HTMLを後に検索（PHPプロジェクトでPHPが優先表示される）
            const phpUris = await vscode.workspace.findFiles('**/*.php', '**/node_modules/**');
            const htmlUris = filterAutoGeneratedHtml(await vscode.workspace.findFiles('**/*.html', '**/node_modules/**'));
            const searchTargets = [
                ...phpUris.map(f => ({ fileUri: f, isPHP: true })),
                ...htmlUris.map(f => ({ fileUri: f, isPHP: false }))
            ];
            // 全マッチを収集（ファイルごとに最初の1件）
            const allMatches = [];
            for (const { fileUri, isPHP } of searchTargets) {
                try {
                    const fileDoc = await vscode.workspace.openTextDocument(fileUri);
                    const lines = fileDoc.getText().split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        let matched = false;
                        for (const pattern of searchPatterns) {
                            if (pattern.test(lines[i])) {
                                allMatches.push({
                                    fileUri,
                                    line: i,
                                    fileName: path.basename(fileUri.fsPath),
                                    lineText: lines[i].trim(),
                                    isPHP
                                });
                                matched = true;
                            }
                            pattern.lastIndex = 0;
                            if (matched) {
                                break;
                            }
                        }
                        if (matched) {
                            break;
                        } // 1ファイルにつき最初のマッチのみ
                    }
                }
                catch (e) {
                    // エラー無視
                }
            }
            if (allMatches.length === 0) {
                return null;
            }
            // 1件 → そのままジャンプ
            if (allMatches.length === 1) {
                return new vscode.Location(allMatches[0].fileUri, new vscode.Position(allMatches[0].line, 0));
            }
            // 複数件 → QuickPickで選択（PHPは$(file-code)、HTMLは$(globe)）
            const items = allMatches.map(m => ({
                label: `$(${m.isPHP ? 'file-code' : 'globe'}) ${m.fileName}`,
                description: `行 ${m.line + 1}`,
                detail: m.lineText,
                match: m
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `"${selectorName}" の使用箇所を選択してください（${allMatches.length}件）`,
                matchOnDescription: true,
                matchOnDetail: true
            });
            if (selected) {
                const selDoc = await vscode.workspace.openTextDocument(selected.match.fileUri);
                const editor = await vscode.window.showTextDocument(selDoc);
                const pos = new vscode.Position(selected.match.line, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
            return null; // QuickPickで処理済み
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
        if (!editor || (editor.document.languageId !== 'css' && editor.document.languageId !== 'php')) {
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
    // カンプ照合（kanpu.json と CSS を比較してインライン警告）
    // ========================================
    const kanpuDecType = vscode.window.createTextEditorDecorationType({
        after: { color: 'rgba(255, 180, 0, 0.9)', fontStyle: 'italic', margin: '0 0 0 1em' }
    });
    context.subscriptions.push(kanpuDecType);
    const checkKanpuCommand = vscode.commands.registerCommand('cssToHtmlJumper.checkKanpu', async () => {
        const fs = require('fs');
        const nodePath = require('path');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('ワークスペースが開かれていません');
            return;
        }
        const wsRoot = workspaceFolders[0].uri.fsPath;
        const cfg = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const kanpuFolder = cfg.get('kanpuFolder', '') || wsRoot;
        const kanpuPath = nodePath.join(kanpuFolder, 'kanpu.json');
        if (!fs.existsSync(kanpuPath)) {
            vscode.window.showErrorMessage(`kanpu.json が見つかりません: ${kanpuPath}`);
            return;
        }
        let kanpuRecords;
        try {
            const raw = fs.readFileSync(kanpuPath, 'utf8');
            const parsed = JSON.parse(raw);
            kanpuRecords = parsed.records || (Array.isArray(parsed) ? parsed : []);
        }
        catch {
            vscode.window.showErrorMessage('kanpu.json の読み込みに失敗しました');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'css') {
            vscode.window.showErrorMessage('CSSファイルを開いた状態で実行してください');
            return;
        }
        const cssText = editor.document.getText();
        // HTMLファイルを結合して検索用テキストを作る
        const htmlFiles = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**', 20);
        let htmlText = '';
        for (const f of htmlFiles) {
            try {
                htmlText += fs.readFileSync(f.fsPath, 'utf8') + '\n';
            }
            catch { /* skip */ }
        }
        const decorations = [];
        for (const record of kanpuRecords) {
            let selector = '';
            let matchType = 'exact';
            if (record.textContent && record.textContent.trim()) {
                selector = kanpuFindSelectorByText(htmlText, record.textContent.trim());
                matchType = 'exact';
            }
            else if (record.shapeHeading) {
                const nameMatch = record.shapeHeading.match(/[：:]\s*(.+)/);
                if (nameMatch) {
                    selector = kanpuFindSelectorByName(htmlText, nameMatch[1].trim());
                    matchType = 'partial';
                }
            }
            if (!selector)
                continue;
            const diffs = kanpuCompare(cssText, selector, record);
            for (const diff of diffs) {
                const lineIndex = kanpuFindPropLine(cssText, selector, diff.prop);
                if (lineIndex < 0)
                    continue;
                const line = editor.document.lineAt(lineIndex);
                const label = matchType === 'partial'
                    ? `  ❓[推定] デザイン: ${diff.expected}`
                    : `  ⚠ デザイン: ${diff.expected}`;
                decorations.push({
                    range: new vscode.Range(lineIndex, line.text.length, lineIndex, line.text.length),
                    renderOptions: { after: { contentText: label } }
                });
            }
        }
        editor.setDecorations(kanpuDecType, decorations);
        if (decorations.length === 0) {
            vscode.window.showInformationMessage('カンプ照合完了: 差異なし');
        }
        else {
            vscode.window.showInformationMessage(`カンプ照合完了: ${decorations.length}件の差異を検出`);
        }
    });
    context.subscriptions.push(checkKanpuCommand);
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
    // ========================================
    // PHP ステータスバー連動（カーソルが関数名の上にある間だけ表示）
    // ========================================
    const phpStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    context.subscriptions.push(phpStatusBar);
    const updatePhpStatusBar = (editor) => {
        if (!editor || editor.document.languageId !== 'php') {
            phpStatusBar.hide();
            return;
        }
        const position = editor.selection.active;
        const wordRange = editor.document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            phpStatusBar.hide();
            return;
        }
        const word = editor.document.getText(wordRange);
        const info = phpProperties_1.phpFunctions[word];
        if (!info) {
            phpStatusBar.hide();
            return;
        }
        phpStatusBar.text = `$(info) [${info.category ?? 'PHP'}] ${info.name} — ${info.description}`;
        phpStatusBar.tooltip = [
            info.params && info.params.length > 0 ? '引数:\n' + info.params.map(p => '  ' + p).join('\n') : '',
            info.returns ? '戻り値: ' + info.returns : '',
            info.tips && info.tips.length > 0 ? 'Tips:\n' + info.tips.map(t => '  ' + t).join('\n') : ''
        ].filter(Boolean).join('\n\n');
        phpStatusBar.show();
    };
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => updatePhpStatusBar(e.textEditor)), vscode.window.onDidChangeActiveTextEditor(e => updatePhpStatusBar(e)));
    // ========================================
    // PHP 日本語ホバー
    // ========================================
    const phpHoverProvider = vscode.languages.registerHoverProvider({ language: 'php' }, {
        provideHover(document, position) {
            const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
            if (!wordRange) {
                return null;
            }
            const word = document.getText(wordRange);
            const info = phpProperties_1.phpFunctions[word];
            if (!info) {
                return null;
            }
            const md = new vscode.MarkdownString();
            md.isTrusted = true;
            md.appendMarkdown(`**[${info.category ?? 'PHP'}]** \`${info.name}\`\n\n`);
            md.appendMarkdown(`${info.description}\n\n`);
            if (info.params && info.params.length > 0) {
                md.appendMarkdown(`**引数**\n`);
                for (const p of info.params) {
                    md.appendMarkdown(`- \`${p}\`\n`);
                }
                md.appendMarkdown('\n');
            }
            if (info.returns) {
                md.appendMarkdown(`**戻り値**: ${info.returns}\n\n`);
            }
            if (info.tips && info.tips.length > 0) {
                md.appendMarkdown(`**Tips**\n`);
                for (const t of info.tips) {
                    md.appendMarkdown(`- ${t}\n`);
                }
            }
            return new vscode.Hover(md, wordRange);
        }
    });
    context.subscriptions.push(phpHoverProvider);
    // ========================================
    // Ctrl+Shift+J → PHP/WP解説をソースコードにコメント挿入（Ctrl+Zで取り消し可）
    // ========================================
    const phpDocCache = new Map();
    // 1行を約30文字で区切りよく折り返す
    const wrapLine = (line, maxLen = 30) => {
        if (line.length <= maxLen) {
            return [line];
        }
        const result = [];
        let remaining = line;
        while (remaining.length > maxLen) {
            // maxLen付近で区切りのよい位置を探す（スペース・句読点・記号の後）
            let breakPos = maxLen;
            for (let i = maxLen; i >= Math.max(maxLen - 10, 1); i--) {
                const ch = remaining[i];
                if (' 　、。・）】」』'.includes(ch) || (i < remaining.length - 1 && /[a-zA-Z0-9]/.test(remaining[i]) && !/[a-zA-Z0-9]/.test(remaining[i + 1]))) {
                    breakPos = i + 1;
                    break;
                }
            }
            result.push(remaining.slice(0, breakPos).trimEnd());
            remaining = remaining.slice(breakPos).trimStart();
        }
        if (remaining.length > 0) {
            result.push(remaining);
        }
        return result;
    };
    // テキストをPHP DocBlock形式に変換（30文字折り返し付き）
    const stripMarkdown = (text) => {
        return text
            .replace(/^#{1,6}\s+/gm, '') // ## 見出し
            .replace(/\*\*(.+?)\*\*/g, '$1') // **太字**
            .replace(/\*(.+?)\*/g, '$1') // *斜体*
            .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // `コード`
            .replace(/^[\*\-]\s+/gm, '・') // * リスト → ・
            .replace(/_{2}(.+?)_{2}/g, '$1'); // __太字__
    };
    const toPhpComment = (text) => {
        const cleaned = stripMarkdown(text);
        const wrapped = cleaned.split('\n').flatMap(l => l.trim() === '' ? [''] : wrapLine(l));
        const lines = wrapped.map(l => ` * ${l}`);
        return '/**\n' + lines.join('\n') + '\n */';
    };
    // 現在行のインデントを取得
    const getIndent = (line) => {
        const m = line.match(/^(\s*)/);
        return m ? m[1] : '';
    };
    const showPhpDoc = vscode.commands.registerCommand('cssToHtmlJumper.showPhpDoc', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const apiKey = config.get('geminiApiKey', '');
        // ── 選択あり → 選択コードの直後に解説コメントを挿入 ──
        const selectedText = editor.document.getText(editor.selection).trim();
        if (selectedText.length > 0) {
            if (!apiKey) {
                vscode.window.showWarningMessage('コード解説にはgeminiApiKeyの設定が必要です。');
                return;
            }
            const statusMsg = vscode.window.setStatusBarMessage('🔍 選択コードを解説しています...');
            const prompt = `以下のPHP/WordPressコードを中学生でもわかるように日本語で解説してください。コードブロックや見出し記号(#)は使わず、プレーンテキストで出力してください。

${selectedText}

【何をしているコードか】
（全体の目的を2〜3文で）

【処理の流れ】
（手順を箇条書きで）

【注意点・よくあるミス】
（あれば記載）`;
            try {
                const postData = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
                const raw = await callGeminiApi(apiKey, 'gemini-3.1-flash-lite-preview', postData);
                const parsed = JSON.parse(raw);
                const result = (parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '解説を取得できませんでした').trim();
                const selStartLine = editor.selection.start.line;
                const insertLine = editor.selection.end.line;
                const indent = getIndent(editor.document.lineAt(selStartLine).text);
                const comment = toPhpComment(result).split('\n').map(l => indent + l).join('\n');
                await editor.edit(eb => {
                    eb.insert(new vscode.Position(insertLine + 1, 0), comment + '\n');
                });
                editor.selection = new vscode.Selection(new vscode.Position(selStartLine, 0), new vscode.Position(insertLine + 1 + comment.split('\n').length, 0));
            }
            catch (e) {
                vscode.window.showErrorMessage(`エラー: ${e.message}`);
            }
            finally {
                statusMsg.dispose();
            }
            return;
        }
        // ── 選択なし → カーソル下の関数名を解説して次の行に挿入 ──
        const position = editor.selection.active;
        const wordRange = editor.document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            vscode.window.showInformationMessage('カーソルを関数名の上に置いてください');
            return;
        }
        const word = editor.document.getText(wordRange);
        const indent = getIndent(editor.document.lineAt(position.line).text);
        // キャッシュヒット → 即挿入
        if (phpDocCache.has(word)) {
            const comment = toPhpComment(phpDocCache.get(word)).split('\n').map(l => indent + l).join('\n');
            await editor.edit(eb => {
                eb.insert(new vscode.Position(position.line + 1, 0), comment + '\n');
            });
            editor.selection = new vscode.Selection(new vscode.Position(position.line, 0), new vscode.Position(position.line + 1 + comment.split('\n').length, 0));
            return;
        }
        if (!apiKey) {
            // APIキーなし → 辞書にフォールバック
            const info = phpProperties_1.phpFunctions[word];
            if (info) {
                const lines = [
                    `[${info.category ?? 'PHP'}] ${info.name}`,
                    info.description,
                    '',
                    ...(info.params && info.params.length > 0 ? ['【引数】', ...info.params.map(p => `  ${p}`)] : []),
                    ...(info.returns ? ['', `【戻り値】 ${info.returns}`] : []),
                    ...(info.tips && info.tips.length > 0 ? ['', '【Tips】', ...info.tips.map(t => `  • ${t}`)] : [])
                ];
                const comment = toPhpComment(lines.join('\n')).split('\n').map(l => indent + l).join('\n');
                await editor.edit(eb => {
                    eb.insert(new vscode.Position(position.line + 1, 0), comment + '\n');
                });
                editor.selection = new vscode.Selection(new vscode.Position(position.line, 0), new vscode.Position(position.line + 1 + comment.split('\n').length, 0));
            }
            else {
                vscode.window.showInformationMessage(`「${word}」は辞書に未登録です。geminiApiKey を設定するとAI解説が使えます。`);
            }
            return;
        }
        // Gemini 3.1 Flash-Lite で解説生成 → 挿入
        const statusMsg = vscode.window.setStatusBarMessage(`🔍 「${word}」を調べています...`);
        const prompt = 'PHP または WordPress の関数「' + word + '」を日本語で解説してください。\n'
            + '【厳守ルール】\n'
            + '・マークダウン記号（#, ##, **, *, `, ``` 等）は一切使わない\n'
            + '・関数名で文章を始めない（「' + word + ' は」のような書き方禁止）\n'
            + '・各項目は短く、1文以内に収める\n'
            + '・空行は各絵文字項目の間にのみ入れる\n\n'
            + '以下の形式で出力してください。\n\n'
            + '📌 何をする？ 1文で（補足は括弧で）\n\n'
            + '📤 戻り値: 実際の値の例（例: "https://example.com/wp-content/themes/mytheme/"）\n\n'
            + '❌ 使わないと → 問題を一言\n'
            + '✅ 使うと    → メリットを一言\n\n'
            + '💡 いつ使う？ 場面を1〜2つ、各1文で\n\n'
            + '関数が存在しない場合は「不明な関数です」とだけ答えてください。';
        try {
            const postData = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
            const raw = await callGeminiApi(apiKey, 'gemini-3.1-flash-lite-preview', postData);
            const parsed = JSON.parse(raw);
            const result = (parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '解説を取得できませんでした').trim();
            phpDocCache.set(word, result);
            const comment = toPhpComment(result).split('\n').map(l => indent + l).join('\n');
            await editor.edit(eb => {
                eb.insert(new vscode.Position(position.line + 1, 0), comment + '\n');
            });
            editor.selection = new vscode.Selection(new vscode.Position(position.line, 0), new vscode.Position(position.line + 1 + comment.split('\n').length, 0));
        }
        catch (e) {
            vscode.window.showErrorMessage(`エラー: ${e.message}`);
        }
        finally {
            statusMsg.dispose();
        }
    });
    context.subscriptions.push(showPhpDoc);
    // ========================================
    // WP フック双方向ジャンプ（Ctrl+Click / F12）
    // ========================================
    const wpHookDefinitionProvider = vscode.languages.registerDefinitionProvider({ language: 'php' }, {
        async provideDefinition(document, position) {
            const line = document.lineAt(position.line).text;
            // do_action / apply_filters → add_action / add_filter を検索
            // add_action / add_filter → do_action / apply_filters を検索
            const callMatch = line.match(/(?:do_action|apply_filters)\s*\(\s*['"]([^'"]+)['"]/);
            const regMatch = line.match(/(?:add_action|add_filter)\s*\(\s*['"]([^'"]+)['"]/);
            const hookName = callMatch ? callMatch[1] : regMatch ? regMatch[1] : null;
            if (!hookName) {
                return null;
            }
            const searchPatterns = callMatch
                ? [`add_action('${hookName}'`, `add_action("${hookName}"`, `add_filter('${hookName}'`, `add_filter("${hookName}"`]
                : [`do_action('${hookName}'`, `do_action("${hookName}"`, `apply_filters('${hookName}'`, `apply_filters("${hookName}"`];
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return null;
            }
            const results = [];
            for (const folder of workspaceFolders) {
                const phpFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.php'), '{**/node_modules/**,**/vendor/**}');
                for (const fileUri of phpFiles) {
                    let content;
                    try {
                        const bytes = await vscode.workspace.fs.readFile(fileUri);
                        content = new TextDecoder('utf-8').decode(bytes);
                    }
                    catch {
                        continue;
                    }
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (searchPatterns.some(p => lines[i].includes(p))) {
                            results.push(new vscode.Location(fileUri, new vscode.Position(i, 0)));
                        }
                    }
                }
            }
            return results.length > 0 ? results : null;
        }
    });
    context.subscriptions.push(wpHookDefinitionProvider);
    // ========================================
    // CSSクラス名補完（PHP / HTML）
    // ========================================
    let cssClassCache = [];
    let cssClassCacheTime = 0;
    async function getCssClassNames() {
        // 10秒キャッシュ
        if (Date.now() - cssClassCacheTime < 10000 && cssClassCache.length > 0) {
            return cssClassCache;
        }
        const defined = await collectDefinedClassesFromCss();
        cssClassCache = Array.from(defined);
        cssClassCacheTime = Date.now();
        return cssClassCache;
    }
    const cssClassCompletionProvider = vscode.languages.registerCompletionItemProvider([{ language: 'php' }, { language: 'html' }], {
        async provideCompletionItems(document, position) {
            const lineText = document.lineAt(position).text;
            const beforeCursor = lineText.substring(0, position.character);
            // class="..." の中かチェック
            const inClassAttr = /class=["'][^"']*$/.test(beforeCursor);
            // post_class( / body_class( / add_class( の中かチェック
            const inClassFunc = /(post_class|body_class|add_class|wp_nav_menu.*classes)\s*\(\s*['"][^'"]*$/.test(beforeCursor);
            // PHPの文字列リテラルの中（$class = '...' のような形）
            const inPhpString = /\$\w*[Cc]lass\w*\s*=\s*['"][^'"]*$/.test(beforeCursor);
            if (!inClassAttr && !inClassFunc && !inPhpString) {
                return undefined;
            }
            const classNames = await getCssClassNames();
            return classNames.map(name => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
                item.detail = 'CSSクラス';
                return item;
            });
        }
    }, '"', "'", ' ' // トリガー文字
    );
    context.subscriptions.push(cssClassCompletionProvider);
    // ========================================
    // WordPress関数補完（PHPで the_ / get_ / wp_ / has_ / is_ を入力時）
    // ========================================
    const wpFunctions = [
        { name: 'the_title()', detail: '投稿タイトルを表示' },
        { name: 'the_content()', detail: '投稿本文を表示' },
        { name: 'the_date()', detail: '投稿日を表示' },
        { name: 'the_author()', detail: '著者名を表示' },
        { name: 'the_permalink()', detail: '投稿URLを表示' },
        { name: 'the_excerpt()', detail: '抜粋を表示' },
        { name: 'the_category()', detail: 'カテゴリを表示' },
        { name: 'the_tags()', detail: 'タグを表示' },
        { name: 'the_post_thumbnail()', detail: 'アイキャッチ画像を表示' },
        { name: 'the_ID()', detail: '投稿IDを表示' },
        { name: 'get_the_title()', detail: '投稿タイトルを取得（戻り値）' },
        { name: 'get_the_ID()', detail: '投稿IDを取得（戻り値）' },
        { name: 'get_the_date()', detail: '投稿日を取得（戻り値）' },
        { name: 'get_permalink()', detail: '投稿URLを取得（戻り値）' },
        { name: 'get_the_excerpt()', detail: '抜粋を取得（戻り値）' },
        { name: 'get_post_thumbnail_url()', detail: 'アイキャッチ画像URLを取得' },
        { name: 'get_theme_file_uri()', detail: 'テーマファイルのURLを取得' },
        { name: 'get_template_directory_uri()', detail: 'テーマディレクトリのURLを取得' },
        { name: 'have_posts()', detail: '投稿があるか判定' },
        { name: 'has_post_thumbnail()', detail: 'アイキャッチがあるか判定' },
        { name: 'wp_head()', detail: '<head>内に必要なコードを出力' },
        { name: 'wp_footer()', detail: '</body>前に必要なコードを出力' },
        { name: 'wp_nav_menu()', detail: 'ナビゲーションメニューを出力' },
        { name: 'bloginfo()', detail: 'サイト情報を出力（name/urlなど）' },
        { name: 'get_bloginfo()', detail: 'サイト情報を取得（戻り値）' },
        { name: 'is_front_page()', detail: 'フロントページか判定' },
        { name: 'is_single()', detail: '投稿ページか判定' },
        { name: 'is_page()', detail: '固定ページか判定' },
        { name: 'is_archive()', detail: 'アーカイブページか判定' },
        { name: 'is_category()', detail: 'カテゴリページか判定' },
        { name: 'wp_enqueue_style()', detail: 'CSSを読み込み登録' },
        { name: 'wp_enqueue_script()', detail: 'JSを読み込み登録' },
        { name: 'add_action()', detail: 'フックにアクションを登録' },
        { name: 'add_filter()', detail: 'フックにフィルターを登録' },
    ];
    const wpFuncCompletionProvider = vscode.languages.registerCompletionItemProvider({ language: 'php' }, {
        provideCompletionItems(document, position) {
            const lineText = document.lineAt(position).text;
            // PHP開きタグの中かチェック
            if (!/(<\?php|<\?=)/.test(lineText) && !document.getText().substring(0, document.offsetAt(position)).includes('<?php')) {
                return undefined;
            }
            return wpFunctions.map(fn => {
                const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
                item.detail = fn.detail;
                item.documentation = `WordPress関数: ${fn.detail}`;
                return item;
            });
        }
    }, 'the_', 'get_', 'wp_', 'has_', 'is_', 'add_', 'blog');
    context.subscriptions.push(wpFuncCompletionProvider);
    // ========================================
    // CSS品質チェック（重複・矛盾・マージ提案）
    // ========================================
    // ========================================
    // css-jumper-ignore Quick Fix（電球アイコン）
    // ========================================
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider([{ language: 'css' }, { language: 'php' }, { language: 'html' }], {
        provideCodeActions(document, _range, context) {
            const actions = [];
            for (const diag of context.diagnostics) {
                if (diag.source !== 'CSS Jumper') {
                    continue;
                }
                const action = new vscode.CodeAction('CSS Jumper: この警告を無視する (/* css-jumper-ignore */)', vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                const line = diag.range.start.line;
                const indent = document.lineAt(line).text.match(/^(\s*)/)?.[1] ?? '';
                action.edit.insert(document.uri, new vscode.Position(line, 0), `${indent}/* css-jumper-ignore */\n`);
                action.diagnostics = [diag];
                actions.push(action);
            }
            return actions;
        }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
    const cssHintDecType = vscode.window.createTextEditorDecorationType({
        after: { color: 'rgba(150, 150, 100, 0.85)', fontStyle: 'italic', margin: '0 0 0 1em' }
    });
    context.subscriptions.push(cssHintDecType);
    const cssHintDecMap = new Map();
    let cssHintsEnabled = true;
    context.subscriptions.push(vscode.commands.registerCommand('cssToHtmlJumper.toggleCssHints', () => {
        cssHintsEnabled = !cssHintsEnabled;
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.languageId === 'css') {
                editor.setDecorations(cssHintDecType, cssHintsEnabled
                    ? (cssHintDecMap.get(editor.document.uri.toString()) ?? [])
                    : []);
            }
        }
        vscode.window.setStatusBarMessage(cssHintsEnabled ? '$(eye) CSS ヒント: ON' : '$(eye-closed) CSS ヒント: OFF', 2000);
    }));
    let cssDupTimer;
    function scheduleCssDupCheck(doc) {
        if (doc.languageId !== 'css') {
            return;
        }
        if (cssDupTimer) {
            clearTimeout(cssDupTimer);
        }
        cssDupTimer = setTimeout(async () => {
            const decs = runCssDupCheck(doc);
            const unusedDecs = await runUnusedCssCheck(doc);
            const allDecs = [...decs, ...unusedDecs];
            cssHintDecMap.set(doc.uri.toString(), allDecs);
            if (!cssHintsEnabled) {
                return;
            }
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document.uri.toString() === doc.uri.toString()) {
                    editor.setDecorations(cssHintDecType, allDecs);
                }
            }
        }, 800);
    }
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleCssDupCheck), vscode.workspace.onDidChangeTextDocument(e => scheduleCssDupCheck(e.document)), vscode.workspace.onDidSaveTextDocument(scheduleCssDupCheck), vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && editor.document.languageId === 'css') {
            editor.setDecorations(cssHintDecType, cssHintsEnabled
                ? (cssHintDecMap.get(editor.document.uri.toString()) ?? [])
                : []);
        }
    }));
    if (vscode.window.activeTextEditor) {
        scheduleCssDupCheck(vscode.window.activeTextEditor.document);
    }
    // ========================================
    // HTML品質チェック（img alt欠落）
    // ========================================
    const htmlQualityDiag = vscode.languages.createDiagnosticCollection('htmlQuality');
    context.subscriptions.push(htmlQualityDiag);
    let htmlQualityTimer;
    function scheduleHtmlQualityCheck(doc) {
        if (doc.languageId !== 'html' && doc.languageId !== 'php') {
            return;
        }
        if (htmlQualityTimer) {
            clearTimeout(htmlQualityTimer);
        }
        htmlQualityTimer = setTimeout(() => runHtmlQualityCheck(doc, htmlQualityDiag), 800);
    }
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleHtmlQualityCheck), vscode.workspace.onDidChangeTextDocument(e => scheduleHtmlQualityCheck(e.document)), vscode.workspace.onDidSaveTextDocument(scheduleHtmlQualityCheck));
    if (vscode.window.activeTextEditor) {
        scheduleHtmlQualityCheck(vscode.window.activeTextEditor.document);
    }
}
async function deactivate() {
}
// ========================================
// 未使用CSS検出
// ========================================
async function runUnusedCssCheck(doc) {
    const fs = require('fs');
    const decorations = [];
    const text = doc.getText();
    const htmlFiles = await vscode.workspace.findFiles('**/*.{html,php}', '**/node_modules/**', 50);
    if (htmlFiles.length === 0) {
        return decorations;
    }
    let htmlText = '';
    for (const f of htmlFiles) {
        try {
            htmlText += fs.readFileSync(f.fsPath, 'utf8') + '\n';
        }
        catch { /* skip */ }
    }
    const keyframeStopRegex = /^(from|to|\d+%(\s*,\s*\d+%)*)$/i;
    const ruleRegex = /([^{}@][^{}]*?)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRegex.exec(text)) !== null) {
        const rawSelector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!rawSelector || keyframeStopRegex.test(rawSelector)) {
            continue;
        }
        // , 区切りで複数セレクタを分割して、全部未使用のときだけ警告
        const parts = rawSelector.split(',').map(s => s.trim()).filter(Boolean);
        const allUnused = parts.every(sel => !isSelectorUsed(sel, htmlText));
        if (!allUnused) {
            continue;
        }
        // セレクタ行の位置を特定
        const leadingMatch = m[1].match(/^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/);
        const selectorOffset = m.index + (leadingMatch ? leadingMatch[0].length : 0);
        if (hasIgnoreComment(doc, selectorOffset)) {
            continue;
        }
        const pos = doc.positionAt(selectorOffset);
        const lineEnd = doc.lineAt(pos.line).range.end;
        decorations.push({
            range: new vscode.Range(pos.line, 0, pos.line, lineEnd.character),
            renderOptions: { after: { contentText: `  💤 未使用: HTMLで使われていません` } }
        });
    }
    return decorations;
}
function isSelectorUsed(selector, htmlText) {
    // 疑似クラス・疑似要素を除去してから判定
    const cleaned = selector.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim();
    // html / body / * / :root / タグ単体 → 常に使用済み扱い
    if (!cleaned || /^(html|body|\*|:root)$/.test(cleaned)) {
        return true;
    }
    if (/^[a-z][a-z0-9]*$/i.test(cleaned)) {
        return true;
    }
    // .class と #id を抽出
    const classNames = (cleaned.match(/\.([\w-]+)/g) || []).map(c => c.slice(1));
    const idNames = (cleaned.match(/#([\w-]+)/g) || []).map(i => i.slice(1));
    // クラスもIDもなければスキップ（例: タグ > タグ）
    if (classNames.length === 0 && idNames.length === 0) {
        return true;
    }
    for (const cls of classNames) {
        if (!new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, 'i').test(htmlText)) {
            return false;
        }
    }
    for (const id of idNames) {
        if (!new RegExp(`id="[^"]*\\b${id}\\b[^"]*"`, 'i').test(htmlText)) {
            return false;
        }
    }
    return true;
}
// ========================================
// カンプ照合ヘルパー関数
// ========================================
function kanpuFindSelectorByText(htmlText, text) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // class属性を持つタグの中にテキストを含む
    const classMatch = htmlText.match(new RegExp(`<[a-z0-9]+[^>]*class="([^"]+)"[^>]*>\\s*${escaped}\\s*</`, 'i'));
    if (classMatch) {
        return '.' + classMatch[1].split(/\s+/)[0];
    }
    // id属性
    const idMatch = htmlText.match(new RegExp(`<[a-z0-9]+[^>]*id="([^"]+)"[^>]*>\\s*${escaped}\\s*</`, 'i'));
    if (idMatch) {
        return '#' + idMatch[1];
    }
    return '';
}
function kanpuFindSelectorByName(htmlText, name) {
    const lower = name.toLowerCase();
    // class属性に部分一致
    const classMatch = htmlText.match(new RegExp(`class="([^"]*${lower}[^"]*)"`, 'i'));
    if (classMatch) {
        const cls = classMatch[1].split(/\s+/).find(c => c.toLowerCase().includes(lower));
        if (cls) {
            return '.' + cls;
        }
    }
    // id属性に部分一致
    const idMatch = htmlText.match(new RegExp(`id="([^"]*${lower}[^"]*)"`, 'i'));
    if (idMatch) {
        return '#' + idMatch[1];
    }
    // src/alt に部分一致 → imgの直前の親クラスを探す
    const srcRe = new RegExp(`(<img[^>]*(?:src|alt)="[^"]*${lower}[^"]*"[^>]*>)`, 'i');
    const srcMatch = htmlText.match(srcRe);
    if (srcMatch) {
        const before = htmlText.substring(0, htmlText.indexOf(srcMatch[1]));
        const parentMatch = before.match(/class="([^"]+)"\s*[^>]*>\s*$/);
        if (parentMatch) {
            return '.' + parentMatch[1].split(/\s+/)[0];
        }
    }
    return '';
}
function kanpuCompare(cssText, selector, record) {
    const diffs = [];
    const block = kanpuGetBlock(cssText, selector);
    if (!block) {
        return diffs;
    }
    const checks = [
        { key: 'textSize', prop: 'font-size' },
        { key: 'color', prop: 'color' },
        { key: 'letterSpacing', prop: 'letter-spacing' },
        { key: 'textFamily', prop: 'font-family' },
        { key: 'w', prop: 'width' },
        { key: 'h', prop: 'height' },
    ];
    for (const c of checks) {
        const jsonVal = record[c.key];
        if (!jsonVal || !jsonVal.trim()) {
            continue;
        }
        const cssVal = kanpuGetPropVal(block, c.prop);
        if (!cssVal) {
            continue;
        }
        if (!kanpuValMatch(jsonVal.trim(), cssVal.trim(), c.prop)) {
            diffs.push({ prop: c.prop, expected: jsonVal.trim() });
        }
    }
    return diffs;
}
function kanpuGetBlock(cssText, selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = cssText.match(new RegExp(esc + '\\s*\\{([^}]*)\\}'));
    return m ? m[1] : null;
}
function kanpuGetPropVal(block, prop) {
    const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = block.match(new RegExp(esc + '\\s*:\\s*([^;\\n]+)'));
    return m ? m[1].trim() : null;
}
function kanpuFindPropLine(cssText, selector, prop) {
    const lines = cssText.split('\n');
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
        if (!inBlock && new RegExp(esc + '\\s*\\{').test(lines[i])) {
            inBlock = true;
            continue;
        }
        if (inBlock) {
            if (lines[i].includes('}')) {
                inBlock = false;
                continue;
            }
            if (new RegExp(prop + '\\s*:').test(lines[i])) {
                return i;
            }
        }
    }
    return -1;
}
function kanpuValMatch(jsonVal, cssVal, prop) {
    // calc() / % / vw / vh / auto / var() は比較スキップ（意図的な動的・相対値）
    if (/calc\(|%|vw|vh|auto|var\(/.test(cssVal)) {
        return true;
    }
    // color は16進数で正規化して比較
    if (prop === 'color') {
        return jsonVal.toLowerCase() === cssVal.toLowerCase();
    }
    // 数値（px/rem）は数値部分だけ比較（1px以内は許容）
    const jNum = parseFloat(jsonVal);
    const cNum = parseFloat(cssVal);
    if (!isNaN(jNum) && !isNaN(cNum)) {
        return Math.abs(jNum - cNum) < 1;
    }
    return jsonVal === cssVal;
}
// ========================================
// css-jumper-ignore コメントチェック
// ========================================
function hasIgnoreComment(doc, offset) {
    const pos = doc.positionAt(offset);
    if (pos.line === 0) {
        return false;
    }
    return doc.lineAt(pos.line - 1).text.includes('css-jumper-ignore');
}
// ワークスペースのCSSから定義済みクラスを収集
async function collectDefinedClassesFromCss() {
    const defined = new Set();
    const cssFiles = await vscode.workspace.findFiles('**/*.css', '**/node_modules/**', 20);
    for (const fileUri of cssFiles) {
        try {
            const css = fs.readFileSync(fileUri.fsPath, 'utf-8');
            // コメント（/* ... */）を除去してからクラスを抽出
            const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
            const selRegex = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
            let sm;
            while ((sm = selRegex.exec(cssNoComments)) !== null) {
                defined.add(sm[1]);
            }
        }
        catch { /* ignore */ }
    }
    return defined;
}
// ========================================
// CSS品質チェック ヘルパー
// ========================================
/** offset が属する行の末尾位置を返す（ヒントを行末に表示するため） */
function lineEndPos(doc, offset) {
    return doc.lineAt(doc.positionAt(offset).line).range.end;
}
function runCssDupCheck(doc) {
    const text = doc.getText();
    const decorations = [];
    // shorthand → longhand の上書き対応表
    const shorthandMap = {
        'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
        'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
        'border': ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color'],
        'background': ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat'],
        'font': ['font-size', 'font-family', 'font-weight', 'font-style', 'font-variant'],
        'flex': ['flex-grow', 'flex-shrink', 'flex-basis'],
    };
    const rules = [];
    // @keyframes内のルール（0%, 100%, from, to）は除外
    const keyframeStopRegex = /^(from|to|\d+%(\s*,\s*\d+%)*)$/i;
    const ruleRegex = /([^{}@][^{}]*?)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRegex.exec(text)) !== null) {
        const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (keyframeStopRegex.test(selector)) {
            continue;
        }
        const body = m[2];
        const bodyStart = m.index + m[0].indexOf(m[2]);
        const props = new Map();
        const propRegex = /([\w-]+)\s*:\s*([^;]+);/g;
        let pm;
        while ((pm = propRegex.exec(body)) !== null) {
            const propName = pm[1].trim().toLowerCase();
            const propValue = pm[2].trim();
            const offset = bodyStart + pm.index;
            const line = doc.positionAt(offset).line;
            props.set(propName, { value: propValue, line, offset });
        }
        const leadingMatch = m[1].match(/^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/); // 先頭の空白・コメントをスキップ
        const selectorOffset = m.index + (leadingMatch ? leadingMatch[0].length : 0);
        rules.push({ selector, props, selectorLine: doc.positionAt(selectorOffset).line, selectorOffset });
    }
    // ① 同じルール内のプロパティ重複チェック（同じファイルを走査する前に重複チェック）
    for (const rule of rules) {
        // 既に追加済みのプロパティを追跡（同じルール内での重複）
        const seen = new Map();
        const propRegex2 = /([\w-]+)\s*:\s*([^;]+);/g;
        const bodyMatch = /\{([^{}]*)\}/.exec(text.substring(rule.selectorOffset));
        if (!bodyMatch) {
            continue;
        }
        const bodyStart = rule.selectorOffset + bodyMatch.index + 1;
        let pm2;
        while ((pm2 = propRegex2.exec(bodyMatch[1])) !== null) {
            const propName = pm2[1].trim().toLowerCase();
            const propValue = pm2[2].trim();
            const offset = bodyStart + pm2.index;
            if (seen.has(propName)) {
                const prev = seen.get(propName);
                // 前の定義に警告
                const prevStart = doc.positionAt(prev.offset);
                const prevEnd = lineEndPos(doc, prev.offset);
                decorations.push({
                    range: new vscode.Range(prevStart, prevEnd),
                    renderOptions: { after: { contentText: `  ⚠ "${propName}" が同じルール内で重複しています（後の "${propValue}" が有効）` } }
                });
            }
            seen.set(propName, { value: propValue, line: doc.positionAt(offset).line, offset });
        }
        // ② shorthand が longhand を上書きするチェック
        for (const [shorthand, longhands] of Object.entries(shorthandMap)) {
            if (!rule.props.has(shorthand)) {
                continue;
            }
            const shortInfo = rule.props.get(shorthand);
            for (const longhand of longhands) {
                if (!rule.props.has(longhand)) {
                    continue;
                }
                const longInfo = rule.props.get(longhand);
                // longhandがshorthandより前にある場合は上書きされる
                if (longInfo.offset < shortInfo.offset) {
                    const start = doc.positionAt(longInfo.offset);
                    const end = lineEndPos(doc, longInfo.offset);
                    decorations.push({
                        range: new vscode.Range(start, end),
                        renderOptions: { after: { contentText: `  ⚠ "${longhand}" は後の "${shorthand}" に上書きされます` } }
                    });
                }
            }
        }
    }
    // ③ 同じセレクタが複数定義されているチェック
    const selectorMap = new Map();
    for (const rule of rules) {
        const sel = rule.selector.replace(/\s+/g, ' ').toLowerCase();
        if (!selectorMap.has(sel)) {
            selectorMap.set(sel, []);
        }
        selectorMap.get(sel).push({ line: rule.selectorLine, offset: rule.selectorOffset });
    }
    for (const [sel, locations] of selectorMap) {
        if (locations.length < 2) {
            continue;
        }
        // 最初の定義に警告
        const first = locations[0];
        if (hasIgnoreComment(doc, first.offset)) {
            continue;
        }
        const start = doc.positionAt(first.offset);
        const end = lineEndPos(doc, first.offset);
        const lines = locations.map(l => `行${l.line + 1}`).join(', ');
        decorations.push({
            range: new vscode.Range(start, end),
            renderOptions: { after: { contentText: `  [参考] "${sel}" が${locations.length}箇所に定義されています（${lines}）。まとめられます` } }
        });
    }
    // ④ 同じプロパティセットを持つセレクタのマージ提案
    const propSignatureMap = new Map();
    for (const rule of rules) {
        if (rule.props.size < 3) {
            continue;
        } // 3つ以上一致したときだけ提案
        const sig = Array.from(rule.props.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v.value}`)
            .join(';');
        if (!propSignatureMap.has(sig)) {
            propSignatureMap.set(sig, []);
        }
        propSignatureMap.get(sig).push(rule.selector);
    }
    for (const [, selectors] of propSignatureMap) {
        if (selectors.length < 2) {
            continue;
        }
        // 該当ルールに情報警告を追加
        for (const rule of rules) {
            if (!selectors.includes(rule.selector)) {
                continue;
            }
            if (hasIgnoreComment(doc, rule.selectorOffset)) {
                continue;
            }
            const start = doc.positionAt(rule.selectorOffset);
            const end = lineEndPos(doc, rule.selectorOffset);
            const others = selectors.filter(s => s !== rule.selector).join(', ');
            decorations.push({
                range: new vscode.Range(start, end),
                renderOptions: { after: { contentText: `  [参考] "${rule.selector}" は "${others}" と同じプロパティです。まとめられます` } }
            });
        }
    }
    // ⑤ 必須セットプロパティのチェック
    for (const rule of rules) {
        const props = rule.props;
        const hasPosition = props.has('position');
        const positionValue = props.get('position')?.value ?? '';
        const hasTop = props.has('top');
        const hasBottom = props.has('bottom');
        const hasLeft = props.has('left');
        const hasRight = props.has('right');
        // z-index は position が static 以外のときのみ有効
        if (props.has('z-index') && (!hasPosition || positionValue === 'static')) {
            const info = props.get('z-index');
            const start = doc.positionAt(info.offset);
            const end = lineEndPos(doc, info.offset);
            decorations.push({
                range: new vscode.Range(start, end),
                renderOptions: { after: { contentText: `  ⚠ "z-index" は "position: static"（デフォルト）のままでは効きません。position: relative/absolute/fixed のいずれかが必要です` } }
            });
        }
        // position: absolute/fixed/sticky には座標が必要
        if (hasPosition && ['absolute', 'fixed', 'sticky'].includes(positionValue)) {
            const hasAxisX = hasLeft || hasRight;
            const hasAxisY = hasTop || hasBottom;
            if (!hasAxisX || !hasAxisY) {
                const info = props.get('position');
                const start = doc.positionAt(info.offset);
                const end = lineEndPos(doc, info.offset);
                const missing = [];
                if (!hasAxisY) {
                    missing.push('top か bottom');
                }
                if (!hasAxisX) {
                    missing.push('left か right');
                }
                decorations.push({
                    range: new vscode.Range(start, end),
                    renderOptions: { after: { contentText: `  "position: ${positionValue}" には ${missing.join(' と ')} も必要です` } }
                });
            }
        }
        // display: grid にはテンプレート定義が必要
        if (props.get('display')?.value === 'grid') {
            const hasCols = props.has('grid-template-columns') || props.has('grid-template');
            const hasRows = props.has('grid-template-rows');
            if (!hasCols && !hasRows) {
                const info = props.get('display');
                const start = doc.positionAt(info.offset);
                const end = lineEndPos(doc, info.offset);
                decorations.push({
                    range: new vscode.Range(start, end),
                    renderOptions: { after: { contentText: `  "display: grid" には "grid-template-columns" か "grid-template-rows" が必要です` } }
                });
            }
        }
    }
    // ⑤' margin/padding ロングハンドをまとめる提案
    const longhandGroups = [
        { shorthand: 'margin', sides: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
        { shorthand: 'padding', sides: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
    ];
    for (const rule of rules) {
        for (const group of longhandGroups) {
            if (rule.props.has(group.shorthand)) {
                continue;
            } // shorthand既にあり → スキップ
            const found = group.sides.filter(s => rule.props.has(s));
            if (found.length < 2) {
                continue;
            }
            // ショートハンド提案値を生成（未指定は '0' 扱い）
            const tv = rule.props.get(`${group.shorthand}-top`)?.value ?? '0';
            const rv = rule.props.get(`${group.shorthand}-right`)?.value ?? '0';
            const bv = rule.props.get(`${group.shorthand}-bottom`)?.value ?? '0';
            const lv = rule.props.get(`${group.shorthand}-left`)?.value ?? '0';
            let suggestion;
            if (tv === rv && rv === bv && bv === lv) {
                suggestion = `${group.shorthand}: ${tv}`;
            }
            else if (rv === lv && tv === bv) {
                suggestion = `${group.shorthand}: ${tv} ${rv}`;
            }
            else if (rv === lv) {
                suggestion = `${group.shorthand}: ${tv} ${rv} ${bv}`;
            }
            else {
                suggestion = `${group.shorthand}: ${tv} ${rv} ${bv} ${lv}`;
            }
            // 最初のロングハンドの行にヒントを出す
            const firstInfo = found
                .map(lh => rule.props.get(lh))
                .reduce((a, b) => a.offset < b.offset ? a : b);
            const hintStart = doc.positionAt(firstInfo.offset);
            const hintEnd = lineEndPos(doc, firstInfo.offset);
            decorations.push({
                range: new vscode.Range(hintStart, hintEnd),
                renderOptions: { after: { contentText: `  [参考] ${found.join(' + ')} → ${suggestion}; にまとめられます` } }
            });
        }
    }
    // ⑥ px と rem の混在チェック（font-size / margin / padding / width / height）
    const sizeProps = ['font-size', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
        'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'width', 'height',
        'gap', 'line-height', 'border-radius'];
    const pxOffsets = [];
    const remOffsets = [];
    const sizePropRegex = new RegExp(`(${sizeProps.join('|')})\\s*:\\s*[^;]*(\\d+(?:\\.\\d+)?)(px|rem)`, 'g');
    let sp;
    while ((sp = sizePropRegex.exec(text)) !== null) {
        const unit = sp[3];
        const unitOffset = sp.index + sp[0].lastIndexOf(unit);
        if (unit === 'px') {
            pxOffsets.push(unitOffset);
        }
        else {
            remOffsets.push(unitOffset);
        }
    }
    if (pxOffsets.length > 0 && remOffsets.length > 0) {
        // 最初のpxに警告を1つだけ出す
        const offset = pxOffsets[0];
        const start = doc.positionAt(offset);
        const end = lineEndPos(doc, offset);
        decorations.push({
            range: new vscode.Range(start, end),
            renderOptions: { after: { contentText: `  [参考] px と rem が混在しています（${pxOffsets.length}箇所px / ${remOffsets.length}箇所rem）。どちらかに統一すると管理しやすくなります` } }
        });
    }
    // ⑦ CSS変数（var(--xxx)）の未定義チェック
    const definedVars = new Set();
    const varDefRegex = /(--[\w-]+)\s*:/g;
    let vd;
    while ((vd = varDefRegex.exec(text)) !== null) {
        definedVars.add(vd[1]);
    }
    const varUseRegex = /var\((--[\w-]+)\)/g;
    let vu;
    while ((vu = varUseRegex.exec(text)) !== null) {
        const varName = vu[1];
        if (definedVars.has(varName)) {
            continue;
        }
        const offset = vu.index + 4; // "var(" の後
        const start = doc.positionAt(offset);
        const end = lineEndPos(doc, offset);
        decorations.push({
            range: new vscode.Range(start, end),
            renderOptions: { after: { contentText: `  ⚠ CSS変数 "${varName}" が定義されていません（:root に定義が必要です）` } }
        });
    }
    // ⑦ 画像パスの存在チェック（url(...)）
    const docDir = path.dirname(doc.uri.fsPath);
    const urlRegex = /url\(['"]?([^'")]+)['"]?\)/g;
    let um;
    while ((um = urlRegex.exec(text)) !== null) {
        const imgPath = um[1].trim();
        if (imgPath.startsWith('http') || imgPath.startsWith('data:') || imgPath.startsWith('/')) {
            continue;
        }
        const absPath = path.resolve(docDir, imgPath);
        if (!fs.existsSync(absPath)) {
            const offset = um.index + um[0].indexOf(um[1]);
            const start = doc.positionAt(offset);
            const end = lineEndPos(doc, offset);
            decorations.push({
                range: new vscode.Range(start, end),
                renderOptions: { after: { contentText: `  ⚠ 画像ファイルが見つかりません: "${imgPath}"` } }
            });
        }
    }
    const mediaBlocks = [];
    {
        let i = 0;
        while (i < text.length) {
            const atIdx = text.indexOf('@media', i);
            if (atIdx === -1) {
                break;
            }
            const openIdx = text.indexOf('{', atIdx);
            if (openIdx === -1) {
                break;
            }
            let depth = 1;
            let j = openIdx + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === '{') {
                    depth++;
                }
                else if (text[j] === '}') {
                    depth--;
                }
                j++;
            }
            mediaBlocks.push({ start: atIdx, end: j });
            i = j;
        }
    }
    // 通常ルール（@media外）のmap: "selector|property" → value
    const normalRuleMap = new Map();
    for (const rule of rules) {
        const isInMedia = mediaBlocks.some(mb => rule.selectorOffset >= mb.start && rule.selectorOffset < mb.end);
        if (isInMedia) {
            continue;
        }
        for (const [propName, propInfo] of rule.props) {
            const key = `${rule.selector.replace(/\s+/g, ' ').toLowerCase()}|${propName}`;
            normalRuleMap.set(key, propInfo.value);
        }
    }
    // @media内のルールと通常ルールを比較
    for (const rule of rules) {
        const isInMedia = mediaBlocks.some(mb => rule.selectorOffset >= mb.start && rule.selectorOffset < mb.end);
        if (!isInMedia) {
            continue;
        }
        for (const [propName, propInfo] of rule.props) {
            const key = `${rule.selector.replace(/\s+/g, ' ').toLowerCase()}|${propName}`;
            const normalValue = normalRuleMap.get(key);
            if (normalValue !== undefined && normalValue === propInfo.value) {
                const start = doc.positionAt(propInfo.offset);
                const end = lineEndPos(doc, propInfo.offset);
                decorations.push({
                    range: new vscode.Range(start, end),
                    renderOptions: { after: { contentText: `  "${propName}: ${propInfo.value}" は通常ルールと同じ値です。@media内では不要な可能性があります` } }
                });
            }
        }
    }
    // ⑨ ::before / ::after に content がないチェック
    for (const rule of rules) {
        const sel = rule.selector;
        if (!sel.includes('::before') && !sel.includes('::after') &&
            !sel.includes(':before') && !sel.includes(':after')) {
            continue;
        }
        if (!rule.props.has('content')) {
            if (hasIgnoreComment(doc, rule.selectorOffset)) {
                continue;
            }
            const start = doc.positionAt(rule.selectorOffset);
            const end = lineEndPos(doc, rule.selectorOffset);
            decorations.push({
                range: new vscode.Range(start, end),
                renderOptions: { after: { contentText: `  ⚠ "::before/::after" には "content" が必要です（content: "" でも可）` } }
            });
        }
    }
    // ⑩ animation に対応する @keyframes がないチェック
    const definedKeyframes = new Set();
    const keyframeDefRegex = /@keyframes\s+([\w-]+)/g;
    let kd;
    while ((kd = keyframeDefRegex.exec(text)) !== null) {
        definedKeyframes.add(kd[1]);
    }
    for (const rule of rules) {
        const animInfo = rule.props.get('animation') || rule.props.get('animation-name');
        if (!animInfo) {
            continue;
        }
        // animation値から名前部分を抽出（"fade 0.3s ease" → "fade"）
        const animValue = animInfo.value.trim();
        const knownKeywords = /^(none|initial|inherit|unset|normal|forwards|backwards|both|infinite|alternate|reverse|ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|\d)/;
        const nameParts = animValue.split(/[\s,]+/).filter(p => p && !knownKeywords.test(p));
        for (const name of nameParts) {
            if (definedKeyframes.has(name)) {
                continue;
            }
            if (hasIgnoreComment(doc, animInfo.offset)) {
                continue;
            }
            const start = doc.positionAt(animInfo.offset);
            const end = lineEndPos(doc, animInfo.offset);
            decorations.push({
                range: new vscode.Range(start, end),
                renderOptions: { after: { contentText: `  ⚠ "@keyframes ${name}" が定義されていません` } }
            });
            break; // 同じプロパティに1つだけ警告
        }
    }
    return decorations;
}
// ========================================
// HTML品質チェック ヘルパー（img alt欠落）
// ========================================
function runHtmlQualityCheck(doc, diagCollection) {
    const text = doc.getText();
    const diagnostics = [];
    // <img> タグで alt属性がないものを検出（PHP動的imgはスキップ）
    const imgRegex = /<img\b([^>]*)>/gi;
    let m;
    while ((m = imgRegex.exec(text)) !== null) {
        const attrs = m[1];
        if (attrs.includes('<?')) {
            continue;
        } // PHP動的属性はスキップ
        if (/\balt\s*=/.test(attrs)) {
            continue;
        } // alt属性あり → OK
        const start = doc.positionAt(m.index);
        const end = doc.positionAt(m.index + 4); // "<img" の部分
        const diag = new vscode.Diagnostic(new vscode.Range(start, end), `<img> に alt 属性がありません（アクセシビリティ・SEOのために必要です）`, vscode.DiagnosticSeverity.Warning);
        diag.source = 'CSS Jumper';
        diagnostics.push(diag);
    }
    diagCollection.set(doc.uri, diagnostics);
}
// 正規表現の特殊文字をエスケープ
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=extension.js.map