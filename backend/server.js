// server.js — Easy PDF Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Dossiers nécessaires ──────────────────────────────────
['./uploads', './pdfs'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Sécurité ──────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}));

// ── Rate limiting ─────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: { error: 'Trop de requêtes, veuillez réessayer dans 15 minutes.' }
});
app.use('/api/', limiter);

// ── Rate limit spécifique pour auth ──────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 min.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── Body parsing ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Servir le frontend ────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Routes API ────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/convert', require('./routes/convert'));

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    project: 'Easy PDF — Projet Étudiant'
  });
});

// ── 404 API ───────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// ── SPA fallback (toutes les autres routes → frontend) ────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Erreurs globales ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Fichier trop lourd (max ${process.env.MAX_FILE_SIZE_MB || 50} MB)` });
  }
  res.status(500).json({ error: err.message || 'Erreur serveur interne' });
});

// ── Démarrage ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║        Easy PDF — Backend API        ║
  ║      Projet Étudiant v1.0.0          ║
  ╠══════════════════════════════════════╣
  ║  🚀 Serveur: http://localhost:${PORT}   ║
  ║  📚 Mode: ${process.env.NODE_ENV || 'development'}               ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
