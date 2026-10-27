@echo off
echo ========================================================
echo Pushing latest changes to GitHub (ShwaansGaba/A10D)...
echo ========================================================

git add .
git commit -m "update: latest changes"
git push origin main

echo.
echo ========================================================
echo Pushed successfully to https://github.com/ShwaansGaba/A10D.git!
echo Check deployment at https://github.com/ShwaansGaba/A10D/actions
echo ========================================================
pause
