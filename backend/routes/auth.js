// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    });
    if (existing) {
      if (existing.email === email)
        return res.status(409).json({ error: 'Email déjà utilisé' });
      return res.status(409).json({ error: "Nom d'utilisateur déjà pris" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, passwordHash, provider: 'local' }
    });

    const token = signToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me — profil utilisateur connecté
router.get('/me', requireAuth, async (req, res) => {
  const { id, username, email, provider, createdAt } = req.user;
  const convCount = await prisma.conversion.count({ where: { userId: id } });
  res.json({ id, username, email, provider, createdAt, conversionCount: convCount });
});

// POST /api/auth/oauth — connexion via provider social (Google, Apple, Facebook)
// En production: vérifier le token OAuth côté serveur avec les SDK Google/Apple/Facebook
router.post('/oauth', async (req, res) => {
  try {
    const { provider, providerId, email, username } = req.body;
    if (!provider || !providerId || !email)
      return res.status(400).json({ error: 'Données OAuth manquantes' });

    let user = await prisma.user.findFirst({
      where: { OR: [{ providerId }, { email }] }
    });

    if (!user) {
      // Générer un username unique si déjà pris
      let finalUsername = username || email.split('@')[0];
      const existing = await prisma.user.findUnique({ where: { username: finalUsername } });
      if (existing) finalUsername = finalUsername + '_' + Date.now().toString().slice(-4);

      user = await prisma.user.create({
        data: { username: finalUsername, email, provider, providerId }
      });
    }

    const token = signToken(user.id);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('[oauth]', err);
    res.status(500).json({ error: 'Erreur serveur OAuth' });
  }
});

module.exports = router;
