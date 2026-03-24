// 右クリックされた要素を保存
var lastRightClickedElement = null;
var sizeOverlayVisible = false;

// VS Codeからのブラウザハイライト用
var vscodeHighlightPolling = null;
var lastHighlightedElement = null;
var lastHighlightedSelector = null; // 前回のセレクタ（点滅防止）
var highlightOverlay = null; // オーバーレイDOM（再利用）
var highlightLabel = null;   // ラベルDOM（再利用）
var highlightFadeTimer = null; // 自動消去タイマー

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
chrome.storage.local.get(["quickResizeTrigger", "autoShowFlex", "boxModelEnabled"], function(result) {
  if (result.quickResizeTrigger) {
    quickResizeTrigger = result.quickResizeTrigger;
  }
  if (result.autoShowFlex) {
    autoShowFlexEnabled = result.autoShowFlex;
  }
  if (result.boxModelEnabled) {
    enableBoxModelOverlay();
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
  if (changes.boxModelEnabled) {
    if (changes.boxModelEnabled.newValue) {
      if (!boxModelActive) { enableBoxModelOverlay(); }
    } else {
      if (boxModelActive) { removeBoxModelOverlay(); }
    }
  }
});

console.log("CSS Jumper: content.js読み込み完了");

// CSS自動検出済みフラグ（連続実行防止）
var cssAutoDetected = false;

// ========================================
// VS Codeからのブラウザハイライト機能
// ========================================

// VS Codeサーバーをポーリングしてセレクタ情報を取得
function startVSCodeHighlightPolling() {
  // 既にポーリング中なら何もしない
  if (vscodeHighlightPolling) return;

  console.log("CSS Jumper: VS Codeハイライトポーリング開始");

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
            // 同じセレクタ → 位置だけ更新（スクロール追従）
            updateHighlightPosition();
          }
        } else if (lastHighlightedSelector) {
          // セレクタがなくなったらハイライト解除
          lastHighlightedSelector = null;
          removeVSCodeHighlight();
        }
      })
      .catch(function(err) {
        // VS Codeサーバーが起動していない場合は無視
      });
  }, 500); // 500ms間隔でポーリング
}

// セレクタに一致する要素をハイライト
function highlightElementBySelector(type, name) {
  console.log("CSS Jumper: ブラウザハイライト", type, name);

  // 前回のハイライトを削除
  removeVSCodeHighlight();

  // セレクタで要素を検索
  var elements = [];
  if (type === "class") {
    elements = document.querySelectorAll("." + name);
  } else if (type === "id") {
    var elem = document.getElementById(name);
    if (elem) elements = [elem];
  } else if (type === "tag") {
    elements = document.querySelectorAll(name);
  }

  if (elements.length === 0) {
    console.log("CSS Jumper: 該当要素なし");
    return;
  }

  // 最初の要素をハイライト
  var target = elements[0];
  lastHighlightedElement = target;

  // ハイライト用のオーバーレイを作成
  var rect = target.getBoundingClientRect();
  highlightOverlay = document.createElement("div");
  highlightOverlay.className = "css-jumper-vscode-highlight";
  highlightOverlay.style.cssText =
    "position: fixed !important;" +
    "left: " + rect.left + "px !important;" +
    "top: " + rect.top + "px !important;" +
    "width: " + rect.width + "px !important;" +
    "height: " + rect.height + "px !important;" +
    "background: rgba(255, 200, 50, 0.4) !important;" +
    "border: 3px solid rgba(255, 150, 0, 0.9) !important;" +
    "pointer-events: none !important;" +
    "z-index: 999999 !important;" +
    "box-sizing: border-box !important;";
  document.body.appendChild(highlightOverlay);

  // セレクタ名ラベルを追加
  highlightLabel = document.createElement("div");
  highlightLabel.className = "css-jumper-vscode-highlight";
  var selectorText = type === "class" ? "." + name : (type === "id" ? "#" + name : name);
  highlightLabel.textContent = selectorText;
  highlightLabel.style.cssText =
    "position: fixed !important;" +
    "left: " + rect.left + "px !important;" +
    "top: " + (rect.top - 28) + "px !important;" +
    "background: rgba(255, 150, 0, 0.95) !important;" +
    "color: white !important;" +
    "padding: 4px 10px !important;" +
    "font-size: 14px !important;" +
    "font-weight: bold !important;" +
    "font-family: monospace !important;" +
    "border-radius: 4px !important;" +
    "pointer-events: none !important;" +
    "z-index: 999999 !important;" +
    "box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;";
  document.body.appendChild(highlightLabel);

  // 要素が見えるようにスクロール
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  // スクロール追従イベント登録
  window.removeEventListener("scroll", updateHighlightPosition);
  window.addEventListener("scroll", updateHighlightPosition);

  // 5秒後に自動消去（セレクタ名は残す→同じセレクタの再表示を防ぐ）
  if (highlightFadeTimer) clearTimeout(highlightFadeTimer);
  highlightFadeTimer = setTimeout(function() {
    removeVSCodeHighlight();
  }, 3000);
}

// ハイライト位置を更新（スクロール追従）
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

// VS Codeハイライトを削除
function removeVSCodeHighlight() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
  if (highlightLabel) {
    highlightLabel.remove();
    highlightLabel = null;
  }
  // 万が一残っている古いハイライトも削除
  var highlights = document.querySelectorAll(".css-jumper-vscode-highlight");
  for (var i = 0; i < highlights.length; i++) {
    highlights[i].remove();
  }
  lastHighlightedElement = null;
  window.removeEventListener("scroll", updateHighlightPosition);
}

// ページロード完了時にセクション一覧を事前に取得してメニューを準備
// + Live Serverの場合は自動でプロジェクト切替とCSS取得
function initializeExtension() {
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

    // VS Codeからのブラウザハイライトポーリング開始
    startVSCodeHighlightPolling();
  }
}

// DOMが準備完了していれば即実行、そうでなければloadイベントで実行
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", function() {
    setTimeout(initializeExtension, 100);
  });
} else {
  // 既にDOMロード済み（拡張機能の再読み込み時など）
  setTimeout(initializeExtension, 100);
}

// URLからプロジェクトを自動切替
function autoSwitchProjectFromUrl() {
  var url = window.location.href;

  // Live Serverかどうかをチェック（localhost or 127.0.0.1）
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    return;
  }

  console.log("CSS Jumper: Live Server検出、プロジェクト自動切替チェック");

  // まずVS Codeから現在のプロジェクトパスを取得してみる
  fetchProjectPathFromVSCode(function(vscodePath) {
    if (vscodePath) {
      // VS Codeからパスを取得できた → そのまま使う
      applyProjectPath(vscodePath);
    } else {
      // VS Code連携失敗 → 従来のURL+履歴マッチングにフォールバック
      console.log("CSS Jumper: VS Code連携失敗、URL履歴マッチングにフォールバック");
      fallbackProjectSwitchFromUrl();
    }
  });
}

// VS Codeの /project-path エンドポイントからプロジェクトパスを取得
function fetchProjectPathFromVSCode(callback) {
  fetch("http://127.0.0.1:3848/project-path")
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.projectPath) {
        // Windowsパスを正規化（バックスラッシュ → スラッシュ）
        var normalized = data.projectPath.replace(/\\/g, "/");
        console.log("CSS Jumper: VS Codeからプロジェクトパス取得:", normalized);
        callback(normalized);
      } else {
        callback(null);
      }
    })
    .catch(function(err) {
      console.log("CSS Jumper: VS Code /project-path 取得失敗", err);
      callback(null);
    });
}

// 取得したプロジェクトパスを適用（storage更新 + 履歴追加 + CSS検出）
function applyProjectPath(newPath) {
  chrome.storage.local.get(["projectPath", "pathHistory"], function(result) {
    var currentPath = result.projectPath || "";
    var history = result.pathHistory || [];

    // 既に同じパスなら切替不要
    if (currentPath === newPath) {
      console.log("CSS Jumper: プロジェクトパス変更なし");
      autoDetectCssIfLiveServer();
      return;
    }

    // 履歴に追加（重複除去）
    var newHistory = [newPath];
    for (var i = 0; i < history.length; i++) {
      if (history[i] !== newPath) {
        newHistory.push(history[i]);
      }
    }
    // 履歴は最大10件
    if (newHistory.length > 10) {
      newHistory = newHistory.slice(0, 10);
    }

    var folderName = newPath.split("/").pop();
    console.log("CSS Jumper: プロジェクト自動切替（VS Code連携）:", newPath);
    chrome.storage.local.set({ projectPath: newPath, pathHistory: newHistory }, function() {
      showNotification("✓ プロジェクト自動切替: " + folderName, "success");
      autoDetectCssIfLiveServer();
    });
  });
}

// フォールバック: URLのフォルダ名と履歴からマッチング（従来ロジック）
function fallbackProjectSwitchFromUrl() {
  var url = window.location.href;
  var urlObj = new URL(url);
  var pathname = urlObj.pathname;
  var pathParts = pathname.split("/").filter(function(p) { return p.length > 0; });

  if (pathParts.length === 0) {
    console.log("CSS Jumper: URLからフォルダ名を抽出できません");
    autoDetectCssIfLiveServer();
    return;
  }

  var projectFolderFromUrl = pathParts[0];
  console.log("CSS Jumper: URLから検出したフォルダ名:", projectFolderFromUrl);

  chrome.storage.local.get(["pathHistory", "projectPath"], function(result) {
    var currentPath = result.projectPath || "";
    var history = result.pathHistory || [];

    var currentFolderName = currentPath.split("/").pop();

    if (currentFolderName === projectFolderFromUrl) {
      console.log("CSS Jumper: 既に正しいプロジェクトが設定済み");
      autoDetectCssIfLiveServer();
      return;
    }

    var matchedPath = null;
    for (var i = 0; i < history.length; i++) {
      var historyFolderName = history[i].split("/").pop();
      if (historyFolderName === projectFolderFromUrl) {
        matchedPath = history[i];
        break;
      }
    }

    if (matchedPath) {
      console.log("CSS Jumper: プロジェクト自動切替:", matchedPath);
      chrome.storage.local.set({ projectPath: matchedPath }, function() {
        showNotification("✓ プロジェクト自動切替: " + projectFolderFromUrl, "success");
        autoDetectCssIfLiveServer();
      });
    } else {
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

// VS Codeジャンプの共通処理
// preferMobile: trueの場合、メディアクエリ内を優先検索
function jumpToVSCode(clickedElement, preferMobile) {
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
      break;
    } else if (classAttr && classAttr.baseVal && classAttr.baseVal.trim()) {
      foundClassString = classAttr.baseVal.trim();
      break;
    }

    targetElement = targetElement.parentElement;
  }

  if (!foundId && !foundClassString) {
    console.log("CSS Jumper: IDもクラスもなし");
    showNotification("IDまたはクラスが見つかりません", "error");
    return;
  }

  var classes = foundClassString ? foundClassString.trim().split(/\s+/) : [];
  var className = classes[0] || "";
  var allClasses = classes;

  // ビューポート幅を自動検知してモバイルCSS優先を判定
  // document.documentElement.clientWidth を使用（DevToolsのレスポンシブモード設定を反映）
  var actualWidth = document.documentElement.clientWidth || window.innerWidth;
  var autoDetectMobile = actualWidth <= 767;  // CSSの @media (max-width: 767px) と対応
  var isMobile = preferMobile || autoDetectMobile;

  console.log("CSS Jumper: VS Codeジャンプ", { id: foundId, className: className, tagName: targetElement.tagName, actualWidth: actualWidth, preferMobile: preferMobile, autoDetectMobile: autoDetectMobile, isMobile: isMobile });

  // 拡張機能のコンテキストが有効かチェック
  if (!chrome.runtime || !chrome.runtime.id) {
    console.log("CSS Jumper: 拡張機能のコンテキストが無効です。ページをリロードしてください。");
    showNotification("拡張機能が更新されました。ページをリロードしてください。", "error");
    return;
  }

  // モバイル判定の場合、viewportWidthを768未満に設定してメディアクエリ優先検索を発動
  if (isMobile) {
    showNotification("📱 モバイル版CSSを検索中...", "info");
  }
  var viewportWidth = isMobile ? 767 : actualWidth;

  try {
    chrome.runtime.sendMessage({
      action: "classNameResult",
      id: foundId,
      className: className,
      allClasses: allClasses,
      viewportWidth: viewportWidth
    });
  } catch (e) {
    console.log("CSS Jumper: メッセージ送信エラー", e);
    showNotification("通信エラー: ページをリロードしてください", "error");
  }
}

// localhost / 127.0.0.1 / file:// のみで動作させるガード
function isLocalPage() {
  var host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || location.protocol === "file:";
}

// Alt+クリックでVS Codeを開く / Alt+Shift+クリックでAIアドバイス
document.addEventListener("click", function(event) {
  if (!isLocalPage()) return;

  if (event.altKey && event.shiftKey) {
    // Alt+Shift+クリック → AIアドバイスモード
    event.preventDefault();
    event.stopPropagation();
    handleAiAdviceClick(event.target);
    return;
  }

  if (event.shiftKey && !event.altKey && !event.ctrlKey) {
    // Shift+クリック → CSS説明表示 + ジャンプ
    event.preventDefault();
    event.stopPropagation();
    requestCssExplanationAndJump(event.target);
    return;
  }

  if (event.altKey) {
    event.preventDefault();
    event.stopPropagation();

    // 右クリックで記録した要素を使用（なければクリック要素）
    var clickedElement = lastRightClickedElement || event.target;
    if (!lastRightClickedElement) {
      console.log("CSS Jumper: 右クリック要素なし、クリック要素を使用");
    }

    jumpToVSCode(clickedElement, false);
  }
}, true);

// ダブルクリック時のリンク誤作動防止（300ms遅延方式）
// 仕組み: clickを一旦止め → 300ms以内にdblclickが来たらキャンセル → 来なければリンク実行
var _linkClickPending = null;
document.addEventListener("click", function(event) {
  if (!isLocalPage()) return;
  var anchor = event.target.closest("a[href]");
  if (!anchor) return;

  event.preventDefault();
  // stopPropagation削除: ユーザーのaddeventlistenerが発火しなくなるため

  // 前のタイマーをクリア（2回目のクリックで1回目を上書き）
  if (_linkClickPending) {
    clearTimeout(_linkClickPending.timer);
  }

  var href = anchor.getAttribute("href");
  var linkTarget = anchor.getAttribute("target");

  _linkClickPending = {
    timer: setTimeout(function() {
      _linkClickPending = null;
      if (!href || href === "#") return; // href="" / href="#" は何もしない（JSで処理するボタン対応）
      if (linkTarget === "_blank") {
        window.open(anchor.href, "_blank");
      } else {
        window.location.href = anchor.href;
      }
    }, 300)
  };
}, true);

// clip-pathの値をpx換算する
function parseClipVal(val, size) {
  if (!val) return 0;
  if (val.indexOf("%") !== -1) return parseFloat(val) / 100 * size;
  return parseFloat(val) || 0;
}

// クリック位置がclip-pathの可視領域の「内側」かどうか判定
// 内側 → その要素がターゲット, 外側 → スキップして下の要素へ
function isClickInsideClipPath(el, clientX, clientY) {
  var style = window.getComputedStyle(el);
  var cp = style.clipPath;
  if (!cp || cp === "none") return true;

  var rect = el.getBoundingClientRect();
  var px = clientX - rect.left;
  var py = clientY - rect.top;
  var w = rect.width;
  var h = rect.height;

  // ellipse(rx ry at cx cy)
  var em = cp.match(/^ellipse\(\s*(\S+)\s+(\S+)\s+at\s+(\S+)\s+(\S+)\s*\)/);
  if (em) {
    var rx = parseClipVal(em[1], w);
    var ry = parseClipVal(em[2], h);
    var cx = parseClipVal(em[3], w);
    var cy = parseClipVal(em[4], h);
    return ((px - cx) / rx) * ((px - cx) / rx) + ((py - cy) / ry) * ((py - cy) / ry) <= 1;
  }

  // circle(r at cx cy)
  var cm = cp.match(/^circle\(\s*(\S+)\s+at\s+(\S+)\s+(\S+)\s*\)/);
  if (cm) {
    var r = parseClipVal(cm[1], Math.sqrt((w * w + h * h) / 2));
    var cx = parseClipVal(cm[2], w);
    var cy = parseClipVal(cm[3], h);
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r;
  }

  // inset(top right bottom left) - 矩形クリップ
  var im = cp.match(/^inset\(\s*(\S+)(?:\s+(\S+)(?:\s+(\S+)(?:\s+(\S+))?)?)?\s*(?:round.*)?\/?\s*\)/);
  if (im) {
    var t = parseClipVal(im[1], h);
    var r2 = parseClipVal(im[2] || im[1], w);
    var b = parseClipVal(im[3] || im[1], h);
    var l = parseClipVal(im[4] || (im[2] || im[1]), w);
    return px >= l && px <= w - r2 && py >= t && py <= h - b;
  }

  // polygon や path は計算が複雑 → 内側と見なして通常通りターゲットにする
  return true;
}

// 透明オーバーレイ / clip-path領域外をスキップして意味のある要素を返す
function getBestTarget(event) {
  var target = event.target;
  var disabled = [];
  var maxAttempts = 5;

  // 視覚コンテンツを持つ要素タグ（絶対にスキップしない）
  var VISUAL_TAGS = { IMG: 1, VIDEO: 1, CANVAS: 1, SVG: 1, PICTURE: 1, IFRAME: 1 };

  for (var i = 0; i < maxAttempts; i++) {
    if (!target || target === document.body || target === document.documentElement) break;
    // img/video/canvas等は常に確定（透明でもオーバーレイ扱いしない）
    if (VISUAL_TAGS[target.tagName]) break;
    var style = window.getComputedStyle(target);
    var bg = style.backgroundColor;

    // clip-path: クリック位置が可視領域の外側ならスキップ、内側なら確定
    var hasClipPath = style.clipPath && style.clipPath !== "none";
    if (hasClipPath) {
      if (isClickInsideClipPath(target, event.clientX, event.clientY)) break; // 内側→確定
      // 外側→スキップ
      target.style.pointerEvents = "none";
      disabled.push(target);
      target = document.elementFromPoint(event.clientX, event.clientY);
      continue;
    }

    // 透明なposition付き要素（z-index設定あり）はスキップ
    var isOverlay = (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")
      && style.backgroundImage === "none"
      && style.borderTopWidth === "0px"
      && style.position !== "static"
      && style.zIndex !== "auto";
    if (!isOverlay) break;
    target.style.pointerEvents = "none";
    disabled.push(target);
    target = document.elementFromPoint(event.clientX, event.clientY);
  }

  for (var j = 0; j < disabled.length; j++) {
    disabled[j].style.pointerEvents = "";
  }
  return target || event.target;
}

// ダブルクリックでもVS Codeを開く
// Ctrl+ダブルクリック → モバイル版CSS優先
document.addEventListener("dblclick", function(event) {
  if (!isLocalPage()) return;

  // リンク遅延タイマーをキャンセル（リンク遷移させない）
  if (_linkClickPending) {
    clearTimeout(_linkClickPending.timer);
    _linkClickPending = null;
  }

  event.preventDefault();
  event.stopPropagation();

  var preferMobile = event.ctrlKey;

  // z-indexが高い透明オーバーレイを飛ばして最適な要素を取得
  var bestTarget = getBestTarget(event);

  // デバッグ: クリックされた要素の詳細情報
  console.log("CSS Jumper: ダブルクリック検知", {
    ctrlKey: preferMobile,
    tagName: bestTarget.tagName,
    id: bestTarget.id,
    className: bestTarget.className,
    original: event.target !== bestTarget ? event.target.tagName + " (スキップ)" : "なし"
  });

  if (preferMobile) {
    showNotification("📱 モバイル版CSSを検索中...", "info");
  }

  jumpToVSCode(bestTarget, preferMobile);
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

  // ブラウザで要素をハイライト（3秒間）
  if (message.action === "highlightElement") {
    console.log("CSS Jumper: ハイライトリクエスト", message.selector, message.type);
    highlightElementBySelector(message.type, message.selector);

    // 3秒後に自動消去
    setTimeout(function() {
      removeVSCodeHighlight();
    }, 3000);

    sendResponse({ highlighted: true });
  }

  // Flex情報表示（Ctrl+Alt+F）
  if (message.action === "showFlexInfo") {
    console.log("CSS Jumper: Flex情報表示ON");
    showFlexInfo();
    sendResponse({ shown: true });
  }

  // Flex情報削除（Ctrl+Alt+F）
  if (message.action === "removeFlexInfo") {
    console.log("CSS Jumper: Flex情報表示OFF");
    removeFlexInfo();
    sendResponse({ removed: true });
  }

  // ボックスモデル表示トグル（Alt+K）
  if (message.action === "toggleBoxModel") {
    if (boxModelActive) {
      removeBoxModelOverlay();
      chrome.storage.local.set({ boxModelEnabled: false });
      showNotification("ボックスモデル表示: OFF", "success");
    } else {
      enableBoxModelOverlay();
      chrome.storage.local.set({ boxModelEnabled: true });
      showNotification("ボックスモデル表示: ON ✓", "success");
    }
    sendResponse({ active: boxModelActive });
  }

  // 配置方法を解析（トグル）
  if (message.action === "analyzeLayout") {
    toggleLayoutAnalysis();
    sendResponse({ analyzed: true });
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

// Flex/Grid階層の深さを計算（親のflex/gridコンテナを何個持つか）
function getFlexDepth(elem) {
  var depth = 0;
  var parent = elem.parentElement;
  while (parent) {
    if (parent.classList && (
      parent.classList.contains("css-jumper-flex-info") ||
      parent.classList.contains("css-jumper-grid-info") ||
      parent.classList.contains("css-jumper-size-overlay") ||
      parent.classList.contains("css-jumper-spacing-overlay") ||
      parent.classList.contains("css-jumper-outline")
    )) {
      parent = parent.parentElement;
      continue;
    }
    var parentStyle = window.getComputedStyle(parent);
    var d = parentStyle.display;
    if (d === "flex" || d === "inline-flex" || d === "grid" || d === "inline-grid") {
      depth++;
    }
    parent = parent.parentElement;
  }
  return depth;
}

// 要素のクラス名またはIDを取得（表示用）
function getElemSelector(elem) {
  if (elem.id) return "#" + elem.id;
  if (elem.classList && elem.classList.length > 0) {
    for (var i = 0; i < elem.classList.length; i++) {
      if (!elem.classList[i].startsWith("css-jumper-")) {
        return "." + elem.classList[i];
      }
    }
  }
  return elem.tagName.toLowerCase();
}

// Flex情報を表示
function showFlexInfo() {
  // 既存のFlex情報ラベルを削除
  removeFlexInfo();

  console.log("CSS Jumper: Flex情報表示開始");

  // 深さごとの色
  var depthColors = [
    "rgba(156, 39, 176, 0.9)",   // 深さ0: 紫
    "rgba(33, 150, 243, 0.9)",   // 深さ1: 青
    "rgba(76, 175, 80, 0.9)",    // 深さ2: 緑
    "rgba(255, 152, 0, 0.9)",    // 深さ3: オレンジ
    "rgba(244, 67, 54, 0.9)",    // 深さ4: 赤
    "rgba(0, 188, 212, 0.9)"     // 深さ5+: シアン
  ];

  var elements = document.querySelectorAll("*");
  var flexCount = 0;
  var labelHeight = 26; // ラベル1個の高さ(padding含む)
  var labelGap = 2;     // ラベル間の隙間
  var placedLabels = []; // 配置済みラベルの位置記録 [{left, top, width}]

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

    // FlexまたはGridコンテナのみ対象
    var isFlex = style.display === "flex" || style.display === "inline-flex";
    var isGrid = style.display === "grid" || style.display === "inline-grid";
    if (!isFlex && !isGrid) {
      return;
    }

    var rect = elem.getBoundingClientRect();

    // 小さすぎる要素は除外
    if (rect.width < 30 || rect.height < 20) {
      return;
    }

    // 階層の深さを計算
    var depth = getFlexDepth(elem);

    // └記号を深さ分繰り返す
    var treePrefix = "";
    for (var d = 0; d < depth; d++) {
      treePrefix += "\u2514";
    }
    if (treePrefix) treePrefix += " ";

    // クラス名/IDを取得
    var selector = getElemSelector(elem);

    var labelText, bgColor, labelClass;

    if (isFlex) {
      // Flex情報を収集
      var dir = style.flexDirection;
      var dirLabel = "横";
      if (dir === "column" || dir === "column-reverse") {
        dirLabel = "縦";
      }
      labelText = treePrefix + "flex " + dirLabel + "  " + selector;
      bgColor = depthColors[Math.min(depth, depthColors.length - 1)];
      labelClass = "css-jumper-flex-info";
    } else {
      // Grid情報を収集
      var cols = style.gridTemplateColumns ? style.gridTemplateColumns.trim().split(/\s+/).filter(function(s) { return s.length > 0; }).length : 0;
      var rows = style.gridTemplateRows ? style.gridTemplateRows.trim().split(/\s+/).filter(function(s) { return s.length > 0; }).length : 0;
      var gridDesc = cols > 0 ? cols + "列" : "";
      if (rows > 0) gridDesc += (gridDesc ? " " : "") + rows + "行";
      labelText = treePrefix + "grid " + gridDesc + "  " + selector;
      bgColor = "rgba(0, 150, 136, 0.9)"; // teal（Flexと区別）
      labelClass = "css-jumper-grid-info";
    }

    // 画面からはみ出さないよう位置調整
    var labelLeft = rect.left + window.scrollX;
    if (labelLeft < 5) labelLeft = 5;
    var labelTop = rect.top + window.scrollY - 28;

    // 重なり回避: 既に配置済みラベルと被ったら下にズラす
    var labelWidth = labelText.length * 8 + 20; // 大まかな幅推定
    var shifted = true;
    while (shifted) {
      shifted = false;
      for (var p = 0; p < placedLabels.length; p++) {
        var placed = placedLabels[p];
        // 横方向が重なっているか
        var horizOverlap = labelLeft < placed.left + placed.width && labelLeft + labelWidth > placed.left;
        // 縦方向が重なっているか
        var vertOverlap = Math.abs(labelTop - placed.top) < labelHeight + labelGap;
        if (horizOverlap && vertOverlap) {
          labelTop = placed.top + labelHeight + labelGap;
          shifted = true;
        }
      }
    }

    // 配置位置を記録
    placedLabels.push({ left: labelLeft, top: labelTop, width: labelWidth });

    // ラベルを作成
    var label = document.createElement("div");
    label.className = labelClass;
    label.textContent = labelText;

    // クリックでCSS定義へジャンプ用のデータを保存
    var elemId = elem.id || "";
    var elemClassString = "";
    var classAttr = elem.className;
    if (typeof classAttr === "string") {
      elemClassString = classAttr.replace(/css-jumper-\S*/g, "").trim();
    } else if (classAttr && classAttr.baseVal) {
      elemClassString = classAttr.baseVal.replace(/css-jumper-\S*/g, "").trim();
    }
    label.dataset.elemId = elemId;
    label.dataset.elemClasses = elemClassString;

    label.style.cssText =
      "position: absolute !important;" +
      "left: " + labelLeft + "px !important;" +
      "top: " + labelTop + "px !important;" +
      "background: " + bgColor + " !important;" +
      "color: white !important;" +
      "padding: 4px 10px !important;" +
      "font-size: 13px !important;" +
      "font-family: 'Segoe UI', sans-serif !important;" +
      "border-radius: 4px !important;" +
      "z-index: 999995 !important;" +
      "pointer-events: auto !important;" +
      "cursor: pointer !important;" +
      "white-space: nowrap !important;" +
      "box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;";

    // クリックでCSS定義へジャンプ（Native Messaging経由）
    label.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.dataset.elemId;
      var classStr = this.dataset.elemClasses;
      var classes = classStr ? classStr.trim().split(/\s+/) : [];
      var firstClass = classes[0] || "";

      if (!id && !firstClass) {
        showNotification("IDまたはクラスが見つかりません", "error");
        return;
      }

      if (!chrome.runtime || !chrome.runtime.id) {
        showNotification("拡張機能が更新されました。ページをリロードしてください。", "error");
        return;
      }

      // ビューポート幅を自動検知（DevToolsのレスポンシブモード対応）
      var actualWidth = document.documentElement.clientWidth || window.innerWidth;
      var isMobile = actualWidth <= 767;
      if (isMobile) {
        showNotification("📱 モバイル版CSSを検索中...", "info");
      }

      try {
        chrome.runtime.sendMessage({
          action: "classNameResult",
          id: id,
          className: firstClass,
          allClasses: classes,
          viewportWidth: isMobile ? 767 : actualWidth
        });
      } catch (err) {
        showNotification("通信エラー: ページをリロードしてください", "error");
      }
    });

    // ダブルクリックでもVS Codeを開く（Ctrl+ダブルクリックでモバイル版CSS優先）
    label.addEventListener("dblclick", function(e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.dataset.elemId;
      var classStr = this.dataset.elemClasses;
      var classes = classStr ? classStr.trim().split(/\s+/) : [];
      var firstClass = classes[0] || "";

      if (!id && !firstClass) {
        showNotification("IDまたはクラスが見つかりません", "error");
        return;
      }

      if (!chrome.runtime || !chrome.runtime.id) {
        showNotification("拡張機能が更新されました。ページをリロードしてください。", "error");
        return;
      }

      // ビューポート幅を自動検知 + Ctrl押下判定
      var actualWidth = document.documentElement.clientWidth || window.innerWidth;
      var autoDetectMobile = actualWidth <= 767;
      var ctrlPressed = e.ctrlKey;
      var isMobile = ctrlPressed || autoDetectMobile;

      if (isMobile) {
        showNotification("📱 モバイル版CSSを検索中...", "info");
      }

      try {
        chrome.runtime.sendMessage({
          action: "classNameResult",
          id: id,
          className: firstClass,
          allClasses: classes,
          viewportWidth: isMobile ? 767 : actualWidth
        });
      } catch (err) {
        showNotification("通信エラー: ページをリロードしてください", "error");
      }
    });

    document.body.appendChild(label);
    flexCount++;

    // Gridの場合：セルに枠線オーバーレイを描画
    if (isGrid) {
      // グリッドコンテナ自体に外枠
      var containerOverlay = document.createElement("div");
      containerOverlay.className = "css-jumper-grid-info";
      containerOverlay.style.cssText =
        "position:absolute !important;" +
        "pointer-events:none !important;" +
        "z-index:999993 !important;" +
        "border:2px dashed rgba(0,150,136,0.8) !important;" +
        "left:" + (rect.left + window.scrollX) + "px !important;" +
        "top:" + (rect.top + window.scrollY) + "px !important;" +
        "width:" + rect.width + "px !important;" +
        "height:" + rect.height + "px !important;";
      document.body.appendChild(containerOverlay);

      // 各セル（直接の子要素）に点線枠
      var children = elem.children;
      for (var ci = 0; ci < children.length; ci++) {
        var child = children[ci];
        if (child.classList && (
          child.classList.contains("css-jumper-flex-info") ||
          child.classList.contains("css-jumper-grid-info")
        )) continue;
        var childRect = child.getBoundingClientRect();
        if (childRect.width < 5 || childRect.height < 5) continue;
        var cellOverlay = document.createElement("div");
        cellOverlay.className = "css-jumper-grid-info";
        cellOverlay.style.cssText =
          "position:absolute !important;" +
          "pointer-events:none !important;" +
          "z-index:999992 !important;" +
          "border:1px dashed rgba(0,150,136,0.5) !important;" +
          "background:rgba(0,150,136,0.04) !important;" +
          "left:" + (childRect.left + window.scrollX) + "px !important;" +
          "top:" + (childRect.top + window.scrollY) + "px !important;" +
          "width:" + childRect.width + "px !important;" +
          "height:" + childRect.height + "px !important;";
        document.body.appendChild(cellOverlay);
      }
    }
  });

  flexInfoVisible = true;
  console.log("CSS Jumper: Flex情報表示完了", flexCount + "件");

  // 通知は手動実行時のみ（自動リロード時にうるさいため削除）
}

// Flex/Grid情報を削除
function removeFlexInfo() {
  var labels = document.querySelectorAll(".css-jumper-flex-info, .css-jumper-grid-info");
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
// ========================================
// AI CSSアドバイス機能
// ========================================

// Alt+Shift+クリック時の処理
function handleAiAdviceClick(clickedElement) {
  // CSS Jumperのオーバーレイ自体は無視
  if (clickedElement.closest && clickedElement.closest("[id^='css-jumper']")) {
    return;
  }

  // 要素情報を収集
  var elementInfo = collectElementInfo(clickedElement);
  console.log("CSS Jumper: AIアドバイス - 要素情報", elementInfo);

  // 要素をハイライト
  highlightForAdvice(clickedElement);

  // テキスト入力UIを表示
  showAdviceInputUI(clickedElement, elementInfo);
}

// 要素のcomputedStyleを含む情報を収集
function collectElementInfo(el) {
  var cs = window.getComputedStyle(el);
  var parent = el.parentElement;
  var parentCs = parent ? window.getComputedStyle(parent) : null;

  var classList = "";
  if (typeof el.className === "string") {
    classList = el.className.trim();
  } else if (el.className && el.className.baseVal) {
    classList = el.className.baseVal.trim();
  }

  var parentClass = "";
  if (parent) {
    if (typeof parent.className === "string") {
      parentClass = parent.className.trim();
    } else if (parent.className && parent.className.baseVal) {
      parentClass = parent.className.baseVal.trim();
    }
  }

  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || "",
    classList: classList,
    display: cs.display,
    position: cs.position,
    width: cs.width,
    height: cs.height,
    padding: cs.padding,
    margin: cs.margin,
    flex: cs.flex,
    flexDirection: cs.display === "flex" || cs.display === "inline-flex" ? cs.flexDirection : "",
    justifyContent: cs.display === "flex" || cs.display === "inline-flex" ? cs.justifyContent : "",
    alignItems: cs.display === "flex" || cs.display === "inline-flex" ? cs.alignItems : "",
    gap: cs.gap || "",
    overflow: cs.overflow,
    boxSizing: cs.boxSizing,
    parentTagName: parent ? parent.tagName.toLowerCase() : "",
    parentClass: parentClass,
    parentDisplay: parentCs ? parentCs.display : "",
    parentFlexDirection: parentCs && (parentCs.display === "flex" || parentCs.display === "inline-flex") ? parentCs.flexDirection : "",
    viewportWidth: window.innerWidth
  };
}

// アドバイス対象要素をハイライト
function highlightForAdvice(el) {
  removeAdviceHighlight();
  el.style.outline = "3px solid #ff6b00";
  el.style.outlineOffset = "2px";
  el.dataset.cssJumperAdviceHighlight = "true";
}

// アドバイスハイライトを削除
function removeAdviceHighlight() {
  var highlighted = document.querySelector("[data-css-jumper-advice-highlight]");
  if (highlighted) {
    highlighted.style.outline = "";
    highlighted.style.outlineOffset = "";
    delete highlighted.dataset.cssJumperAdviceHighlight;
  }
}

// テキスト入力UI表示
function showAdviceInputUI(el, elementInfo) {
  // 既存のUIを削除
  removeAdviceUI();

  var rect = el.getBoundingClientRect();

  // オーバーレイコンテナ
  var container = document.createElement("div");
  container.id = "css-jumper-advice-ui";
  container.style.cssText =
    "position: fixed;" +
    "z-index: 999999;" +
    "background: #1e1e2e;" +
    "border: 2px solid #ff6b00;" +
    "border-radius: 12px;" +
    "padding: 16px;" +
    "box-shadow: 0 8px 32px rgba(0,0,0,0.5);" +
    "font-family: 'Segoe UI', sans-serif;" +
    "color: #cdd6f4;" +
    "width: 360px;" +
    "max-height: 80vh;" +
    "overflow-y: auto;";

  // 位置計算（要素の下、画面外なら上に）
  var top = rect.bottom + window.scrollY + 8;
  var left = rect.left + window.scrollX;
  if (rect.bottom + 250 > window.innerHeight) {
    top = rect.top + window.scrollY - 250;
  }
  if (left + 380 > window.innerWidth) {
    left = window.innerWidth - 390;
  }
  if (left < 10) left = 10;

  container.style.top = top + "px";
  container.style.left = left + "px";
  container.style.position = "absolute";

  // 要素情報ヘッダー
  var selectorText = elementInfo.classList ? "." + elementInfo.classList.split(" ")[0] : elementInfo.tagName;
  if (elementInfo.id) selectorText = "#" + elementInfo.id;

  var header = document.createElement("div");
  header.style.cssText = "font-size: 13px; color: #ff6b00; margin-bottom: 8px; font-weight: bold;";
  header.textContent = "🤖 " + selectorText + " (" + elementInfo.display + ", " + elementInfo.width + " × " + elementInfo.height + ")";
  container.appendChild(header);

  // 親情報
  var parentInfo = document.createElement("div");
  parentInfo.style.cssText = "font-size: 11px; color: #6c7086; margin-bottom: 12px;";
  var parentLabel = elementInfo.parentClass ? "." + elementInfo.parentClass.split(" ")[0] : elementInfo.parentTagName;
  parentInfo.textContent = "親: " + parentLabel + " (" + elementInfo.parentDisplay + ")";
  container.appendChild(parentInfo);

  // テキスト入力
  var input = document.createElement("input");
  input.type = "text";
  input.placeholder = "例: 幅を広げたい / 横並びにしたい / 中央寄せ";
  input.style.cssText =
    "width: 100%;" +
    "padding: 10px 12px;" +
    "border: 1px solid #45475a;" +
    "border-radius: 8px;" +
    "background: #313244;" +
    "color: #cdd6f4;" +
    "font-size: 14px;" +
    "box-sizing: border-box;" +
    "outline: none;";
  input.addEventListener("focus", function() {
    input.style.borderColor = "#ff6b00";
  });
  input.addEventListener("blur", function() {
    input.style.borderColor = "#45475a";
  });
  container.appendChild(input);

  // ボタン行
  var btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 10px;";

  var askBtn = document.createElement("button");
  askBtn.textContent = "🔍 聞く";
  askBtn.style.cssText =
    "flex: 1; padding: 8px; border: none; border-radius: 6px;" +
    "background: #ff6b00; color: #fff; font-size: 14px; font-weight: bold;" +
    "cursor: pointer;";

  var closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText =
    "padding: 8px 14px; border: 1px solid #45475a; border-radius: 6px;" +
    "background: transparent; color: #cdd6f4; font-size: 14px;" +
    "cursor: pointer;";

  btnRow.appendChild(askBtn);
  btnRow.appendChild(closeBtn);
  container.appendChild(btnRow);

  // 回答表示エリア（初期は非表示）
  var answerArea = document.createElement("div");
  answerArea.id = "css-jumper-advice-answer";
  answerArea.style.cssText =
    "margin-top: 12px; padding: 12px; background: #313244; border-radius: 8px;" +
    "font-size: 13px; line-height: 1.6; white-space: pre-wrap; display: none;";
  container.appendChild(answerArea);

  document.body.appendChild(container);

  // フォーカス
  setTimeout(function() { input.focus(); }, 50);

  // Enterキーで送信
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && input.value.trim()) {
      sendAdviceRequest(input.value.trim(), elementInfo, answerArea, askBtn);
    }
    if (e.key === "Escape") {
      removeAdviceUI();
      removeAdviceHighlight();
    }
  });

  // ボタンイベント
  askBtn.addEventListener("click", function() {
    if (input.value.trim()) {
      sendAdviceRequest(input.value.trim(), elementInfo, answerArea, askBtn);
    }
  });

  closeBtn.addEventListener("click", function() {
    removeAdviceUI();
    removeAdviceHighlight();
  });
}

// AIにリクエスト送信
function sendAdviceRequest(question, elementInfo, answerArea, askBtn) {
  answerArea.style.display = "block";
  answerArea.textContent = "🔄 AIに質問中...";
  answerArea.style.color = "#6c7086";
  askBtn.disabled = true;
  askBtn.textContent = "⏳ 待機中...";

  chrome.runtime.sendMessage({
    action: "aiAdviceRequest",
    userQuestion: question,
    elementInfo: elementInfo
  }, function(response) {
    askBtn.disabled = false;
    askBtn.textContent = "🔍 聞く";

    if (chrome.runtime.lastError) {
      answerArea.style.color = "#f38ba8";
      answerArea.textContent = "❌ 通信エラー: " + chrome.runtime.lastError.message;
      return;
    }

    if (response && response.error) {
      answerArea.style.color = "#f38ba8";
      answerArea.textContent = "❌ " + response.error;
      return;
    }

    if (response && response.answer) {
      answerArea.style.color = "#cdd6f4";
      answerArea.textContent = response.answer;
    }
  });
}

// アドバイスUIを削除
function removeAdviceUI() {
  var existing = document.getElementById("css-jumper-advice-ui");
  if (existing) existing.remove();
}

// ========================================
// 通知表示
// ========================================

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

// ========================================
// Ctrl+クリック → CSS説明表示 + ジャンプ
// ========================================
function requestCssExplanationAndJump(element) {
  console.log("CSS Jumper: CSS説明リクエスト", element);
  
  // ユーザーに修正内容を聞く
  var userRequest = window.prompt("どのような修正をしたいですか？\n(例: 背景を赤くしたい、スマホで非表示にしたい)");
  
  if (userRequest === null) {
    return; // キャンセル
  }
  
  // クラス名・ID・タグ名を取得
  var className = element.className || "";
  var id = element.id || "";
  var tagName = element.tagName.toLowerCase();
  
  // HTMLコンテキスト収集（より広い範囲を取得）
  var htmlContext = "";
  
  // セクションまたは主要なコンテナを探す
  var container = element.closest('section, article, main, header, footer, div.container, body');
  if (!container) container = document.body;
  
  // コンテナ内のHTMLを取得（長すぎる場合は制限）
  if (container) {
    // 自分自身を特定するためのマーカーを追加したHTMLを作成
    var originalId = element.id;
    if (!originalId) {
      element.id = "css-jumper-target-" + Date.now();
    }
    
    // クローンを作成してターゲットをマーク
    var clone = container.cloneNode(true);
    var targetInClone = clone.querySelector("#" + element.id);
    if (!element.id.startsWith("css-jumper-target-")) {
        // 元々IDがあった場合はセレクタで探す
        if (originalId) targetInClone = clone.querySelector("#" + originalId);
        else if (className) targetInClone = clone.querySelector("." + className.split(" ")[0]);
    }
    
    if (targetInClone) {
        targetInClone.setAttribute("data-target-element", "true");
        targetInClone.innerHTML = "<!-- ターゲット要素 -->" + targetInClone.innerHTML;
    }
    
    htmlContext = clone.outerHTML;
    
    // 一時的なIDを削除
    if (!originalId) {
      element.removeAttribute("id");
    }
    
    // 文字数制限（約10000文字）
    if (htmlContext.length > 10000) {
      htmlContext = htmlContext.substring(0, 10000) + "...(truncated)";
    }
  }
  
  // 通知表示
  showNotification("🤖 CSS修正案を生成中...", "info");

  // background scriptに説明リクエスト送信
  chrome.runtime.sendMessage({
    action: "explainAndJump",
    className: className,
    id: id,
    tagName: tagName,
    htmlContext: htmlContext,
    userRequest: userRequest  // ユーザーの要望を追加
  }, function(response) {
    if (response && response.success) {
      showNotification("✅ 修正案を表示しました", "success");
    } else {
      showNotification("❌ 生成に失敗しました", "error");
    }
  });
}

// ========================================
// ボックスモデル表示（Alt+K）
// ========================================
var boxModelActive = false;
var boxModelOverlay = null;
var boxModelLabel = null;
var boxModelCurrentTarget = null;
var boxModelEdgeContainer = null;
var distanceFirstEl = null;
var distanceOverlays = [];
var viewportPresetBar = null;
var originalWindowSize = null; // Alt+A ON前のサイズ
var boxModelResizeHandler = null;

function enableBoxModelOverlay() {
  boxModelActive = true;

  // オーバーレイ用のコンテナ（margin/padding/content の色分け表示）
  boxModelOverlay = document.createElement("div");
  boxModelOverlay.id = "css-jumper-boxmodel-overlay";
  boxModelOverlay.style.cssText = "position:absolute;pointer-events:none;z-index:2147483646;display:none;";
  document.body.appendChild(boxModelOverlay);

  // ラベル（数値表示）- position:fixedで確実に表示
  boxModelLabel = document.createElement("div");
  boxModelLabel.id = "css-jumper-boxmodel-label";
  boxModelLabel.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;" +
    "background:rgba(0,0,0,0.9);color:#fff;font:14px/1.5 monospace;padding:10px 14px;border-radius:4px;" +
    "white-space:pre;max-width:400px;border:1px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(0,0,0,0.5);";
  document.body.appendChild(boxModelLabel);

  // 画面端距離用SVGコンテナ（position:fixedで画面に固定）
  boxModelEdgeContainer = document.createElement("div");
  boxModelEdgeContainer.id = "css-jumper-boxmodel-edge";
  boxModelEdgeContainer.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645;left:0;top:0;width:100%;height:100%;display:none;";
  document.body.appendChild(boxModelEdgeContainer);

  document.addEventListener("mousemove", boxModelMouseMove, true);
  document.addEventListener("scroll", boxModelHide, true);
  document.addEventListener("click", boxModelDistanceClick, true);

  // ビューポートプリセットバー表示 + 自動リサイズ
  showViewportPresetBar();
  applyStoredViewport();
}

function removeBoxModelOverlay() {
  boxModelActive = false;
  document.removeEventListener("mousemove", boxModelMouseMove, true);
  document.removeEventListener("scroll", boxModelHide, true);
  document.removeEventListener("click", boxModelDistanceClick, true);
  if (boxModelOverlay) { boxModelOverlay.remove(); boxModelOverlay = null; }
  if (boxModelLabel) { boxModelLabel.remove(); boxModelLabel = null; }
  if (boxModelEdgeContainer) { boxModelEdgeContainer.remove(); boxModelEdgeContainer = null; }
  if (viewportPresetBar) { viewportPresetBar.remove(); viewportPresetBar = null; }
  boxModelCurrentTarget = null;
  clearDistanceOverlays();
  distanceFirstEl = null;

  // 元のウィンドウサイズに復元
  restoreOriginalWindowSize();
}

function boxModelHide() {
  if (boxModelOverlay) { boxModelOverlay.style.display = "none"; }
  if (boxModelLabel) { boxModelLabel.style.display = "none"; }
  if (boxModelEdgeContainer) { boxModelEdgeContainer.style.display = "none"; }
  boxModelCurrentTarget = null;
}

function boxModelMouseMove(e) {
  // 距離計測中はホバー表示を一時停止
  if (distanceFirstEl || distanceOverlays.length > 0) { return; }

  var el = e.target;

  // 自分自身のオーバーレイは無視
  if (!el || el.id === "css-jumper-boxmodel-overlay" || el.id === "css-jumper-boxmodel-label" ||
      el.closest("#css-jumper-boxmodel-overlay") || el.closest("#css-jumper-boxmodel-label")) {
    return;
  }
  // CSS Jumperの通知やFlexラベルも無視
  if (el.closest(".css-jumper-notification") || el.closest("[data-cssjumper-flex]")) {
    return;
  }


  // 同じ要素ならラベル位置だけ更新
  if (el === boxModelCurrentTarget) {
    if (boxModelLabel && boxModelLabel.style.display === "block") {
      updateBoxModelLabelPos(e);
    }
    return;
  }
  boxModelCurrentTarget = el;

  var style = window.getComputedStyle(el);
  var rect = el.getBoundingClientRect();
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;

  // margin値
  var mt = parseFloat(style.marginTop) || 0;
  var mr = parseFloat(style.marginRight) || 0;
  var mb = parseFloat(style.marginBottom) || 0;
  var ml = parseFloat(style.marginLeft) || 0;

  // padding値
  var pt = parseFloat(style.paddingTop) || 0;
  var pr = parseFloat(style.paddingRight) || 0;
  var pb = parseFloat(style.paddingBottom) || 0;
  var pl = parseFloat(style.paddingLeft) || 0;

  // border値
  var bt = parseFloat(style.borderTopWidth) || 0;
  var br2 = parseFloat(style.borderRightWidth) || 0;
  var bb = parseFloat(style.borderBottomWidth) || 0;
  var bl = parseFloat(style.borderLeftWidth) || 0;

  // gap値（flex/grid コンテナの場合）
  var rowGap = parseFloat(style.rowGap) || 0;
  var colGap = parseFloat(style.columnGap) || 0;
  var isFlex = style.display === "flex" || style.display === "inline-flex";
  var isGrid = style.display === "grid" || style.display === "inline-grid";
  var hasGap = (isFlex || isGrid) && (rowGap > 0 || colGap > 0);

  // content size
  var cw = rect.width - pl - pr - bl - br2;
  var ch = rect.height - pt - pb - bt - bb;

  // オーバーレイ描画（marginエリア全体をカバー）
  var overlayLeft = rect.left + scrollX - ml;
  var overlayTop = rect.top + scrollY - mt;
  var overlayWidth = ml + rect.width + mr;
  var overlayHeight = mt + rect.height + mb;

  // box-shadow で margin(オレンジ), border(黄), padding(緑), content(青) を表現
  boxModelOverlay.style.display = "block";
  boxModelOverlay.style.left = (rect.left + scrollX) + "px";
  boxModelOverlay.style.top = (rect.top + scrollY) + "px";
  boxModelOverlay.style.width = rect.width + "px";
  boxModelOverlay.style.height = rect.height + "px";

  // 内部を色分け表示
  boxModelOverlay.innerHTML = "";

  // margin overlay（オレンジ）
  if (mt > 0 || mr > 0 || mb > 0 || ml > 0) {
    var marginDiv = document.createElement("div");
    marginDiv.style.cssText = "position:absolute;pointer-events:none;" +
      "left:" + (-ml) + "px;top:" + (-mt) + "px;" +
      "width:" + overlayWidth + "px;height:" + overlayHeight + "px;" +
      "background:rgba(255,165,0,0.25);";
    boxModelOverlay.appendChild(marginDiv);
  }

  // element area（marginの色を打ち消す）
  var elemClear = document.createElement("div");
  elemClear.style.cssText = "position:absolute;pointer-events:none;" +
    "left:0;top:0;width:" + rect.width + "px;height:" + rect.height + "px;" +
    "background:rgba(255,165,0,0.001);";
  boxModelOverlay.appendChild(elemClear);

  // padding overlay（緑）
  if (pt > 0 || pr > 0 || pb > 0 || pl > 0) {
    var paddingDiv = document.createElement("div");
    paddingDiv.style.cssText = "position:absolute;pointer-events:none;" +
      "left:" + bl + "px;top:" + bt + "px;" +
      "width:" + (rect.width - bl - br2) + "px;height:" + (rect.height - bt - bb) + "px;" +
      "background:rgba(0,180,0,0.25);";
    boxModelOverlay.appendChild(paddingDiv);
  }

  // content area（青）
  var contentDiv = document.createElement("div");
  contentDiv.style.cssText = "position:absolute;pointer-events:none;" +
    "left:" + (bl + pl) + "px;top:" + (bt + pt) + "px;" +
    "width:" + Math.max(0, cw) + "px;height:" + Math.max(0, ch) + "px;" +
    "background:rgba(100,150,255,0.25);";
  boxModelOverlay.appendChild(contentDiv);

  // gap表示（紫）- flex/gridコンテナの子要素間の隙間
  if (hasGap) {
    var children = el.children;
    var flexDir = style.flexDirection || "row";
    var isColumn = flexDir === "column" || flexDir === "column-reverse";
    var contentLeft = bl + pl;
    var contentTop = bt + pt;

    for (var ci = 0; ci < children.length; ci++) {
      var child = children[ci];
      var childStyle = window.getComputedStyle(child);
      if (childStyle.position === "absolute" || childStyle.position === "fixed" || childStyle.display === "none") { continue; }

      var childRect = child.getBoundingClientRect();
      var childRelX = childRect.left - rect.left;
      var childRelY = childRect.top - rect.top;

      // 子要素の後ろにgap領域を描画（最後の子以外）
      if (ci < children.length - 1) {
        var gapDiv = document.createElement("div");
        if (isFlex && isColumn || isGrid) {
          // 縦方向gap（row-gap）
          if (rowGap > 0) {
            gapDiv.style.cssText = "position:absolute;pointer-events:none;" +
              "left:" + contentLeft + "px;" +
              "top:" + (childRelY + childRect.height) + "px;" +
              "width:" + Math.max(0, cw) + "px;height:" + rowGap + "px;" +
              "background:rgba(180,0,255,0.25);";
            boxModelOverlay.appendChild(gapDiv);
          }
        }
        if (isFlex && !isColumn || isGrid) {
          // 横方向gap（column-gap）
          if (colGap > 0) {
            gapDiv.style.cssText = "position:absolute;pointer-events:none;" +
              "left:" + (childRelX + childRect.width) + "px;" +
              "top:" + contentTop + "px;" +
              "width:" + colGap + "px;height:" + Math.max(0, ch) + "px;" +
              "background:rgba(180,0,255,0.25);";
            boxModelOverlay.appendChild(gapDiv);
          }
        }
      }
    }
  }

  // ラベル表示
  var selector = getElemSelector(el);
  var lines = [];
  lines.push("📦 " + selector);
  lines.push("─────────────────────");

  if (mt > 0 || mr > 0 || mb > 0 || ml > 0) {
    lines.push("🟠 margin:  " + formatBoxValues(mt, mr, mb, ml));
  }
  if (bt > 0 || br2 > 0 || bb > 0 || bl > 0) {
    lines.push("🟡 border:  " + formatBoxValues(bt, br2, bb, bl));
  }
  if (pt > 0 || pr > 0 || pb > 0 || pl > 0) {
    lines.push("🟢 padding: " + formatBoxValues(pt, pr, pb, pl));
  }
  lines.push("🔵 content: " + Math.round(cw) + " × " + Math.round(ch));
  if (hasGap) {
    var gapText = rowGap === colGap ? Math.round(rowGap) + "px" : "row:" + Math.round(rowGap) + "px col:" + Math.round(colGap) + "px";
    lines.push("🟣 gap:     " + gapText);
  }

  // 主要プロパティも表示
  var display = style.display;
  var position = style.position;
  if (display !== "block" && display !== "inline") {
    lines.push("   display: " + display);
  }
  if (position !== "static") {
    lines.push("   position: " + position);
  }

  // フォント・色情報
  var fontSize = style.fontSize;
  if (fontSize) {
    lines.push("   font-size: " + Math.round(parseFloat(fontSize)) + "px");
  }
  var fontWeight = style.fontWeight;
  if (fontWeight && fontWeight !== "400" && fontWeight !== "normal") {
    lines.push("   font-weight: " + fontWeight);
  }
  var color = style.color;
  if (color) {
    lines.push("   color: " + rgbToHex(color));
  }

  boxModelLabel.textContent = lines.join("\n");
  boxModelLabel.style.display = "block";
  updateBoxModelLabelPos(e);

  // 画面端 + 親コンテナからの距離線を描画
  drawEdgeDistanceLines(rect, el);
}

function drawEdgeDistanceLines(rect, el) {
  if (!boxModelEdgeContainer) { return; }
  var viewW = document.documentElement.clientWidth;
  var viewH = window.innerHeight;

  var eTop = Math.round(rect.top);
  var eBottom = Math.round(viewH - rect.bottom);
  var eLeft = Math.round(rect.left);
  var eRight = Math.round(viewW - rect.right);

  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;

  // SVGを毎回作り直し
  boxModelEdgeContainer.innerHTML = "";
  boxModelEdgeContainer.style.display = "block";

  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", viewW);
  svg.setAttribute("height", viewH);
  svg.style.cssText = "position:absolute;left:0;top:0;";

  var lineColor = "#FF3333";

  // 先に隣接要素を検出（どの方向に隣接要素があるか）
  var hasNeighbor = drawNeighborDistances(svg, rect, el);

  // 画面端からの距離（隣接要素がない方向のみ）
  // 上
  if (eTop > 3 && !hasNeighbor.top) {
    drawEdgeLine(svg, cx, rect.top, cx, 0, lineColor);
    drawEdgeLabel(svg, cx + 6, rect.top / 2 + 4, eTop + "px", lineColor);
  }
  // 下
  if (eBottom > 3 && !hasNeighbor.bottom) {
    drawEdgeLine(svg, cx, rect.bottom, cx, viewH, lineColor);
    drawEdgeLabel(svg, cx + 6, rect.bottom + (viewH - rect.bottom) / 2 + 4, eBottom + "px", lineColor);
  }
  // 左
  if (eLeft > 3 && !hasNeighbor.left) {
    drawEdgeLine(svg, rect.left, cy, 0, cy, lineColor);
    drawEdgeLabel(svg, rect.left / 2, cy - 8, eLeft + "px", lineColor, true);
  }
  // 右
  if (eRight > 3 && !hasNeighbor.right) {
    drawEdgeLine(svg, rect.right, cy, viewW, cy, lineColor);
    drawEdgeLabel(svg, rect.right + (viewW - rect.right) / 2, cy - 8, eRight + "px", lineColor, true);
  }

  boxModelEdgeContainer.appendChild(svg);
}

// 上下左右の距離を描画（兄弟要素 or 親padding距離）
function drawNeighborDistances(svg, rect, el) {
  var siblingColor = "#4488FF"; // 兄弟要素: 青
  var paddingColor = "#22CC66"; // 親padding: 緑
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;
  var hasNeighbor = {top: false, bottom: false, left: false, right: false};

  var parent = el.parentElement;
  var pRect = null, pStyle = null;
  if (parent && parent !== document.body && parent !== document.documentElement) {
    pRect = parent.getBoundingClientRect();
    pStyle = getComputedStyle(parent);
  }

  // 前の表示可能な兄弟要素を取得
  var prevSib = getVisibleSibling(el, 'prev');
  // 次の表示可能な兄弟要素を取得
  var nextSib = getVisibleSibling(el, 'next');

  // ===== 上方向 =====
  if (prevSib) {
    var sibRect = prevSib.getBoundingClientRect();
    var gap = Math.round(rect.top - sibRect.bottom);
    if (gap > 0) {
      drawEdgeLine(svg, cx, rect.top, cx, sibRect.bottom, siblingColor);
      drawEdgeLabel(svg, cx + 6, sibRect.bottom + gap / 2 + 4, gap + "px", siblingColor);
    }
    hasNeighbor.top = true;
  } else if (pRect) {
    var pBorderTop = parseFloat(pStyle.borderTopWidth) || 0;
    var parentInnerTop = pRect.top + pBorderTop;
    var gap = Math.round(rect.top - parentInnerTop);
    if (gap > 0) {
      drawEdgeLine(svg, cx, rect.top, cx, parentInnerTop, paddingColor);
      drawEdgeLabel(svg, cx + 6, parentInnerTop + gap / 2 + 4, gap + "px", paddingColor);
    }
    hasNeighbor.top = true;
  }

  // ===== 下方向 =====
  if (nextSib) {
    var sibRect = nextSib.getBoundingClientRect();
    var gap = Math.round(sibRect.top - rect.bottom);
    if (gap > 0) {
      drawEdgeLine(svg, cx, rect.bottom, cx, sibRect.top, siblingColor);
      drawEdgeLabel(svg, cx + 6, rect.bottom + gap / 2 + 4, gap + "px", siblingColor);
    }
    hasNeighbor.bottom = true;
  } else if (pRect) {
    var pBorderBottom = parseFloat(pStyle.borderBottomWidth) || 0;
    var parentInnerBottom = pRect.bottom - pBorderBottom;
    var gap = Math.round(parentInnerBottom - rect.bottom);
    if (gap > 0) {
      drawEdgeLine(svg, cx, rect.bottom, cx, parentInnerBottom, paddingColor);
      drawEdgeLabel(svg, cx + 6, rect.bottom + gap / 2 + 4, gap + "px", paddingColor);
    }
    hasNeighbor.bottom = true;
  }

  // ===== 左方向 =====
  if (pRect) {
    var pBorderLeft = parseFloat(pStyle.borderLeftWidth) || 0;
    var parentInnerLeft = pRect.left + pBorderLeft;
    var gap = Math.round(rect.left - parentInnerLeft);
    if (gap > 0) {
      drawEdgeLine(svg, rect.left, cy, parentInnerLeft, cy, paddingColor);
      drawEdgeLabel(svg, parentInnerLeft + gap / 2, cy - 8, gap + "px", paddingColor, true);
    }
    hasNeighbor.left = true;
  }

  // ===== 右方向 =====
  if (pRect) {
    var pBorderRight = parseFloat(pStyle.borderRightWidth) || 0;
    var parentInnerRight = pRect.right - pBorderRight;
    var gap = Math.round(parentInnerRight - rect.right);
    if (gap > 0) {
      drawEdgeLine(svg, rect.right, cy, parentInnerRight, cy, paddingColor);
      drawEdgeLabel(svg, rect.right + gap / 2, cy - 8, gap + "px", paddingColor, true);
    }
    hasNeighbor.right = true;
  }

  return hasNeighbor;
}

// 表示可能な兄弟要素を取得
function getVisibleSibling(el, direction) {
  var sibling = direction === 'prev' ? el.previousElementSibling : el.nextElementSibling;
  while (sibling) {
    var style = getComputedStyle(sibling);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      return sibling;
    }
    sibling = direction === 'prev' ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return null;
}

// 複数点からスキャンして最も近い隣接要素を検出
function findNeighborMultiPoint(el, rect, direction) {
  var points = [];

  if (direction === 'top') {
    points = [
      {x: rect.left + rect.width * 0.25, y: rect.top - 1, dx: 0, dy: -1},
      {x: rect.left + rect.width * 0.5, y: rect.top - 1, dx: 0, dy: -1},
      {x: rect.left + rect.width * 0.75, y: rect.top - 1, dx: 0, dy: -1}
    ];
  } else if (direction === 'bottom') {
    points = [
      {x: rect.left + rect.width * 0.25, y: rect.bottom + 1, dx: 0, dy: 1},
      {x: rect.left + rect.width * 0.5, y: rect.bottom + 1, dx: 0, dy: 1},
      {x: rect.left + rect.width * 0.75, y: rect.bottom + 1, dx: 0, dy: 1}
    ];
  } else if (direction === 'left') {
    points = [
      {x: rect.left - 1, y: rect.top + rect.height * 0.25, dx: -1, dy: 0},
      {x: rect.left - 1, y: rect.top + rect.height * 0.5, dx: -1, dy: 0},
      {x: rect.left - 1, y: rect.top + rect.height * 0.75, dx: -1, dy: 0}
    ];
  } else if (direction === 'right') {
    points = [
      {x: rect.right + 1, y: rect.top + rect.height * 0.25, dx: 1, dy: 0},
      {x: rect.right + 1, y: rect.top + rect.height * 0.5, dx: 1, dy: 0},
      {x: rect.right + 1, y: rect.top + rect.height * 0.75, dx: 1, dy: 0}
    ];
  }

  var closestNeighbor = null;
  var minDistance = Infinity;

  for (var i = 0; i < points.length; i++) {
    var p = points[i];
    var neighbor = findNeighborInDirection(el, p.x, p.y, p.dx, p.dy, 0);
    if (neighbor) {
      var nRect = neighbor.getBoundingClientRect();
      var dist = 0;
      if (direction === 'top') dist = rect.top - nRect.bottom;
      else if (direction === 'bottom') dist = nRect.top - rect.bottom;
      else if (direction === 'left') dist = rect.left - nRect.right;
      else if (direction === 'right') dist = nRect.left - rect.right;

      // dist >= 0 を許可（接している要素もOK）、マイナスは除外（重なり）
      if (dist >= 0 && dist < minDistance) {
        minDistance = dist;
        closestNeighbor = neighbor;
      }
    }
  }

  return closestNeighbor;
}

// 指定方向にスキャンして最も近い隣接要素を検出
// isHorizontal: 1=水平方向, 0=垂直方向
function findNeighborInDirection(el, startX, startY, dx, dy, isHorizontal) {
  var viewW = document.documentElement.clientWidth;
  var viewH = window.innerHeight;
  var x = startX, y = startY;
  var maxSteps = 500;
  var elRect = el.getBoundingClientRect();

  for (var i = 0; i < maxSteps; i++) {
    x += dx; y += dy;
    if (x < 0 || x >= viewW || y < 0 || y >= viewH) { break; }

    var hit = document.elementFromPoint(x, y);
    if (!hit || hit === el) { continue; }

    // 自分の子孫・先祖は無視
    if (el.contains(hit) || hit.contains(el)) { continue; }

    // body/html・オーバーレイは無視してスキャン継続
    if (hit === document.body || hit === document.documentElement) { continue; }
    if (hit.id && hit.id.indexOf("css-jumper") === 0) { continue; }
    if (hit.className && typeof hit.className === "string" && hit.className.indexOf("css-jumper") >= 0) { continue; }

    return hit;
  }
  return null;
}

function drawEdgeLine(svg, x1, y1, x2, y2, color) {
  var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-dasharray", "4,3");
  svg.appendChild(line);
}

function drawEdgeLabel(svg, x, y, text, color, center) {
  var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  if (center) { t.setAttribute("text-anchor", "middle"); }
  t.setAttribute("fill", color);
  t.setAttribute("font-size", "13"); t.setAttribute("font-family", "monospace");
  t.setAttribute("font-weight", "bold");
  t.textContent = text;
  svg.appendChild(t);
}

function formatBoxValues(top, right, bottom, left) {
  var t = Math.round(top), r = Math.round(right), b = Math.round(bottom), l = Math.round(left);
  if (t === r && r === b && b === l) {
    return t + "px";
  }
  if (t === b && l === r) {
    return t + "px " + r + "px";
  }
  return t + "px " + r + "px " + b + "px " + l + "px";
}

function rgbToHex(rgb) {
  var match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) { return rgb; }
  var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

function updateBoxModelLabelPos(e) {
  if (!boxModelLabel) { return; }
  var labelW = boxModelLabel.offsetWidth || 200;
  var labelH = boxModelLabel.offsetHeight || 100;
  var viewW = document.documentElement.clientWidth;
  var viewH = window.innerHeight;

  // position:fixedなのでclientX/Yを使用
  var labelX = e.clientX + 16;
  var labelY = e.clientY + 16;

  if (labelX + labelW > viewW) {
    labelX = e.clientX - labelW - 8;
  }
  if (labelY + labelH > viewH) {
    labelY = e.clientY - labelH - 8;
  }
  // 負の値にならないよう
  if (labelX < 0) { labelX = 4; }
  if (labelY < 0) { labelY = 4; }

  boxModelLabel.style.left = labelX + "px";
  boxModelLabel.style.top = labelY + "px";
}

// ========================================
// 要素間の距離表示（Shift+クリック）
// ========================================
function boxModelDistanceClick(e) {
  if (!boxModelActive) { return; }

  var el = e.target;
  // 自分のオーバーレイ等は無視
  if (!el || el.id === "css-jumper-boxmodel-overlay" || el.id === "css-jumper-boxmodel-label" ||
      el.closest("#css-jumper-boxmodel-overlay") || el.closest("#css-jumper-boxmodel-label") ||
      el.closest(".css-jumper-distance")) {
    return;
  }

  // Shift無しクリック → 距離表示クリア
  if (!e.shiftKey) {
    if (distanceOverlays.length > 0 || distanceFirstEl) {
      clearDistanceOverlays();
      distanceFirstEl = null;
      boxModelCurrentTarget = null;
      document.removeEventListener("keydown", distanceEscHandler);
    }
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  if (!distanceFirstEl) {
    // 1つ目の要素を選択 → ボックスモデル表示を一時停止
    distanceFirstEl = el;
    clearDistanceOverlays();
    boxModelHide();
    var marker = createDistanceMarker(el, "1️⃣ " + getElemSelector(el), "#FF6B6B");
    distanceOverlays.push(marker);
    showNotification("Shift+クリックで2つ目 / クリックでクリア", "info");
    document.addEventListener("keydown", distanceEscHandler);
  } else {
    // 2つ目の要素 → 距離を計算・表示
    showDistanceBetween(distanceFirstEl, el);
    distanceFirstEl = null;
  }
}

function createDistanceMarker(el, text, color) {
  var rect = el.getBoundingClientRect();
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;

  var marker = document.createElement("div");
  marker.className = "css-jumper-distance";
  marker.style.cssText = "position:absolute;pointer-events:none;z-index:2147483645;" +
    "border:2px dashed " + color + ";" +
    "left:" + (rect.left + scrollX) + "px;top:" + (rect.top + scrollY) + "px;" +
    "width:" + rect.width + "px;height:" + rect.height + "px;";

  var label = document.createElement("div");
  label.className = "css-jumper-distance";
  label.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;" +
    "background:" + color + ";color:#fff;font:12px/1.3 monospace;padding:2px 6px;border-radius:3px;" +
    "white-space:nowrap;" +
    "left:" + (rect.left + scrollX) + "px;top:" + (rect.top + scrollY - 20) + "px;";
  label.textContent = text;

  document.body.appendChild(marker);
  document.body.appendChild(label);
  return [marker, label];
}

function showAllNeighborDistances(el) {
  var rect = el.getBoundingClientRect();
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;

  // 選択要素にマーカー
  var marker = createDistanceMarker(el, "📏 " + getElemSelector(el), "#FF6B6B");
  distanceOverlays.push(marker);

  // SVGコンテナ
  var lineContainer = document.createElement("div");
  lineContainer.className = "css-jumper-distance";
  lineContainer.style.cssText = "position:absolute;pointer-events:none;z-index:2147483645;left:0;top:0;";
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;";
  svg.setAttribute("width", "1");
  svg.setAttribute("height", "1");

  // 兄弟要素を全て取得（非表示除外）
  var siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
  var visibleSiblings = siblings.filter(function(sib) {
    if (sib === el) { return false; }
    var s = window.getComputedStyle(sib);
    return s.display !== "none" && s.visibility !== "hidden";
  });

  // 上下左右で最も近い要素を探す
  var nearest = { top: null, bottom: null, left: null, right: null };
  var nearestDist = { top: Infinity, bottom: Infinity, left: Infinity, right: Infinity };

  visibleSiblings.forEach(function(sib) {
    var sRect = sib.getBoundingClientRect();

    // 上（sibの下端が自分の上端より上）
    if (sRect.bottom <= rect.top) {
      var d = rect.top - sRect.bottom;
      if (d < nearestDist.top) { nearestDist.top = d; nearest.top = sib; }
    }
    // 下（sibの上端が自分の下端より下）
    if (sRect.top >= rect.bottom) {
      var d2 = sRect.top - rect.bottom;
      if (d2 < nearestDist.bottom) { nearestDist.bottom = d2; nearest.bottom = sib; }
    }
    // 左（sibの右端が自分の左端より左）
    if (sRect.right <= rect.left) {
      var d3 = rect.left - sRect.right;
      if (d3 < nearestDist.left) { nearestDist.left = d3; nearest.left = sib; }
    }
    // 右（sibの左端が自分の右端より右）
    if (sRect.left >= rect.right) {
      var d4 = sRect.left - rect.right;
      if (d4 < nearestDist.right) { nearestDist.right = d4; nearest.right = sib; }
    }
  });

  var dirColors = { top: "#33BBFF", bottom: "#33BBFF", left: "#4ECDC4", right: "#4ECDC4" };
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;

  // 上
  if (nearest.top) {
    var sRect = nearest.top.getBoundingClientRect();
    var dist = Math.round(rect.top - sRect.bottom);
    var lx = cx + scrollX;
    drawNeighborMarker(sRect, scrollX, scrollY, dirColors.top);
    drawDistLine(svg, lx, sRect.bottom + scrollY, lx, rect.top + scrollY, dirColors.top);
    drawDistLabel(svg, lx + 6, (sRect.bottom + rect.top) / 2 + scrollY + 5, dist + "px", dirColors.top);
  }
  // 下
  if (nearest.bottom) {
    var sRect2 = nearest.bottom.getBoundingClientRect();
    var dist2 = Math.round(sRect2.top - rect.bottom);
    var lx2 = cx + scrollX;
    drawNeighborMarker(sRect2, scrollX, scrollY, dirColors.bottom);
    drawDistLine(svg, lx2, rect.bottom + scrollY, lx2, sRect2.top + scrollY, dirColors.bottom);
    drawDistLabel(svg, lx2 + 6, (rect.bottom + sRect2.top) / 2 + scrollY + 5, dist2 + "px", dirColors.bottom);
  }
  // 左
  if (nearest.left) {
    var sRect3 = nearest.left.getBoundingClientRect();
    var dist3 = Math.round(rect.left - sRect3.right);
    var ly = cy + scrollY;
    drawNeighborMarker(sRect3, scrollX, scrollY, dirColors.left);
    drawDistLine(svg, sRect3.right + scrollX, ly, rect.left + scrollX, ly, dirColors.left);
    drawDistLabel(svg, (sRect3.right + rect.left) / 2 + scrollX, ly - 10, dist3 + "px", dirColors.left, true);
  }
  // 右
  if (nearest.right) {
    var sRect4 = nearest.right.getBoundingClientRect();
    var dist4 = Math.round(sRect4.left - rect.right);
    var ly2 = cy + scrollY;
    drawNeighborMarker(sRect4, scrollX, scrollY, dirColors.right);
    drawDistLine(svg, rect.right + scrollX, ly2, sRect4.left + scrollX, ly2, dirColors.right);
    drawDistLabel(svg, (rect.right + sRect4.left) / 2 + scrollX, ly2 - 10, dist4 + "px", dirColors.right, true);
  }

  lineContainer.appendChild(svg);
  document.body.appendChild(lineContainer);
  distanceOverlays.push([lineContainer]);
}

function drawNeighborMarker(sRect, scrollX, scrollY, color) {
  var m = document.createElement("div");
  m.className = "css-jumper-distance";
  m.style.cssText = "position:absolute;pointer-events:none;z-index:2147483644;" +
    "border:2px dotted " + color + ";" +
    "left:" + (sRect.left + scrollX) + "px;top:" + (sRect.top + scrollY) + "px;" +
    "width:" + sRect.width + "px;height:" + sRect.height + "px;";
  document.body.appendChild(m);
  distanceOverlays.push([m]);
}

function drawDistLine(svg, x1, y1, x2, y2, color) {
  var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", color); line.setAttribute("stroke-width", "3");
  line.setAttribute("stroke-dasharray", "8,4");
  svg.appendChild(line);
}

function drawDistLabel(svg, x, y, text, color, center) {
  // 背景
  var bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  var textLen = text.length * 9;
  bg.setAttribute("x", center ? x - textLen / 2 - 4 : x - 4);
  bg.setAttribute("y", y - 14);
  bg.setAttribute("width", textLen + 8); bg.setAttribute("height", "20");
  bg.setAttribute("rx", "3"); bg.setAttribute("fill", "rgba(0,0,0,0.85)");
  svg.appendChild(bg);
  // テキスト
  var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  if (center) { t.setAttribute("text-anchor", "middle"); }
  t.setAttribute("fill", color);
  t.setAttribute("font-size", "15"); t.setAttribute("font-family", "monospace");
  t.setAttribute("font-weight", "bold");
  t.textContent = text;
  svg.appendChild(t);
}

function showDistanceBetween(el1, el2) {
  var r1 = el1.getBoundingClientRect();
  var r2 = el2.getBoundingClientRect();
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;

  // 2つ目のマーカー
  var marker2 = createDistanceMarker(el2, "2️⃣ " + getElemSelector(el2), "#4ECDC4");
  distanceOverlays.push(marker2);

  // 水平・垂直の端間距離（最も近い辺同士）
  var hGap, vGap;

  // 水平方向: 重なりがなければ隙間を表示
  if (r2.left >= r1.right) {
    hGap = Math.round(r2.left - r1.right);
  } else if (r1.left >= r2.right) {
    hGap = Math.round(r1.left - r2.right);
  } else {
    hGap = null; // 水平方向に重なっている
  }

  // 垂直方向
  if (r2.top >= r1.bottom) {
    vGap = Math.round(r2.top - r1.bottom);
  } else if (r1.top >= r2.bottom) {
    vGap = Math.round(r1.top - r2.bottom);
  } else {
    vGap = null; // 垂直方向に重なっている
  }

  // 距離線を描画（最も近い辺同士を結ぶ）
  var lineContainer = document.createElement("div");
  lineContainer.className = "css-jumper-distance";
  lineContainer.style.cssText = "position:absolute;pointer-events:none;z-index:2147483645;left:0;top:0;";

  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;";
  svg.setAttribute("width", "1");
  svg.setAttribute("height", "1");

  // 水平方向の線（辺同士）
  if (hGap !== null && hGap > 0) {
    var hx1, hx2, hy;
    hy = Math.max(r1.top, r2.top) + (Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top)) / 2;
    // 垂直に重なりがない場合は中間点
    if (r1.bottom <= r2.top || r2.bottom <= r1.top) {
      hy = (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2;
    }
    if (r2.left >= r1.right) {
      hx1 = r1.right; hx2 = r2.left;
    } else {
      hx1 = r2.right; hx2 = r1.left;
    }
    var hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hLine.setAttribute("x1", hx1 + scrollX); hLine.setAttribute("y1", hy + scrollY);
    hLine.setAttribute("x2", hx2 + scrollX); hLine.setAttribute("y2", hy + scrollY);
    hLine.setAttribute("stroke", "#FF3333"); hLine.setAttribute("stroke-width", "3");
    hLine.setAttribute("stroke-dasharray", "8,4");
    svg.appendChild(hLine);

    // 背景付き数値ラベル
    var hLabelX = (hx1 + hx2) / 2 + scrollX;
    var hLabelY = hy + scrollY - 12;
    var hBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    hBg.setAttribute("x", hLabelX - 28); hBg.setAttribute("y", hLabelY - 14);
    hBg.setAttribute("width", "56"); hBg.setAttribute("height", "20");
    hBg.setAttribute("rx", "3"); hBg.setAttribute("fill", "rgba(0,0,0,0.85)");
    svg.appendChild(hBg);
    var hText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    hText.setAttribute("x", hLabelX);
    hText.setAttribute("y", hLabelY);
    hText.setAttribute("text-anchor", "middle");
    hText.setAttribute("fill", "#FF5555");
    hText.setAttribute("font-size", "15");
    hText.setAttribute("font-family", "monospace");
    hText.setAttribute("font-weight", "bold");
    hText.textContent = hGap + "px";
    svg.appendChild(hText);
  }

  // 垂直方向の線（辺同士）
  if (vGap !== null && vGap > 0) {
    var vy1, vy2, vx;
    vx = Math.max(r1.left, r2.left) + (Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left)) / 2;
    // 水平に重なりがない場合は中間点
    if (r1.right <= r2.left || r2.right <= r1.left) {
      vx = (r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2;
    }
    if (r2.top >= r1.bottom) {
      vy1 = r1.bottom; vy2 = r2.top;
    } else {
      vy1 = r2.bottom; vy2 = r1.top;
    }
    var vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    vLine.setAttribute("x1", vx + scrollX); vLine.setAttribute("y1", vy1 + scrollY);
    vLine.setAttribute("x2", vx + scrollX); vLine.setAttribute("y2", vy2 + scrollY);
    vLine.setAttribute("stroke", "#33BBFF"); vLine.setAttribute("stroke-width", "3");
    vLine.setAttribute("stroke-dasharray", "8,4");
    svg.appendChild(vLine);

    // 背景付き数値ラベル
    var vLabelX = vx + scrollX + 8;
    var vLabelY = (vy1 + vy2) / 2 + scrollY + 5;
    var vBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    vBg.setAttribute("x", vLabelX - 4); vBg.setAttribute("y", vLabelY - 15);
    vBg.setAttribute("width", "56"); vBg.setAttribute("height", "20");
    vBg.setAttribute("rx", "3"); vBg.setAttribute("fill", "rgba(0,0,0,0.85)");
    svg.appendChild(vBg);
    var vText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    vText.setAttribute("x", vLabelX);
    vText.setAttribute("y", vLabelY);
    vText.setAttribute("fill", "#55CCFF");
    vText.setAttribute("font-size", "15");
    vText.setAttribute("font-family", "monospace");
    vText.setAttribute("font-weight", "bold");
    vText.textContent = vGap + "px";
    svg.appendChild(vText);
  }

  lineContainer.appendChild(svg);
  document.body.appendChild(lineContainer);
  distanceOverlays.push([lineContainer]);

  // 距離ラベル（結果表示）
  var distLabel = document.createElement("div");
  distLabel.className = "css-jumper-distance";
  distLabel.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;" +
    "background:rgba(0,0,0,0.95);color:#fff;font:14px/1.5 monospace;padding:10px 14px;border-radius:4px;" +
    "white-space:pre;border:1px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(0,0,0,0.5);" +
    "left:50%;top:20px;transform:translateX(-50%);";

  var lines = [];
  lines.push("📏 要素間の距離");
  lines.push("─────────────────────");
  if (hGap !== null) {
    lines.push("↔ 水平: " + hGap + "px");
  }
  if (vGap !== null) {
    lines.push("↕ 垂直: " + vGap + "px");
  }
  if (hGap === null && vGap === null) {
    lines.push("⚠ 要素が重なっています");
  }
  lines.push("─────────────────────");
  lines.push("Shift+クリックで再計測 / Escでクリア");

  distLabel.textContent = lines.join("\n");
  document.body.appendChild(distLabel);
  distanceOverlays.push([distLabel]);

  // Escキーでクリア
  document.addEventListener("keydown", distanceEscHandler);
}

function distanceEscHandler(e) {
  if (e.key === "Escape") {
    clearDistanceOverlays();
    distanceFirstEl = null;
    boxModelCurrentTarget = null; // ホバー再開時にすぐ表示されるよう
    document.removeEventListener("keydown", distanceEscHandler);
  }
}

function clearDistanceOverlays() {
  distanceOverlays.forEach(function(items) {
    if (Array.isArray(items)) {
      items.forEach(function(el) { if (el && el.remove) { el.remove(); } });
    }
  });
  distanceOverlays = [];
}

// 画面端（ビューポート）からの距離を表示
function showEdgeDistances(el) {
  var rect = el.getBoundingClientRect();
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;
  var viewW = document.documentElement.clientWidth;
  var viewH = window.innerHeight;

  var top = Math.round(rect.top);
  var bottom = Math.round(viewH - rect.bottom);
  var left = Math.round(rect.left);
  var right = Math.round(viewW - rect.right);

  var lineColor = "#FF3333";
  var container = document.createElement("div");
  container.className = "css-jumper-distance";
  container.style.cssText = "position:absolute;pointer-events:none;z-index:2147483645;left:0;top:0;";

  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible;pointer-events:none;";
  svg.setAttribute("width", "1");
  svg.setAttribute("height", "1");

  var cx = rect.left + rect.width / 2 + scrollX;
  var cy = rect.top + rect.height / 2 + scrollY;

  // 上方向の線
  if (top > 5) {
    addDistanceLine(svg, cx, rect.top + scrollY, cx, scrollY, lineColor, top + "px");
  }
  // 下方向の線
  if (bottom > 5) {
    addDistanceLine(svg, cx, rect.bottom + scrollY, cx, viewH + scrollY, lineColor, bottom + "px");
  }
  // 左方向の線
  if (left > 5) {
    addDistanceLineH(svg, rect.left + scrollX, cy, scrollX, cy, lineColor, left + "px");
  }
  // 右方向の線
  if (right > 5) {
    addDistanceLineH(svg, rect.right + scrollX, cy, viewW + scrollX, cy, lineColor, right + "px");
  }

  container.appendChild(svg);
  document.body.appendChild(container);
  distanceOverlays.push([container]);

  // Escでクリアできるように
  document.addEventListener("keydown", distanceEscHandler);
}

function addDistanceLine(svg, x1, y1, x2, y2, color, label) {
  var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-dasharray", "4,3");
  svg.appendChild(line);

  var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", x1 + 6);
  text.setAttribute("y", (y1 + y2) / 2 + 4);
  text.setAttribute("fill", color);
  text.setAttribute("font-size", "12");
  text.setAttribute("font-family", "monospace");
  text.setAttribute("font-weight", "bold");
  text.textContent = label;
  svg.appendChild(text);
}

function addDistanceLineH(svg, x1, y1, x2, y2, color, label) {
  var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", color); line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-dasharray", "4,3");
  svg.appendChild(line);

  var text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", (x1 + x2) / 2);
  text.setAttribute("y", y1 - 6);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", color);
  text.setAttribute("font-size", "12");
  text.setAttribute("font-family", "monospace");
  text.setAttribute("font-weight", "bold");
  text.textContent = label;
  svg.appendChild(text);
}

// ========================================
// ビューポートプリセット
// ========================================
var DEFAULT_VIEWPORT_PRESETS = [1920, 1440, 1280, 768, 375];

// プリセットバー表示
function showViewportPresetBar() {
  if (viewportPresetBar) { return; }
  chrome.storage.local.get(["viewportCustomPresets", "viewportExcluded"], function(result) {
    var custom = result.viewportCustomPresets || [];
    var excluded = result.viewportExcluded || [];
    buildViewportPresetBar(custom, excluded);
  });
}

function buildViewportPresetBar(customPresets, excluded) {
  if (viewportPresetBar) { viewportPresetBar.remove(); viewportPresetBar = null; }

  // デフォルト（除外を引く）+ カスタムを統合、大→小ソート
  var allPresets = DEFAULT_VIEWPORT_PRESETS.filter(function(w) {
    return excluded.indexOf(w) === -1;
  });
  customPresets.forEach(function(w) {
    if (allPresets.indexOf(w) === -1) { allPresets.push(w); }
  });
  allPresets.sort(function(a, b) { return b - a; });

  viewportPresetBar = document.createElement("div");
  viewportPresetBar.id = "css-jumper-viewport-bar";
  viewportPresetBar.style.cssText = "position:fixed;top:0;left:50%;transform:translateX(-50%);" +
    "z-index:2147483647;display:flex;align-items:center;gap:2px;padding:4px 8px;" +
    "background:rgba(0,0,0,0.85);border-radius:0 0 8px 8px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.5);font:13px/1 monospace;";

  // 現在のビューポート幅
  var currentLabel = document.createElement("span");
  currentLabel.id = "css-jumper-viewport-current";
  currentLabel.style.cssText = "color:#4488FF;padding:6px 8px;font-weight:bold;";
  currentLabel.textContent = "📐" + window.innerWidth + "px";
  viewportPresetBar.appendChild(currentLabel);
  addBarSep(viewportPresetBar);

  // プリセットボタン（長押し1秒で削除）
  allPresets.forEach(function(width) {
    viewportPresetBar.appendChild(createPresetBtn(width));
  });

  addBarSep(viewportPresetBar);

  // 直接入力欄
  var input = document.createElement("input");
  input.type = "number";
  input.placeholder = "px";
  input.style.cssText = "width:56px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);" +
    "color:#fff;padding:4px 6px;border-radius:4px;font:13px/1 monospace;text-align:center;" +
    "outline:none;-moz-appearance:textfield;";
  input.addEventListener("keydown", function(e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      var val = parseInt(input.value);
      if (val > 0) { applyViewportWidth(val); }
    }
  });
  input.addEventListener("click", function(e) { e.stopPropagation(); });
  viewportPresetBar.appendChild(input);

  // 登録ボタン
  var regBtn = document.createElement("button");
  regBtn.style.cssText = "background:none;border:1px solid rgba(100,255,100,0.5);color:#66FF66;" +
    "padding:5px 8px;border-radius:4px;cursor:pointer;font:12px/1 monospace;transition:background 0.15s;";
  regBtn.textContent = "登録";
  regBtn.addEventListener("mouseenter", function() { regBtn.style.background = "rgba(100,255,100,0.2)"; });
  regBtn.addEventListener("mouseleave", function() { regBtn.style.background = "none"; });
  regBtn.addEventListener("click", function(e) {
    e.stopPropagation(); e.preventDefault();
    var val = parseInt(input.value);
    if (val > 0) {
      registerPreset(val);
      input.value = "";
    }
  });
  viewportPresetBar.appendChild(regBtn);

  addBarSep(viewportPresetBar);

  // 戻すボタン
  var restoreBtn = document.createElement("button");
  restoreBtn.style.cssText = "background:none;border:1px solid rgba(255,100,100,0.5);color:#FF6B6B;" +
    "padding:5px 8px;border-radius:4px;cursor:pointer;font:12px/1 monospace;transition:background 0.15s;";
  restoreBtn.textContent = "戻す";
  restoreBtn.addEventListener("mouseenter", function() { restoreBtn.style.background = "rgba(255,100,100,0.2)"; });
  restoreBtn.addEventListener("mouseleave", function() { restoreBtn.style.background = "none"; });
  restoreBtn.addEventListener("click", function(e) {
    e.stopPropagation(); e.preventDefault();
    restoreOriginalWindowSize();
  });
  viewportPresetBar.appendChild(restoreBtn);

  document.body.appendChild(viewportPresetBar);
}

function addBarSep(bar) {
  var s = document.createElement("span");
  s.style.cssText = "color:rgba(255,255,255,0.3);padding:6px 2px;";
  s.textContent = "|";
  bar.appendChild(s);
}

// プリセットボタン（クリック=適用、長押し1秒=削除）
function createPresetBtn(width) {
  var btn = document.createElement("button");
  btn.style.cssText = "background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;" +
    "padding:5px 10px;border-radius:4px;cursor:pointer;font:13px/1 monospace;transition:all 0.15s;";
  btn.textContent = width;

  var holdTimer = null;
  var held = false;

  btn.addEventListener("mouseenter", function() {
    if (!held) { btn.style.background = "rgba(255,255,255,0.2)"; }
  });
  btn.addEventListener("mouseleave", function() {
    btn.style.background = "none";
    btn.style.borderColor = "rgba(255,255,255,0.3)";
    clearTimeout(holdTimer); held = false;
  });
  btn.addEventListener("mousedown", function(e) {
    e.preventDefault();
    held = false;
    holdTimer = setTimeout(function() {
      held = true;
      btn.style.background = "rgba(255,50,50,0.4)";
      btn.style.borderColor = "#FF3333";
      deletePreset(width);
    }, 1000);
  });
  btn.addEventListener("mouseup", function(e) {
    clearTimeout(holdTimer);
    if (!held) {
      e.stopPropagation(); e.preventDefault();
      applyViewportWidth(width);
    }
    held = false;
  });

  return btn;
}

// プリセット登録
function registerPreset(width) {
  chrome.storage.local.get(["viewportCustomPresets", "viewportExcluded"], function(result) {
    var custom = result.viewportCustomPresets || [];
    var excluded = result.viewportExcluded || [];
    // 除外リストから復活
    var exIdx = excluded.indexOf(width);
    if (exIdx >= 0) { excluded.splice(exIdx, 1); }
    // カスタムに追加（デフォルトにないもののみ）
    if (DEFAULT_VIEWPORT_PRESETS.indexOf(width) === -1 && custom.indexOf(width) === -1) {
      custom.push(width);
    }
    chrome.storage.local.set({ viewportCustomPresets: custom, viewportExcluded: excluded }, function() {
      rebuildBar();
      applyViewportWidth(width);
      showNotification(width + "px を登録", "success");
    });
  });
}

// プリセット削除
function deletePreset(width) {
  chrome.storage.local.get(["viewportCustomPresets", "viewportExcluded"], function(result) {
    var custom = result.viewportCustomPresets || [];
    var excluded = result.viewportExcluded || [];
    // カスタムから削除
    var cIdx = custom.indexOf(width);
    if (cIdx >= 0) { custom.splice(cIdx, 1); }
    // デフォルトなら除外リストに追加
    if (DEFAULT_VIEWPORT_PRESETS.indexOf(width) >= 0 && excluded.indexOf(width) === -1) {
      excluded.push(width);
    }
    chrome.storage.local.set({ viewportCustomPresets: custom, viewportExcluded: excluded }, function() {
      rebuildBar();
      showNotification(width + "px を削除", "info");
    });
  });
}

// バー再構築
function rebuildBar() {
  chrome.storage.local.get(["viewportCustomPresets", "viewportExcluded"], function(result) {
    buildViewportPresetBar(result.viewportCustomPresets || [], result.viewportExcluded || []);
  });
}

// 保存済みビューポート幅を自動適用
function applyStoredViewport() {
  chrome.storage.local.get("viewportPreset", function(result) {
    if (result.viewportPreset) {
      applyViewportWidth(result.viewportPreset);
    }
  });
}

// ビューポート幅を適用
function applyViewportWidth(width) {
  // 元のサイズを保存（初回のみ）
  if (!originalWindowSize) {
    originalWindowSize = {};
  }

  // storage に保存
  chrome.storage.local.set({ viewportPreset: width });

  // ラベルを即座にターゲット値で更新
  var label = document.getElementById("css-jumper-viewport-current");
  if (label) { label.textContent = "📐" + width + "px"; }

  // background.jsにリサイズ依頼
  chrome.runtime.sendMessage({
    action: "resizeViewport",
    width: width
  }, function(response) {
    if (response && response.success) {
      // 元のサイズ・位置を保存（初回のみ）
      if (!originalWindowSize.saved) {
        originalWindowSize.prevWidth = response.previousWidth;
        originalWindowSize.prevHeight = response.previousHeight;
        originalWindowSize.prevLeft = response.previousLeft;
        originalWindowSize.prevTop = response.previousTop;
        originalWindowSize.saved = true;
      }
    }
  });
}

// 元のウィンドウサイズに復元
function restoreOriginalWindowSize() {
  if (!originalWindowSize || !originalWindowSize.saved) { return; }

  // background.jsで直接ウィンドウサイズを復元
  chrome.runtime.sendMessage({
    action: "restoreWindow",
    width: originalWindowSize.prevWidth,
    height: originalWindowSize.prevHeight,
    left: originalWindowSize.prevLeft,
    top: originalWindowSize.prevTop
  }, function() {
    originalWindowSize = null;
    setTimeout(updateViewportCurrentLabel, 200);
  });
}

// プリセットバーの現在値を更新
function updateViewportCurrentLabel() {
  var label = document.getElementById("css-jumper-viewport-current");
  if (label) {
    label.textContent = "📐" + window.innerWidth + "px";
  }
}

// ========================================
// 配置方法を解析（ホバー追従モード）
// ========================================
var layoutAnalysisActive = false;
var layoutTooltip = null;
var layoutHighlight = null;

function toggleLayoutAnalysis() {
  if (layoutAnalysisActive) {
    disableLayoutAnalysis();
    showNotification("🔍 配置解析: OFF", "success");
  } else {
    enableLayoutAnalysis();
    showNotification("🔍 配置解析: ON（ホバーで表示）", "success");
  }
}

function enableLayoutAnalysis() {
  layoutAnalysisActive = true;

  // ツールチップ作成
  layoutTooltip = document.createElement("div");
  layoutTooltip.id = "css-jumper-layout-tooltip";
  layoutTooltip.style.cssText = "position:fixed;display:none;background:rgba(0,0,0,0.9);color:#fff;border-radius:6px;padding:10px 14px;z-index:999999;pointer-events:none;font-family:Consolas,Monaco,monospace;font-size:12px;line-height:1.5;max-width:420px;white-space:pre-line;box-shadow:0 2px 10px rgba(0,0,0,0.4);";
  document.body.appendChild(layoutTooltip);

  // ハイライト枠
  layoutHighlight = document.createElement("div");
  layoutHighlight.id = "css-jumper-layout-highlight";
  layoutHighlight.style.cssText = "position:fixed;display:none;border:2px solid #00bcd4;background:rgba(0,188,212,0.1);z-index:999998;pointer-events:none;";
  document.body.appendChild(layoutHighlight);

  document.addEventListener("mousemove", onLayoutMouseMove, true);
}

function disableLayoutAnalysis() {
  layoutAnalysisActive = false;
  document.removeEventListener("mousemove", onLayoutMouseMove, true);
  if (layoutTooltip) { layoutTooltip.remove(); layoutTooltip = null; }
  if (layoutHighlight) { layoutHighlight.remove(); layoutHighlight = null; }
}

function onLayoutMouseMove(e) {
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === layoutTooltip || el === layoutHighlight) return;

  // ツールチップ内容を構築
  var s = getComputedStyle(el);
  var parent = el.offsetParent || el.parentElement;
  var ps = parent ? getComputedStyle(parent) : null;

  var selector = el.tagName.toLowerCase();
  if (el.id) selector += "#" + el.id;
  var cls = el.className;
  if (typeof cls === "string" && cls.trim()) {
    selector += "." + cls.trim().split(/\s+/)[0];
  }

  var parentSelector = parent ? parent.tagName.toLowerCase() : "-";
  if (parent && parent.className && typeof parent.className === "string" && parent.className.trim()) {
    parentSelector += "." + parent.className.trim().split(/\s+/)[0];
  }

  var lines = [];
  lines.push("🔍 " + selector);
  lines.push("─────────────────");
  lines.push("position: " + s.position);
  lines.push("display:  " + s.display);
  if (s.position !== "static") {
    lines.push("top: " + s.top + "  left: " + s.left);
    lines.push("right: " + s.right + "  bottom: " + s.bottom);
  }
  lines.push("width: " + s.width + "  height: " + s.height);
  if (s.zIndex !== "auto") lines.push("z-index: " + s.zIndex);
  lines.push("─────────────────");
  lines.push("親: " + parentSelector);
  if (ps) {
    lines.push("  position: " + ps.position);
    lines.push("  display:  " + ps.display);
  }

  layoutTooltip.textContent = lines.join("\n");
  layoutTooltip.style.display = "block";

  // 位置調整（画面端で反転）
  var tx = e.clientX + 15;
  var ty = e.clientY + 15;
  var tw = layoutTooltip.offsetWidth;
  var th = layoutTooltip.offsetHeight;
  if (tx + tw > window.innerWidth) tx = e.clientX - tw - 10;
  if (ty + th > window.innerHeight) ty = e.clientY - th - 10;
  layoutTooltip.style.left = tx + "px";
  layoutTooltip.style.top = ty + "px";

  // ハイライト枠
  var rect = el.getBoundingClientRect();
  layoutHighlight.style.display = "block";
  layoutHighlight.style.left = rect.left + "px";
  layoutHighlight.style.top = rect.top + "px";
  layoutHighlight.style.width = rect.width + "px";
  layoutHighlight.style.height = rect.height + "px";
}

// ========================================
// Adobe XD テキスト＋フォント情報取得（試験実装）
// Alt+X で起動 / もう一度で閉じる
// ========================================
(function () {
  if (!location.hostname.includes('xd.adobe.com')) { return; }

  var xdPanel = null;

  // 「スタイル」セクションのラベル要素を見つけ、
  // その後続テキストからフォント情報を抽出する
  function extractFromStyleSection() {
    var result = { fontFamily: '', fontWeight: '', fontSize: '' };

    // 「スタイル」という文字を含む要素を探す（条件を緩めに）
    var allEls = document.querySelectorAll('*');
    var styleLabel = null;
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var t = el.textContent.trim();
      if (t === 'スタイル' || t.startsWith('スタイル')) {
        styleLabel = el;
        break;
      }
    }
    if (!styleLabel) { result._debug = '「スタイル」ラベル要素が見つかりません'; return result; }
    result._debug = '「スタイル」発見: ' + styleLabel.tagName + ' / ' + (styleLabel.className || 'no-class');

    // 「スタイル」の親コンテナのテキストを収集
    var container = styleLabel.parentElement;
    // 親を2〜3階層たどって十分な範囲のテキストを取る
    for (var d = 0; d < 3; d++) {
      if (container && container.parentElement) { container = container.parentElement; }
    }
    var txt = container ? (container.innerText || '') : '';

    // フォントファミリー＋ウェイト: 「Yu Gothic Regular」のような行を1行ずつ検索
    var weightRe = /\b(Regular|Bold|Light|Medium|Semibold|Semi Bold|Thin|Black|Heavy|Italic)\b/;
    var lines = txt.split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      var wm = line.match(weightRe);
      if (wm) {
        result.fontWeight = wm[1];
        result.fontFamily = line.replace(wm[1], '').trim();
        break;
      }
    }

    // フォントサイズ: 「サイズ 48px」または単体の数値+px
    var sizeMatch = txt.match(/サイズ\s+(\d+(?:\.\d+)?)\s*px/);
    if (sizeMatch) {
      result.fontSize = sizeMatch[1] + 'px';
    } else {
      // 「サイズ」ラベルがない場合、8〜200の範囲のpx値を探す
      var nums = txt.match(/\b(\d+(?:\.\d+)?)\s*px\b/g) || [];
      var filtered = nums.filter(function(v){ var n=parseFloat(v); return n>=8 && n<=200; });
      if (filtered.length) { result.fontSize = filtered[0]; }
    }

    return result;
  }

  // 「コンテンツ」セクションのテキストを取得
  function extractContentText() {
    var allEls = document.querySelectorAll('*');
    var contentLabel = null;
    for (var i = 0; i < allEls.length; i++) {
      var el = allEls[i];
      var t = el.textContent.trim();
      if (t === 'コンテンツ' || t.startsWith('コンテンツ')) {
        contentLabel = el;
        break;
      }
    }
    if (!contentLabel) { return ''; }

    // コンテンツラベルの次の兄弟か、親コンテナの次の要素からテキストを取る
    var container = contentLabel.parentElement;
    for (var d = 0; d < 2; d++) {
      if (container && container.parentElement) { container = container.parentElement; }
    }
    // コンテナのテキストから「コンテンツ」ラベル自体を除いた部分
    var txt = container ? (container.innerText || '') : '';
    // 「コンテンツ」「テキスト :」などのラベル文字を除去
    txt = txt.replace(/^コンテンツ\s*/,'').replace(/^テキスト\s*[:：]\s*/,'').trim();
    // 改行で分割して最初の意味のある行
    var lines = txt.split('\n').map(function(l){return l.trim();}).filter(function(l){return l.length > 1;});
    return lines[0] || '';
  }

  function extractXdTypography() {
    if (xdPanel) { xdPanel.remove(); xdPanel = null; return; }

    // background.js に蓄積されたデータを取得
    chrome.runtime.sendMessage({ type: 'GET_XD_DATA' }, function (response) {
      var items = (response && response.items) || [];

      // ---- 表示パネル ----
      xdPanel = document.createElement('div');
      Object.assign(xdPanel.style, {
        position: 'fixed', top: '60px', right: '20px', zIndex: '2147483647',
        background: '#1e1e2e', color: '#cdd6f4', padding: '16px 18px',
        borderRadius: '10px', fontFamily: 'monospace', fontSize: '12px',
        lineHeight: '1.6', maxWidth: '520px', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 6px 30px rgba(0,0,0,0.6)', border: '1px solid #45475a'
      });

      var html = '<div style="font-weight:bold;color:#89b4fa;font-size:14px;margin-bottom:10px">'
               + '🎨 Adobe XD デザインデータ（' + items.length + '件）</div>';

      if (items.length === 0) {
        html += '<div style="color:#f38ba8">⚠ データなし。ページをリロードしてから試してください。</div>';
      } else {
        html += '<table style="border-collapse:collapse;width:100%">'
              + '<tr style="color:#6c7086;font-size:10px;border-bottom:1px solid #313244">'
              + '<td style="padding:2px 8px 4px 0">テキスト</td>'
              + '<td style="padding:2px 8px 4px 0">サイズ</td>'
              + '<td style="padding:2px 8px 4px 0">フォント</td>'
              + '<td style="padding:2px 0 4px 0">ウェイト</td></tr>';
        items.forEach(function (it) {
          var weightColor = it.fontWeight === 'Bold' ? '#f38ba8' : '#6c7086';
          html += '<tr>'
            + '<td style="color:#cba6f7;padding:2px 8px 2px 0;max-width:160px;overflow:hidden;white-space:nowrap">'
            + it.text.replace(/</g,'&lt;').substring(0, 22) + '</td>'
            + '<td style="color:#a6e3a1;padding:2px 8px 2px 0">' + (it.fontSize || '—') + '</td>'
            + '<td style="color:#89dceb;padding:2px 8px 2px 0">' + (it.fontFamily || '—') + '</td>'
            + '<td style="color:' + weightColor + ';font-weight:' + (it.fontWeight === 'Bold' ? 'bold' : 'normal') + '">'
            + (it.fontWeight || '—') + '</td>'
            + '</tr>';
        });
        html += '</table>';
      }

      var json = JSON.stringify(items, null, 2);
      html += '<button id="xd_copy_btn" style="margin-top:12px;padding:6px 14px;background:#313244;'
            + 'color:#cdd6f4;border:1px solid #45475a;border-radius:6px;cursor:pointer;font-size:12px">'
            + '📋 JSON をコピー（Claude Code 用）</button>';
      html += '<div style="color:#45475a;font-size:11px;margin-top:8px">Alt+X で閉じる</div>';

      xdPanel.innerHTML = html;
      document.body.appendChild(xdPanel);

      document.getElementById('xd_copy_btn').addEventListener('click', function () {
        navigator.clipboard.writeText(json).then(function () {
          document.getElementById('xd_copy_btn').textContent = '✅ コピーしました！';
        });
      });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      extractXdTypography();
    }
  });
})();
