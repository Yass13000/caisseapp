/**
 * Types pour l'intégration SumUp Terminal API (Réseau Local)
 * Documentation: https://developer.sumup.com/docs/terminal-api/
 */

/**
 * Configuration du terminal SumUp
 */
export interface SumUpTerminalConfig {
  /** Adresse IP locale du terminal SumUp (ex: 192.168.1.100) */
  terminalIp: string;
  /** Port de l'API (par défaut: 8080) */
  port: number;
  /** Timeout pour les requêtes en millisecondes */
  timeout: number;
  /** Code d'appairage (pairing code) pour l'API Terminal */
  pairingCode?: string;
  /** Token d'authentification après appairage */
  authToken?: string;
}

/**
 * Statut de connexion du terminal
 */
export type TerminalConnectionStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Requête de paiement envoyée au terminal
 */
export interface PaymentRequest {
  /** Montant en centimes (ex: 1050 = 10.50€) */
  amount: number;
  /** Code devise ISO 4217 (ex: EUR, USD) */
  currency: string;
  /** Identifiant unique de transaction (généré par votre système) */
  transaction_id: string;
  /** Description de la transaction (optionnel) */
  description?: string;
  /** ID du commerçant (optionnel) */
  merchant_code?: string;
}

/**
 * Réponse du terminal après une demande de paiement
 */
export interface PaymentResponse {
  /** Statut de la transaction */
  status: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR' | 'PENDING';
  /** ID de transaction SumUp */
  transaction_id: string;
  /** Montant traité */
  amount: number;
  /** Devise */
  currency: string;
  /** Code de la carte (4 derniers chiffres) */
  card_last_4?: string;
  /** Type de carte (VISA, MASTERCARD, etc.) */
  card_type?: string;
  /** Date/heure de la transaction */
  timestamp: string;
  /** Message d'erreur si applicable */
  error_message?: string;
  /** Code d'erreur si applicable */
  error_code?: string;
  /** Données brutes de la réponse */
  raw_data?: any;
}

/**
 * État du terminal
 */
export interface TerminalStatus {
  /** État de connexion */
  connection_status: TerminalConnectionStatus;
  /** Terminal prêt à accepter des paiements */
  is_ready: boolean;
  /** Niveau de batterie (0-100) si disponible */
  battery_level?: number;
  /** Version du logiciel du terminal */
  software_version?: string;
  /** Dernière vérification */
  last_check: Date;
}

/**
 * Événement de progression du paiement
 */
export type PaymentEvent = 
  | 'WAITING_FOR_CARD'
  | 'CARD_INSERTED'
  | 'PROCESSING'
  | 'WAITING_FOR_PIN'
  | 'APPROVED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'ERROR';

/**
 * Callback pour les événements de paiement
 */
export interface PaymentEventCallback {
  (event: PaymentEvent, data?: any): void;
}

/**
 * Options pour initier un paiement
 */
export interface InitiatePaymentOptions {
  /** Montant en euros (sera converti en centimes) */
  amountInEuros: number;
  /** Description de la commande */
  orderDescription: string;
  /** ID de la commande */
  orderId: string;
  /** Callback pour les événements de progression */
  onEvent?: PaymentEventCallback;
  /** Timeout spécifique pour cette transaction (ms) */
  timeout?: number;
}

/**
 * Résultat d'un paiement
 */
export interface PaymentResult {
  /** Succès du paiement */
  success: boolean;
  /** ID de transaction SumUp */
  transactionId?: string;
  /** Montant payé */
  amount?: number;
  /** Devise */
  currency?: string;
  /** Informations sur la carte */
  cardInfo?: {
    last4: string;
    type: string;
  };
  /** Message d'erreur en cas d'échec */
  errorMessage?: string;
  /** Code d'erreur */
  errorCode?: string;
  /** Timestamp de la transaction */
  timestamp?: string;
  /** Données complètes de la réponse */
  fullResponse?: PaymentResponse;
}

/**
 * Configuration stockée dans localStorage
 */
export interface StoredSumUpConfig {
  terminalIp: string;
  port: number;
  lastUsed: string;
  pairingCode?: string;
  authToken?: string;
}
