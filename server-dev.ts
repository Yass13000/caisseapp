import { createServer } from 'http';
import { parse } from 'url';
import dotenv from 'dotenv';
import handler from './api/create-sumup-checkout';

// Charger les variables d'environnement
dotenv.config();

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
        
        // Simuler req/res Vercel
        const vercelReq = Object.assign(req, {
          query: parsedUrl.query,
          body: requestData
        }) as any;

        const vercelRes = Object.assign(res, {
          status: (code: number) => {
            res.statusCode = code;
            return vercelRes;
          },
          json: (data: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          },
          send: (data: any) => {
            res.end(data);
          }
        }) as any;

        await handler(vercelReq, vercelRes);
      } catch (error) {
        console.error('[Server] Error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
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
  console.log('');
  console.log('   Variables d\'environnement chargées:');
  console.log(`   • SUMUP_CLIENT_ID: ${process.env.SUMUP_CLIENT_ID ? '✅' : '❌'}`);
  console.log(`   • SUMUP_CLIENT_SECRET: ${process.env.SUMUP_CLIENT_SECRET ? '✅' : '❌'}`);
  console.log(`   • SUMUP_TERMINAL_SERIAL: ${process.env.SUMUP_TERMINAL_SERIAL ? '✅' : '❌'}`);
  console.log(`   • SUMUP_EMAIL: ${process.env.SUMUP_EMAIL ? '✅' : '❌'}`);
  console.log('');
});
