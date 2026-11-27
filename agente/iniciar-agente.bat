@echo off
title Katu POS - Agente de equipos
cd /d %~dp0
if not exist node_modules call npm install --omit=dev
if not exist .env copy .env.example .env
node agente.js
echo.
echo El agente se detuvo. Revisa el mensaje de arriba.
pause
