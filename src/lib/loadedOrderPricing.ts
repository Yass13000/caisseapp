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

// ─── Chemin complet d'une commande rouverte à la caisse ───────────────────────
// Suivi des commandes → ticket → total. Utilisé par la caisse ET par le test
// « npm run verif:encaissement » : le test vérifie donc exactement le code de la caisse.

/** Lignes d'une commande, quel que soit le format enregistré. */
export const extractOrderItems = (detailsRaw: any): any[] => {
  try {
    const parsed = typeof detailsRaw === 'string' ? JSON.parse(detailsRaw) : detailsRaw;
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    if (parsed && parsed.cart && Array.isArray(parsed.cart.items)) return parsed.cart.items;
    if (parsed && parsed.cart && Array.isArray(parsed.cart)) return parsed.cart;
    if (parsed) return [parsed];
    return [];
  } catch {
    return [];
  }
};

/** Nom affiché d'une ligne. */
export const orderItemName = (item: any): string => {
  if (!item) return 'Produit inconnu';
  if (item.product && item.product.name) return item.product.name;
  if (item.name) return item.name;
  if (item.title) return item.title;
  return 'Produit inconnu';
};

/** Suivi des commandes : lignes d'une commande préparées pour être rouvertes à la caisse. */
export const mapOrderItemsForTill = (order: any, groupMapping: Record<string, string> = {}): any[] =>
  extractOrderItems(order?.order_details).map((item: any, index: number) => {
    const productObj = item.product || item;
    // Commande déjà rouverte à la caisse : le nom complet (« Menu … », « … (6) ») est sur la ligne
    const alreadyLoaded = String(item.id || '').startsWith('loaded-');
    const productName = (alreadyLoaded && item.name) ? String(item.name) : orderItemName(item);
    const isReward = item.isReward === true || item.is_reward === true;
    const productPrice = isReward ? 0 : resolveBaseUnitPrice(item, groupMapping);

    const rawId = productObj.id ?? item.id;
    const parsed = typeof rawId === 'number' ? rawId : parseInt(String(rawId).split('-')[0], 10);
    const realProductId = !isNaN(parsed) ? parsed : rawId;

    const rawSelections = item.rawSelections || productObj.rawSelections || item.selections || productObj.selections || null;
    const rawOptions = item.selectedSubOptions || productObj.selectedSubOptions || item.flatOptions || productObj.flatOptions || item.options || productObj.options || item.selectedOptions || productObj.selectedOptions || [];
    const removedIngredients = item.removedIngredients || productObj.removedIngredients || [];
    const isSolo = item.isSolo === true || productObj.isSolo === true || item.is_solo === true || productObj.is_solo === true;

    const optionsHash = btoa(encodeURIComponent(JSON.stringify(rawOptions))).substring(0, 15);
    const antiFusionId = `loaded-${order.id}-${index}-${realProductId}-${optionsHash}`;

    return {
      ...item,
      id: antiFusionId,
      customKey: antiFusionId,
      cartKey: antiFusionId,
      name: productName,
      price: productPrice,
      base_price: productPrice,
      isSolo,
      isReward,
      product: {
        ...productObj,
        id: realProductId,
        name: productName,
        price: productPrice,
        base_price: productPrice,
        is_available: true,
        category: productObj.category || '',
        isSolo,
        isReward,
        rawSelections,
        options: rawOptions,
        selectedSubOptions: rawOptions,
        flatOptions: rawOptions,
        removedIngredients,
      },
      selectedSubOptions: rawOptions,
      options: rawOptions,
      flatOptions: rawOptions,
      rawSelections,
      removedIngredients,
    };
  });

/** Identifiant produit réel à partir des différents formats d'identifiant de ligne. */
export const extractRealProductId = (rawId: any): number | string => {
  if (typeof rawId === 'number') return rawId;
  const str = String(rawId || '').trim();
  if (!str) return '';
  if (str.startsWith('loaded-')) {
    const parts = str.split('-');
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) return last;
  }
  const first = parseInt(str.split('-')[0].replace(/^dyn_/, ''), 10);
  return !isNaN(first) ? first : rawId;
};

/** Ticket de caisse : une ligne de commande rouverte, prête à être ajoutée au panier. */
export const buildLoadedCartItem = (item: any, idx: number, orderId: string | number, catalog: any[]): any => {
  const productObj = item.product || item;
  const rawId = productObj.id ?? item.id;
  const realProductId = extractRealProductId(rawId);
  // Infos du catalogue (catégorie, réglages…) : utiles pour modifier la ligne, jamais pour son prix
  const catalogProduct = (catalog || []).find((p: any) => String(p.id) === String(realProductId)) || null;

  const rawSelections = item.rawSelections || productObj.rawSelections || null;
  const selectedSubOptions = item.selectedSubOptions || productObj.selectedSubOptions || item.options || [];
  const removedIngredients = item.removedIngredients || productObj.removedIngredients || [];
  const isSolo = item.isSolo === true || item.product?.isSolo === true || item.is_solo === true || /\bseul\b/i.test(item.name || productObj.name || '');

  const uniqueKey = `loaded-${orderId}-${idx}-${realProductId}`;
  return {
    ...item,
    id: uniqueKey,
    isSolo,
    // Nom et prix de la commande conservés (variante, menu, seul) : le prix du catalogue ne les remplace pas
    product: buildLoadedProduct(item, catalogProduct, {
      isSolo,
      rawSelections,
      selectedSubOptions,
      removedIngredients,
      options: selectedSubOptions,
    }),
    rawSelections,
    selectedSubOptions,
    removedIngredients,
    quantity: item.quantity || 1,
    cartKey: uniqueKey,
    customKey: uniqueKey,
  };
};

/** Total d'une ligne du ticket de caisse (prix hors options + options payantes) × quantité. */
export const tillLineTotal = (item: any, groupMapping: Record<string, string> = {}): number => {
  const groups = getFormattedOrderOptions(item, groupMapping);
  const optsPrice = groups.flatMap((g) => g.items).reduce((sum, o) => sum + (Number(o.price) || 0), 0);

  let basePrice = parseFloat(item.product?.price !== undefined ? item.product.price : (item.price || 0));

  if (item.price !== undefined && item.product?.price !== undefined && optsPrice > 0) {
    if (Math.abs(Number(item.price) - (Number(item.product.price) + optsPrice)) < 0.01) {
      basePrice = Number(item.product.price);
    }
  } else if (item.price !== undefined && optsPrice > 0 && Number(item.price) > optsPrice && !item.product?.price) {
    if (item.is_total_price || item.includes_options) {
      basePrice = Math.max(0, Number(item.price) - optsPrice);
    }
  }

  return (basePrice + optsPrice) * (item.quantity || 1);
};
