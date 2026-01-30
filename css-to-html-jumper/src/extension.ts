import * as vscode from 'vscode';
import * as path from 'path';
import { cssProperties, analyzeValue } from './cssProperties';
import { jsMethods } from './jsProperties';

export function activate(context: vscode.ExtensionContext) {
  console.log('CSS to HTML Jumper: 拡張機能が有効化されました');

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

      // ┌～└ 内の │ 行からタイトルだけ取得
      if (inBox && !capturedTitle) {
        const pipeIndex = line.indexOf('│');
        if (pipeIndex !== -1) {
          const prefix = line.substring(0, pipeIndex).trim();
          if (prefix === '' || prefix === '/*' || prefix.endsWith('/*')) {
            let content = line.substring(pipeIndex + 1);
            const lastPipeIndex = content.lastIndexOf('│');
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
    const text = editor.document.getText(new vscode.Range(0, 0, position.line + 1, 0));
    
    // 簡易的なメディアクエリ判定
    // カーソル位置より前の @media と } の数をカウント
    const mediaMatches = (text.match(/@media[^{]*{/g) || []);
    const openBraces = (text.match(/{/g) || []).length;
    const closeBraces = (text.match(/}/g) || []).length;
    
    // 開いている波括弧の数で判定（簡易ロジック）
    // @media { selector { ... } } なので、深さが外部より深い場所を探す必要があるが、
    // ここでは単純に「直近の @media 宣言を見つける」方式で実装
    
    let currentMediaQuery = '';
    const lines = text.split('\n');
    let braceDepth = 0;
    
    // 現在の行から上に遡って、未閉の @media を探す
    // ※ 厳密なパースではないが、実用上は多くのケースで動作する
    // バッファの全テキストを取得して解析するのは重いので、現在の行から上へ探索
    
    // シンプルなアプローチ: 
    // カーソル位置を含むブロックが @media かどうかを確認
    
    let depth = 0;
    let foundMedia = false;
    
    // 全文検索で現在のブロックを特定（パフォーマンス考慮しつつ）
    const fullText = editor.document.getText();
    const cursorOffset = editor.document.offsetAt(position);
    const textBefore = fullText.substring(0, cursorOffset);
    
    // 最後の @media を探す
    const lastMediaIndex = textBefore.lastIndexOf('@media');
    
    if (lastMediaIndex !== -1) {
      // @media があった場合、それが閉じられているか確認
      const textFromMedia = textBefore.substring(lastMediaIndex);
      
      // 波括弧のバランスを確認
      let open = 0;
      let close = 0;
      let mediaHeaderEnd = textFromMedia.indexOf('{');
      
      if (mediaHeaderEnd !== -1) {
        // @media の条件部分を取得
        const mediaCondition = textFromMedia.substring(6, mediaHeaderEnd).trim();
        
        // オフセット以降の波括弧をカウント
        for (let i = 0; i < textFromMedia.length; i++) {
          if (textFromMedia[i] === '{') open++;
          if (textFromMedia[i] === '}') close++;
        }
        
        // 開いている数が閉じた数より多ければ、メディアクエリ内
        if (open > close) {
          foundMedia = true;
          currentMediaQuery = mediaCondition;
        }
      }
    }

    if (foundMedia) {
      // 条件に応じてアイコンを変更
      let icon = '🎨';
      if (currentMediaQuery.includes('max-width')) {
        icon = '📱'; // スマホ/タブレット
        // スマホ時は背景色を警告色（黄色/オレンジ）にしてアピール！
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else if (currentMediaQuery.includes('min-width')) {
        icon = '💻'; // PC
        // PC時は色は通常（またはお好みで変更可能）
        statusBarItem.backgroundColor = undefined;
      } else {
        statusBarItem.backgroundColor = undefined;
      }
      
      statusBarItem.text = `${icon} Media: ${currentMediaQuery}`;
      statusBarItem.show();
    } else {
      statusBarItem.text = `Global CSS`;
      statusBarItem.backgroundColor = undefined; // 色をリセット
      statusBarItem.show();
    }
  }
}

export function deactivate() {}

// 正規表現の特殊文字をエスケープ
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
