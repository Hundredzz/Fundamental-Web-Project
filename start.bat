@echo off
echo Installing dependencies...
call npm install express ejs sqlite3 express-session cookie-parser multer

echo.
echo Starting the server...
node index.js

pause