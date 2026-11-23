@echo off
chcp 65001 > nul
echo ====================================================
echo スマブラ3on3 チームドラフト - GitHub Pages デプロイ実行中...
echo ====================================================
echo.

echo [1/1] GitHub (origin/main) へ最新コミットをプッシュ中...
git push -u origin main
if %ERRORLEVEL% neq 0 (
    echo [エラー] GitHubへのプッシュに失敗しました。
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================
echo デプロイ（GitHubへのプッシュ）が正常に完了しました！
echo 公開URL: https://takaken0518.github.io/random_team_maker_4_3on3/
echo ====================================================
pause
