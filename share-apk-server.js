const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APK_PATH = path.join(__dirname, 'A10D-Kiosk.apk');
const FALLBACK_APK_PATH = path.join(__dirname, 'build', 'app', 'outputs', 'flutter-apk', 'app-arm64-v8a-release.apk');

const targetApk = fs.existsSync(APK_PATH) ? APK_PATH : (fs.existsSync(FALLBACK_APK_PATH) ? FALLBACK_APK_PATH : null);

if (!targetApk) {
  console.error('[ERROR] A10D-Kiosk.apk could not be found! Please build the APK first.');
  process.exit(1);
}

// Find local Wi-Fi / LAN IP
const ifaces = os.networkInterfaces();
let localIp = '127.0.0.1';
for (const dev in ifaces) {
  for (const details of ifaces[dev]) {
    if (details.family === 'IPv4' && !details.internal) {
      if (details.address.startsWith('192.168.') || details.address.startsWith('10.') || details.address.startsWith('172.')) {
        localIp = details.address;
        break;
      }
    }
  }
}

const PORT = 8080;
const stat = fs.statSync(targetApk);
const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);

const server = http.createServer((req, res) => {
  if (req.url === '/download' || req.url === '/A10D-Kiosk.apk') {
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="A10D-Kiosk.apk"'
    });
    fs.createReadStream(targetApk).pipe(res);
    console.log(`[DOWNLOAD] Phone started downloading APK (${sizeMb} MB)...`);
    return;
  }

  // Mobile Web Landing Page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download A10D Kiosk APK</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 24px; padding: 32px 24px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    .logo { width: 80px; height: 80px; background: linear-gradient(135deg, #1D93CA, #0284c7); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 38px; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(29,147,202,0.4); }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #ffffff; }
    p.subtitle { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .badge-container { display: flex; justify-content: center; gap: 8px; margin-bottom: 28px; }
    .badge { background: #334155; color: #38bdf8; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 20px; }
    .btn { display: block; width: 100%; background: linear-gradient(135deg, #1D93CA, #0284c7); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 700; padding: 18px; border-radius: 16px; box-shadow: 0 10px 20px rgba(29,147,202,0.35); transition: transform 0.15s; }
    .btn:active { transform: scale(0.98); }
    .instructions { text-align: left; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 16px; margin-top: 24px; font-size: 13px; color: #94a3b8; line-height: 1.6; }
    .instructions b { color: #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚡</div>
    <h1>A10D Kiosk App</h1>
    <p class="subtitle">Face Biometric Attendance System<br>Optimized Android Release</p>
    <div class="badge-container">
      <span class="badge">ARM64 Release</span>
      <span class="badge">${sizeMb} MB</span>
      <span class="badge">v2.0</span>
    </div>
    <a href="/download" class="btn">📥 Tap to Download & Install</a>
    <div class="instructions">
      <b>After downloading:</b><br>
      1. Tap <i>Open</i> on the downloaded file.<br>
      2. If prompted, allow <i>Install from unknown sources</i> for your browser.<br>
      3. Tap <b>Install</b> or <b>Update</b> to run the app.
    </div>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n====================================================================');
  console.log('         A10D - WIRELESS PHONE INSTALLER / DOWNLOAD SERVER');
  console.log('====================================================================\n');
  console.log(' 1. Connect your phone to the same Wi-Fi as this PC.');
  console.log(' 2. Open Chrome (or any browser) on your phone and go to:\n');
  console.log(`      👉  http://${localIp}:${PORT}  👈\n`);
  console.log(' 3. Tap the "Download & Install" button on your phone screen.\n');
  console.log('====================================================================');
  console.log(' Server running. Press Ctrl + C to stop when installation is complete.\n');
});
