@echo off
chcp 65001 > nul
echo ====================================================
echo スマブラ3on3 チームドラフト - AWS デプロイ実行中...
echo ====================================================
echo.

echo [1/2] S3バケットへ最新ファイルを同期中...
aws s3 sync . s3://smash-3on3-team-draft-069089525875/ --exclude "*" --include "index.html" --include "team.html" --include "index.css" --include "sample_participants.csv" --include "js/*" --include "audio/*"
if %ERRORLEVEL% neq 0 (
    echo [エラー] S3へのアップロードに失敗しました。
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] CloudFrontのキャッシュをクリア中...
aws cloudfront create-invalidation --distribution-id E3V9FHQ10CNA0 --paths "/*"
if %ERRORLEVEL% neq 0 (
    echo [エラー] CloudFrontキャッシュの無効化に失敗しました。
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ====================================================
echo デプロイが正常に完了しました！
echo 公開URL: https://d17rgiovi2e9q9.cloudfront.net
echo ====================================================
pause
