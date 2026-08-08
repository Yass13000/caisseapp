// @ts-nocheck
import { supabase } from '@/lib/supabaseClient';

export interface FormattedOptionItem {
  name: string;
  price: number;
  qty: number;
  isSans: boolean;
}

export interface FormattedOptionGroup {
  groupName: string;
  items: FormattedOptionItem[];
}

/**
 * 🟢 1. MAPPING DES OPTIONS (GROUPS & SANS)
 */
export const fetchOptionGroupMapping = async (
  items: any[], 
  activeRestoId?: string
): Promise<Record<string, string>> => {
  if (!items || items.length === 0) return {};

  const optionIds = new Set<string>();
  const explicitGroupIds = new Set<string>();
  const dynamicProductIds = new Set<string>();

  const collectIds = (arr: any) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((o: any) => {
      if (!o) return;
      if (o.options && Array.isArray(o.options)) {
        collectIds(o.options);
      } else {
        if (o.option_group_id) explicitGroupIds.add(String(o.option_group_id));
        if (o.group_id) explicitGroupIds.add(String(o.group_id));

        if (o.id) {
          const strId = String(o.id);
          if (strId.startsWith('dyn_')) {
            dynamicProductIds.add(strId.replace('dyn_', ''));
          } else if (o.is_dynamic || o.original_product_id) {
            dynamicProductIds.add(String(o.original_product_id || o.id));
          } else if (!isNaN(Number(strId))) {
            optionIds.add(strId);
          }
        }
      }
    });
  };

  items.forEach(item => {
    collectIds(item.selectedSubOptions);
    collectIds(item.options);
    collectIds(item.flatOptions);
    collectIds(item.directSubOptions);

    if (typeof item.selections === 'object' && item.selections !== null) {
      Object.values(item.selections).forEach(val => {
        if (Array.isArray(val)) collectIds(val);
      });
    }
  });

  const mapping: Record<string, string> = {};

  try {
    if (explicitGroupIds.size > 0) {
      const { data: groupData } = await supabase
        .from('option_groups')
        .select('id, name')
        .in('id', Array.from(explicitGroupIds));

      if (groupData) {
        groupData.forEach((grp: any) => {
          mapping[`grp_${grp.id}`] = grp.name;
        });
      }
    }

    const cleanOptionIds = Array.from(optionIds).filter(id => id && !isNaN(Number(id)));
    if (cleanOptionIds.length > 0) {
      let query = supabase
        .from('option_group_links')
        .select('option_id, option_groups(id, name, restaurant_id)')
        .in('option_id', cleanOptionIds);

      if (activeRestoId) {
        query = query.eq('option_groups.restaurant_id', activeRestoId);
      }

      const { data: linksData } = await query;

      if (linksData) {
        linksData.forEach((link: any) => {
          const grpObj = Array.isArray(link.option_groups) ? link.option_groups[0] : link.option_groups;
          if (link.option_id && grpObj?.name) {
            const strId = String(link.option_id);
            mapping[strId] = grpObj.name;
          }
        });
      }
    }

    if (dynamicProductIds.size > 0) {
      let dynQuery = supabase
        .from('option_groups')
        .select('id, name, product_overrides, target_category_name, target_subcategory_id');

      if (activeRestoId) {
        dynQuery = dynQuery.eq('restaurant_id', activeRestoId);
      }

      const { data: dynGroups } = await dynQuery;

      if (dynGroups) {
        dynGroups.forEach((grp: any) => {
          mapping[`grp_${grp.id}`] = grp.name;
          const overrides = typeof grp.product_overrides === 'string' 
            ? JSON.parse(grp.product_overrides || '{}') 
            : (grp.product_overrides || {});

          dynamicProductIds.forEach(prodId => {
            if (overrides[prodId] || grp.target_category_name || grp.target_subcategory_id) {
              mapping[`dyn_${prodId}`] = grp.name;
              mapping[prodId] = grp.name;
            }
          });
        });
      }
    }
  } catch (e) {
    console.error("Erreur chargement mapping option groups :", e);
  }

  return mapping;
};

/**
 * 🟢 2. FORMATEUR DES OPTIONS POUR L'AFFICHAGE DU TICKET
 */
export const getFormattedOrderOptions = (
  item: any, 
  groupMapping: Record<string, string> = {}
): FormattedOptionGroup[] => {
  let rawOptions: any[] = [];

  if (item.boisson) {
    rawOptions.push({
      name: typeof item.boisson === 'string' ? item.boisson : (item.boisson.name || ''),
      price: parseFloat(item.boisson.price || 0),
      group_name: 'BOISSONS'
    });
  }
  if (item.accompagnement) {
    rawOptions.push({
      name: typeof item.accompagnement === 'string' ? item.accompagnement : (item.accompagnement.name || ''),
      price: parseFloat(item.accompagnement.price || 0),
      group_name: 'ACCOMPAGNEMENTS'
    });
  }

  let primaryOpts: any[] = [];
  if (Array.isArray(item.selectedSubOptions) && item.selectedSubOptions.length > 0) primaryOpts = item.selectedSubOptions;
  else if (Array.isArray(item.flatOptions) && item.flatOptions.length > 0) primaryOpts = item.flatOptions;
  else if (Array.isArray(item.options) && item.options.length > 0) primaryOpts = item.options;
  else if (Array.isArray(item.selections) && item.selections.length > 0) primaryOpts = item.selections;
  else if (Array.isArray(item.directSubOptions) && item.directSubOptions.length > 0) primaryOpts = item.directSubOptions;

  primaryOpts.forEach(sub => {
    if (!sub) return;
    if (sub.options && Array.isArray(sub.options)) {
      const grpName = sub.group_name || sub.name || sub.groupName;
      sub.options.forEach(o => { if (o) rawOptions.push({ ...o, group_name: o.group_name || grpName }); });
    } else if (typeof sub === 'object') {
      rawOptions.push(sub);
    } else if (typeof sub === 'string') {
      rawOptions.push({ name: sub, price: 0 });
    }
  });

  const optionsByCategory = new Map<string, FormattedOptionItem[]>();
  const processedSansNames = new Set<string>();

  const removedIngs = item.removedIngredients || item.product?.removedIngredients || [];
  if (Array.isArray(removedIngs) && removedIngs.length > 0) {
    const catKey = 'INGRÉDIENTS';
    if (!optionsByCategory.has(catKey)) optionsByCategory.set(catKey, []);

    removedIngs.forEach((ing: any) => {
      const ingName = typeof ing === 'string' ? ing : (ing.name || ing.ingredient_name);
      if (ingName) {
        const normName = String(ingName).trim().toUpperCase();
        const displayName = normName.startsWith('SANS ') ? normName : `SANS ${normName}`;
        
        if (!processedSansNames.has(displayName)) {
          processedSansNames.add(displayName);
          optionsByCategory.get(catKey)!.push({ name: displayName, price: 0, qty: 1, isSans: true });
        }
      }
    });
  }

  rawOptions.forEach(opt => {
    if (!opt) return;
    const rawName = typeof opt === 'string' ? opt : (opt.name || opt.option_name || opt.title || opt.value || '');
    const name = String(rawName).trim();
    if (!name || name.toLowerCase() === 'option' || name.toLowerCase() === 'options...') return;

    const upperName = name.toUpperCase();
    const isSans = opt.groupName === 'Sans' || opt.group_name === 'Sans' || upperName.startsWith('SANS ') || !!opt.isRemoved || !!opt.isSans;
    const displayName = isSans && !upperName.startsWith('SANS ') ? `SANS ${upperName}` : upperName;

    if (isSans) {
      if (processedSansNames.has(displayName)) return;
      processedSansNames.add(displayName);

      const catKey = 'INGRÉDIENTS';
      if (!optionsByCategory.has(catKey)) optionsByCategory.set(catKey, []);
      optionsByCategory.get(catKey)!.push({ name: displayName, price: 0, qty: 1, isSans: true });
      return;
    }

    let candidateGroup = opt.group_name || opt.option_group_name || opt.groupName || opt.group || opt.step_name;
    if (candidateGroup && (candidateGroup.toLowerCase() === 'option' || candidateGroup.toLowerCase() === 'options')) {
      candidateGroup = null;
    }

    const explicitGrpId = opt.option_group_id || opt.group_id;
    const mappedByGrpId = explicitGrpId ? groupMapping[`grp_${explicitGrpId}`] : null;

    const strOptId = opt.id ? String(opt.id) : '';
    const cleanOptId = strOptId.replace('dyn_', '');
    const mappedByOptId = groupMapping[strOptId] || groupMapping[cleanOptId] || groupMapping[`dyn_${cleanOptId}`];

    const fallbackType = opt.type && opt.type.toLowerCase() !== 'option' && opt.type.toLowerCase() !== 'options' ? opt.type : null;

    const finalGroupName = candidateGroup || mappedByGrpId || mappedByOptId || fallbackType || `GRP_${optionsByCategory.size + 1}`;
    const cleanCategoryKey = String(finalGroupName).trim().toUpperCase();
    const price = typeof opt === 'string' ? 0 : parseFloat(opt.price || 0);

    if (!optionsByCategory.has(cleanCategoryKey)) {
      optionsByCategory.set(cleanCategoryKey, []);
    }

    const list = optionsByCategory.get(cleanCategoryKey)!;
    const existing = list.find(o => o.name.toUpperCase() === displayName && !o.isSans);

    if (existing) {
      existing.qty += 1;
      existing.price += price;
    } else {
      list.push({ name: displayName, price: price, qty: 1, isSans: false });
    }
  });

  return Array.from(optionsByCategory.values()).map(items => ({
    groupName: '',
    items
  }));
};

/**
 * 🟢 3. FONCTION UNIQUE CENTRALISÉE — PAYLOAD TICKET CLIENT
 */
export const buildClientReceiptPayload = (params: {
  restaurantId?: string | null;
  restaurantInfo: { name?: string; restaurant_name?: string; address?: string | null; phone?: string | null; tva?: number; logoUrl?: string | null };
  orderNumber: string;
  orderType: string;
  paymentMethod: string;
  items: any[];
  subtotal: number;
  deliveryFee?: number;
  finalTotal: number;
  clientInfo?: any;
  groupMapping?: Record<string, string>;
  orderDate?: string;
}) => {
  const {
    restaurantId,
    restaurantInfo,
    orderNumber,
    orderType,
    paymentMethod,
    items,
    deliveryFee = 0,
    finalTotal,
    clientInfo,
    groupMapping = {},
    orderDate
  } = params;

  // 💳 Normalisation basée sur les valeurs exactes Supabase
  let rawPayment = String(paymentMethod || 'counter').trim();
  const pLower = rawPayment.toLowerCase();

  if (pLower === 'counter' || pLower.includes('espece') || pLower.includes('cash')) {
    rawPayment = 'especes';
  } else if (pLower.includes('carte') || pLower.includes('cb') || pLower.includes('card') || pLower.includes('sumup')) {
    rawPayment = 'cb';
  } else if (pLower.includes('ticket') || pLower.includes('resto')) {
    rawPayment = 'ticket_resto';
  } else if (pLower.includes('attente') || pLower.includes('pending')) {
    rawPayment = 'en attente';
  }
  // Si c'est un paiement fractionné, rawPayment conserve sa chaîne complète ex: "Fractionné (Espèces: 20€ + CB: 4.7€)"

  const formattedItems = items.map(item => {
    const optionGroups = getFormattedOrderOptions(item, groupMapping);
    const notes = optionGroups.flatMap(grp => grp.items.map(opt => ({
      name: (grp.groupName ? `${grp.groupName}: ` : '') + (opt.qty > 1 ? `${opt.qty}x ` : '') + opt.name,
      price: opt.price || 0,
      isSans: opt.isSans
    })));
    return {
      qty: item.quantity || item.qty || 1,
      name: item.product?.name || item.name || 'Produit',
      unitPrice: item.price || item.product?.price || 0,
      notes,
      categoryName: item.product?.category_name || item.category || ''
    };
  });

  const restoName = restaurantInfo?.restaurant_name || restaurantInfo?.name || 'VOTRE RESTAURANT';

  return {
    restaurant_id: restaurantId,
    restaurantId: restaurantId,
    orderType,
    order_number: orderNumber,
    orderNumber: orderNumber,
    orderDate: orderDate || new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    restaurant_name: restoName,
    restaurantName: restoName,
    restaurantAddress: restaurantInfo?.address || null,
    restaurantPhone: restaurantInfo?.phone || null,
    restaurantLogoUrl: restaurantInfo?.logoUrl || null,
    payment_method: rawPayment,
    paymentMethod: rawPayment,
    tva: restaurantInfo?.tva || 10,
    items: formattedItems,
    total_price: finalTotal,
    total: finalTotal,
    delivery: orderType.toUpperCase().includes('LIVRAISON') ? {
      customerName: clientInfo?.name || clientInfo?.customer_name,
      address: clientInfo?.address || clientInfo?.customer_address,
      phone: clientInfo?.phone || clientInfo?.customer_phone,
      deliveryNotes: clientInfo?.notes || clientInfo?.additionalInfo || clientInfo?.comment || '',
      fee: deliveryFee
    } : undefined
  };
};

/**
 * 🟢 4. FONCTION UNIQUE CENTRALISÉE — PAYLOAD BON CUISINE
 */
export const buildKitchenReceiptPayload = (params: {
  orderNumber: string;
  orderType: string;
  items: any[];
  groupMapping?: Record<string, string>;
  orderDate?: string;
}) => {
  const { orderNumber, orderType, items, groupMapping = {}, orderDate } = params;

  const formattedItems = items.map(item => {
    const optionGroups = getFormattedOrderOptions(item, groupMapping);
    const notes = optionGroups.flatMap(grp => grp.items.map(opt => ({
      name: (grp.groupName ? `${grp.groupName}: ` : '') + (opt.qty > 1 ? `${opt.qty}x ` : '') + opt.name,
      isSans: opt.isSans
    })));
    return {
      qty: item.quantity || item.qty || 1,
      name: item.product?.name || item.name || 'Produit',
      unitPrice: 0,
      notes,
      categoryName: item.product?.category_name || item.category || ''
    };
  });

  return {
    orderType: `CUISINE - ${orderType}`,
    order_number: orderNumber,
    orderNumber: orderNumber,
    orderDate: orderDate || new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    restaurant_name: 'CUISINE',
    restaurantName: 'CUISINE',
    items: formattedItems,
    total: 0
  };
};

/**
 * 🟢 5. MAPPING POUR UN OBJET DB 'ORDERS' DE SUPABASE
 */
export const buildReceiptPayloadFromOrder = async (
  order: any,
  optionGroupMapping: Record<string, string> = {},
  prefixOrderType: string = ''
) => {
  if (!order) return null;

  let rawItems: any[] = [];
  try {
    let details = typeof order.order_details === 'string' ? JSON.parse(order.order_details) : order.order_details;
    if (Array.isArray(details)) rawItems = details;
    else if (details && Array.isArray(details.items)) rawItems = details.items;
    else if (details && Array.isArray(details.cart)) rawItems = details.cart;
    else if (details) rawItems = [details];
  } catch (e) {
    rawItems = [];
  }

  let restoInfo = {
    name: 'VOTRE RESTAURANT',
    restaurant_name: 'VOTRE RESTAURANT',
    address: null as string | null,
    phone: null as string | null,
    tva: 10,
    logoUrl: null as string | null
  };

  const targetRestoId = order.restaurant_id || localStorage.getItem('pos_restaurant_id');

  if (targetRestoId) {
    try {
      const { data: restoData } = await supabase
        .from('restaurants')
        .select('name, restaurant_name, address, phone, tva, logo_url')
        .eq('id', targetRestoId)
        .maybeSingle();

      if (restoData) {
        restoInfo = {
          name: restoData.restaurant_name || restoData.name || 'VOTRE RESTAURANT',
          restaurant_name: restoData.restaurant_name || restoData.name || 'VOTRE RESTAURANT',
          address: restoData.address || null,
          phone: restoData.phone || null,
          tva: (restoData.tva !== null && restoData.tva !== undefined) ? Number(restoData.tva) : 10,
          logoUrl: restoData.logo_url || null
        };
      }
    } catch (e) {}
  }

  const ORDER_TYPE_LABELS: Record<string, string> = {
    '633425b1-f86c-4c17-8cba-b258906ad317': 'SUR PLACE',
    '2cac3f10-73e2-40a5-a7e0-053bd861b4d9': 'EMPORTER',
    'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d': 'LIVRAISON'
  };

  let rawTypeLabel = String(order.order_type || '').toUpperCase();
  if (!rawTypeLabel || rawTypeLabel === 'UNDEFINED') {
    rawTypeLabel = ORDER_TYPE_LABELS[order.order_type_id] || 'SUR PLACE';
  }

  const finalOrderType = prefixOrderType ? `${prefixOrderType} - ${rawTypeLabel}` : rawTypeLabel;

  return buildClientReceiptPayload({
    restaurantId: targetRestoId,
    restaurantInfo: restoInfo,
    orderNumber: String(order.order_number || order.number || order.id || '001'),
    orderType: finalOrderType,
    paymentMethod: order.payment_method || order.paymentMethod || 'especes',
    items: rawItems,
    subtotal: Number(order.total_price || order.total || 0),
    deliveryFee: Number(order.delivery_fee || 0),
    finalTotal: Number(order.total_price || order.total || 0),
    clientInfo: {
      name: order.customer_name,
      phone: order.customer_phone,
      address: order.customer_address,
      notes: order.comment
    },
    groupMapping: optionGroupMapping,
    orderDate: order.created_at ? new Date(order.created_at).toLocaleString('fr-FR') : undefined
  });
};