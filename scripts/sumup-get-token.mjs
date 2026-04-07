#!/usr/bin/env node

/**
 * Script pour obtenir un Access Token SumUp via OAuth2
 * 
 * Usage:
 *   node scripts/sumup-get-token.mjs
 * 
 * Nécessite:
 *   - SUMUP_CLIENT_ID dans .env.local
 *   - SUMUP_CLIENT_SECRET dans .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createServer } from 'http';

// Charger .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.SUMUP_CLIENT_ID;
const CLIENT_SECRET = process.env.SUMUP_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ SUMUP_CLIENT_ID et SUMUP_CLIENT_SECRET requis dans .env.local');
  process.exit(1);
}

console.log('🔐 Obtention Access Token SumUp OAuth2\n');
console.log('Client ID:', CLIENT_ID.substring(0, 10) + '***');
console.log('Redirect URI:', REDIRECT_URI);
console.log('\n📋 Étapes:\n');

// Étape 1 : URL d'autorisation
const authUrl = new URL('https://api.sumup.com/authorize');
authUrl.searchParams.append('response_type', 'code');
authUrl.searchParams.append('client_id', CLIENT_ID);
authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
authUrl.searchParams.append('scope', 'payments');

console.log('1️⃣  Ouvrez cette URL dans votre navigateur:\n');
console.log(`   ${authUrl.toString()}\n`);
console.log('2️⃣  Connectez-vous avec votre compte SumUp');
console.log('3️⃣  Autorisez l\'application');
console.log('4️⃣  Vous serez redirigé vers localhost:3333/callback\n');

// Étape 2 : Serveur local pour recevoir le code
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>❌ Erreur: Aucun code reçu</h1>');
      return;
    }

    console.log('✅ Code d\'autorisation reçu:', code.substring(0, 10) + '***\n');
    console.log('5️⃣  Échange du code contre un Access Token...\n');

    // Étape 3 : Échanger le code contre un access token
    try {
      const tokenResponse = await fetch('https://api.sumup.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('❌ Erreur lors de l\'échange du token:', errorText);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>❌ Erreur</h1><pre>${errorText}</pre>`);
        return;
      }

      const tokenData = await tokenResponse.json();

      console.log('✅ Access Token obtenu!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('📝 Ajoutez ces lignes dans votre .env.local:\n');
      console.log(`# Production (Vercel)`);
      console.log(`SUMUP_API_KEY=${tokenData.access_token}`);
      console.log(`\n# Dev local`);
      console.log(`VITE_SUMUP_API_KEY=${tokenData.access_token}`);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log(`⏰ Expire dans: ${tokenData.expires_in} secondes (${Math.floor(tokenData.expires_in / 3600)} heures)`);
      
      if (tokenData.refresh_token) {
        console.log(`\n🔄 Refresh Token (pour renouveler):`);
        console.log(`   ${tokenData.refresh_token}`);
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head>
            <title>✅ Token obtenu</title>
            <style>
              body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
              pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
              .success { color: green; }
            </style>
          </head>
          <body>
            <h1 class="success">✅ Access Token obtenu avec succès!</h1>
            <p>Copiez ces lignes dans votre <code>.env.local</code>:</p>
            <pre># Production (Vercel)
SUMUP_API_KEY=${tokenData.access_token}

# Dev local
VITE_SUMUP_API_KEY=${tokenData.access_token}</pre>
            <p><strong>⏰ Expire dans:</strong> ${Math.floor(tokenData.expires_in / 3600)} heures</p>
            <p>Vous pouvez fermer cette fenêtre.</p>
          </body>
        </html>
      `);

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 2000);

    } catch (error) {
      console.error('❌ Erreur:', error.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>❌ Erreur</h1><pre>${error.message}</pre>`);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(3333, () => {
  console.log('🌐 Serveur de callback démarré sur http://localhost:3333');
  console.log('⏳ En attente de la redirection...\n');
});

// Ouvrir automatiquement le navigateur (macOS)
import { exec } from 'child_process';
exec(`open "${authUrl.toString()}"`);
