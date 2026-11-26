import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Ancienne route de paiement SumUp de la caisse, désactivée.
 * La caisse n'avait plus aucune page qui l'utilisait (paiements : TPE SumUp Solo),
 * et la version précédente acceptait des notifications non vérifiées capables de
 * marquer une commande « payée ». Les paiements en ligne passent par l'appli client.
 */
export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Route désactivée.' }));
}
