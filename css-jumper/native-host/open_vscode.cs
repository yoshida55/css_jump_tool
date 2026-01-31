using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Text.RegularExpressions;

class Program {
    static void Main() {
        try {
            // stdin からメッセージ長（4バイト）を読む
            Stream stdin = Console.OpenStandardInput();
            byte[] lenBuf = new byte[4];
            stdin.Read(lenBuf, 0, 4);
            int msgLen = BitConverter.ToInt32(lenBuf, 0);

            // メッセージ本文を読む
            byte[] msgBuf = new byte[msgLen];
            int totalRead = 0;
            while (totalRead < msgLen) {
                totalRead += stdin.Read(msgBuf, totalRead, msgLen - totalRead);
            }
            string msg = Encoding.UTF8.GetString(msgBuf);

            // JSON から file と line を抽出（正規表現）
            string file = ExtractJsonValue(msg, "file");
            string line = ExtractJsonValue(msg, "line");

            // code --goto file:line で VS Code を起動（cmd経由で.cmdを解決）
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = "/c code --goto \"" + file + ":" + line + "\"";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process.Start(psi);

            // 成功レスポンスを返す
            SendResponse("{\"success\":true}");
        } catch (Exception ex) {
            string safeMsg = ex.Message.Replace("\"", "'").Replace("\\", "/");
            SendResponse("{\"success\":false,\"error\":\"" + safeMsg + "\"}");
        }
    }

    static string ExtractJsonValue(string json, string key) {
        // "key":"value" or "key":number のパターンを抽出
        string pattern = "\"" + key + "\"\\s*:\\s*\"?(.*?)\"?[,}]";
        Match m = Regex.Match(json, pattern);
        if (m.Success) {
            string val = m.Groups[1].Value;
            // JSON のエスケープされたバックスラッシュを戻す
            val = val.Replace("\\\\", "\\");
            // 末尾の引用符を除去
            val = val.TrimEnd('"');
            return val;
        }
        return "";
    }

    static void SendResponse(string response) {
        byte[] respBytes = Encoding.UTF8.GetBytes(response);
        byte[] lenBytes = BitConverter.GetBytes(respBytes.Length);
        Stream stdout = Console.OpenStandardOutput();
        stdout.Write(lenBytes, 0, 4);
        stdout.Write(respBytes, 0, respBytes.Length);
        stdout.Flush();
    }
}
