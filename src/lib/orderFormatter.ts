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
 * 🟢 MAPPING ULTRA-ROBUSTE DEPUIS SUPABASE (OPTIONS STATIQUES ET DYNAMIQUES)
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
 * 🟢 FORMATEUR NETTOYÉ SANS AUCUN SYMBOLE DE DEUX-POINTS (:)
 */
export const getFormattedOrderOptions = (
  item: any, 
  groupMapping: Record<string, string> = {}
): FormattedOptionGroup[] => {
  let rawOptions: any[] = [];

  // A. Boissons & Accompagnements
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

  // B. Source unique d'options principale
  let primaryOpts: any[] = [];
  if (Array.isArray(item.selectedSubOptions) && item.selectedSubOptions.length > 0) {
    primaryOpts = item.selectedSubOptions;
  } else if (Array.isArray(item.flatOptions) && item.flatOptions.length > 0) {
    primaryOpts = item.flatOptions;
  } else if (Array.isArray(item.options) && item.options.length > 0) {
    primaryOpts = item.options;
  } else if (Array.isArray(item.selections) && item.selections.length > 0) {
    primaryOpts = item.selections;
  } else if (Array.isArray(item.directSubOptions) && item.directSubOptions.length > 0) {
    primaryOpts = item.directSubOptions;
  }

  primaryOpts.forEach(sub => {
    if (!sub) return;
    if (sub.options && Array.isArray(sub.options)) {
      const grpName = sub.group_name || sub.name || sub.groupName;
      sub.options.forEach(o => {
        if (o) rawOptions.push({ ...o, group_name: o.group_name || grpName });
      });
    } else if (typeof sub === 'object') {
      rawOptions.push(sub);
    } else if (typeof sub === 'string') {
      rawOptions.push({ name: sub, price: 0 });
    }
  });

  const optionsByCategory = new Map<string, FormattedOptionItem[]>();
  const processedSansNames = new Set<string>();

  // C. Ingrédients retirés (SANS ...)
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

  // D. Classement des options par groupe réel
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

  // 🟢 ASTUCE : Si la première option de chaque ligne est renvoyée sans nom de groupe, 
  // on élimine la tentative du JSX d'écrire ":"
  return Array.from(optionsByCategory.values()).map(items => {
    return {
      groupName: '', // Nom de groupe vide pour ne pas afficher d'étiquette ni de ':' parasite
      items
    };
  });
};