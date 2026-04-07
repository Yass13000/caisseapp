/**
 * Service pour l'intégration SumUp Cloud API
 * Remplace sumupTerminalService.ts pour le mode Cloud
 */

interface CreateCheckoutParams {
  amount: number;
  currency?: string;
  description?: string;
  orderId?: string;
  customerEmail?: string;
}

interface CheckoutResponse {
  success: boolean;
  checkout: {
    id: string;
    checkoutReference: string;
    amount: number;
    currency: string;
    status: string;
    validUntil: string;
    paymentUrl: string;
  };
}

class SumUpCloudService {
  private apiEndpoint: string;

  constructor() {
    // Toujours passer par l'endpoint serverless (sécurisé)
    // En dev: proxy Vite vers /api/* (à configurer)
    // En prod: Vercel serverless functions
    this.apiEndpoint = '/api/create-sumup-checkout';
  }

  /**
   * Crée un checkout SumUp et retourne l'URL de paiement
   * Appelle TOUJOURS l'endpoint serverless (jamais d'appel direct client)
   */
  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResponse> {
    console.log('[SumUp Cloud] Creating checkout:', params);

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[SumUp Cloud] Checkout creation failed:', response.status, errorData);
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: CheckoutResponse = await response.json();
      console.log('[SumUp Cloud] Checkout created:', data.checkout.id);

      return data;
    } catch (error) {
      console.error('[SumUp Cloud] Error creating checkout:', error);
      throw error;
    }
  }

  /**
   * Ouvre l'URL de paiement dans un nouvel onglet ou fenêtre popup
   */
  openPaymentWindow(paymentUrl: string, popup = false): Window | null {
    console.log('[SumUp Cloud] Opening payment:', paymentUrl);

    if (popup) {
      // Fenêtre popup centrée
      const width = 600;
      const height = 800;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;
      
      return window.open(
        paymentUrl,
        'SumUpPayment',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
      );
    } else {
      // Nouvel onglet
      return window.open(paymentUrl, '_blank');
    }
  }

  /**
   * Génère un QR code contenant l'URL de paiement (pour affichage sur borne)
   * Utilise une API gratuite de génération de QR codes
   */
  getQRCodeUrl(paymentUrl: string, size = 300): string {
    const encodedUrl = encodeURIComponent(paymentUrl);
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodedUrl}`;
  }

  /**
   * Vérifie le statut d'un paiement (polling manuel)
   * Note: En production, préférer l'utilisation de webhooks
   */
  async checkPaymentStatus(checkoutId: string): Promise<{ status: string; paid: boolean }> {
    console.log('[SumUp Cloud] Checking payment status:', checkoutId);
    
    // TODO: Implémenter un endpoint pour vérifier le statut
    // Pour l'instant, retourne un placeholder
    throw new Error('Payment status check not implemented. Use webhooks instead.');
  }
}

// Export singleton
export const sumupCloudService = new SumUpCloudService();
