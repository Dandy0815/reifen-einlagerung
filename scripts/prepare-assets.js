// Kopiert die Bibliotheken aus node_modules in die App, damit sie ohne Internet laufen.
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'lib');
const files = [
  ['pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['qrcode-generator/qrcode.js', 'qrcode.js'],
  ['jsqr/dist/jsQR.js', 'jsQR.js'],
];

fs.mkdirSync(target, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(__dirname, '..', 'node_modules', from);
  if (!fs.existsSync(src)) {
    console.error('Datei fehlt: ' + src + '\nBitte zuerst "npm install" ausführen.');
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(target, to));
  console.log('kopiert: ' + to);
}
