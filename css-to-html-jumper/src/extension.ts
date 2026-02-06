import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { cssProperties, analyzeValue } from './cssProperties';
import { jsMethods } from './jsProperties';

// ========================================
// メモ検索履歴（最新10件）
// ========================================
let memoSearchHistory: string[] = [];

// ========================================
// クイズ履歴（間隔反復学習用）
// ========================================
interface QuizHistory {
  title: string;          // 見出し
  line: number;           // 行番号
  lastReviewed: number;   // 最終復習日時（Unix timestamp）
  reviewCount: number;    // 復習回数
}

let quizHistoryMap: Map<string, QuizHistory> = new Map();

// ========================================
// メモ検索関連関数
// ========================================

/**
 * Fuzzy検索: 部分一致、大小文字無視、スペース無視、単語分割マッチ
 * 例: 「ボックスサイズ」→「ボックス」「サイズ」両方含む行を検索
 */
function fuzzySearch(query: string, lines: string[]): { line: number; text: string; preview: string }[] {
  const results: { line: number; text: string; preview: string }[] = [];

  // クエリを単語分割（スペース・記号で区切る）
  const queryWords = query
    .toLowerCase()
    .split(/[\s　、。・]+/)  // 半角・全角スペース、句読点で分割
    .filter(w => w.length > 0);

  if (queryWords.length === 0) {
    return results;
  }

  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = lines[i].toLowerCase();

    // 全単語が含まれているかチェック
    const allWordsMatch = queryWords.every(word => normalizedLine.includes(word));

    if (allWordsMatch) {
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
 * Gemini Flash API呼び出し
 */
async function searchWithGemini(query: string, memoContent: string): Promise<{ line: number; keyword: string; text: string; preview: string }[]> {
  const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
  const apiKey = config.get<string>('geminiApiKey', '');

  if (!apiKey) {
    throw new Error('Gemini API キーが設定されていません。設定 → cssToHtmlJumper.geminiApiKey を確認してください。');
  }

  const prompt = `以下のメモファイルから「${query}」に関連する行を検索してください。

【メモファイル】（各行に行番号付き）
${memoContent.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}

【検索クエリ】
${query}

【指示】
- 検索クエリに関連する行を抽出する
- 単語が1つの場合: その単語を含む行を探す（例: 「隣接」→「隣接」を含む行）
- 単語が複数の場合: 全単語を含む行を最優先（例: 「ボックスサイズ」→「ボックス」「サイズ」両方含む行）
- 単語の順序は問わない、離れていてもOK
- typoや表記ゆれも考慮する
- **最大3件のみ**抽出（関連度が最も高いものだけ、厳選すること）
- **必ず異なるセクション（トピック）から選ぶ**（連続した行番号NG、離れた箇所から）
- 見出し行（##で始まる）を優先する
- 類似内容・同じセクションの重複は絶対に避ける

【出力形式】
JSON配列で返す。説明文は不要。必ず3件以内。
各結果に**技術用語・キーワード**を必ず抽出して含める。

[
  {"line": 行番号, "keyword": "主要な技術用語", "text": "該当行の内容"},
  ...
]

例:
[
  {"line": 1052, "keyword": "inline-block", "text": "## テキストなどの幅をサイズに丁度にボックスを調整する"},
  {"line": 2536, "keyword": "fit-content", "text": "幅がひろいwidthを文字は文字幅にあわせる"}
]`;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,  // 精度重視で低めに
        maxOutputTokens: 4096
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

          // JSON配列を抽出
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const results = JSON.parse(jsonMatch[0]);
            const formatted = results.map((r: any) => ({
              line: r.line,
              keyword: r.keyword || '',
              text: r.text,
              preview: r.text.substring(0, 100)
            }));
            resolve(formatted);
          } else {
            resolve([]);
          }
        } catch (e: any) {
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
  const memoFilePath = config.get<string>('memoFilePath', '');

  if (!memoFilePath) {
    vscode.window.showErrorMessage('メモファイルパスが設定されていません。設定 → cssToHtmlJumper.memoFilePath を確認してください。');
    return;
  }

  // 検索クエリ入力
  const query = await vscode.window.showInputBox({
    prompt: 'メモ内を検索',
    placeHolder: '検索キーワードを入力...'
  });

  if (!query) {
    return; // キャンセル
  }

  try {
    // メモファイル読み込み
    const memoUri = vscode.Uri.file(memoFilePath);
    const memoDoc = await vscode.workspace.openTextDocument(memoUri);
    const memoContent = memoDoc.getText();

    // Gemini Flash検索（Fuzzyスキップ）
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: '🤖 Gemini Flashで検索中...',
      cancellable: false
    }, async () => {
      try {
        const geminiResults = await searchWithGemini(query, memoContent);

        if (geminiResults.length > 0) {
          const items = geminiResults.map(r => ({
            label: `行 ${r.line}: ${r.keyword}`,
            description: r.preview,
            line: r.line
          }));

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `${geminiResults.length}件見つかりました`
          });

          if (selected) {
            const editor = await vscode.window.showTextDocument(memoDoc);
            const position = new vscode.Position(selected.line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
          }
        } else {
          // 0件時はメッセージなし（静かに終了）
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Gemini検索エラー: ${e.message}`);
      }
    });
  } catch (e: any) {
    vscode.window.showErrorMessage(`メモファイル読み込みエラー: ${e.message}`);
  }
}

/**
 * クイズのメイン処理
 */
async function handleQuiz() {
  const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
  const memoFilePath = config.get<string>('memoFilePath', '');

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
    const headings: { line: number; title: string; content: string[] }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^##\s+(.+)/);
      if (match) {
        const title = match[1];
        const content: string[] = [];

        // 次の見出しまでの内容を取得
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].match(/^##\s+/)) {
            break;
          }
          if (lines[j].trim()) {
            content.push(lines[j]);
          }
        }

        if (content.length > 0) {
          headings.push({ line: i + 1, title, content });
        }
      }
    }

    if (headings.length === 0) {
      vscode.window.showInformationMessage('メモに見出し（##）が見つかりませんでした');
      return;
    }

    // 復習優先ロジック
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 復習候補: 1日以上経過した問題
    const reviewCandidates = headings.filter(h => {
      const history = quizHistoryMap.get(h.title);
      if (!history) return false; // 未出題は除外
      const daysSince = (now - history.lastReviewed) / ONE_DAY;
      return daysSince >= 1;
    });

    let quiz;
    if (reviewCandidates.length > 0) {
      // 復習問題を優先（古い順）
      reviewCandidates.sort((a, b) => {
        const historyA = quizHistoryMap.get(a.title)!;
        const historyB = quizHistoryMap.get(b.title)!;
        return historyA.lastReviewed - historyB.lastReviewed;
      });
      quiz = reviewCandidates[0];
    } else {
      // 復習なし → 未出題 or ランダム
      const unreviewed = headings.filter(h => !quizHistoryMap.has(h.title));
      if (unreviewed.length > 0) {
        const randomIndex = Math.floor(Math.random() * unreviewed.length);
        quiz = unreviewed[randomIndex];
      } else {
        const randomIndex = Math.floor(Math.random() * headings.length);
        quiz = headings[randomIndex];
      }
    }

    // Gemini 2.5 Flash-Liteで問題生成
    const geminiApiKey = config.get<string>('geminiApiKey', '');
    let questionText = quiz.title; // フォールバック

    if (geminiApiKey) {
      try {
        const contentPreview = quiz.content.slice(0, 10).join('\n');
        const prompt = `以下のメモの見出しと内容から、簡潔なクイズ問題を1つ生成してください。

【見出し】
${quiz.title}

【内容】
${contentPreview}

【要件】
- 30文字以内の短い質問
- 必ず「？」で終わる
- 前置き・説明文は一切禁止、質問のみ出力
- キーワードを含める

悪い例: "[!INFORMATION]という文字を視覚的に中央に配置するには、負担的に以下のようなCSSプロパティと値が必要"（長すぎ・説明的）
良い例: "中央配置に必要なCSSプロパティは？"`;

        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + geminiApiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (response.ok) {
          const data: any = await response.json();
          const generatedQuestion = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generatedQuestion) {
            questionText = generatedQuestion;
          }
        }
      } catch (e) {
        // エラー時はフォールバック（見出しのみ）
        console.error('Gemini問題生成エラー:', e);
      }
    }

    // QuickPickで問題表示
    const answer = await vscode.window.showQuickPick(
      [
        { label: '💡 答えを見る', description: '', action: 'answer' },
        { label: '🔄 別の問題', description: '', action: 'next' }
      ],
      {
        placeHolder: `🎯 ${questionText}`
      }
    );

    if (!answer) {
      return; // キャンセル
    }

    if (answer.action === 'answer') {
      // 履歴記録（答えを見た時点で記録）
      const existingHistory = quizHistoryMap.get(quiz.title);
      if (existingHistory) {
        existingHistory.lastReviewed = now;
        existingHistory.reviewCount++;
      } else {
        quizHistoryMap.set(quiz.title, {
          title: quiz.title,
          line: quiz.line,
          lastReviewed: now,
          reviewCount: 1
        });
      }

      // 答え表示 → 自動でメモを開く
      const editor = await vscode.window.showTextDocument(memoDoc);
      const position = new vscode.Position(quiz.line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

      // 答え確認後の選択肢
      const afterAnswer = await vscode.window.showQuickPick(
        [
          { label: '🔁 同じ問題をもう一度', description: '', action: 'retry' },
          { label: '🔄 別の問題', description: '', action: 'next' },
          { label: '✅ 終了', description: '', action: 'exit' }
        ],
        {
          placeHolder: '次のアクション'
        }
      );

      if (afterAnswer?.action === 'retry') {
        // 同じ問題を再出題（QuickPickから再開）
        const retryAnswer = await vscode.window.showQuickPick(
          [
            { label: '💡 答えを見る', description: '', action: 'answer' },
            { label: '🔄 別の問題', description: '', action: 'next' }
          ],
          {
            placeHolder: `🎯 ${questionText}`
          }
        );

        if (retryAnswer?.action === 'answer') {
          // 答えを見る → メモジャンプ
          const editor2 = await vscode.window.showTextDocument(memoDoc);
          const position2 = new vscode.Position(quiz.line - 1, 0);
          editor2.selection = new vscode.Selection(position2, position2);
          editor2.revealRange(new vscode.Range(position2, position2), vscode.TextEditorRevealType.InCenter);
        } else if (retryAnswer?.action === 'next') {
          await handleQuiz();
        }
      } else if (afterAnswer?.action === 'next') {
        await handleQuiz();
      }
      // exit or キャンセルは何もしない
    } else if (answer.action === 'next') {
      // 別の問題
      await handleQuiz();
    }
  } catch (e: any) {
    vscode.window.showErrorMessage(`クイズエラー: ${e.message}`);
  }
}

// ========================================
// Claude API 呼び出し関数
// ========================================
async function askClaudeAPI(code: string, question: string, htmlContext?: string, isStructural?: boolean): Promise<string> {
  const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
  const apiKey = config.get<string>('claudeApiKey', '');
  const model = config.get<string>('claudeModel', 'claude-sonnet-4-5-20250929');

  if (!apiKey) {
    throw new Error('Claude API キーが設定されていません。設定 → cssToHtmlJumper.claudeApiKey を確認してください。');
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
  } else if (isStructural && code.trim()) {
    prompt = `以下のHTMLファイルの構造改善を依頼します。

【HTMLファイル全体】
\`\`\`html
${code}
\`\`\`

【依頼】
${question}

日本語で回答してください。`;
  } else if (code.trim() && htmlContext) {
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
  } else if (code.trim()) {
    prompt = `以下のコードについて質問があります。

【コード】
\`\`\`
${code}
\`\`\`

【質問】
${question}

日本語で簡潔に回答してください。`;
  } else {
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
    max_tokens: isStructural ? 8192 : 4096,
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
          } else if (json.content && json.content[0] && json.content[0].text) {
            resolve(json.content[0].text);
          } else {
            reject(new Error('予期しないレスポンス形式'));
          }
        } catch (e) {
          reject(new Error('レスポンスの解析に失敗'));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(requestBody);
    req.end();
  });
}

// CSSコードからクラス名/ID名を抽出
function extractSelectorsFromCSS(cssCode: string): string[] {
  const selectors: string[] = [];
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
function findParentSelector(document: vscode.TextDocument, position: vscode.Position): { selectors: string[]; selectorText: string; fullRule: string } {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // カーソル位置より前のテキスト
  const beforeCursor = text.substring(0, offset);

  // 最後の { を探す（CSSルールの開始）
  const lastOpenBrace = beforeCursor.lastIndexOf('{');
  if (lastOpenBrace === -1) return { selectors: [], selectorText: '', fullRule: '' };

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

// HTMLファイルからセレクタの使用箇所を検索
async function findHtmlUsage(selectors: string[]): Promise<string> {
  if (selectors.length === 0) return '';

  const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
  const targetPattern = config.get<string>('targetFiles', '**/*.html');
  const htmlFiles = await vscode.workspace.findFiles(targetPattern, '**/node_modules/**');

  const results: string[] = [];
  const maxResults = 10; // 最大10件まで

  for (const fileUri of htmlFiles) {
    if (results.length >= maxResults) break;

    try {
      const htmlDoc = await vscode.workspace.openTextDocument(fileUri);
      const text = htmlDoc.getText();
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break;

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
    } catch (e) {
      // エラー無視
    }
  }

  return results.join('\n');
}

// HTMLからクラス/ID抽出
function extractClassesAndIdsFromHtml(html: string): { classes: string[]; ids: string[] } {
  const classes: string[] = [];
  const ids: string[] = [];

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
async function findLinkedCssFiles(htmlDocument: vscode.TextDocument): Promise<string[]> {
  const htmlText = htmlDocument.getText();
  const cssFiles: string[] = [];

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

// HTMLファイルからセクション候補を3段階で検出
function detectHtmlSections(document: vscode.TextDocument): { label: string; line: number; type: string }[] {
  const sections: { label: string; line: number; type: string }[] = [];
  const text = document.getText();
  const lines = text.split('\n');

  // 優先度1: 罫線ボックスコメント ┌─┐ │ セクション名 │ └─┘
  let inBox = false;
  let capturedTitle = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.search(/[┌]/) >= 0) { inBox = true; capturedTitle = false; }
    else if (inBox && !capturedTitle && line.search(/[│|]/) >= 0) {
      const pipeIndex = line.search(/[│|]/);
      const lastPipe = line.lastIndexOf('│') !== -1 ? line.lastIndexOf('│') : line.lastIndexOf('|');
      const name = line.substring(pipeIndex + 1, lastPipe).trim();
      if (name.length > 0 && !/^[─━┈┄]+$/.test(name)) {
        sections.push({ label: `📦 ${name}`, line: i, type: 'box' });
        capturedTitle = true;
      }
    }
    else if (line.search(/[└]/) >= 0) { inBox = false; }
  }

  // 優先度2: HTMLコメント <!-- xxx --> （10文字以上のみ）
  for (let i = 0; i < lines.length; i++) {
    const commentRegex = /<!--\s*(.+?)\s*-->/g;
    let match;
    while ((match = commentRegex.exec(lines[i])) !== null) {
      const content = match[1].trim();
      if (content.length >= 10 && !/^[─━┈┄└┌┐┘│|]+$/.test(content) && !content.startsWith('★')) {
        sections.push({ label: `💬 ${content}`, line: i, type: 'comment' });
      }
    }
  }

  // 優先度3: 主要な親要素（インデント0のみ = body直下のみ）
  const tagRegex = /^<(header|nav|main|section|footer|aside|article|div)\b[^>]*?(?:class="([^"]*)")?[^>]*>/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(tagRegex);
    if (match) {
      const tag = match[1];
      const className = match[2] || '';
      const label = className ? `<${tag} class="${className}">` : `<${tag}>`;
      sections.push({ label: `🏷 ${label}`, line: i, type: 'element' });
    }
  }

  return sections;
}

// セクションの終了行を推定
function findSectionEnd(lines: string[], startLine: number): number {
  const startIndent = lines[startLine].search(/\S/);
  if (startIndent < 0) { return startLine; }
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { continue; }
    const indent = line.search(/\S/);
    if (indent <= startIndent && i > startLine + 1) {
      if (line.trim().startsWith('</')) { return i; }
      return i - 1;
    }
  }
  return lines.length - 1;
}

// CSSファイルから指定されたクラス/IDに関連するルールのみを抽出
async function extractRelatedCssRules(htmlContent: string, cssFilePaths: string[]): Promise<string> {
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
        } else if (inRule) {
          currentRule += line + '\n';
          braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

          if (braceCount === 0) {
            relatedCss += currentRule;
            inRule = false;
            currentRule = '';
          }
        }
      }
    } catch (e) {
      // ファイル読み込み失敗は無視
    }
  }

  return relatedCss;
}

// ブラウザハイライト用のセレクタ情報を保持
let currentBrowserSelector: { type: 'class' | 'id' | 'tag'; name: string; timestamp: number } | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('CSS to HTML Jumper: 拡張機能が有効化されました');

  // クイズ履歴を復元
  const savedHistory = context.globalState.get<Array<[string, QuizHistory]>>('quizHistory', []);
  quizHistoryMap = new Map(savedHistory);

  // ========================================
  // ブラウザハイライト用HTTPサーバー（ポート3847）
  // ========================================
  const browserHighlightServer = http.createServer((req, res) => {
    // CORSヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/selector') {
      const now = Date.now();
      // 3秒以内のセレクタ情報のみ返す（古いものは無視）
      if (currentBrowserSelector && (now - currentBrowserSelector.timestamp) < 3000) {
        res.writeHead(200);
        res.end(JSON.stringify({
          type: currentBrowserSelector.type,
          name: currentBrowserSelector.name
        }));
        // 一度返したらクリア（連続ハイライト防止）
        currentBrowserSelector = null;
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ type: null, name: null }));
      }
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  browserHighlightServer.listen(3847, '127.0.0.1', () => {
    console.log('CSS to HTML Jumper: ブラウザハイライトサーバー起動 (port 3847)');
  });

  browserHighlightServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log('CSS to HTML Jumper: ポート3847は既に使用中');
    } else {
      console.error('CSS to HTML Jumper: サーバーエラー', err);
    }
  });

  // 拡張機能終了時にサーバーを閉じる
  context.subscriptions.push({
    dispose: () => {
      browserHighlightServer.close();
      console.log('CSS to HTML Jumper: ブラウザハイライトサーバー停止');
    }
  });

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
    async handleUri(uri: vscode.Uri) {
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
      } catch (e) {
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
    if (!editor) return;

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
  const cssHoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file', language: 'css' },
    {
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

        const propInfo = cssProperties[word];
        if (!propInfo) {
          return null;
        }

        // 値を取得して解析
        const valueMatch = line.match(new RegExp(`${word}\\s*:\\s*([^;]+)`));
        const value = valueMatch ? valueMatch[1].trim() : '';
        const analyzedTips = analyzeValue(word, value);

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
    }
  );

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
  let hoverHighlightTimer: NodeJS.Timeout | null = null;

  const cssSelectorHoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file', language: 'css' },
    {
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
        let selectorType: 'class' | 'id' | 'tag' | null = null;
        let selectorName: string = '';

        if (selector.startsWith('.')) {
          selectorType = 'class';
          selectorName = selector.substring(1);
        } else if (selector.startsWith('#')) {
          selectorType = 'id';
          selectorName = selector.substring(1);
        } else {
          // プレフィックスがない場合、行の内容から判定
          if (line.includes(`.${selector}`)) {
            selectorType = 'class';
            selectorName = selector;
          } else if (line.includes(`#${selector}`)) {
            selectorType = 'id';
            selectorName = selector;
          } else if (/^[a-z]+$/i.test(selector) && (line.trim().startsWith(selector) || line.includes(` ${selector}`))) {
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
        const targetPattern = config.get<string>('targetFiles', '**/*.html');
        const htmlFiles = await vscode.workspace.findFiles(targetPattern, '**/node_modules/**');

        if (htmlFiles.length === 0) {
          return null;
        }

        // 検索パターンを構築
        let searchPattern: RegExp;
        if (selectorType === 'class') {
          searchPattern = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'gi');
        } else if (selectorType === 'id') {
          searchPattern = new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'gi');
        } else {
          searchPattern = new RegExp(`<${escapeRegex(selectorName)}[\\s>]`, 'gi');
        }

        // 検索結果
        const results: { uri: vscode.Uri; line: number; text: string }[] = [];

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
          } catch (e) {
            // エラー無視
          }
        }

        if (results.length === 0) {
          return null;
        }

        // HTMLファイルをハイライト（CSSにフォーカスを残したまま）
        const firstResult = results[0];
        try {
          // 既に開いているエディタを探す
          let htmlEditor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.fsPath === firstResult.uri.fsPath
          );

          if (!htmlEditor) {
            // 開いていなければサイドで開く（フォーカスはCSSに残す）
            const htmlDoc = await vscode.workspace.openTextDocument(firstResult.uri);
            htmlEditor = await vscode.window.showTextDocument(htmlDoc, {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: true,
              preview: true
            });
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

        } catch (e) {
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
    }
  );

  context.subscriptions.push(cssSelectorHoverProvider);

  // ========================================
  // JavaScript日本語ホバー機能
  // ========================================
  const jsHoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file', language: 'javascript' },
    {
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
            const foundKeywords: string[] = [];
            
            // 辞書の全キーに対してチェック（少し重いかもしれないが、キー数はそれほどではない）
            Object.keys(jsMethods).forEach(key => {
              // 単純検索だと "log" が "dialog" にマッチしてしまうので境界チェックが必要
              // ただし、メソッドチェーン "console.log" のようなケースもあるため、
              // 簡易的に "key" が含まれているかチェックし、その後誤検知を除外する
              
              if (selectedText.includes(key)) {
                // キーワードが単独で存在するか、区切り文字( . ( ) space )と隣接しているか簡易チェック
                // 完全なパースは難しいので、実用的な範囲で判定
                
                // 既に登録済みならスキップ（重複防止）
                if (foundKeywords.includes(key)) return;
                
                foundKeywords.push(key);
              }
            });

            if (foundKeywords.length > 0) {
              const md = new vscode.MarkdownString();
              md.appendMarkdown(`### 🔍 選択範囲のコード解説 (${foundKeywords.length}件)\n\n---\n`);

              foundKeywords.forEach(key => {
                const info = jsMethods[key];
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
        if (!jsMethods[word]) {
          // ドットの後の単語だけを試す
          const lastPart = word.split('.').pop();
          if (lastPart && jsMethods[lastPart]) {
            word = lastPart;
          }
        }

        const methodInfo = jsMethods[word];
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
    }
  );


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
    const customPrompt = config.get<string>('copilotPrompt', 'このコードの目的を簡潔に説明して');
    const prompt = `${customPrompt}\n\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``;

    try {
      // Chatを開く (クエリを渡す)
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
    } catch (e) {
      console.error('Copilot Chat open failed', e);
      try {
        // フォールバック: 単にチャットを開くだけ試す
        await vscode.commands.executeCommand('workbench.action.chat.open');
        vscode.window.showInformationMessage('Copilot Chatが開きました。プロンプトを手動で入力してください。');
      } catch (e2) {
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
    { label: '📖 説明して', prompt: 'このコードが何をしているか説明してください。', showBeside: false },
    { label: '🎨 SVGで図解', prompt: `このコードの動作や構造をSVGで図解してください。

【重要な制約】
- できるだけわかりやすく、シンプルな図にする
- 日本語でラベルを付ける
- 色を使って区別をつける
- 矢印やボックスで関係性を示す
- SVGコードのみ出力（説明文は不要）
- 必ず </svg> で終わること`, showBeside: false },
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
    { label: '📝 メモ検索', prompt: '', showBeside: false },
    { label: '🎯 クイズ', prompt: '', showBeside: false }
  ];

  const claudeCommand = vscode.commands.registerCommand('cssToHtmlJumper.askClaude', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('エディタを開いてください');
      return;
    }

    const selection = editor.selection;
    const code = editor.document.getText(selection).trim();

    // Step 1: InputBoxで追加質問を入力
    const userInput = await vscode.window.showInputBox({
      prompt: '質問を入力（空欄でプリセット選択へ）',
      placeHolder: '例: <div class="slide"></div>について'
    });

    if (userInput === undefined) {
      return; // キャンセル
    }

    // Step 2: プリセット選択（入力ありの場合は「自由質問」も追加）
    const presetItems = [...presetQuestions];
    if (userInput.trim()) {
      presetItems.push({ label: '💬 自由質問', prompt: '', showBeside: false });
    }

    const result = await new Promise<{ question: string; isSvg: boolean; isSkeleton: boolean; isStructural: boolean; isMemoSearch: boolean; isQuiz: boolean; isFreeQuestion: boolean; showBeside: boolean } | undefined>((resolve) => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.items = presetItems;
      quickPick.placeholder = userInput.trim() ? 'プリセットを選択（自由質問も可）' : 'プリセットを選択';

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0] as typeof presetItems[0] | undefined;

        if (selected && selected.label.includes('自由質問')) {
          // 自由質問: userInputのみ送信
          resolve({
            question: userInput.trim(),
            isSvg: false,
            isSkeleton: false,
            isStructural: false,
            isMemoSearch: false,
            isQuiz: false,
            isFreeQuestion: true,
            showBeside: false
          });
        } else if (selected && selected.label.includes('メモ検索')) {
          resolve({
            question: '',
            isSvg: false,
            isSkeleton: false,
            isStructural: false,
            isMemoSearch: true,
            isQuiz: false,
            isFreeQuestion: false,
            showBeside: false
          });
        } else if (selected && selected.label.includes('クイズ')) {
          resolve({
            question: '',
            isSvg: false,
            isSkeleton: false,
            isStructural: false,
            isMemoSearch: false,
            isQuiz: true,
            isFreeQuestion: false,
            showBeside: false
          });
        } else if (selected && selected.prompt) {
          // プリセット選択 + userInput
          let finalQuestion = selected.prompt;
          const isSkeleton = selected.label.includes('スケルトン');
          const isStructural = selected.label.includes('構造改善');

          if (userInput.trim() && code && !isSkeleton && !isStructural) {
            // 入力あり + 選択範囲あり + スケルトン・構造改善以外 → 踏み込んだ質問
            finalQuestion = `以下のコード内の \`${userInput.trim()}\` について${selected.label.replace(/[📖🎨🔧🐛]/g, '').trim()}ください。\n\n【コード全体】\n${code}`;
          }
          // スケルトン・構造改善は入力無視、元のプリセットプロンプトのみ使用

          resolve({
            question: finalQuestion,
            isSvg: selected.label.includes('SVG'),
            isSkeleton: isSkeleton,
            isStructural: isStructural,
            isMemoSearch: false,
            isQuiz: false,
            isFreeQuestion: false,
            showBeside: selected.showBeside
          });
        } else {
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

    const { question, isSvg, isSkeleton, isStructural, isMemoSearch, isQuiz, isFreeQuestion, showBeside } = result;

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

        if (isQuiz) {
          // クイズ処理
          return; // 一旦プログレスを終了してクイズ処理へ
        } else if (isStructural) {
          // HTML構造改善: 選択範囲 or セクション選択 + 全体送信 + CSS
          if (editor.document.languageId !== 'html') {
            vscode.window.showWarningMessage('HTML構造改善はHTMLファイルで使用してください');
            return;
          }

          const fullHtml = editor.document.getText();

          // 選択範囲があればそのまま使用、なければセクション選択QuickPick
          if (code) {
            // 選択範囲あり → QuickPickスキップ、選択範囲に★マーカー
            const beforeSelection = editor.document.getText(
              new vscode.Range(new vscode.Position(0, 0), selection.start)
            );
            const afterSelection = editor.document.getText(
              new vscode.Range(selection.end, new vscode.Position(editor.document.lineCount, 0))
            );
            codeToSend = beforeSelection
              + '<!-- ★改善対象ここから -->\n'
              + code
              + '\n<!-- ★改善対象ここまで -->'
              + afterSelection;
          } else {
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

            if (!selectedSection) { return; }

            if (selectedSection.line === -1) {
              codeToSend = fullHtml;
            } else {
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
        } else if (isMemoSearch) {
          // メモ検索処理
          return; // 一旦プログレスを終了してメモ検索処理へ
        } else if (isFreeQuestion) {
          // 自由質問: コンテキスト収集不要
          codeToSend = '';
          htmlContext = '';
        } else if (editor.document.languageId === 'css') {
          // まず選択範囲からセレクタを探す
          let selectors = code ? extractSelectorsFromCSS(code) : [];

          // 選択範囲にセレクタがない場合、親のCSSルールからセレクタを検出
          if (selectors.length === 0) {
            const parentInfo = findParentSelector(editor.document, selection.start);
            selectors = parentInfo.selectors;
            // 選択範囲が空または親ルール全体を含まない場合、親ルール全体を使用
            if (!code && parentInfo.fullRule) {
              codeToSend = parentInfo.fullRule;
            } else if (code && parentInfo.selectorText) {
              // セレクタ情報を追加
              codeToSend = `/* セレクタ: ${parentInfo.selectorText} */\n${code}`;
            }
          }

          if (selectors.length > 0) {
            htmlContext = await findHtmlUsage(selectors);
          }
        }

        const answer = await askClaudeAPI(codeToSend, question, htmlContext || undefined, isStructural);

        // コードブロック（```css など）を削除
        const cleanAnswer = answer
          .replace(/```[\w]*\n?/g, '')  // ```css, ```html 等を削除
          .replace(/```/g, '')           // 残りの ``` を削除
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
          } else {
            // CSS選択（複数ある場合）
            let targetCssPath: string;
            if (cssFiles.length > 1) {
              const items = cssFiles.map(f => ({
                label: path.basename(f),
                description: f,
                path: f
              }));
              const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'CSSファイルを選択'
              });
              if (!selected) { return; }
              targetCssPath = selected.path;
            } else {
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
        } else if (showBeside) {
          // 改善・バグチェック：右側に新しいドキュメントを開く
          const doc = await vscode.workspace.openTextDocument({
            content: `✨ Claude AI 回答\n${'='.repeat(40)}\n\n${cleanAnswer}`,
            language: editor.document.languageId
          });
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
        } else if (isSvg) {
          // SVGの場合：<svg>～</svg>を抽出してクリップボードにコピー
          const svgMatch = cleanAnswer.match(/<svg[\s\S]*<\/svg>/i);
          const svgCode = svgMatch ? svgMatch[0] : cleanAnswer;

          await vscode.env.clipboard.writeText(svgCode);
          vscode.window.showInformationMessage('✅ SVGをクリップボードにコピーしました');

          // エディタにも挿入
          const endPosition = selection.end;
          const insertPosition = new vscode.Position(endPosition.line, editor.document.lineAt(endPosition.line).text.length);
          const insertText = `\n${svgCode}\n`;
          await editor.edit(editBuilder => {
            editBuilder.insert(insertPosition, insertText);
          });
        } else {
          // 説明：コメントとして挿入
          const endPosition = selection.end;
          const insertPosition = new vscode.Position(endPosition.line, editor.document.lineAt(endPosition.line).text.length);
          const lang = editor.document.languageId;

          let insertText: string;
          if (lang === 'html') {
            insertText = `\n<!-- ✨\n${cleanAnswer}\n-->\n`;
          } else {
            insertText = `\n/* ✨\n${cleanAnswer}\n*/\n`;
          }

          await editor.edit(editBuilder => {
            editBuilder.insert(insertPosition, insertText);
          });
        }
      } catch (e: any) {
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
  // クイズコマンド
  // ========================================
  const quizCommand = vscode.commands.registerCommand('cssToHtmlJumper.quiz', async () => {
    await handleQuiz();
  });

  context.subscriptions.push(quizCommand);

  // ========================================
  // 赤枠追加コマンド
  // ========================================
  const addRedBorderCommand = vscode.commands.registerCommand('cssToHtmlJumper.addRedBorder', async (args: { line: number }) => {
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
    } else if (currentLine.includes(':') && !currentLine.trim().startsWith('/*') && !currentLine.trim().startsWith('//')) {
      // プロパティ行にホバー → 上に向かって { を探す
      let tempBraceCount = 0;
      for (let i = startLine; i >= 0; i--) {
        const lineText = lines[i];
        for (let j = lineText.length - 1; j >= 0; j--) {
          const char = lineText[j];
          if (char === '}') tempBraceCount++;
          if (char === '{') {
            if (tempBraceCount > 0) {
              tempBraceCount--;
            } else {
              braceOpenLine = i;
              break;
            }
          }
        }
        if (braceOpenLine !== -1) break;
      }
    } else {
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
        if (c === '{') depth++;
        if (c === '}') {
          depth--;
          if (depth === 0) {
            braceCloseLine = i;
            break;
          }
        }
      }
      if (braceCloseLine !== -1) break;
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
    const linesToDelete: number[] = [];
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
    let selectorType: 'class' | 'id' | 'tag';
    let selectorName: string;

    if (selector.startsWith('.')) {
      selectorType = 'class';
      selectorName = selector.substring(1);
    } else if (selector.startsWith('#')) {
      selectorType = 'id';
      selectorName = selector.substring(1);
    } else {
      // プレフィックスがない場合、行の内容から判定
      const line = editor.document.lineAt(selection.start.line).text;
      
      // 直前に # があるか確認
      if (line.includes(`#${selector}`)) {
        selectorType = 'id';
      } else if (line.includes(`.${selector}`)) {
        selectorType = 'class';
      } else {
        // どちらでもなければタグセレクタ
        selectorType = 'tag';
      }
      selectorName = selector;
    }

    console.log(`CSS to HTML Jumper: 検索 - ${selectorType}: ${selectorName}`);

    // 設定から検索対象ファイルパターンを取得
    const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
    const targetPattern = config.get<string>('targetFiles', '**/index.html');

    // ワークスペース内のHTMLファイルを検索
    const htmlFiles = await vscode.workspace.findFiles(targetPattern, '**/node_modules/**');
    
    if (htmlFiles.length === 0) {
      vscode.window.showWarningMessage('HTMLファイルが見つかりません');
      return;
    }

    // 検索結果を格納
    const results: { uri: vscode.Uri; line: number; text: string }[] = [];

    // 検索パターンを構築
    let searchPattern: RegExp;
    if (selectorType === 'class') {
      // class="xxx" または class="... xxx ..." にマッチ
      searchPattern = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'gi');
    } else if (selectorType === 'id') {
      // id="xxx" にマッチ
      searchPattern = new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'gi');
    } else {
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
      } catch (e) {
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
    } else {
      vscode.window.showInformationMessage(`✓ ${path.basename(result.uri.fsPath)}:${result.line + 1}`);
    }
  });

  // ハイライト用の装飾タイプ
  const highlightDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(100, 180, 255, 0.25)', // 薄い青の半透明背景
    isWholeLine: true // 行全体をハイライト
  });

  // 指定した範囲を一瞬ハイライトする関数
  function flashHighlight(editor: vscode.TextEditor, range: vscode.Range) {
    // ハイライト適用
    editor.setDecorations(highlightDecorationType, [range]);

    // 1.5秒後にハイライト解除
    setTimeout(() => {
      editor.setDecorations(highlightDecorationType, []);
    }, 800);
  }

  // Definition Provider: Alt+Click で動作（editor.multiCursorModifier = ctrlCmd に設定した場合）
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    { scheme: 'file', language: 'css' },
    {
      async provideDefinition(document, position) {
        let selector: string = '';
        let selectorType: 'class' | 'id' | 'tag' | 'unknown' = 'unknown';
        let selectorName: string = '';

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
        } else if (selector.startsWith('#')) {
          selectorType = 'id';
          selectorName = selector.substring(1);
        } else {
          // プレフィックスがない場合
          // 行の内容から推測するか、選択範囲そのものを使う
          
          // 明示的な選択の場合は、そのままの名前で検索を試みる
          if (!selector.match(/^[.#]/) && line.includes(`.${selector}`)) {
             selectorType = 'class';
             selectorName = selector;
          } else if (!selector.match(/^[.#]/) && line.includes(`#${selector}`)) {
             selectorType = 'id';
             selectorName = selector;
          } else {
             // 判断つかない、またはタグ
             selectorType = 'tag';
             selectorName = selector;
          }
        }

        const config = vscode.workspace.getConfiguration('cssToHtmlJumper');
        const targetPattern = config.get<string>('targetFiles', '**/*.html');
        const htmlFiles = await vscode.workspace.findFiles(targetPattern, '**/node_modules/**');
        
        // 検索パターンの構築
        // 選択した文字列が class="name" や id="name" にマッチするか
        let searchPatterns: RegExp[] = []; // 複数パターン試す

        if (selectorType === 'class') {
          // class="... name ..."
          searchPatterns.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRegex(selectorName)}\\b[^"']*["']`, 'i'));
        } else if (selectorType === 'id') {
          // id="name"
          searchPatterns.push(new RegExp(`id\\s*=\\s*["']${escapeRegex(selectorName)}["']`, 'i'));
        } else {
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
          } catch (e) {
            // エラー無視
          }
        }
        return null;
      }
    }
  );

  context.subscriptions.push(disposable);
  context.subscriptions.push(definitionProvider);

  // セクションジャンプコマンド
  const sectionJumper = vscode.commands.registerCommand('cssToHtmlJumper.jumpToSection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('CSSファイルを開いてください');
      return;
    }

    const text = editor.document.getText();
    const lines = text.split('\n');

    // セクションを探す（│ セクション名 │ の形式）
    // シンプルロジック: 連続する「│で始まる行」の「最初の1行」だけを抽出する
    const sections: { label: string; line: number }[] = [];

    let inMediaQuery = false;
    let mediaQueryType: 'mobile' | 'pc' | null = null;
    let braceDepth = 0;
    let mediaStartDepth = -1;
    
    // ┌～└ のボックス内かどうか追跡
    let inBox = false;
    let capturedTitle = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // @media の開始を検出
      if (/@media\s/.test(line)) {
        mediaStartDepth = braceDepth;
        if (line.includes('max-width')) {
          mediaQueryType = 'mobile';
        } else if (line.includes('min-width')) {
          mediaQueryType = 'pc';
        } else {
          mediaQueryType = null;
        }
      }

      // 波括弧をカウント
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceDepth += openBraces;

      // 現在メディアクエリ内かどうか判定
      inMediaQuery = mediaStartDepth >= 0 && braceDepth > mediaStartDepth;

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

            if (sectionName && sectionName.length > 0 && !/^[─━┈┄]+$/.test(sectionName)) {
              let icon = '📍';
              let suffix = '';

              if (inMediaQuery && mediaQueryType === 'mobile') {
                icon = '📱';
                suffix = ' (mobile)';
              } else if (inMediaQuery && mediaQueryType === 'pc') {
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

      // 波括弧深さを減算
      braceDepth -= closeBraces;

      // メディアクエリから抜けたかチェック
      if (mediaStartDepth >= 0 && braceDepth <= mediaStartDepth) {
        mediaStartDepth = -1;
        mediaQueryType = null;
      }
    }

    if (sections.length === 0) {
      vscode.window.showInformationMessage('セクションが見つかりませんでした（│ セクション名 │ 形式のコメントを探しています）');
      return;
    }

    // クイックピックで表示
    const items = sections.map(s => ({
      label: s.label,
      description: `line ${s.line + 1}`,
      line: s.line
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'ジャンプするセクションを選択'
    });

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
  });

  context.subscriptions.push(sectionJumper);

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

      // ┌ でボックス開始を検出
      if (line.includes('┌')) {
        inBox = true;
        capturedTitle = false;
      }

      // ボックス内で、まだタイトルを取得していない場合
      if (inBox && !capturedTitle) {
        // │ セクション名 │ or | 形式を検出（半角パイプも対応）
        const pipeMatch = line.match(/[│|]\s*(.+?)\s*[│|]/);
        if (pipeMatch && pipeMatch[1]) {
          let content = pipeMatch[1].trim();
          // 罫線だけの行は除外
          if (content && !/^[─━┈┄┌┐└┘├┤┬┴┼\-=]+$/.test(content)) {
            content = content.replace(/\*\/$/, '').trim();
            if (content.length > 0) {
              currentSection = content;
              capturedTitle = true; // 最初の1行だけ採用
            }
          }
        }
      }

      // └ でボックス終了
      if (line.includes('└')) {
        inBox = false;
      }
    }

    // ========================================
    // メディアクエリ判定
    // ========================================
    let currentMediaQuery = '';
    let foundMedia = false;

    const cursorOffset = editor.document.offsetAt(position);
    const textBefore = fullText.substring(0, cursorOffset);

    const lastMediaIndex = textBefore.lastIndexOf('@media');

    if (lastMediaIndex !== -1) {
      const textFromMedia = textBefore.substring(lastMediaIndex);

      let open = 0;
      let close = 0;
      let mediaHeaderEnd = textFromMedia.indexOf('{');

      if (mediaHeaderEnd !== -1) {
        const mediaCondition = textFromMedia.substring(6, mediaHeaderEnd).trim();

        for (let i = 0; i < textFromMedia.length; i++) {
          if (textFromMedia[i] === '{') open++;
          if (textFromMedia[i] === '}') close++;
        }

        if (open > close) {
          foundMedia = true;
          currentMediaQuery = mediaCondition;
        }
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

    // max-width（スマホ/タブレット）の時だけメディアクエリ表示
    if (foundMedia && currentMediaQuery.includes('max-width')) {
      icon = '📱';
      statusText = `${icon} ${sectionName} | ${currentMediaQuery}`;
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      // 通常時またはPC(min-width)時はセクション名だけ
      statusText = `${icon} ${sectionName}`;
      statusBarItem.backgroundColor = undefined;
    }

    statusBarItem.text = statusText;
    statusBarItem.show();
  }

  // クイズ履歴を保存（拡張機能終了時 or 定期保存）
  const saveQuizHistory = () => {
    const historyArray = Array.from(quizHistoryMap.entries());
    context.globalState.update('quizHistory', historyArray);
  };

  // 定期保存（10秒ごと）
  const saveInterval = setInterval(saveQuizHistory, 10000);
  context.subscriptions.push({ dispose: () => clearInterval(saveInterval) });
}

export function deactivate() {}

// 正規表現の特殊文字をエスケープ
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
