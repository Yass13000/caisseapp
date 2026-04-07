import { Capacitor } from '@capacitor/core';

export interface SumUpPaymentResponse {
  success: boolean;
  transactionCode?: string;
  error?: string;
  cardType?: string;
  amount?: number;
  currency?: string;
}

class PaymentService {
  private isAvailable(): boolean {
    return Capacitor.isNativePlatform() && (window as any).SumUp;
  }

  /**
   * Login à SumUp avec une clé d'API (nécessaire avant paiement)
   * @param affiliateKey Clé d'affilié SumUp
   */
  public async login(affiliateKey: string): Promise<boolean> {
    if (!this.isAvailable()) return false;

    return new Promise((resolve) => {
      (window as any).SumUp.login(affiliateKey, (res: any) => {
        resolve(res === 'OK');
      }, (err: any) => {
        console.error('SumUp login error:', err);
        resolve(false);
      });
    });
  }

  /**
   * Déclenche un paiement sur le TPE
   * @param amount Montant du paiement
   * @param currency Devise (par défaut 'EUR')
   * @param title Titre de la transaction
   * @param receiptEmail Optionnel: Email pour le reçu
   */
  public async makePayment(
    amount: number, 
    currency: string = 'EUR', 
    title: string = 'Commande Kiosque',
    receiptEmail?: string
  ): Promise<SumUpPaymentResponse> {
    if (!this.isAvailable()) {
      return { success: false, error: 'SumUp plugin not available' };
    }

    const request = {
      amount,
      currency,
      title,
      receiptEmail
    };

    return new Promise((resolve) => {
      (window as any).SumUp.pay(request, (res: any) => {
        // Le plugin retourne généralement un objet avec les détails de transaction
        resolve({
          success: true,
          transactionCode: res.transaction_code,
          cardType: res.card_type,
          amount: res.amount,
          currency: res.currency
        });
      }, (err: any) => {
        console.error('SumUp payment error:', err);
        resolve({
          success: false,
          error: err || 'Payment failed or cancelled'
        });
      });
    });
  }

  /**
   * Ouvre les réglages SumUp pour configurer le terminal (Bluetooth, etc)
   */
  public async openSettings(): Promise<boolean> {
    if (!this.isAvailable()) return false;

    return new Promise((resolve) => {
      (window as any).SumUp.preferences(() => {
        resolve(true);
      }, (err: any) => {
        console.error('SumUp preferences error:', err);
        resolve(false);
      });
    });
  }
}

export const paymentService = new PaymentService();
