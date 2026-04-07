/**
 * Service de communication avec le terminal SumUp via l'API réseau local
 * 
 * Ce service permet de :
 * - Vérifier la connexion au terminal
 * - Initier des paiements
 * - Récupérer le statut des transactions
 * - Annuler des paiements en cours
 * 
 * Documentation SumUp Terminal API: https://developer.sumup.com/docs/terminal-api/
 */

import type {
  SumUpTerminalConfig,
  TerminalStatus,
  PaymentRequest,
  PaymentResponse,
  PaymentResult,
  InitiatePaymentOptions,
  StoredSumUpConfig
} from '../types/sumup';

const STORAGE_KEY = 'sumup_terminal_config';
const DEFAULT_PORT = 8080;
const DEFAULT_TIMEOUT = 60000; // 60 secondes

class SumUpTerminalService {
  private config: SumUpTerminalConfig | null = null;
  private currentTransactionId: string | null = null;

  constructor() {
    this.loadConfig();
  }

  /**
   * Charger la configuration depuis le localStorage
   */
  private loadConfig(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredSumUpConfig = JSON.parse(stored);
        this.config = {
          terminalIp: parsed.terminalIp,
          port: parsed.port || DEFAULT_PORT,
          timeout: DEFAULT_TIMEOUT,
          pairingCode: parsed.pairingCode,
          authToken: parsed.authToken
        };
      } else {
        // Si aucune config en localStorage, utiliser les valeurs par défaut de .env.local
        const defaultIp = import.meta.env.VITE_SUMUP_DEFAULT_IP;
        const defaultPort = parseInt(import.meta.env.VITE_SUMUP_DEFAULT_PORT || '8080');
        
        if (defaultIp) {
          console.log('[SumUp] Configuration par défaut chargée depuis .env.local:', defaultIp);
          this.config = {
            terminalIp: defaultIp,
            port: defaultPort,
            timeout: DEFAULT_TIMEOUT
          };
          // Sauvegarder la config par défaut
          this.saveConfig();
        }
      }
    } catch (error) {
      console.error('[SumUp] Erreur chargement config:', error);
    }
  }

  /**
   * Sauvegarder la configuration dans le localStorage
   */
  private saveConfig(): void {
    if (!this.config) return;
    
    try {
      const toStore: StoredSumUpConfig = {
        terminalIp: this.config.terminalIp,
        port: this.config.port,
        lastUsed: new Date().toISOString(),
        pairingCode: this.config.pairingCode,
        authToken: this.config.authToken
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.error('[SumUp] Erreur sauvegarde config:', error);
    }
  }

  /**
   * Configurer le terminal
   */
  public configure(terminalIp: string, port: number = DEFAULT_PORT, pairingCode?: string): void {
    this.config = {
      terminalIp,
      port,
      timeout: DEFAULT_TIMEOUT,
      pairingCode
    };
    this.saveConfig();
    console.log(`[SumUp] Terminal configuré: ${terminalIp}:${port}${pairingCode ? ' avec code d\'appairage' : ''}`);
  }

  /**
   * Obtenir la configuration actuelle
   */
  public getConfig(): SumUpTerminalConfig | null {
    return this.config;
  }

  /**
   * Construire l'URL de base pour l'API
   */
  private getBaseUrl(): string {
    if (!this.config) {
      throw new Error('Terminal SumUp non configuré');
    }
    return `http://${this.config.terminalIp}:${this.config.port}`;
  }

  /**
   * Générer un ID de transaction unique
   */
  private generateTransactionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `TXN-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Convertir euros en centimes
   */
  private eurosToCents(euros: number): number {
    return Math.round(euros * 100);
  }

  /**
   * Vérifier si le terminal est configuré
   */
  public isConfigured(): boolean {
    return this.config !== null && this.config.terminalIp !== '';
  }

  /**
   * Vérifier la connexion au terminal
   */
  public async checkConnection(): Promise<TerminalStatus> {
    if (!this.isConfigured()) {
      return {
        connection_status: 'disconnected',
        is_ready: false,
        last_check: new Date()
      };
    }

    try {
      const baseUrl = this.getBaseUrl();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout pour le health check

      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log('[SumUp] Terminal connecté:', data);
        
        return {
          connection_status: 'connected',
          is_ready: data.ready !== false, // true par défaut si non spécifié
          software_version: data.version,
          last_check: new Date()
        };
      } else {
        console.warn('[SumUp] Réponse terminal non-ok:', response.status);
        return {
          connection_status: 'error',
          is_ready: false,
          last_check: new Date()
        };
      }
    } catch (error: any) {
      console.error('[SumUp] Erreur connexion terminal:', error);
      
      return {
        connection_status: error.name === 'AbortError' ? 'error' : 'disconnected',
        is_ready: false,
        last_check: new Date()
      };
    }
  }

  /**
   * Initier un paiement sur le terminal
   */
  public async initiatePayment(options: InitiatePaymentOptions): Promise<PaymentResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        errorMessage: 'Terminal SumUp non configuré. Veuillez configurer l\'adresse IP du terminal.',
        errorCode: 'NOT_CONFIGURED'
      };
    }

    try {
      const transactionId = this.generateTransactionId();
      this.currentTransactionId = transactionId;
      
      const amountInCents = this.eurosToCents(options.amountInEuros);
      
      console.log(`[SumUp] Initiation paiement: ${options.amountInEuros}€ (${amountInCents} centimes)`);
      
      const paymentRequest: PaymentRequest = {
        amount: amountInCents,
        currency: 'EUR',
        transaction_id: transactionId,
        description: options.orderDescription || `Commande #${options.orderId}`
      };

      // Notifier l'événement de début
      options.onEvent?.('WAITING_FOR_CARD');

      const baseUrl = this.getBaseUrl();
      const controller = new AbortController();
      const timeout = options.timeout || this.config!.timeout;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${baseUrl}/payment`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentRequest)
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SumUp] Erreur HTTP:', response.status, errorText);
        
        return {
          success: false,
          errorMessage: `Erreur terminal: ${response.status} - ${errorText}`,
          errorCode: `HTTP_${response.status}`
        };
      }

      const paymentResponse: PaymentResponse = await response.json();
      console.log('[SumUp] Réponse paiement:', paymentResponse);

      // Traiter la réponse selon le statut
      if (paymentResponse.status === 'APPROVED') {
        options.onEvent?.('APPROVED', paymentResponse);
        
        return {
          success: true,
          transactionId: paymentResponse.transaction_id,
          amount: paymentResponse.amount,
          currency: paymentResponse.currency,
          cardInfo: paymentResponse.card_last_4 ? {
            last4: paymentResponse.card_last_4,
            type: paymentResponse.card_type || 'UNKNOWN'
          } : undefined,
          timestamp: paymentResponse.timestamp,
          fullResponse: paymentResponse
        };
      } else if (paymentResponse.status === 'DECLINED') {
        options.onEvent?.('DECLINED', paymentResponse);
        
        return {
          success: false,
          errorMessage: paymentResponse.error_message || 'Paiement refusé',
          errorCode: paymentResponse.error_code || 'DECLINED',
          transactionId: paymentResponse.transaction_id
        };
      } else if (paymentResponse.status === 'CANCELLED') {
        options.onEvent?.('CANCELLED', paymentResponse);
        
        return {
          success: false,
          errorMessage: 'Paiement annulé par l\'utilisateur',
          errorCode: 'CANCELLED',
          transactionId: paymentResponse.transaction_id
        };
      } else if (paymentResponse.status === 'ERROR') {
        options.onEvent?.('ERROR', paymentResponse);
        
        return {
          success: false,
          errorMessage: paymentResponse.error_message || 'Erreur lors du paiement',
          errorCode: paymentResponse.error_code || 'ERROR',
          transactionId: paymentResponse.transaction_id
        };
      } else {
        // Statut inconnu ou PENDING
        return {
          success: false,
          errorMessage: `Statut inattendu: ${paymentResponse.status}`,
          errorCode: 'UNKNOWN_STATUS',
          transactionId: paymentResponse.transaction_id
        };
      }

    } catch (error: any) {
      console.error('[SumUp] Erreur initiation paiement:', error);
      
      options.onEvent?.('ERROR', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          errorMessage: 'Délai d\'attente dépassé. Le terminal ne répond pas.',
          errorCode: 'TIMEOUT'
        };
      }

      return {
        success: false,
        errorMessage: error.message || 'Erreur de communication avec le terminal',
        errorCode: 'NETWORK_ERROR'
      };
    } finally {
      this.currentTransactionId = null;
    }
  }

  /**
   * Annuler le paiement en cours (si supporté par le terminal)
   */
  public async cancelPayment(): Promise<boolean> {
    if (!this.currentTransactionId) {
      console.warn('[SumUp] Aucun paiement en cours à annuler');
      return false;
    }

    try {
      const baseUrl = this.getBaseUrl();
      const response = await fetch(`${baseUrl}/payment/${this.currentTransactionId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('[SumUp] Paiement annulé avec succès');
        this.currentTransactionId = null;
        return true;
      } else {
        console.error('[SumUp] Échec annulation paiement:', response.status);
        return false;
      }
    } catch (error) {
      console.error('[SumUp] Erreur annulation paiement:', error);
      return false;
    }
  }

  /**
   * Récupérer le statut d'une transaction
   */
  public async getTransactionStatus(transactionId: string): Promise<PaymentResponse | null> {
    try {
      const baseUrl = this.getBaseUrl();
      const response = await fetch(`${baseUrl}/payment/${transactionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data: PaymentResponse = await response.json();
        return data;
      } else {
        console.error('[SumUp] Erreur récupération statut transaction:', response.status);
        return null;
      }
    } catch (error) {
      console.error('[SumUp] Erreur récupération statut transaction:', error);
      return null;
    }
  }

  /**
   * Réinitialiser la configuration
   */
  public resetConfig(): void {
    this.config = null;
    localStorage.removeItem(STORAGE_KEY);
    console.log('[SumUp] Configuration réinitialisée');
  }
}

// Instance singleton
export const sumupTerminalService = new SumUpTerminalService();
