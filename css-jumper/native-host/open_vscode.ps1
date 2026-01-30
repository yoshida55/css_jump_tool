# Native Messaging Host for CSS Jumper
$input = [Console]::OpenStandardInput()
$output = [Console]::OpenStandardOutput()

# メッセージ長を読み取り（4バイト）
$lengthBytes = New-Object byte[] 4
$input.Read($lengthBytes, 0, 4) | Out-Null
$length = [BitConverter]::ToInt32($lengthBytes, 0)

# メッセージ本体を読み取り
$messageBytes = New-Object byte[] $length
$input.Read($messageBytes, 0, $length) | Out-Null
$message = [System.Text.Encoding]::UTF8.GetString($messageBytes)

# JSONをパース
$json = $message | ConvertFrom-Json
$url = $json.url

# VS Codeを開く
Start-Process $url

# 成功レスポンスを返す
$response = '{"success":true}'
$responseBytes = [System.Text.Encoding]::UTF8.GetBytes($response)
$responseLengthBytes = [BitConverter]::GetBytes($responseBytes.Length)
$output.Write($responseLengthBytes, 0, 4)
$output.Write($responseBytes, 0, $responseBytes.Length)
$output.Flush()
