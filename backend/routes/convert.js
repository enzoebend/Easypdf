// routes/convert.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ── Dossiers de sortie ─────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const PDF_DIR = process.env.PDF_OUTPUT_DIR || './pdfs';
[UPLOAD_DIR, PDF_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Multer config ──────────────────────────────────────────
const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg','image/png','image/gif','image/webp','image/bmp',
      'image/svg+xml','image/tiff',
      'text/plain','text/html',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Type de fichier non supporté: ${file.mimetype}`));
  }
});

// ── Générateur PDF ─────────────────────────────────────────
async function generatePDF(inputPath, outputPath, mimetype, originalName) {
  // Essayer d'abord avec Puppeteer (meilleure qualité)
  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();

    if (mimetype.startsWith('image/')) {
      // Pour les images: créer une page HTML centrée
      const ext = path.extname(originalName).toLowerCase();
      const dataUrl = `data:${mimetype};base64,` + fs.readFileSync(inputPath).toString('base64');
      await page.setContent(`<!DOCTYPE html><html><head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
      </style></head><body><img src="${dataUrl}"></body></html>`);
    } else if (mimetype === 'text/plain') {
      const content = fs.readFileSync(inputPath, 'utf8')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      await page.setContent(`<!DOCTYPE html><html><head><style>
        body { font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6;
               padding: 40px; color: #1a1a1a; background: white; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        h3 { font-family: sans-serif; color: #E85D26; margin-bottom: 20px; font-size: 16px; }
      </style></head><body>
        <h3>📄 ${originalName}</h3>
        <pre>${content}</pre>
      </body></html>`);
    } else if (mimetype === 'text/html') {
      const html = fs.readFileSync(inputPath, 'utf8');
      await page.setContent(html, { waitUntil: 'networkidle0' });
    } else {
      // DOCX et autres: fallback texte
      await page.setContent(`<!DOCTYPE html><html><head><style>
        body { font-family: sans-serif; padding: 60px; text-align: center; color: #1a1a1a; }
        .icon { font-size: 80px; margin-bottom: 20px; }
        h2 { font-size: 24px; color: #E85D26; }
        p { color: #666; margin-top: 10px; }
      </style></head><body>
        <div class="icon">📄</div>
        <h2>${originalName}</h2>
        <p>Converti via Easy PDF</p>
      </body></html>`);
    }

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }
    });

    await browser.close();
    return { method: 'puppeteer' };
  } catch (err) {
    // Fallback: Sharp pour les images si Puppeteer échoue
    if (mimetype.startsWith('image/') && !mimetype.includes('svg')) {
      try {
        const sharp = require('sharp');
        // Générer un PNG A4 de qualité et l'envelopper dans un PDF minimal
        const A4W = 2480, A4H = 3508; // A4 à 300dpi
        const imgBuffer = await sharp(inputPath)
          .resize(A4W, A4H, { fit: 'inside', withoutEnlargement: false })
          .jpeg({ quality: 95 })
          .toBuffer();

        // Construire un PDF minimal avec l'image JPEG intégrée
        const pdfBytes = buildMinimalPDF(imgBuffer, A4W, A4H);
        fs.writeFileSync(outputPath, pdfBytes);
        return { method: 'sharp' };
      } catch (sharpErr) {
        throw new Error('Conversion impossible: ' + sharpErr.message);
      }
    }
    throw err;
  }
}

// PDF minimal (fallback si Puppeteer non dispo)
function buildMinimalPDF(jpegBuffer, w, h) {
  const imgLen = jpegBuffer.length;
  const objs = [];
  objs.push(Buffer.from(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`));
  objs.push(Buffer.from(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`));
  objs.push(Buffer.from(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`));
  const streamContent = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`;
  objs.push(Buffer.from(`4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`));
  const img5header = Buffer.from(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLen} >>\nstream\n`);
  const img5end = Buffer.from(`\nendstream\nendobj\n`);

  const header = Buffer.from('%PDF-1.4\n');
  const parts = [header, ...objs, img5header, jpegBuffer, img5end];
  let offset = 0;
  const offsets = [];
  for (let i = 0; i < parts.length - 2; i++) { // -2 pour img+end
    if (i < objs.length + 1) offsets.push(offset);
    offset += parts[i].length;
  }
  const xrefOffset = offset;
  const xrefLines = [`xref\n0 6\n0000000000 65535 f \n`];
  offsets.forEach(o => xrefLines.push(String(o).padStart(10, '0') + ' 00000 n \n'));
  const xref = Buffer.from(xrefLines.join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.concat([...parts, xref]);
}

// ── ROUTE: POST /api/convert ──────────────────────────────
router.post('/', requireAuth, upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'Aucun fichier reçu' });

  const results = [];

  for (const file of req.files) {
    const convId = uuidv4();
    const pdfName = path.basename(file.originalname, path.extname(file.originalname)) + '_' + Date.now() + '.pdf';
    const pdfPath = path.join(PDF_DIR, pdfName);

    // Créer l'entrée en BDD avec statut "processing"
    const conv = await prisma.conversion.create({
      data: {
        id: convId,
        userId: req.user.id,
        originalName: file.originalname,
        originalSize: file.size,
        fileType: file.mimetype,
        pdfName,
        status: 'processing'
      }
    });

    try {
      await generatePDF(file.path, pdfPath, file.mimetype, file.originalname);
      const pdfSize = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).size : null;

      await prisma.conversion.update({
        where: { id: convId },
        data: { status: 'done', pdfSize }
      });

      results.push({
        id: convId,
        originalName: file.originalname,
        pdfName,
        status: 'done',
        downloadUrl: `/api/convert/download/${convId}`
      });
    } catch (err) {
      await prisma.conversion.update({
        where: { id: convId },
        data: { status: 'error', errorMsg: err.message }
      });
      results.push({
        id: convId,
        originalName: file.originalname,
        status: 'error',
        error: err.message
      });
    } finally {
      // Supprimer le fichier original uploadé
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  res.json({ results });
});

// ── ROUTE: GET /api/convert/download/:id ──────────────────
router.get('/download/:id', requireAuth, async (req, res) => {
  const conv = await prisma.conversion.findUnique({ where: { id: req.params.id } });
  if (!conv) return res.status(404).json({ error: 'Conversion introuvable' });
  if (conv.userId !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  if (conv.status !== 'done') return res.status(400).json({ error: 'PDF non disponible' });

  const pdfPath = path.join(PDF_DIR, conv.pdfName);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'Fichier PDF introuvable' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(conv.originalName.replace(/\.[^.]+$/, '') + '.pdf')}"`);
  // Permet le téléchargement sur mobile
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.sendFile(path.resolve(pdfPath));
});

// ── ROUTE: GET /api/convert/history ───────────────────────
router.get('/history', requireAuth, async (req, res) => {
  const conversions = await prisma.conversion.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  res.json({ conversions });
});

// ── ROUTE: DELETE /api/convert/:id ────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const conv = await prisma.conversion.findUnique({ where: { id: req.params.id } });
  if (!conv || conv.userId !== req.user.id) return res.status(404).json({ error: 'Introuvable' });

  const pdfPath = path.join(PDF_DIR, conv.pdfName);
  if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

  await prisma.conversion.delete({ where: { id: conv.id } });
  res.json({ success: true });
});

module.exports = router;
