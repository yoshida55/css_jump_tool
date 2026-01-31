// 右クリックされた要素を保存
var lastRightClickedElement = null;
var sizeOverlayVisible = false;

// Ctrl+クリック距離測定用
var distanceMeasureFirstElement = null;
var distanceMeasureHighlight = null;

// クイックリサイズ用
var quickResizeOriginalWidth = null;
var quickResizeActive = false;
var quickResizeTrigger = "both"; // "wheel", "ctrlRight", "both"
var preventContextMenu = false;

// Flex情報自動表示用
var flexInfoVisible = false;
var autoShowFlexEnabled = false;

// 設定を読み込み
chrome.storage.local.get(["quickResizeTrigger", "autoShowFlex"], function(result) {
  if (result.quickResizeTrigger) {
    quickResizeTrigger = result.quickResizeTrigger;
  }
  if (result.autoShowFlex) {
    autoShowFlexEnabled = result.autoShowFlex;
  }
});

// 設定変更を監視
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.quickResizeTrigger) {
    quickResizeTrigger = changes.quickResizeTrigger.newValue;
    console.log("CSS Jumper: トリガー設定変更", quickResizeTrigger);
  }
  if (changes.autoShowFlex) {
    autoShowFlexEnabled = changes.autoShowFlex.newValue;
    console.log("CSS Jumper: Flex自動表示設定変更", autoShowFlexEnabled);
  }
});

console.log("CSS Jumper: content.js読み込み完了");

// CSS自動検出済みフラグ（連続実行防止）
var cssAutoDetected = false;

// ページロード完了時にセクション一覧を事前に取得してメニューを準備
// + Live Serverの場合は自動でプロジェクト切替とCSS取得
window.addEventListener("load", function() {
  setTimeout(function() {
    // セクション一覧を取得してbackground.jsに送信
    var sections = getSectionList();
    if (sections && sections.length > 0) {
      chrome.runtime.sendMessage({
        action: "preloadSectionMenu",
        sections: sections
      });
      console.log("CSS Jumper: セクションメニュー事前ロード", sections.length + "件");
    }

    // Live Serverのページなら自動でプロジェクト切替とCSS検出
    autoSwitchProjectFromUrl();

    // Flex情報自動表示（設定ONかつLive Serverの場合のみ）
    var url = window.location.href;
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      chrome.storage.local.get(["autoShowFlex"], function(result) {
        if (result.autoShowFlex) {
          setTimeout(function() {
            showFlexInfo();
          }, 100);
        }
      });
    }
  }, 100);
});

// URLからプロジェクトを自動切替
function autoSwitchProjectFromUrl() {
  var url = window.location.href;
  
  // Live Serverかどうかをチェック（localhost or 127.0.0.1）
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    return;
  }
  
  console.log("CSS Jumper: Live Server検出、プロジェクト自動切替チェック");
  
  // URLからフォルダ名を抽出（例: /61_応用編：スクール/index.html → 61_応用編：スクール）
  var urlObj = new URL(url);
  var pathname = urlObj.pathname; // 例: /61_応用編：スクール/index.html
  var pathParts = pathname.split("/").filter(function(p) { return p.length > 0; });
  
  if (pathParts.length === 0) {
    console.log("CSS Jumper: URLからフォルダ名を抽出できません");
    autoDetectCssIfLiveServer();
    return;
  }
  
  // 最初のフォルダ名を取得（プロジェクト名）
  var projectFolderFromUrl = pathParts[0];
  console.log("CSS Jumper: URLから検出したフォルダ名:", projectFolderFromUrl);
  
  // 履歴から一致するパスを探す
  chrome.storage.local.get(["pathHistory", "projectPath"], function(result) {
    var currentPath = result.projectPath || "";
    var history = result.pathHistory || [];
    
    // 現在のパスのフォルダ名を取得
    var currentFolderName = currentPath.split("/").pop();
    
    // 既に正しいプロジェクトが設定されている場合はCSS検出のみ
    if (currentFolderName === projectFolderFromUrl) {
      console.log("CSS Jumper: 既に正しいプロジェクトが設定済み");
      autoDetectCssIfLiveServer();
      return;
    }
    
    // 履歴から一致するパスを探す
    var matchedPath = null;
    for (var i = 0; i < history.length; i++) {
      var historyFolderName = history[i].split("/").pop();
      if (historyFolderName === projectFolderFromUrl) {
        matchedPath = history[i];
        break;
      }
    }
    
    if (matchedPath) {
      // 一致するパスが見つかった！自動切替
      console.log("CSS Jumper: プロジェクト自動切替:", matchedPath);
      chrome.storage.local.set({ projectPath: matchedPath }, function() {
        showNotification("✓ プロジェクト自動切替: " + projectFolderFromUrl, "success");
        autoDetectCssIfLiveServer();
      });
    } else {
      // 一致するパスがない場合は通常のCSS検出のみ
      console.log("CSS Jumper: 履歴に一致するパスなし、CSS検出のみ実行");
      autoDetectCssIfLiveServer();
    }
  });
}


// Live Serverのページなら自動でCSS検出
function autoDetectCssIfLiveServer() {
  var url = window.location.href;
  
  // Live Serverかどうかをチェック（localhost or 127.0.0.1）
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    return;
  }
  
  console.log("CSS Jumper: Live Serverを検出、自動CSS取得開始");
  
  // プロジェクトパスが設定されているかチェック
  chrome.storage.local.get(["projectPath"], function(result) {
    if (!result.projectPath) {
      console.log("CSS Jumper: プロジェクトパス未設定、自動検出スキップ");
      return;
    }
    
    // ページ内のCSSリンクを取得
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var cssLinks = [];
    
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href;
      // 外部CDN等は除外（ローカルのみ）
      if (href && (href.includes('127.0.0.1') || href.includes('localhost'))) {
        cssLinks.push(href);
      }
    }
    
    if (cssLinks.length === 0) {
      console.log("CSS Jumper: ローカルCSSリンクなし");
      return;
    }
    
    console.log("CSS Jumper: CSSリンク検出", cssLinks.length + "件");
    
    // 各CSSファイルをfetchで読み込み
    var cssFiles = [];
    var loadedCount = 0;
    var errorCount = 0;
    var excludeFiles = ["reset.css", "normalize.css", "sanitize.css"];
    
    for (var j = 0; j < cssLinks.length; j++) {
      (function(cssUrl) {
        fetch(cssUrl)
          .then(function(res) { return res.text(); })
          .then(function(content) {
            var urlObj = new URL(cssUrl);
            var pathname = urlObj.pathname;
            var relativePath = pathname.replace(/^\//, '');
            var fileName = relativePath.split('/').pop();
            
            // 除外ファイルをチェック
            var isExcluded = false;
            for (var e = 0; e < excludeFiles.length; e++) {
              if (fileName.toLowerCase() === excludeFiles[e].toLowerCase()) {
                isExcluded = true;
                break;
              }
            }
            
            cssFiles.push({
              name: fileName,
              relativePath: relativePath,
              content: content,
              lines: content.split('\n').length,
              excluded: isExcluded
            });
            loadedCount++;
            
            if (loadedCount + errorCount === cssLinks.length) {
              saveCssFilesAuto(cssFiles);
            }
          })
          .catch(function(err) {
            // サーバー未起動時は正常動作なのでログのみ（warnだとChrome拡張ページにエラー表示される）
            console.log("CSS Jumper: CSS取得スキップ（サーバー未起動の可能性）", cssUrl);
            errorCount++;
            if (loadedCount + errorCount === cssLinks.length) {
              saveCssFilesAuto(cssFiles);
            }
          });
      })(cssLinks[j]);
    }
  });
}

// 自動検出したCSSファイルを保存
function saveCssFilesAuto(cssFiles) {
  if (cssFiles.length === 0) {
    return;
  }
  
  // 検出済みフラグを立てる（連続実行防止）
  cssAutoDetected = true;
  
  chrome.storage.local.set({ cssFiles: cssFiles }, function() {
    console.log("CSS Jumper: 自動検出CSS保存完了", cssFiles.length + "件");
    // 通知は出さない（毎回出ると邪魔なので）
    // showNotification("✓ CSSを自動検出しました（" + cssFiles.length + "件）", "success");
  });
}

// クイックリサイズ実行
function executeQuickResize() {
  console.log("CSS Jumper: クイックリサイズ実行");
  
  chrome.runtime.sendMessage({
    action: "quickResize",
    isActive: quickResizeActive,
    originalWidth: quickResizeOriginalWidth,
    currentWidth: window.innerWidth
  }, function(response) {
    if (response && response.success) {
      if (quickResizeActive) {
        quickResizeActive = false;
        quickResizeOriginalWidth = null;
        showNotification("↩️ 元の幅に戻しました", "info");
      } else {
        quickResizeOriginalWidth = response.originalWidth;
        quickResizeActive = true;
        showNotification("📐 " + response.targetWidth + "px にリサイズ", "success");
      }
    }
  });
}

// ホイールクリック（中ボタン）でクイックリサイズ
document.addEventListener("mousedown", function(event) {
  // 中ボタン（button === 1）
  if (event.button === 1) {
    if (quickResizeTrigger === "wheel" || quickResizeTrigger === "both") {
      event.preventDefault();
      executeQuickResize();
    }
  }
  
  // Ctrl + 右クリック（button === 2 && ctrlKey）
  if (event.button === 2 && event.ctrlKey) {
    if (quickResizeTrigger === "ctrlRight" || quickResizeTrigger === "both") {
      preventContextMenu = true;
      executeQuickResize();
    }
  }
}, true);

// 右クリック時に要素を記録（Ctrl+右クリック時はメニューを抑止）
document.addEventListener("contextmenu", function(event) {
  if (preventContextMenu) {
    event.preventDefault();
    preventContextMenu = false;
    return;
  }
  lastRightClickedElement = event.target;
  console.log("CSS Jumper: 右クリック要素記録", lastRightClickedElement.className);
});

// Ctrl + ↓ でクイックリサイズ
document.addEventListener("keydown", function(event) {
  // デバッグ: Ctrlキー押下を確認
  if (event.ctrlKey && event.key === "ArrowDown") {
    console.log("CSS Jumper: Ctrl+↓ 検出, トリガー設定:", quickResizeTrigger);
    if (quickResizeTrigger === "ctrlDown" || quickResizeTrigger === "both") {
      event.preventDefault();
      event.stopPropagation();
      executeQuickResize();
    }
  }
}, true);

// Alt+クリックでVS Codeを開く（右クリックで選択した要素を使用）
document.addEventListener("click", function(event) {
  if (event.altKey) {
    event.preventDefault();
    event.stopPropagation();

    // 右クリックで記録した要素を使用（なければクリック要素）
    var clickedElement = lastRightClickedElement || event.target;
    if (!lastRightClickedElement) {
      console.log("CSS Jumper: 右クリック要素なし、クリック要素を使用");
    }
    var classString = "";
    var targetElement = clickedElement;
    
    // クリックした要素からIDまたはクラスを持つ要素を探す（親を遡る）
    var foundId = "";
    var foundClassString = "";
    
    while (targetElement && targetElement !== document.body) {
      // IDをチェック
      if (targetElement.id) {
        foundId = targetElement.id;
        // IDが見つかったら、その要素のクラスも取得してループ終了（ID優先）
        var classAttr = targetElement.className;
        if (typeof classAttr === "string") {
          foundClassString = classAttr;
        } else if (classAttr && classAttr.baseVal) {
          foundClassString = classAttr.baseVal;
        }
        break;
      }
      
      // クラスをチェック
      var classAttr = targetElement.className;
      if (typeof classAttr === "string" && classAttr.trim()) {
        foundClassString = classAttr.trim();
        // クラスが見つかったらループ終了（ただし親にIDがあるかもしれないので本来は遡るべきだが、直感的にはクリックした要素に近い方が良い）
        break;
      } else if (classAttr && classAttr.baseVal && classAttr.baseVal.trim()) {
        foundClassString = classAttr.baseVal.trim();
        break;
      }
      
      targetElement = targetElement.parentElement;
    }
    
    if (!foundId && !foundClassString) {
      console.log("CSS Jumper: Alt+クリック - IDもクラスもなし");
      showNotification("IDまたはクラスが見つかりません", "error");
      return;
    }
    
    var classes = foundClassString ? foundClassString.trim().split(/\s+/) : [];
    var className = classes[0] || "";
    var allClasses = classes;
    
    console.log("CSS Jumper: Alt+クリック", { id: foundId, className: className, tagName: targetElement.tagName });
    
    // 拡張機能のコンテキストが有効かチェック
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log("CSS Jumper: 拡張機能のコンテキストが無効です。ページをリロードしてください。");
      showNotification("拡張機能が更新されました。ページをリロードしてください。", "error");
      return;
    }

    try {
      chrome.runtime.sendMessage({
        action: "classNameResult",
        id: foundId,
        className: className,
        allClasses: allClasses,
        viewportWidth: window.innerWidth
      });
    } catch (e) {
      console.log("CSS Jumper: メッセージ送信エラー", e);
      showNotification("通信エラー: ページをリロードしてください", "error");
    }
  }
}, true);



// Escキーで選択をキャンセル
document.addEventListener("keydown", function(event) {
  if (event.key === "Escape" && distanceMeasureFirstElement) {
    if (distanceMeasureHighlight) {
      distanceMeasureHighlight.remove();
      distanceMeasureHighlight = null;
    }
    distanceMeasureFirstElement = null;
    showNotification("距離測定をキャンセル", "info");
  }
});

// background.jsからのメッセージを受信
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  console.log("CSS Jumper: content.jsメッセージ受信", message);
  
  if (message.action === "getClassName") {
    var id = lastRightClickedElement ? lastRightClickedElement.id : "";
    var className = getFirstClassName();
    var allClasses = getAllClassNames();
    
    console.log("CSS Jumper: 要素情報取得", { id: id, className: className, allClasses: allClasses });
    
    chrome.runtime.sendMessage({
      action: "classNameResult",
      id: id,
      className: className,
      allClasses: allClasses,
      viewportWidth: window.innerWidth
    });
    
    sendResponse({ received: true });
  }
  
  if (message.action === "copyToClipboard") {
    console.log("CSS Jumper: クリップボードにコピー", message.text);
    // クリップボードAPIを使用
    navigator.clipboard.writeText(message.text).catch(function(err) {
      console.error("CSS Jumper: クリップボードコピー失敗", err);
    });
    return true; // 非同期応答の可能性のためにtrueを返す（念のため）
  }

  if (message.action === "openUrl") {
    console.log("CSS Jumper: VS Code URLを開く", message.url);
    openVscodeUrl(message.url);
    sendResponse({ opened: true });
  }
  
  if (message.action === "toggleSizeDisplay") {
    console.log("CSS Jumper: サイズ表示トグル");
    toggleSizeDisplay();
    sendResponse({ toggled: true });
  }
  
  if (message.action === "showNotification") {
    showNotification(message.message, message.type || "info");
    sendResponse({ shown: true });
  }
  
  if (message.action === "getViewportInfo") {
    // ビューポート情報を返す
    var info = {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight
    };
    console.log("CSS Jumper: ビューポート情報を返す", info);
    sendResponse(info);
  }
  
  if (message.action === "toggleSpacingDisplay") {
    console.log("CSS Jumper: 距離表示トグル");
    toggleSpacingDisplay();
    sendResponse({ toggled: true });
  }
  
  if (message.action === "toggleBothDisplay") {
    console.log("CSS Jumper: 両方表示");
    showBothOverlays();
    sendResponse({ shown: true });
  }
  
  if (message.action === "getCssLinks") {
    // ページ内のCSSリンクを取得
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var cssLinks = [];
    
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href;
      // 外部CDN等は除外（ローカルのみ）
      if (href && (href.includes('127.0.0.1') || href.includes('localhost'))) {
        cssLinks.push(href);
      }
    }
    
    console.log("CSS Jumper: CSSリンク検出", cssLinks);
    sendResponse({ cssLinks: cssLinks });
  }
  
  // セクション一覧を取得
  if (message.action === "getSectionList") {
    var sections = getSectionList();
    console.log("CSS Jumper: セクション一覧", sections);
    sendResponse({ sections: sections });
  }
  
  // セクション枠を表示
  if (message.action === "showSectionOutline") {
    showSectionOutline(message.sectionId);
    sendResponse({ shown: true });
  }

  
  return true;
});

// スクロールバー幅を取得
function getScrollbarWidth() {
  return window.innerWidth - document.documentElement.clientWidth;
}

// セクション枠表示用変数
var sectionOutlineVisible = false;
var sectionOutlineData = [];

// セクション一覧を取得
function getSectionList() {
  var sectionTags = ["header", "nav", "main", "section", "article", "aside", "footer"];
  var sections = [];
  
  sectionTags.forEach(function(tag) {
    var elements = document.querySelectorAll(tag);
    elements.forEach(function(elem, index) {
      var className = elem.className || "";
      if (typeof className === "object" && className.baseVal) {
        className = className.baseVal;
      }
      var firstClass = className.split(" ")[0] || "";
      
      sections.push({
        tag: tag,
        className: firstClass,
        index: sections.length,
        element: elem
      });
    });
  });
  
  // セクションデータを保存（後で使用）
  sectionOutlineData = sections;
  
  return sections.map(function(s) {
    return { tag: s.tag, className: s.className, index: s.index };
  });
}


// セクション枠を表示
function showSectionOutline(sectionId) {
  // 既存の枠を削除
  removeSectionOutline();
  
  var targetSections = [];
  
  if (sectionId === "section_all") {
    // 全セクション
    targetSections = sectionOutlineData;
  } else {
    // 特定のセクション
    var index = parseInt(sectionId.replace("section_", ""));
    if (sectionOutlineData[index]) {
      targetSections = [sectionOutlineData[index]];
    }
  }
  
  if (targetSections.length === 0) {
    showNotification("セクションが見つかりません", "error");
    return;
  }
  
  // 各セクションとその子要素に枠を表示
  targetSections.forEach(function(section) {
    showElementOutline(section.element, 0);
  });
  
  sectionOutlineVisible = true;
  showNotification("セクション枠を表示しました（クリアするには再度メニューを選択）", "success");
}

// 要素とその子要素に枠を表示（再帰的）
function showElementOutline(element, depth) {
  if (!element || depth > 6) return;
  
  // CSS Jumperのオーバーレイは除外
  if (element.classList && (
    element.classList.contains("css-jumper-outline") ||
    element.classList.contains("css-jumper-size-overlay") ||
    element.classList.contains("css-jumper-spacing-overlay")
  )) {
    return;
  }
  
  // 非表示要素や小さすぎる要素は除外
  var rect = element.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  
  var style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return;
  
  // 階層別の色（3色、落ち着いた色）
  var colors = [
    "#2196F3", // 深さ0: ブルー
    "#4CAF50", // 深さ1: グリーン
    "#FF9800"  // 深さ2: オレンジ
  ];
  var bgColors = [
    "rgba(33, 150, 243, 0.1)", // 薄いブルー
    "rgba(76, 175, 80, 0.1)",  // 薄いグリーン
    "rgba(255, 152, 0, 0.1)"   // 薄いオレンジ
  ];
  var color = colors[depth % colors.length];
  var bgColor = bgColors[depth % bgColors.length];
  
  // 薄い背景色 + 細い破線の枠（参照画像のように）
  var outline = document.createElement("div");
  outline.className = "css-jumper-outline";
  outline.style.cssText = 
    "position: absolute !important;" +
    "left: " + (rect.left + window.scrollX) + "px !important;" +
    "top: " + (rect.top + window.scrollY) + "px !important;" +
    "width: " + rect.width + "px !important;" +
    "height: " + rect.height + "px !important;" +
    "background: " + bgColor + " !important;" +
    "border: 8px solid " + color + " !important;" +
    "border-radius: 20px !important;" +
    "pointer-events: none !important;" +
    "z-index: " + (999990 - depth) + " !important;" +
    "box-sizing: border-box !important;";
  document.body.appendChild(outline);
  
  // クラス名を取得
  var className = element.className || "";
  if (typeof className === "object" && className.baseVal) {
    className = className.baseVal;
  }
  var firstClass = className.split(" ")[0] || element.tagName.toLowerCase();
  
  // CSSプロパティを日本語で取得
  var cssPropsJp = [];
  if (style.display === "flex" || style.display === "inline-flex") {
    cssPropsJp.push("◀▶ 横並び");
  }
  if (style.position === "relative") {
    cssPropsJp.push("📍 配置の基準");
  }
  if (style.position === "absolute") {
    cssPropsJp.push("📌 絶対配置");
  }
  
  // 画面からはみ出さないようにleft位置を調整
  var labelLeft = rect.left + window.scrollX;
  if (labelLeft < 10) {
    labelLeft = 10;
  }
  
  // クラス名ラベル
  var label = document.createElement("div");
  label.className = "css-jumper-outline";
  label.innerHTML = "." + firstClass;
  label.style.cssText = 
    "position: absolute !important;" +
    "left: " + labelLeft + "px !important;" +
    "top: " + (rect.top + window.scrollY - 50) + "px !important;" +
    "background: " + color + " !important;" +
    "color: white !important;" +
    "padding: 5px 15px !important;" +
    "font-size: 32px !important;" +
    "font-weight: bold !important;" +
    "font-family: monospace !important;" +
    "pointer-events: none !important;" +
    "z-index: " + (999991 - depth) + " !important;" +
    "white-space: nowrap !important;" +
    "border-radius: 8px !important;" +
    "max-width: calc(100vw - 40px) !important;" +
    "overflow: hidden !important;" +
    "text-overflow: ellipsis !important;";
  document.body.appendChild(label);
  
  // CSSプロパティラベル（別行で黒文字・日本語）
  if (cssPropsJp.length > 0) {
    var propsLabel = document.createElement("div");
    propsLabel.className = "css-jumper-outline";
    propsLabel.innerHTML = cssPropsJp.join(" ");
    propsLabel.style.cssText = 
      "position: absolute !important;" +
      "left: " + (labelLeft + 10) + "px !important;" +
      "top: " + (rect.top + window.scrollY - 10) + "px !important;" +
      "color: #333 !important;" +
      "font-size: 24px !important;" +
      "font-family: sans-serif !important;" +
      "pointer-events: none !important;" +
      "z-index: " + (999991 - depth) + " !important;" +
      "white-space: nowrap !important;";
    document.body.appendChild(propsLabel);
  }
  
  // 子要素に再帰（クラスを持つ要素のみ）
  var children = element.children;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    // script, style, meta等は除外
    if (["SCRIPT", "STYLE", "META", "LINK", "HEAD"].indexOf(child.tagName) >= 0) {
      continue;
    }
    showElementOutline(child, depth + 1);
  }
}

// CSSプロパティラベルを生成
function getCssPropertiesLabel(style) {
  var props = [];
  
  // display
  var display = style.display;
  if (display === "flex") {
    props.push("flex");
    var dir = style.flexDirection;
    if (dir && dir !== "row") {
      props.push(dir);
    }
  } else if (display === "grid") {
    props.push("grid");
  } else if (display === "inline-block") {
    props.push("inline-block");
  }
  
  // position（staticは省略）
  var position = style.position;
  if (position && position !== "static") {
    props.push(position);
  }
  
  // gap
  var gap = style.gap;
  if (gap && gap !== "normal" && gap !== "0px") {
    props.push("gap:" + gap);
  }
  
  // width/height（明示的な値のみ）
  var width = style.width;
  var height = style.height;
  if (width && width !== "auto" && !width.includes("%") && parseFloat(width) > 0) {
    var w = Math.round(parseFloat(width));
    if (w > 0 && w < 2000) {
      props.push("w:" + w);
    }
  }
  
  return props.join(", ");
}

// セクション枠を削除
function removeSectionOutline() {
  var outlines = document.querySelectorAll(".css-jumper-outline");
  for (var i = 0; i < outlines.length; i++) {
    outlines[i].remove();
  }
  sectionOutlineVisible = false;
}

// Flex情報を表示
function showFlexInfo() {
  // 既存のFlex情報ラベルを削除
  removeFlexInfo();

  console.log("CSS Jumper: Flex情報表示開始");

  var elements = document.querySelectorAll("*");
  var flexCount = 0;

  elements.forEach(function(elem) {
    // CSS Jumperのオーバーレイは除外
    if (elem.classList && (
      elem.classList.contains("css-jumper-flex-info") ||
      elem.classList.contains("css-jumper-size-overlay") ||
      elem.classList.contains("css-jumper-spacing-overlay") ||
      elem.classList.contains("css-jumper-outline")
    )) {
      return;
    }

    var style = window.getComputedStyle(elem);

    // Flexコンテナのみ対象
    if (style.display !== "flex" && style.display !== "inline-flex") {
      return;
    }

    var rect = elem.getBoundingClientRect();

    // 小さすぎる要素は除外
    if (rect.width < 30 || rect.height < 20) {
      return;
    }

    // Flex情報を収集（シンプルに縦/横のみ）
    var dir = style.flexDirection;
    var dirLabel = "横";
    if (dir === "column" || dir === "column-reverse") {
      dirLabel = "縦";
    }

    // ラベルを作成
    var label = document.createElement("div");
    label.className = "css-jumper-flex-info";
    label.textContent = "flex " + dirLabel;

    // 画面からはみ出さないよう位置調整
    var labelLeft = rect.left + window.scrollX;
    if (labelLeft < 5) labelLeft = 5;

    label.style.cssText =
      "position: absolute !important;" +
      "left: " + labelLeft + "px !important;" +
      "top: " + (rect.top + window.scrollY - 28) + "px !important;" +
      "background: rgba(156, 39, 176, 0.9) !important;" +
      "color: white !important;" +
      "padding: 4px 10px !important;" +
      "font-size: 13px !important;" +
      "font-family: 'Segoe UI', sans-serif !important;" +
      "border-radius: 4px !important;" +
      "z-index: 999995 !important;" +
      "pointer-events: none !important;" +
      "white-space: nowrap !important;" +
      "box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;";

    document.body.appendChild(label);
    flexCount++;
  });

  flexInfoVisible = true;
  console.log("CSS Jumper: Flex情報表示完了", flexCount + "件");

  // 通知は手動実行時のみ（自動リロード時にうるさいため削除）
}

// Flex情報を削除
function removeFlexInfo() {
  var labels = document.querySelectorAll(".css-jumper-flex-info");
  for (var i = 0; i < labels.length; i++) {
    labels[i].remove();
  }
  flexInfoVisible = false;
}

// デザイン基準（1rem = 10px）でmargin値を変換
function convertToDesignBasis(pixelValue) {
  // ブラウザの実際のhtml font-sizeを取得
  var htmlFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  
  // rem値を逆算
  var remValue = pixelValue / htmlFontSize;
  
  // デザイン基準（1rem = 10px）で再計算
  var designBasisPx = remValue * 10;
  
  return Math.round(designBasisPx);
}

// 配置方法に基づいてスクロールバー補正値を計算
function getScrollbarCorrection(element) {
  var scrollbarWidth = getScrollbarWidth();
  
  // スクロールバーがなければ補正不要
  // デバッグ用：一時的に補正を無効化
  if (true || scrollbarWidth <= 0) {
    return { left: 0, right: 0 };
  }
  
  var style = window.getComputedStyle(element);
  var parent = element.parentElement;
  var parentStyle = parent ? window.getComputedStyle(parent) : null;
  
  // 要素の位置から中央寄せかどうかを判定
  var rect = element.getBoundingClientRect();
  var parentRect = parent ? parent.getBoundingClientRect() : { left: 0, right: window.innerWidth };
  
  // 親要素に対する左右の余白を計算
  var leftSpace = rect.left - parentRect.left;
  var rightSpace = parentRect.right - rect.right;
  
  // 左右の余白がほぼ等しい場合は中央寄せと判定（許容誤差10px）
  if (Math.abs(leftSpace - rightSpace) <= 10) {
    return {
      left: scrollbarWidth / 2,
      right: scrollbarWidth / 2
    };
  }
  
  // flexboxの中央寄せ判定
  if (parentStyle && 
      (parentStyle.display === 'flex' || parentStyle.display === 'inline-flex') &&
      parentStyle.justifyContent === 'center') {
    return {
      left: scrollbarWidth / 2,
      right: scrollbarWidth / 2
    };
  }
  
  // gridの中央寄せ判定
  if (parentStyle && 
      (parentStyle.display === 'grid' || parentStyle.display === 'inline-grid') &&
      parentStyle.justifyContent === 'center') {
    return {
      left: scrollbarWidth / 2,
      right: scrollbarWidth / 2
    };
  }
  
  // position: absoluteの判定
  if (style.position === 'absolute' || style.position === 'fixed') {
    var hasLeft = style.left !== 'auto';
    var hasRight = style.right !== 'auto';
    
    if (hasLeft && hasRight) {
      // 両方指定 → 中央的な配置
      return { left: scrollbarWidth / 2, right: scrollbarWidth / 2 };
    } else if (hasLeft) {
      // left基準 → 左は変わらない、右が縮む
      return { left: 0, right: scrollbarWidth };
    } else if (hasRight) {
      // right基準 → 右は変わらない、左が縮む
      return { left: scrollbarWidth, right: 0 };
    }
  }
  
  // 右寄りの場合（右余白が左余白より小さい）
  if (rightSpace < leftSpace - 10) {
    return {
      left: scrollbarWidth,
      right: 0
    };
  }
  
  // 左寄せ（デフォルト）
  return {
    left: 0,
    right: scrollbarWidth
  };
}

// サイズ表示をトグル
function toggleSizeDisplay() {
  if (sizeOverlayVisible) {
    removeSizeOverlay();
  } else {
    showSizeOverlay();
  }
}

// サイズオーバーレイを表示
function showSizeOverlay() {
  // 距離オーバーレイが表示されていたら削除
  removeSpacingOverlay();
  
  // まずスクロールを左上にリセット
  window.scrollTo(0, 0);
  
  // 少し待ってからサイズを計測
  setTimeout(function() {
    // ビューポート情報を取得
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var documentWidth = document.documentElement.scrollWidth;
    var documentHeight = document.documentElement.scrollHeight;
    
    // 水平スクロールが発生しているか確認
    var hasHorizontalScroll = documentWidth > viewportWidth;
    
    console.log("CSS Jumper: ビューポート情報", {
      viewportWidth: viewportWidth,
      viewportHeight: viewportHeight,
      documentWidth: documentWidth,
      documentHeight: documentHeight,
      hasHorizontalScroll: hasHorizontalScroll
    });
    
    // ビューポート幅の表示（画面左上に固定）
    var viewportInfo = document.createElement("div");
    viewportInfo.className = "css-jumper-size-overlay css-jumper-viewport-info";
    viewportInfo.innerHTML = 
      "<strong>📐 ビューポート: " + viewportWidth + " × " + viewportHeight + "</strong>" +
      (hasHorizontalScroll ? 
        "<br><span style='color:#ff9800'>⚠ コンテンツ幅: " + documentWidth + "px（はみ出しあり）</span>" : 
        "<br><span style='color:#81c784'>✓ コンテンツ幅: " + documentWidth + "px</span>");
    
    viewportInfo.style.cssText = 
      "position: fixed;" +
      "left: 10px;" +
      "top: 10px;" +
      "background: rgba(0, 0, 0, 0.85);" +
      "color: white;" +
      "padding: 10px 14px;" +
      "font-size: 13px;" +
      "font-family: 'Segoe UI', sans-serif;" +
      "border-radius: 6px;" +
      "z-index: 999999;" +
      "pointer-events: none;" +
      "box-shadow: 0 4px 12px rgba(0,0,0,0.4);" +
      "line-height: 1.6;";
    
    document.body.appendChild(viewportInfo);
    
    // クラスを持つ要素のみを対象に（精度向上のため）
    var elements = document.querySelectorAll("[class]");
    var processedRects = []; // 重複防止用
    
    for (var i = 0; i < elements.length; i++) {
      var elem = elements[i];
      
      // 自身のオーバーレイはスキップ
      if (elem.classList && elem.classList.contains("css-jumper-size-overlay")) {
        continue;
      }
      
      // script, style, head 内の要素はスキップ
      if (elem.tagName === "SCRIPT" || elem.tagName === "STYLE" || elem.tagName === "HEAD" || elem.tagName === "META" || elem.tagName === "LINK") {
        continue;
      }
      
      // 検証ツールと同じ値を取得するためoffsetWidth/offsetHeightを使用
      var elemWidth = elem.offsetWidth;
      var elemHeight = elem.offsetHeight;
      
      // 小さすぎる要素はスキップ（幅20px未満または高さ12px未満）
      if (elemWidth < 20 || elemHeight < 12) {
        continue;
      }
      
      // 位置取得用にgetBoundingClientRectを使用（位置だけ）
      var rect = elem.getBoundingClientRect();
      
      // 重複チェック（同じ位置・サイズの要素はスキップ）
      var rectKey = Math.round(rect.left) + "," + Math.round(rect.top) + "," + elemWidth + "," + elemHeight;
      if (processedRects.indexOf(rectKey) !== -1) {
        continue;
      }
      processedRects.push(rectKey);
      
      var label = document.createElement("div");
      label.className = "css-jumper-size-overlay";
      
      var width = elemWidth;
      var height = elemHeight;
      
      // フォントサイズを取得
      var computedStyle = window.getComputedStyle(elem);
      var fontSize = Math.round(parseFloat(computedStyle.fontSize));
      
      // 幅がビューポートを超えている場合は警告色
      var bgColor = "rgba(33, 150, 243, 0.9)";
      if (width > viewportWidth) {
        bgColor = "rgba(255, 152, 0, 0.9)"; // オレンジ（警告）
      }
      
      // サイズとフォントサイズを表示
      label.textContent = width + "×" + height + " f" + fontSize;
      label.style.cssText = 
        "position: absolute;" +
        "left: " + (rect.left + window.scrollX) + "px;" +
        "top: " + (rect.top + window.scrollY) + "px;" +
        "background: " + bgColor + ";" +
        "color: white;" +
        "padding: 2px 6px;" +
        "font-size: 11px;" +
        "font-family: monospace;" +
        "border-radius: 3px;" +
        "z-index: 999998;" +
        "pointer-events: none;" +
        "white-space: nowrap;";
      
      document.body.appendChild(label);
    }
    
    sizeOverlayVisible = true;
    
    // 通知メッセージ
    var message = "✓ サイズ表示ON（ビューポート: " + viewportWidth + "px）";
    if (hasHorizontalScroll) {
      message = "⚠ サイズ表示ON（ビューポート: " + viewportWidth + "px、コンテンツがはみ出しています）";
      showNotification(message, "warning");
    } else {
      showNotification(message, "success");
    }
  }, 100);
}

// サイズオーバーレイを削除
function removeSizeOverlay() {
  var overlays = document.querySelectorAll(".css-jumper-size-overlay");
  for (var i = 0; i < overlays.length; i++) {
    overlays[i].remove();
  }
  
  sizeOverlayVisible = false;
  showNotification("サイズ表示OFF", "info");
}

// 距離表示用のフラグ
var spacingOverlayVisible = false;

// 距離表示をトグル
function toggleSpacingDisplay() {
  if (spacingOverlayVisible) {
    removeSpacingOverlay();
  } else {
    showSpacingOverlay();
  }
}

// 両方表示（サイズ＋距離を同時に表示）
function showBothOverlays() {
  // 既存のオーバーレイを削除
  removeSizeOverlay();
  removeSpacingOverlay();
  
  // スクロールをリセット
  window.scrollTo(0, 0);
  
  setTimeout(function() {
    // サイズ表示（距離を消さないバージョン）
    showSizeOverlayOnly();
    
    // 少し待ってから距離表示（サイズを消さないバージョン）
    setTimeout(function() {
      showSpacingOverlayOnly();
      showNotification("✓ サイズ＋距離を同時表示", "success");
    }, 50);
  }, 100);
}

// サイズオーバーレイのみ表示（他のオーバーレイを消さない）
function showSizeOverlayOnly() {
  var viewportWidth = window.innerWidth;
  var viewportHeight = window.innerHeight;
  var documentWidth = document.documentElement.scrollWidth;
  var hasHorizontalScroll = documentWidth > viewportWidth;
  
  // ビューポート情報
  var viewportInfo = document.createElement("div");
  viewportInfo.className = "css-jumper-size-overlay css-jumper-viewport-info";
  var bgColor = hasHorizontalScroll ? "rgba(255, 152, 0, 0.95)" : "rgba(33, 150, 243, 0.95)";
  viewportInfo.innerHTML = "<strong>📐 ビューポート: " + viewportWidth + " × " + viewportHeight + "</strong>";
  if (hasHorizontalScroll) {
    viewportInfo.innerHTML += "<br>⚠️ コンテンツ幅: " + documentWidth + "px（はみ出し）";
  }
  viewportInfo.style.cssText = 
    "position: fixed;" +
    "left: 10px;" +
    "top: 10px;" +
    "background: " + bgColor + ";" +
    "color: white;" +
    "padding: 10px 14px;" +
    "font-size: 13px;" +
    "font-family: 'Segoe UI', sans-serif;" +
    "border-radius: 6px;" +
    "z-index: 999999;" +
    "pointer-events: none;" +
    "box-shadow: 0 4px 12px rgba(0,0,0,0.4);" +
    "line-height: 1.6;";
  document.body.appendChild(viewportInfo);
  
  // クラスを持つ要素のサイズ表示
  var elements = document.querySelectorAll("[class]");
  var processedRects = [];
  
  for (var i = 0; i < elements.length; i++) {
    var elem = elements[i];
    if (elem.classList && elem.classList.contains("css-jumper-size-overlay")) continue;
    if (elem.classList && elem.classList.contains("css-jumper-spacing-overlay")) continue;
    if (elem.tagName === "SCRIPT" || elem.tagName === "STYLE" || elem.tagName === "HEAD") continue;
    
    var elemWidth = elem.offsetWidth;
    var elemHeight = elem.offsetHeight;
    if (elemWidth < 20 || elemHeight < 12) continue;
    
    var rect = elem.getBoundingClientRect();
    
    var rectKey = Math.round(rect.left) + "," + Math.round(rect.top) + "," + elemWidth + "," + elemHeight;
    if (processedRects.indexOf(rectKey) !== -1) continue;
    processedRects.push(rectKey);
    
    var label = document.createElement("div");
    label.className = "css-jumper-size-overlay";
    var bgColor = elemWidth > viewportWidth ? "rgba(255, 152, 0, 0.9)" : "rgba(33, 150, 243, 0.9)";
    // フォントサイズを取得
    var computedStyle = window.getComputedStyle(elem);
    var fontSize = Math.round(parseFloat(computedStyle.fontSize));
    label.textContent = elemWidth + "×" + elemHeight + " f" + fontSize;
    label.style.cssText = 
      "position: absolute;" +
      "left: " + (rect.left + window.scrollX) + "px;" +
      "top: " + (rect.top + window.scrollY) + "px;" +
      "background: " + bgColor + ";" +
      "color: white;" +
      "padding: 2px 6px;" +
      "font-size: 11px;" +
      "font-family: monospace;" +
      "border-radius: 3px;" +
      "z-index: 999998;" +
      "pointer-events: none;" +
      "white-space: nowrap;";
    document.body.appendChild(label);
  }
  sizeOverlayVisible = true;
}

// 距離オーバーレイのみ表示（他のオーバーレイを消さない）
function showSpacingOverlayOnly() {
  var viewportWidth = window.innerWidth;
  var viewportHeight = window.innerHeight;
  
  var elements = document.querySelectorAll("[class]");
  var processedElements = [];
  
  for (var i = 0; i < elements.length; i++) {
    var elem = elements[i];
    if (elem.classList.contains("css-jumper-spacing-overlay") || elem.classList.contains("css-jumper-size-overlay")) continue;
    if (elem.tagName === "SCRIPT" || elem.tagName === "STYLE" || elem.tagName === "HEAD") continue;
    
    var elemWidth = elem.offsetWidth;
    var elemHeight = elem.offsetHeight;
    if (elemWidth < 20 || elemHeight < 12) continue;
    
    var rect = elem.getBoundingClientRect();
    
    var key = Math.round(rect.left) + "," + Math.round(rect.top) + "," + elemWidth + "," + elemHeight;
    if (processedElements.indexOf(key) !== -1) continue;
    processedElements.push(key);
    
    var style = window.getComputedStyle(elem);
    var marginTop = Math.round(parseFloat(style.marginTop)) || 0;
    var marginLeft = Math.round(parseFloat(style.marginLeft)) || 0;
    var marginBottom = Math.round(parseFloat(style.marginBottom)) || 0;
    var marginRight = Math.round(parseFloat(style.marginRight)) || 0;
    
    // 中央寄せ（margin: auto）の場合、スクロールバー幅分を補正
    var scrollbarWidth = getScrollbarWidth();
    if (scrollbarWidth > 0 && Math.abs(marginLeft - marginRight) < 3) {
      // 左右のmarginがほぼ同じ = margin: auto で中央寄せ
      var scrollbarCorrection = Math.floor(scrollbarWidth / 2);
      marginLeft += scrollbarCorrection;
      marginRight += scrollbarCorrection;
    }
    
    // margin表示（ピンク/オレンジ）
    if (marginTop >= 5) {
      var mTop = document.createElement("div");
      mTop.className = "css-jumper-spacing-overlay";
      mTop.textContent = "↑" + marginTop;
      mTop.style.cssText = "position:absolute;left:" + (rect.left + window.scrollX + rect.width/2 - 20) + "px;top:" + (rect.top + window.scrollY - 18) + "px;background:rgba(233,30,99,0.9);color:white;padding:2px 6px;font-size:10px;font-family:monospace;border-radius:3px;z-index:999997;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(mTop);
    }
    if (marginBottom >= 5) {
      var mBot = document.createElement("div");
      mBot.className = "css-jumper-spacing-overlay";
      mBot.textContent = "↓" + marginBottom;
      mBot.style.cssText = "position:absolute;left:" + (rect.left + window.scrollX + rect.width/2 - 20) + "px;top:" + (rect.bottom + window.scrollY + 2) + "px;background:rgba(233,30,99,0.9);color:white;padding:2px 6px;font-size:10px;font-family:monospace;border-radius:3px;z-index:999997;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(mBot);
    }
    if (marginLeft >= 5) {
      var mLeft = document.createElement("div");
      mLeft.className = "css-jumper-spacing-overlay";
      mLeft.textContent = "←" + marginLeft;
      mLeft.style.cssText = "position:absolute;left:" + (rect.left + window.scrollX - 40) + "px;top:" + (rect.top + window.scrollY + rect.height/2 - 8) + "px;background:rgba(255,152,0,0.9);color:white;padding:2px 6px;font-size:10px;font-family:monospace;border-radius:3px;z-index:999997;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(mLeft);
    }
    if (marginRight >= 5) {
      var mRight = document.createElement("div");
      mRight.className = "css-jumper-spacing-overlay";
      mRight.textContent = marginRight + "→";
      mRight.style.cssText = "position:absolute;left:" + (rect.right + window.scrollX + 4) + "px;top:" + (rect.top + window.scrollY + rect.height/2 - 8) + "px;background:rgba(255,152,0,0.9);color:white;padding:2px 6px;font-size:10px;font-family:monospace;border-radius:3px;z-index:999997;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(mRight);
    }
  }
  spacingOverlayVisible = true;
}

// 距離オーバーレイを表示
function showSpacingOverlay() {
  // まず既存のオーバーレイを削除
  removeSpacingOverlay();
  removeSizeOverlay();
  
  window.scrollTo(0, 0);
  
  setTimeout(function() {
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    
    // ビューポート情報を表示
    var viewportInfo = document.createElement("div");
    viewportInfo.className = "css-jumper-spacing-overlay css-jumper-viewport-info";
    viewportInfo.innerHTML = "<strong>📐 距離表示モード（ビューポート: " + viewportWidth + "px）</strong>";
    viewportInfo.style.cssText = 
      "position: fixed;" +
      "left: 10px;" +
      "top: 10px;" +
      "background: rgba(156, 39, 176, 0.9);" +
      "color: white;" +
      "padding: 10px 14px;" +
      "font-size: 13px;" +
      "font-family: 'Segoe UI', sans-serif;" +
      "border-radius: 6px;" +
      "z-index: 999999;" +
      "pointer-events: none;" +
      "box-shadow: 0 4px 12px rgba(0,0,0,0.4);";
    document.body.appendChild(viewportInfo);
    
    // クラスを持つ要素のみを対象に
    var elements = document.querySelectorAll("[class]");
    var processedElements = [];
    
    for (var i = 0; i < elements.length; i++) {
      var elem = elements[i];
      
      // 自身のオーバーレイはスキップ
      if (elem.classList.contains("css-jumper-spacing-overlay") || 
          elem.classList.contains("css-jumper-size-overlay")) {
        continue;
      }
      
      // 非表示要素はスキップ
      if (elem.tagName === "SCRIPT" || elem.tagName === "STYLE" || 
          elem.tagName === "HEAD" || elem.tagName === "META" || elem.tagName === "LINK") {
        continue;
      }
      
      var elemWidth = elem.offsetWidth;
      var elemHeight = elem.offsetHeight;
      
      if (elemWidth < 20 || elemHeight < 12) {
        continue;
      }
      
      var rect = elem.getBoundingClientRect();
      
      // 重複チェック
      var key = Math.round(rect.left) + "," + Math.round(rect.top) + "," + elemWidth + "," + elemHeight;
      if (processedElements.indexOf(key) !== -1) {
        continue;
      }
      processedElements.push(key);
      
      // marginを取得
      var style = window.getComputedStyle(elem);
      var marginTop = Math.round(parseFloat(style.marginTop)) || 0;
      var marginLeft = Math.round(parseFloat(style.marginLeft)) || 0;
      var marginBottom = Math.round(parseFloat(style.marginBottom)) || 0;
      var marginRight = Math.round(parseFloat(style.marginRight)) || 0;
      
      // 中央寄せ（margin: auto）の場合、スクロールバー幅分を補正
      var scrollbarWidth = getScrollbarWidth();
      if (scrollbarWidth > 0 && Math.abs(marginLeft - marginRight) < 3) {
        // 左右のmarginがほぼ同じ = margin: auto で中央寄せ
        var scrollbarCorrection = Math.floor(scrollbarWidth / 2);
        marginLeft += scrollbarCorrection;
        marginRight += scrollbarCorrection;
      }
      
      // paddingを取得
      var paddingTop = Math.round(parseFloat(style.paddingTop)) || 0;
      var paddingLeft = Math.round(parseFloat(style.paddingLeft)) || 0;
      var paddingBottom = Math.round(parseFloat(style.paddingBottom)) || 0;
      var paddingRight = Math.round(parseFloat(style.paddingRight)) || 0;
      
      // padding表示（シアン色、5px以上の場合のみ）
      if (paddingTop >= 5) {
        var pTopLabel = document.createElement("div");
        pTopLabel.className = "css-jumper-spacing-overlay";
        pTopLabel.textContent = "p↓" + paddingTop;
        pTopLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX + rect.width / 2 + 20) + "px;" +
          "top: " + (rect.top + window.scrollY + 2) + "px;" +
          "background: rgba(0, 188, 212, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(pTopLabel);
      }
      
      if (paddingLeft >= 5) {
        var pLeftLabel = document.createElement("div");
        pLeftLabel.className = "css-jumper-spacing-overlay";
        pLeftLabel.textContent = "p→" + paddingLeft;
        pLeftLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX + 2) + "px;" +
          "top: " + (rect.top + window.scrollY + rect.height / 2 + 10) + "px;" +
          "background: rgba(0, 188, 212, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(pLeftLabel);
      }
      
      if (paddingBottom >= 5) {
        var pBottomLabel = document.createElement("div");
        pBottomLabel.className = "css-jumper-spacing-overlay";
        pBottomLabel.textContent = "p↑" + paddingBottom;
        pBottomLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX + rect.width / 2 + 20) + "px;" +
          "top: " + (rect.bottom + window.scrollY - 18) + "px;" +
          "background: rgba(0, 188, 212, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(pBottomLabel);
      }
      
      if (paddingRight >= 5) {
        var pRightLabel = document.createElement("div");
        pRightLabel.className = "css-jumper-spacing-overlay";
        pRightLabel.textContent = paddingRight + "←p";
        pRightLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.right + window.scrollX - 45) + "px;" +
          "top: " + (rect.top + window.scrollY + rect.height / 2 + 10) + "px;" +
          "background: rgba(0, 188, 212, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(pRightLabel);
      }
      
      // 上方向のmarginを表示（5px以上の場合のみ）
      if (marginTop >= 5) {
        var topLabel = document.createElement("div");
        topLabel.className = "css-jumper-spacing-overlay";
        topLabel.textContent = "↑" + marginTop;
        topLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX + rect.width / 2 - 20) + "px;" +
          "top: " + (rect.top + window.scrollY - 18) + "px;" +
          "background: rgba(233, 30, 99, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(topLabel);
      }
      
      // 左方向のmarginを表示（5px以上）
      if (marginLeft >= 5) {
        var leftLabel = document.createElement("div");
        leftLabel.className = "css-jumper-spacing-overlay";
        leftLabel.textContent = "←" + marginLeft;
        leftLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX - 40) + "px;" +
          "top: " + (rect.top + window.scrollY + rect.height / 2 - 8) + "px;" +
          "background: rgba(255, 152, 0, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(leftLabel);
      }
      
      // 下方向のmarginを表示（5px以上の場合のみ）
      if (marginBottom >= 5) {
        var bottomLabel = document.createElement("div");
        bottomLabel.className = "css-jumper-spacing-overlay";
        bottomLabel.textContent = "↓" + marginBottom;
        bottomLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.left + window.scrollX + rect.width / 2 - 20) + "px;" +
          "top: " + (rect.bottom + window.scrollY + 2) + "px;" +
          "background: rgba(233, 30, 99, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(bottomLabel);
      }
      
      // 右方向のmarginを表示（5px以上）
      if (marginRight >= 5) {
        var rightLabel = document.createElement("div");
        rightLabel.className = "css-jumper-spacing-overlay";
        rightLabel.textContent = marginRight + "→";
        rightLabel.style.cssText = 
          "position: absolute;" +
          "left: " + (rect.right + window.scrollX + 2) + "px;" +
          "top: " + (rect.top + window.scrollY + rect.height / 2 - 8) + "px;" +
          "background: rgba(255, 152, 0, 0.9);" +
          "color: white;" +
          "padding: 2px 6px;" +
          "font-size: 10px;" +
          "font-family: monospace;" +
          "border-radius: 3px;" +
          "z-index: 999997;" +
          "pointer-events: none;" +
          "white-space: nowrap;";
        document.body.appendChild(rightLabel);
      }
      
      // Flex/Gridの親要素の場合、gapを表示
      var display = style.display;
      if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
        var gap = parseInt(style.gap) || 0;
        var columnGap = parseInt(style.columnGap) || gap;
        var rowGap = parseInt(style.rowGap) || gap;
        
        if (columnGap >= 5 || rowGap >= 5) {
          var gapLabel = document.createElement("div");
          gapLabel.className = "css-jumper-spacing-overlay";
          var gapText = "";
          if (columnGap === rowGap && columnGap > 0) {
            gapText = "gap:" + columnGap;
          } else {
            if (rowGap >= 5) gapText += "row:" + rowGap + " ";
            if (columnGap >= 5) gapText += "col:" + columnGap;
          }
          gapLabel.textContent = gapText.trim();
          gapLabel.style.cssText = 
            "position: absolute;" +
            "left: " + (rect.left + window.scrollX + 2) + "px;" +
            "top: " + (rect.top + window.scrollY + 2) + "px;" +
            "background: rgba(0, 150, 136, 0.9);" +
            "color: white;" +
            "padding: 2px 6px;" +
            "font-size: 10px;" +
            "font-family: monospace;" +
            "border-radius: 3px;" +
            "z-index: 999998;" +
            "pointer-events: none;" +
            "white-space: nowrap;";
          document.body.appendChild(gapLabel);
        }
        
        // Flex/Grid中央配置時の視覚的余白を計算（親子間の距離）
        var justifyContent = style.justifyContent;
        var alignItems = style.alignItems;
        
        // 親要素のborder幅を取得
        var borderLeft = Math.round(parseFloat(style.borderLeftWidth)) || 0;
        var borderRight = Math.round(parseFloat(style.borderRightWidth)) || 0;
        var borderTop = Math.round(parseFloat(style.borderTopWidth)) || 0;
        var borderBottom = Math.round(parseFloat(style.borderBottomWidth)) || 0;
        
        // 子要素が1つだけの場合、視覚的余白を計算
        var firstChild = elem.firstElementChild;
        if (firstChild && elem.children.length === 1) {
          var childRect = firstChild.getBoundingClientRect();
          
          // 横方向の視覚的余白（justify-content: center の場合）
          // border幅を引いて純粋な余白のみ表示
          if (justifyContent === "center" || justifyContent === "space-around" || justifyContent === "space-evenly") {
            var leftSpace = Math.round(childRect.left - rect.left) - borderLeft;
            var rightSpace = Math.round(rect.right - childRect.right) - borderRight;
            
            if (leftSpace >= 10) {
              var lSpaceLabel = document.createElement("div");
              lSpaceLabel.className = "css-jumper-spacing-overlay";
              lSpaceLabel.textContent = "⇥" + leftSpace;
              lSpaceLabel.style.cssText = 
                "position: absolute;" +
                "left: " + (rect.left + window.scrollX + leftSpace / 2 - 15) + "px;" +
                "top: " + (rect.top + window.scrollY + rect.height / 2 - 8) + "px;" +
                "background: rgba(121, 85, 72, 0.9);" +
                "color: white;" +
                "padding: 2px 6px;" +
                "font-size: 10px;" +
                "font-family: monospace;" +
                "border-radius: 3px;" +
                "z-index: 999998;" +
                "pointer-events: none;" +
                "white-space: nowrap;";
              document.body.appendChild(lSpaceLabel);
            }
            
            if (rightSpace >= 10) {
              var rSpaceLabel = document.createElement("div");
              rSpaceLabel.className = "css-jumper-spacing-overlay";
              rSpaceLabel.textContent = rightSpace + "⇤";
              rSpaceLabel.style.cssText = 
                "position: absolute;" +
                "left: " + (childRect.right + window.scrollX + rightSpace / 2 - 15) + "px;" +
                "top: " + (rect.top + window.scrollY + rect.height / 2 - 8) + "px;" +
                "background: rgba(121, 85, 72, 0.9);" +
                "color: white;" +
                "padding: 2px 6px;" +
                "font-size: 10px;" +
                "font-family: monospace;" +
                "border-radius: 3px;" +
                "z-index: 999998;" +
                "pointer-events: none;" +
                "white-space: nowrap;";
              document.body.appendChild(rSpaceLabel);
            }
          }
          
          // 縦方向の視覚的余白（align-items: center の場合）
          // border幅を引いて純粋な余白のみ表示
          if (alignItems === "center") {
            var topSpace = Math.round(childRect.top - rect.top) - borderTop;
            var bottomSpace = Math.round(rect.bottom - childRect.bottom) - borderBottom;
            
            if (topSpace >= 10) {
              var tSpaceLabel = document.createElement("div");
              tSpaceLabel.className = "css-jumper-spacing-overlay";
              tSpaceLabel.textContent = "⇣" + topSpace;
              tSpaceLabel.style.cssText = 
                "position: absolute;" +
                "left: " + (rect.left + window.scrollX + rect.width / 2 - 15) + "px;" +
                "top: " + (rect.top + window.scrollY + topSpace / 2 - 8) + "px;" +
                "background: rgba(121, 85, 72, 0.9);" +
                "color: white;" +
                "padding: 2px 6px;" +
                "font-size: 10px;" +
                "font-family: monospace;" +
                "border-radius: 3px;" +
                "z-index: 999998;" +
                "pointer-events: none;" +
                "white-space: nowrap;";
              document.body.appendChild(tSpaceLabel);
            }
          }
        }
      }
      
      // 右隣の兄弟要素との距離を計算
      var nextSibling = elem.nextElementSibling;
      if (nextSibling && nextSibling.offsetWidth > 0) {
        var nextRect = nextSibling.getBoundingClientRect();
        
        // 同じ行にある場合（横方向の距離）
        if (Math.abs(rect.top - nextRect.top) < rect.height / 2) {
          var horizontalGap = Math.round(nextRect.left - rect.right);
          if (horizontalGap >= 5 && horizontalGap < 200) {
            var hGapLabel = document.createElement("div");
            hGapLabel.className = "css-jumper-spacing-overlay";
            hGapLabel.textContent = "←" + horizontalGap + "→";
            hGapLabel.style.cssText = 
              "position: absolute;" +
              "left: " + (rect.right + window.scrollX + horizontalGap / 2 - 25) + "px;" +
              "top: " + (rect.top + window.scrollY + rect.height / 2 - 8) + "px;" +
              "background: rgba(63, 81, 181, 0.9);" +
              "color: white;" +
              "padding: 2px 6px;" +
              "font-size: 10px;" +
              "font-family: monospace;" +
              "border-radius: 3px;" +
              "z-index: 999998;" +
              "pointer-events: none;" +
              "white-space: nowrap;";
            document.body.appendChild(hGapLabel);
          }
        }
        
        // 大きなブロック要素間の縦方向距離（セクション間など）
        var blockTags = ["DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "NAV", "ASIDE", "UL", "OL", "DL", "TABLE", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "P"];
        var isBlock = blockTags.indexOf(elem.tagName) !== -1;
        var isNextBlock = blockTags.indexOf(nextSibling.tagName) !== -1;
        
        // 両方がブロック要素の場合に表示（見出し要素は高さが小さいので条件を緩和）
        var minHeight = 12; // 見出し対応用に緩和
        if (isBlock && isNextBlock && elemWidth > 50 && elemHeight >= minHeight && nextSibling.offsetHeight >= minHeight) {
          var verticalGap = Math.round(nextRect.top - rect.bottom);
          if (verticalGap >= 10 && verticalGap < 300) {
            var vGapLabel = document.createElement("div");
            vGapLabel.className = "css-jumper-spacing-overlay";
            vGapLabel.textContent = "↕ " + verticalGap + "px";
            vGapLabel.style.cssText = 
              "position: absolute;" +
              "left: " + (Math.min(rect.left, nextRect.left) + window.scrollX + 5) + "px;" +
              "top: " + (rect.bottom + window.scrollY + verticalGap / 2 - 8) + "px;" +
              "background: rgba(103, 58, 183, 0.95);" +
              "color: white;" +
              "padding: 3px 8px;" +
              "font-size: 11px;" +
              "font-weight: bold;" +
              "font-family: monospace;" +
              "border-radius: 4px;" +
              "z-index: 999999;" +
              "pointer-events: none;" +
              "white-space: nowrap;" +
              "box-shadow: 0 2px 6px rgba(0,0,0,0.3);";
            document.body.appendChild(vGapLabel);
          }
        }
      }
    }
    
    spacingOverlayVisible = true;
    showNotification("✓ 距離（margin/gap）表示ON", "success");
  }, 100);
}

// 距離オーバーレイを削除
function removeSpacingOverlay() {
  var overlays = document.querySelectorAll(".css-jumper-spacing-overlay");
  for (var i = 0; i < overlays.length; i++) {
    overlays[i].remove();
  }
  
  spacingOverlayVisible = false;
}

// VS Code URLを開く（iframe方式でエンコード回避）
function openVscodeUrl(url) {
  console.log("CSS Jumper: openVscodeUrl実行", url);

  try {
    // iframe方式（URLエンコードを回避）
    var iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);

    setTimeout(function() {
      if (iframe.parentNode) {
        document.body.removeChild(iframe);
      }
    }, 500);

    console.log("CSS Jumper: iframe方式成功");
  } catch (err) {
    console.log("CSS Jumper: iframe方式失敗", err);
  }
}
  
// 最初のクラス名を取得
function getFirstClassName() {
  if (!lastRightClickedElement) {
    console.log("CSS Jumper: 要素が記録されていません");
    return null;
  }
  
  var classAttr = lastRightClickedElement.className;
  var classString = "";
  
  if (typeof classAttr === "string") {
    classString = classAttr;
  } else if (classAttr && classAttr.baseVal !== undefined) {
    classString = classAttr.baseVal;
  }
  
  if (!classString || !classString.trim()) {
    console.log("CSS Jumper: クラス属性が空です");
    return null;
  }
  
  var classes = classString.trim().split(/\s+/);
  console.log("CSS Jumper: 分割されたクラス", classes);
  return classes[0] || null;
}

// 全てのクラス名を取得
function getAllClassNames() {
  if (!lastRightClickedElement) return [];
  
  var classAttr = lastRightClickedElement.className;
  var classString = "";
  
  if (typeof classAttr === "string") {
    classString = classAttr;
  } else if (classAttr && classAttr.baseVal !== undefined) {
    classString = classAttr.baseVal;
  }
  
  if (!classString || !classString.trim()) return [];
  
  return classString.trim().split(/\s+/);
}

// 画面に通知を表示
function showNotification(message, type) {
  if (!type) type = "info";
  
  console.log("CSS Jumper: 通知表示", message, type);
  
  var existing = document.getElementById("css-jumper-notification");
  if (existing) {
    existing.remove();
  }
  
  var notification = document.createElement("div");
  notification.id = "css-jumper-notification";
  notification.textContent = message;
  
  var bgColor = "#2196f3";
  if (type === "success") bgColor = "#4caf50";
  if (type === "error") bgColor = "#f44336";
  if (type === "warning") bgColor = "#ff9800";
  
  notification.style.cssText = 
    "position: fixed;" +
    "bottom: 20px;" +
    "right: 20px;" +
    "background: " + bgColor + ";" +
    "color: #fff;" +
    "padding: 14px 24px;" +
    "border-radius: 8px;" +
    "font-size: 14px;" +
    "font-family: 'Segoe UI', sans-serif;" +
    "z-index: 999999;" +
    "box-shadow: 0 4px 16px rgba(0,0,0,0.3);" +
    "opacity: 0;" +
    "transform: translateY(20px);" +
    "transition: all 0.3s ease;" +
    "max-width: 400px;";
  
  document.body.appendChild(notification);
  
  setTimeout(function() {
    notification.style.opacity = "1";
    notification.style.transform = "translateY(0)";
  }, 10);
  
  setTimeout(function() {
    notification.style.opacity = "0";
    notification.style.transform = "translateY(-10px)";
    setTimeout(function() {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 3500);
}
