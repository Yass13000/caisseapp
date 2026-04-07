import type { IncomingMessage, ServerResponse } from 'http';

// Types Vercel (inline pour éviter dépendance)
type VercelRequest = IncomingMessage & { query: Record<string, string | string[]>; body: any };
type VercelResponse = ServerResponse & { status: (code: number) => VercelResponse; json: (body: any) => void; send: (body: any) => void };

/**
 * Endpoint serverless pour créer un checkout SumUp via l'API Cloud
 * 
 * Documentation: https://developer.sumup.com/docs/api/tag/Checkouts
 * 
 * Variables d'environnement requises (CÔTÉ SERVEUR UNIQUEMENT):
 * - SUMUP_CLIENT_ID: Client ID de votre application SumUp
 * - SUMUP_CLIENT_SECRET: Client Secret de votre application SumUp
 * - SUMUP_TERMINAL_SERIAL: Numéro de série du terminal Solo
 * - SUMUP_EMAIL: Email du compte marchand SumUp
 */

interface CreateCheckoutRequest {
  amount: number;
  currency?: string;
  description?: string;
  orderId?: string;
  customerEmail?: string;
}

interface SumUpCheckoutResponse {
  id: string;
  checkout_reference: string;
  amount: number;
  currency: string;
  merchant_code: string;
  description: string;
  status: string;
  date: string;
  valid_until: string;
}

// Cache du token OAuth (en mémoire, valide 1 heure)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Vérifier si le token en cache est encore valide
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    console.log('[SumUp OAuth] Using cached token');
    return cachedToken.token;
  }

  const clientId = process.env.SUMUP_CLIENT_ID;
  const clientSecret = process.env.SUMUP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SUMUP_CLIENT_ID and SUMUP_CLIENT_SECRET must be configured');
  }

  console.log('[SumUp OAuth] Requesting new access token with scope: payments');

  // Obtenir un token via OAuth2 Client Credentials
  const tokenResponse = await fetch('https://api.sumup.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'payments',
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[SumUp OAuth] Token request failed:', tokenResponse.status, errorText);
    throw new Error(`Failed to obtain access token: ${tokenResponse.status} - ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  
  console.log('[SumUp OAuth] Token response:', {
    hasAccessToken: !!tokenData.access_token,
    expiresIn: tokenData.expires_in,
    scope: tokenData.scope,
    tokenType: tokenData.token_type
  });

  // Mettre en cache le token (expire dans 1 heure - 5 minutes de marge)
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in - 300) * 1000,
  };

  console.log('[SumUp OAuth] Access token obtained successfully');
  return tokenData.access_token;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS headers pour permettre les appels depuis le front
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, currency = 'EUR', description, orderId, customerEmail } = req.body as CreateCheckoutRequest;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount is required and must be positive' });
    }

    const terminalSerial = process.env.SUMUP_TERMINAL_SERIAL;
    const merchantEmail = process.env.SUMUP_EMAIL;

    if (!terminalSerial) {
      console.error('[SumUp API] SUMUP_TERMINAL_SERIAL not configured');
      return res.status(500).json({ error: 'SumUp terminal serial not configured' });
    }

    if (!merchantEmail) {
      console.error('[SumUp API] SUMUP_EMAIL not configured');
      return res.status(500).json({ error: 'SumUp merchant email not configured' });
    }

    // Obtenir le token OAuth
    const accessToken = await getAccessToken();

    console.log(`[SumUp API] Creating checkout for amount: ${amount} ${currency}`);

    // Appel à l'API SumUp pour créer un checkout
    const checkoutResponse = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        checkout_reference: orderId || `order_${Date.now()}`,
        amount,
        currency,
        merchant_code: merchantEmail, // L'email du marchand
        description: description || 'Commande restaurant',
        pay_to_email: merchantEmail,
        return_url: process.env.SUMUP_RETURN_URL || `${req.headers.origin}/payment-success`,
      }),
    });

    if (!checkoutResponse.ok) {
      const errorData = await checkoutResponse.text();
      console.error('[SumUp API] Checkout creation failed:', checkoutResponse.status, errorData);
      return res.status(checkoutResponse.status).json({ 
        error: 'Failed to create SumUp checkout',
        details: errorData 
      });
    }

    const checkoutData: SumUpCheckoutResponse = await checkoutResponse.json();

    console.log(`[SumUp API] Checkout created successfully: ${checkoutData.id}`);

    return res.status(200).json({
      success: true,
      checkout: {
        id: checkoutData.id,
        checkoutReference: checkoutData.checkout_reference,
        amount: checkoutData.amount,
        currency: checkoutData.currency,
        status: checkoutData.status,
        validUntil: checkoutData.valid_until,
        // URL pour rediriger le client vers le paiement SumUp
        paymentUrl: `https://pay.sumup.com/${checkoutData.id}`,
      }
    });

  } catch (error) {
    console.error('[SumUp API] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
