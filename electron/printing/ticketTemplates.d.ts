// Types des modèles de tickets partagés (fichier JS commun Windows / Android)
export function configureTicketTemplates(env: { readSettings?: () => Record<string, any>; getLogo?: (url: string, restaurantId?: string) => Promise<string> }): void;
export function escapeHtml(str: unknown): string;
export function parseOrderItems(raw: unknown): any[];
export function buildKitchenHtml(orderData: any, widthMm?: string): string;
export function buildDriverSettlementHtml(data: any, widthMm?: string): string;
export function buildZReportHtml(reportData: any, widthMm?: string): string;
export function buildReceiptHtml(orderData: any, widthMm?: string): Promise<string>;
