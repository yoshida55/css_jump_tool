@echo off
setlocal

echo ================================================================================
echo CSS Jumper �Z�b�g�A�b�v
echo ================================================================================
echo.

:: ���݂̃t�H���_���擾
set "SCRIPT_DIR=%~dp0"
set "NATIVE_HOST_DIR=%SCRIPT_DIR%native-host"
set "JSON_FILE=%NATIVE_HOST_DIR%\com.cssjumper.open_vscode.json"
set "EXE_FILE=%NATIVE_HOST_DIR%\open_vscode.exe"

:: �p�X�̃o�b�N�X���b�V�����G�X�P�[�v
set "EXE_PATH_ESCAPED=%EXE_FILE:\=\\%"
set "JSON_PATH=%JSON_FILE%"

echo [1/3] JSON�t�@�C�����X�V��...

:: �g���@�\ID�̓��͂����߂�
echo.
echo Chrome�g���@�\��ID����͂��Ă�������
echo �ichrome://extensions/ �Ŋm�F�ł��܂��j
echo.
set /p EXT_ID="�g���@�\ID: "

if "%EXT_ID%"=="" (
    echo �G���[: ID�����͂���Ă��܂���
    pause
    exit /b 1
)

:: JSON�t�@�C���𐶐��i���̊��̊g��ID�ێ��j
:: ���ɑ��̊��̊g��ID������Ύ����Ǝc��
set "EXISTING_IDS="
if exist "%JSON_FILE%" (
    for /f "tokens=*" %%a in ('powershell -NoProfile -Command "$j = Get-Content '%JSON_FILE%' -Raw | ConvertFrom-Json; $j.allowed_origins | ForEach-Object { $_ -replace 'chrome-extension://','' -replace '/.*','' } | Where-Object { $_ -ne '%EXT_ID%' } | ForEach-Object { Write-Output $_ }"') do (
        set "EXISTING_IDS=%%a"
    )
)

:: allowed_origins ��\�z
if "%EXISTING_IDS%"=="" (
    set "ORIGINS=[\"chrome-extension://%EXT_ID%/\"]"
) else (
    set "ORIGINS=[\"chrome-extension://%EXT_ID%/\", \"chrome-extension://%EXISTING_IDS%/\"]"
)

:: PowerShell��JSON�𐮌`�ŏo��
powershell -NoProfile -Command ^
    "$json = @{ name='com.cssjumper.open_vscode'; description='Open VS Code from CSS Jumper'; path='%EXE_PATH_ESCAPED%'; type='stdio'; allowed_origins=@() };" ^
    "$ids = @('%EXT_ID%');" ^
    "if ('%EXISTING_IDS%' -ne '') { $ids += '%EXISTING_IDS%' };" ^
    "$json.allowed_origins = $ids | ForEach-Object { 'chrome-extension://' + $_ + '/' };" ^
    "$json | ConvertTo-Json -Depth 10 | Set-Content '%JSON_FILE%' -Encoding UTF8"

echo    ����
echo.

echo [2/3] ���W�X�g���ɓo�^��...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cssjumper.open_vscode" /ve /t REG_SZ /d "%JSON_FILE%" /f > nul
echo    ����
echo.

echo [3/3] vscode://�v���g�R���o�^��...
:: VS Code�̃p�X��T��
set "VSCODE_PATH="
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
    set "VSCODE_PATH=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"
)
if exist "C:\Program Files\Microsoft VS Code\Code.exe" (
    set "VSCODE_PATH=C:\Program Files\Microsoft VS Code\Code.exe"
)

if "%VSCODE_PATH%"=="" (
    echo    VS Code��������܂���B�蓮�œo�^���Ă��������B
) else (
    reg add "HKCU\Software\Classes\vscode" /ve /t REG_SZ /d "URL:vscode" /f > nul
    reg add "HKCU\Software\Classes\vscode" /v "URL Protocol" /t REG_SZ /d "" /f > nul
    reg add "HKCU\Software\Classes\vscode\shell\open\command" /ve /t REG_SZ /d "\"%VSCODE_PATH%\" --open-url -- \"%%1\"" /f > nul
    echo    ����
)

echo.
echo ================================================================================
echo �Z�b�g�A�b�v�����I
echo ================================================================================
echo.
echo ���̎菇:
echo   1. Chrome�����S�ɕ��čċN��
echo   2. �g���@�\�̃|�b�v�A�b�v�Ńv���W�F�N�g�p�X��ݒ�
echo   3. Alt+�N���b�N�Ńe�X�g
echo.
pause
