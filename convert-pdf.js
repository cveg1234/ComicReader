const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
const { createCanvas } = require('canvas');
const path = require('path');
const fs = require('fs');

const targetDir = process.argv[2] || path.join(require('os').homedir(), 'Downloads');

async function convertPdfToJpg(pdfPath, outputDir) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument(data).promise;
  const baseName = path.basename(pdfPath, '.pdf');

  const pdfOutputDir = path.join(outputDir, baseName);
  if (!fs.existsSync(pdfOutputDir)) fs.mkdirSync(pdfOutputDir, { recursive: true });

  console.log(`Converting ${pdfPath} (${doc.numPages} pages)...`);

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const jpgPath = path.join(pdfOutputDir, `page-${String(i).padStart(3, '0')}.jpg`);
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    fs.writeFileSync(jpgPath, buffer);
    page.cleanup();
    process.stdout.write(`\r  Page ${i}/${doc.numPages}`);
  }

  console.log(`\nDone -> ${pdfOutputDir}`);
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    console.error('Directory not found:', targetDir);
    process.exit(1);
  }

  const files = fs.readdirSync(targetDir).filter(f => f.toLowerCase().endsWith('.pdf'));

  if (files.length === 0) {
    console.log('No PDFs found in', targetDir);
    return;
  }

  for (const file of files) {
    const pdfPath = path.join(targetDir, file);
    const stats = fs.statSync(pdfPath);
    if (stats.isFile()) {
      await convertPdfToJpg(pdfPath, targetDir);
    }
  }
}

main().catch(console.error);
