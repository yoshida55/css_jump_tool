@echo off
chcp 65001 > nul
setlocal

echo ================================================================================
echo CSS Jumper セットアップ
echo ================================================================================
echo.

:: 現在のフォルダを取得
set "SCRIPT_DIR=%~dp0"
set "NATIVE_HOST_DIR=%SCRIPT_DIR%native-host"
set "JSON_FILE=%NATIVE_HOST_DIR%\com.cssjumper.open_vscode.json"
set "EXE_FILE=%NATIVE_HOST_DIR%\open_vscode.exe"

:: パスのバックスラッシュをエスケープ
set "EXE_PATH_ESCAPED=%EXE_FILE:\=\\%"
set "JSON_PATH=%JSON_FILE%"

echo [1/3] JSONファイルを更新中...

:: 拡張機能IDの入力を求める
echo.
echo Chrome拡張機能のIDを入力してください
echo （chrome://extensions/ で確認できます）
echo.
set /p EXT_ID="拡張機能ID: "

if "%EXT_ID%"=="" (
    echo エラー: IDが入力されていません
    pause
    exit /b 1
)

:: JSONファイルを生成
echo {> "%JSON_FILE%"
echo   "name": "com.cssjumper.open_vscode",>> "%JSON_FILE%"
echo   "description": "Open VS Code from CSS Jumper",>> "%JSON_FILE%"
echo   "path": "%EXE_PATH_ESCAPED%",>> "%JSON_FILE%"
echo   "type": "stdio",>> "%JSON_FILE%"
echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]>> "%JSON_FILE%"
echo }>> "%JSON_FILE%"

echo    完了
echo.

echo [2/3] レジストリに登録中...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cssjumper.open_vscode" /ve /t REG_SZ /d "%JSON_FILE%" /f > nul
echo    完了
echo.

echo [3/3] vscode://プロトコル登録中...
:: VS Codeのパスを探す
set "VSCODE_PATH="
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
    set "VSCODE_PATH=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
)
if exist "C:\Program Files\Microsoft VS Code\Code.exe" (
    set "VSCODE_PATH=C:\Program Files\Microsoft VS Code\Code.exe"
)

if "%VSCODE_PATH%"=="" (
    echo    VS Codeが見つかりません。手動で登録してください。
) else (
    reg add "HKCU\Software\Classes\vscode" /ve /t REG_SZ /d "URL:vscode" /f > nul
    reg add "HKCU\Software\Classes\vscode" /v "URL Protocol" /t REG_SZ /d "" /f > nul
    reg add "HKCU\Software\Classes\vscode\shell\open\command" /ve /t REG_SZ /d "\"%VSCODE_PATH%\" --open-url -- \"%%1\"" /f > nul
    echo    完了
)

echo.
echo ================================================================================
echo セットアップ完了！
echo ================================================================================
echo.
echo 次の手順:
echo   1. Chromeを完全に閉じて再起動
echo   2. 拡張機能のポップアップでプロジェクトパスを設定
echo   3. Alt+クリックでテスト
echo.
pause
