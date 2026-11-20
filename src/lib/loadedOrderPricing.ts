// Prix d'un article de commande rechargé à la caisse (borne, app ou caisse).
//
// Chaque canal enregistre ses lignes différemment :
//   • borne / app : item.price = prix unitaire OPTIONS COMPRISES ; (item|product).base_price = prix hors options
//   • caisse      : pas de item.price ; product.price = prix hors options (déjà « seul » / variante)
//   • commande déjà rouverte à la caisse (id « loaded-… ») : item.base_price = prix hors options
//
// Règle unique : on retrouve le prix unitaire HORS OPTIONS réellement vendu (variante, menu ou seul),
// et on ne le remplace JAMAIS par le prix du catalogue (sinon « Nuggets (6) » à 6,50 € redevient 3,50 €).
import { getFormattedOrderOptions } from '@/lib/orderFormatter';

const num = (v: any): number | null =>
  v !== undefined && v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : null;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Somme des options payantes d'une ligne (prix effectifs, choix offerts déjà déduits). */
export const optionsUnitPrice = (item: any, groupMapping: Record<string, string> = {}): number =>
  round2(
    getFormattedOrderOptions(item, groupMapping)
      .flatMap((g) => g.items)
      .reduce((sum, o) => sum + (Number(o.price) || 0), 0)
  );

/** Prix unitaire hors options réellement vendu pour cette ligne. */
export const resolveBaseUnitPrice = (item: any, groupMapping: Record<string, string> = {}): number => {
  if (!item) return 0;
  if (item.isReward === true || item.is_reward === true) return 0;
  const product = item.product || {};

  // 1. Prix hors options enregistré tel quel
  const base = num(item.base_price) ?? num(product.base_price);
  if (base !== null) return round2(base);

  // 2. Format caisse : product.price est déjà le prix hors options
  const own = num(item.price) ?? num(item.unit_price);
  if (own === null) return round2(num(product.price) ?? 0);

  const opts = optionsUnitPrice(item, groupMapping);
  if (opts <= 0) return round2(own);

  // 3. Format app où price est hors options et unit_price options comprises (unit_price = price + options)
  const price = num(item.price);
  const unit = num(item.unit_price);
  if (price !== null && unit !== null && Math.abs(unit - (price + opts)) < 0.01) return round2(price);

  // 4. Ancien format borne / app sans base_price : le prix inclut les options payantes
  return own >= opts ? round2(own - opts) : round2(own);
};

/**
 * Produit placé dans le ticket quand on recharge une commande :
 * les infos du catalogue (catégorie, réglages menu…) servent à pouvoir modifier la ligne,
 * mais le NOM et le PRIX restent ceux de la commande (variante, seul, menu).
 */
export const buildLoadedProduct = (item: any, catalogProduct: any | null | undefined, extra: Record<string, any> = {}) => {
  const ordered = item.product || item;
  const price = num(ordered.price) ?? num(item.price) ?? num(catalogProduct?.price) ?? 0;
  const variantName = ordered.variantName ?? ordered.variant_name ?? item.variantName ?? item.variant_name ?? undefined;
  const variantId = ordered.variantId ?? ordered.variant_id ?? item.variantId ?? item.variant_id ?? undefined;
  // Référence utilisée seulement si on rouvre les options de la ligne (la fenêtre recalcule
  // menu / seul à partir d'elle) : prix du catalogue pour un produit normal, prix de la variante sinon.
  const hasVariant = variantName !== undefined && variantName !== null && String(variantName) !== '';
  const originalBase = hasVariant ? price : (num(catalogProduct?.price) ?? price);

  return {
    ...(catalogProduct || {}),
    ...extra,
    id: ordered.id ?? catalogProduct?.id,
    name: ordered.name || catalogProduct?.name || 'Produit',
    price,
    base_price: price,
    original_base_price: originalBase,
    variant_name: ordered.variant_name ?? variantName,
    variantName,
    variantId,
    variant_id: variantId,
    isReward: ordered.isReward === true || item.isReward === true,
  };
};

/**
 * Lignes enregistrées par la caisse : chaque ligne porte des montants à jour et sans ambiguïté
 * (base_price hors options, unit_price options comprises, total = unit_price × quantité).
 * Sans ça, une commande borne rouverte gardait ses anciens totaux de ligne même après
 * un changement de quantité ou d'options.
 */
export const normalizeLinesForSave = (items: any[], groupMapping: Record<string, string> = {}): any[] =>
  (items || []).map((line) => {
    if (!line) return line;
    const qty = Number(line.quantity) || 1;
    const base = round2(num(line.product?.price) ?? num(line.price) ?? 0);
    const unit = round2(base + optionsUnitPrice(line, groupMapping));
    const total = round2(unit * qty);
    const out: any = { ...line, quantity: qty, base_price: base, unit_price: unit, total, total_price: total };
    if (line.price !== undefined) out.price = base;
    return out;
  });
