@echo off
:: Reto Aeropuerto · servidor local de desarrollo
:: Ejecuta: doble clic sobre iniciar.bat  (o: cmd /c iniciar.bat)
setlocal

set "PORT=5173"
if not defined NO_OPEN set "NO_OPEN="

echo ============================================
echo   Reto Aeropuerto - Servidor local
echo ============================================
echo.
echo Puerto: %PORT%
echo Abriendo el navegador automaticamente...
echo.

:: Usar node de la carpeta actual si existe, si no el del PATH
if exist "node.exe" (
  set "NODE=node.exe"
) else (
  set "NODE=node"
)

set "NO_OPEN=1"
start "" "%NODE%" server.js %PORT%

echo.
echo Si el navegador no se abrio, visite: http://localhost:%PORT/
echo Para detener: cierre esta ventana o presione Ctrl+C en la consola de node.
pause
