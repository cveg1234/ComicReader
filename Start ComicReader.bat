@echo off
title MyComicReader
cd /d "%~dp0"
if not exist "node_modules\" npm install
npm start
