#!/usr/bin/env node

/**
 * Serveur de développement simple pour tester les fonctions serverless Vercel
 * Lance un serveur HTTP qui simule l'environnement Vercel
 */

import { createServer } from 'http';
import { parse } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement
dotenv.config({ path: join(__dirname, '.env') });

const PORT = 3000;

const server = createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '/';

  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route: /api/create-sumup-checkout
  if (pathname === '/api/create-sumup-checkout' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        
        // Exécuter le fichier TypeScript avec tsx
        const child = spawn('npx', ['tsx', './api/create-sumup-checkout.ts'], {
          cwd: __dirname,
          env: { ...process.env, REQUEST_BODY: JSON.stringify(requestData) }
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
          output += data.toString();
        });

        child.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        child.on('close', (code) => {
          if (code !== 0) {
            console.error('[Server] Error:', errorOutput);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              error: 'Internal server error',
              message: errorOutput
            }));
            return;
          }

          try {
            const result = JSON.parse(output);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
              error: 'Invalid response',
              message: output
            }));
          }
        });

      } catch (error) {
        console.error('[Server] Error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          error: 'Internal server error',
          message: error.message 
        }));
      }
    });
    return;
  }

  // Route: /api/sumup-webhook
  if (pathname === '/api/sumup-webhook' && req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        
        const { default: handler } = await import('./api/sumup-webhook.ts');
        
        const vercelReq = Object.assign(req, {
          query: parsedUrl.query,
          body: requestData
        });

        const vercelRes = Object.assign(res, {
          status: (code) => {
            res.statusCode = code;
            return vercelRes;
          },
          json: (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          },
          send: (data) => {
            res.end(data);
          }
        });

        await handler(vercelReq, vercelRes);
      } catch (error) {
        console.error('[Server] Error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          error: 'Internal server error',
          message: error.message 
        }));
      }
    });
    return;
  }

  // 404 pour les autres routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log('');
  console.log('🚀 Serveur API de développement démarré');
  console.log('');
  console.log(`   📡 API disponible sur: http://localhost:${PORT}`);
  console.log('');
  console.log('   Endpoints:');
  console.log(`   • POST /api/create-sumup-checkout`);
  console.log(`   • POST /api/sumup-webhook`);
  console.log('');
  console.log('   Variables d\'environnement chargées:');
  console.log(`   • SUMUP_CLIENT_ID: ${process.env.SUMUP_CLIENT_ID ? '✅' : '❌'}`);
  console.log(`   • SUMUP_CLIENT_SECRET: ${process.env.SUMUP_CLIENT_SECRET ? '✅' : '❌'}`);
  console.log(`   • SUMUP_TERMINAL_SERIAL: ${process.env.SUMUP_TERMINAL_SERIAL ? '✅' : '❌'}`);
  console.log(`   • SUMUP_EMAIL: ${process.env.SUMUP_EMAIL ? '✅' : '❌'}`);
  console.log('');
});
