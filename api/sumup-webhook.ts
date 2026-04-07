import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';

// Types Vercel (inline pour éviter dépendance)
type VercelRequest = IncomingMessage & { query: Record<string, string | string[]>; body: any };
type VercelResponse = ServerResponse & { status: (code: number) => VercelResponse; json: (body: any) => void; send: (body: any) => void };

/**
 * Endpoint webhook pour recevoir les notifications de paiement SumUp
 * 
 * Documentation: https://developer.sumup.com/api/webhooks/
 * 
 * Configuration dans le dashboard SumUp:
 * URL: https://votre-domaine.vercel.app/api/sumup-webhook
 * Events: checkout.completed, checkout.failed
 */

interface SumUpWebhookPayload {
  event_type: 'checkout.completed' | 'checkout.failed' | string;
  event_id: string;
  timestamp: string;
  resource: {
    id: string;
    checkout_reference: string;
    amount: number;
    currency: string;
    status: 'PAID' | 'PENDING' | 'FAILED';
    date: string;
    merchant_code: string;
    description: string;
    transaction_id?: string;
    transaction_code?: string;
    payment_type?: string;
    card?: {
      last_4_digits: string;
      type: string;
    };
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body as SumUpWebhookPayload;

    console.log(`[SumUp Webhook] Received event: ${payload.event_type}`, {
      checkoutId: payload.resource.id,
      reference: payload.resource.checkout_reference,
      status: payload.resource.status,
    });

    // Vérification de sécurité (optionnel): vérifier la signature du webhook
    // const signature = req.headers['x-sumup-signature'];
    // if (!verifySignature(signature, req.body)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // Mise à jour de la commande dans Supabase
    if (payload.event_type === 'checkout.completed' && payload.resource.status === 'PAID') {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.error('[SumUp Webhook] Supabase credentials not configured');
        return res.status(500).json({ error: 'Database not configured' });
      }

      const supabase = createClient(supabaseUrl, supabaseKey);

      // Extraction de l'order_id depuis checkout_reference (format: order_123)
      const orderIdMatch = payload.resource.checkout_reference.match(/order_(\d+)/);
      const orderId = orderIdMatch ? parseInt(orderIdMatch[1]) : null;

      if (!orderId) {
        console.error('[SumUp Webhook] Could not extract order ID from reference:', payload.resource.checkout_reference);
        // On renvoie 200 quand même pour éviter que SumUp ne renvoie le webhook
        return res.status(200).json({ received: true, warning: 'Order ID not found' });
      }

      // Mise à jour de la commande avec les infos de paiement
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_method: 'sumup',
          payment_status: 'paid',
          sumup_transaction_id: payload.resource.transaction_id || payload.resource.id,
          sumup_payment_data: {
            checkout_id: payload.resource.id,
            checkout_reference: payload.resource.checkout_reference,
            transaction_code: payload.resource.transaction_code,
            payment_type: payload.resource.payment_type,
            card: payload.resource.card,
            amount: payload.resource.amount,
            currency: payload.resource.currency,
            paid_at: payload.timestamp,
          },
        })
        .eq('id', orderId);

      if (updateError) {
        console.error('[SumUp Webhook] Failed to update order:', updateError);
        return res.status(500).json({ error: 'Database update failed' });
      }

      console.log(`[SumUp Webhook] Order ${orderId} marked as paid`);
    }

    // Répondre 200 OK pour indiquer à SumUp que le webhook a été reçu
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[SumUp Webhook] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
