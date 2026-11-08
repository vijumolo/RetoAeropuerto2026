# Reto Aeropuerto 7ma Edición — Resultados y Diplomas Virtuales

Sitio web estático 100 % responsivo para consultar resultados de un evento de running, ver y descargar diplomas en PDF (1 hoja, A4 horizontal), imprimir y compartir por WhatsApp/QR. Sin backend, sin CDN, funciona offline y en `file://`.

## URL de producción

> ⚠️ Reemplazar con la URL real tras el despliegue en Vercel.
> Ejemplo: `https://reto-aeropuerto-7ma.vercel.app`

## Estructura del repositorio (`App/`)

| Archivo / carpeta | Propósito |
|---|---|
| `index.html` | App principal: buscador, filtros, lista, modales |
| `styles.css` | Tokens, `clamp()`, responsive (390 px), impresión, accesibilidad |
| `app.js` | Lógica de interfaz: búsqueda sin tildes, filtros, carga más, modal diploma, descarga PDF, QR, WhatsApp, analytics |
| `print.html` | Impresión A4 horizontal del diploma (`?dorsal=XXXX`) |
| `data.js` | `window.EVENT_DATA` (carga primero; válido en `file://`) |
| `data.json` | Mismo contenido para uso externo / API |
| `vendor/pdf-lib.min.js` | Generador de PDF del diploma en el cliente |
| `vendor/qrcode.js` | Generador de códigos QR |
| `assets/resultados-oficiales.pdf` | PDF oficial de resultados (copia) |
| `assets/diplomas-oficiales.pdf` | PDF oficial de diplomas (copia, 1 página por deportista) |
| `assets/qr-sitio.svg` | QR del sitio web |
| `assets/qr-whatsapp.png` | Poster QR 1080×1350 para WhatsApp |
| `diplomas/img/d-XXXX.webp` | Imagen de cada diploma (dorsal de 4 dígitos) |
| `server.js` | Servidor local de desarrollo (MIME, `no-store`, LAN, mock analytics) |
| `iniciar.bat` | Doble clic para abrir en el navegador |
| `LEEME.txt` | Guía rápida en español |
| `tools/` | Scripts de construcción y extracción (no se despliegan) |
| `tests/` | Pruebas automatizadas (Fase 5) |

Desplegado en Vercel (build vacío, salida = raíz). `.vercelignore` excluye `node_modules`, `tools/`, `server.js`, `package.json`, `iniciar.bat`, `LEEME.txt`, `README.md` del despliegue.

## Requisitos

- Node.js ≥ 22
- Chrome o Edge instalados (para pruebas con `puppeteer-core` y para generar el poster QR)
- Windows 10/11 + PowerShell

## Instalación y desarrollo

```bash
cd App
npm install
npm run iniciar      # o: node server.js
# Abre http://localhost:5173/
```

### Regenerar datos y assets

```bash
cd App
npm install
node tools/build.js                 # idempotente (omite imágenes existentes)
FORCE_RENDER=1 node tools/build.js  # regenera todas las imágenes WebP
```

## Despliegue en Vercel

1. `git init -b main` en `App/`
2. Añadir `.gitignore` (ya incluido): `node_modules`, `.vercel`, `*.log`, `tmp-*`, etc.
3. Subir el repositorio a GitHub.
4. Importar en Vercel: **Add New Project → Import Git Repository → Other framework**.
   - Build Command: (vacío / ninguno)
   - Output Directory: `.` (raíz)
   - Instalar Framework: "Other"
5. `vercel.json` ya configura:
   - `cleanUrls`, `trailingSlash: false`
   - Caché larga para `/diplomas/img` y `/vendor`
   - `data.js` con `max-age=0, must-revalidate`
   - `X-Content-Type-Options: nosniff`

**Importante:** `package.json` tiene el script `"datos"` (no `"build"`) para que Vercel no intente construir y falle. `package.json` está excluido del despliegue mediante `.vercelignore`.

## Web Analytics (Vercel)

1. En el dashboard de Vercel: Project → Analytics → Enable.
2. Desplegar nuevamente (obligatorio: si no, `/_vercel/insights/script.js` da 404).
3. Verificar: script 200 y `POST /_vercel/insights/view` → 200 con navegador real.
4. El panel muestra "Get Started" hasta la primera visita real. Los adblockers pueden bloquear el script.

El snippet ya está incluido en `index.html` (solo se carga en `http:`/`https:`, no en `file://` para evitar 404 de consola).

## Pruebas automatizadas (Fase 5)

```bash
cd App
npm test
```

Equivale a `node tests/run-tests.js`. Verifica:
- Sintaxis de JS (`node --check`)
- UI: 60 filas, contador total, búsqueda sin tildes por dorsal, modal con imagen y posiciones, descarga de PDF (1 página, 792×612 pt), filtros (distancia y género), `?dorsal=`, `print.html`, móvil 390×844 (0 px overflow), 0 errores de consola
- `file://`: datos, modal e imagen; descarga cae al fallback del PDF oficial
- Assets: MIME correctos, PDFs íntegros (N páginas)
- Analytics: `script.js` 200 y `POST /view` 200

## Reglas de oro

1. Todos los datos salen de los PDF; si falta, se muestra "—".
2. No se alteran nombres, tiempos, dorsales ni categorías.
3. Sin backend ni CDN: HTML/CSS/JS vanilla; funciona offline y en `file://`.
4. Un solo PDF de diplomas + recorte en el cliente (no `copyPages` por diploma).
5. Sin `node_modules` en el repo; sí `package.json` para regenerar.
6. UI en español, accesible (roles, foco, ESC) y responsive real (móvil 390 px).
7. Tokens/credenciales: solo variable de entorno, nunca en archivos ni en git.
8. Build idempotente.

## Licencia

Uso interno del evento Reto Aeropuerto 7ma Edición.
