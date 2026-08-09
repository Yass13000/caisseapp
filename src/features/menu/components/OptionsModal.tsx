// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase, RESTAURANT_ID, getActiveRestaurantId } from '@/lib/supabaseClient';

export interface CustomizationOption { 
  id: number | string; 
  name: string; 
  price: number;
  type?: string;
  image?: string;
  description?: string;
  sort_order?: number;
  is_dynamic?: boolean;
  original_product_id?: number;
  group_name?: string;
  option_group_name?: string;
  groupName?: string;
  option_group_id?: number | string;
  is_menu?: boolean;
}

interface Ingredient { 
  id: number; 
  product_id?: number; 
  name: string; 
  image_url?: string | null; 
  is_available?: boolean; 
}

interface StepData { 
  id: string; 
  min_choices: number; 
  max_choices: number; 
  step_order: number; 
  group_name: string; 
  allow_multiple: boolean; 
  options: CustomizationOption[]; 
  isSubOption?: boolean; 
  isIngredientStep?: boolean;
  free_choices_count?: number; 
  option_group_id?: number | string;
  is_menu?: boolean;
}

const cleanId = (id: string | number) => String(id).replace('dyn_', '');

// 🟢 HELPER: FORMATTAGE DU NOM DU PRODUIT (ex: "Menu Tacos" -> "Tacos Seul", "Tacos" -> "Tacos Seul")
const formatProductName = (name: string, isSolo: boolean) => {
  if (!name) return '';
  if (!isSolo) return name;
  const cleanName = name.replace(/^menu\s+/i, '').trim();
  return `${cleanName} Seul`;
};

const OptionsModal = ({ product, onAddToCart, onClose, initialSelections }: any) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [baseSteps, setBaseSteps] = useState<StepData[]>([]);
  const [allSubGroups, setAllSubGroups] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [removedIngredientIds, setRemovedIngredientIds] = useState<Set<number>>(new Set());
  
  const [stepSelections, setStepSelections] = useState<Record<string, CustomizationOption[]>>({});
  
  // 🟢 GESTION DU MODE SEUL / MENU ET DÉDUCTION DU PRIX
  const [isCategoryMenu, setIsCategoryMenu] = useState(false);
  const [isSoloMode, setIsSoloMode] = useState(false);
  const [soloDiscount, setSoloDiscount] = useState<number>(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [bubbleOption, setBubbleOption] = useState<{ parentItem: CustomizationOption, childGroups: any[], baseStepId: string } | null>(null);

  const onAddToCartRef = useRef(onAddToCart);
  onAddToCartRef.current = onAddToCart;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stepSelectionsRef = useRef(stepSelections);
  stepSelectionsRef.current = stepSelections;
  const activeStepsRef = useRef<StepData[]>([]);
  const hasInitializedStepRef = useRef(false);

  const formatSubGroup = useCallback((sg: any, parentOptName?: string): StepData => {
    const groupName = parentOptName ? `${sg.name} (${parentOptName})` : sg.name;
    const validChoices = (sg.sub_option_choices || [])
        .filter((c: any) => c.is_available !== false)
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((c: any) => ({
            id: c.id, 
            name: c.name,
            price: c.price || 0,
            sort_order: c.sort_order || 0,
            group_name: groupName,
            option_group_name: groupName,
            groupName: groupName,
            option_group_id: sg.id,
            is_menu: sg.is_menu === true
        }));

    return {
        id: `sub_${sg.id}`,
        min_choices: sg.min_choices != null ? Number(sg.min_choices) : 0,
        max_choices: sg.max_choices != null ? Number(sg.max_choices) : 1,
        step_order: sg.sort_order || 0,
        group_name: groupName,
        allow_multiple: (sg.max_choices != null ? Number(sg.max_choices) : 1) > 1, 
        options: validChoices,
        isSubOption: true,
        free_choices_count: sg.free_choices_count || 0,
        option_group_id: sg.id,
        is_menu: sg.is_menu === true
    };
  }, []);

  useEffect(() => {
    hasInitializedStepRef.current = false;
  }, [product?.id]);

  useEffect(() => {
    let isMounted = true;
    
    const fetchRulesAndOptions = async () => {
      if (!product?.id || product.id === 'undefined' || product.id === 'null') {
        if (isMounted) setIsLoading(false);
        return;
      }
      setIsLoading(true);

      const rawId = String(product.id);
      const realProductId = parseInt(rawId.split('-')[0], 10);
      const activeRestoId = product?.restaurant_id || (typeof getActiveRestaurantId === 'function' ? getActiveRestaurantId() : null) || localStorage.getItem('pos_restaurant_id') || RESTAURANT_ID;

      try {
        // 🟢 VÉRIFICATION DU MODE MENU ET RÉCUPÉRATION DE LA DÉDUCTION DANS CATEGORIES
        let categoryIsMenu = false;
        let categorySoloDiscount = 0;

        if (product?.category) {
          const { data: catRes } = await supabase
            .from('categories')
            .select('is_menu, solo_discount_price')
            .eq('restaurant_id', activeRestoId)
            .ilike('name', product.category.trim())
            .maybeSingle();
          
          if (catRes) {
            if (catRes.is_menu === true || String(catRes.is_menu).toLowerCase() === 'true') {
              categoryIsMenu = true;
            }
            if (catRes.solo_discount_price != null) {
              categorySoloDiscount = Number(catRes.solo_discount_price) || 0;
            }
          }
        } else if (product?.is_menu || product?.category_is_menu) {
          categoryIsMenu = true;
        }

        if (isMounted) {
          setIsCategoryMenu(categoryIsMenu);
          setSoloDiscount(categorySoloDiscount);
        }

        const [baseRes, subProdRes, ingRes] = await Promise.all([
          supabase
            .from('product_option_groups')
            .select(`id, min_choices, max_choices, step_order, free_choices_count, is_menu, option_groups (id, name, allow_multiple, free_choices_count, is_menu, target_category_name, target_subcategory_id, product_overrides, option_group_links ( sort_order, options ( id, name, price, image_url, is_available, description ) ))`)
            .eq('product_id', product.id)
            .order('step_order'),
          supabase
            .from('sub_option_groups')
            .select(`id, name, min_choices, max_choices, free_choices_count, sort_order, option_id, product_id, is_menu, sub_option_choices ( id, name, price, is_available, sort_order )`)
            .eq('product_id', product.id),
          realProductId ? supabase
            .from('product_ingredients')
            .select(`global_ingredients ( id, name, image_url, is_available )`)
            .eq('product_id', realProductId) : Promise.resolve({ data: [] })
        ]);

        let formattedBaseSteps: StepData[] = [];
        const optionIds = new Set<string>();

        if (baseRes.data && baseRes.data.length > 0) {
          formattedBaseSteps = await Promise.all(baseRes.data.map(async (rule: any) => {
            const groupName = rule.option_groups?.name || 'Options';
            const groupGroupId = rule.option_groups?.id;
            const isMenuGroup = rule.is_menu === true || rule.option_groups?.is_menu === true;

            const rawLinks = rule.option_groups?.option_group_links || [];
            const sortedLinks = rawLinks.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
            
            const validOptions: CustomizationOption[] = sortedLinks
              .map((link: any) => link.options)
              .filter((opt: any) => opt && opt.is_available !== false)
              .map((opt: any, idx: number) => {
                 optionIds.add(String(opt.id));
                 return { 
                   id: opt.id, 
                   name: opt.name, 
                   price: opt.price || 0,
                   sort_order: sortedLinks[idx]?.sort_order || 0,
                   image: opt.image_url || '',
                   description: opt.description || '',
                   group_name: groupName,
                   option_group_name: groupName,
                   groupName: groupName,
                   option_group_id: groupGroupId,
                   is_menu: isMenuGroup
                 };
              });

            let dynamicOptions: CustomizationOption[] = [];
            const targetSubcatId = rule.option_groups?.target_subcategory_id;
            const targetCatName = rule.option_groups?.target_category_name;
            const overrides = rule.option_groups?.product_overrides || {};

            let fetchedProds: any[] = [];

            if (targetSubcatId) {
              const { data: dynProds } = await supabase
                .from('product')
                .select('id, name, price, image, description, is_available, sort_order')
                .eq('subcategory_id', targetSubcatId)
                .eq('restaurant_id', activeRestoId)
                .eq('is_available', true)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });

              if (dynProds) fetchedProds = dynProds;
            } else if (targetCatName) {
              const { data: dynProds } = await supabase
                .from('product')
                .select('id, name, price, image, description, is_available, sort_order')
                .ilike('category', targetCatName.trim())
                .eq('restaurant_id', activeRestoId)
                .eq('is_available', true)
                .order('sort_order', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });

              if (dynProds) fetchedProds = dynProds;
            }

            if (fetchedProds.length > 0) {
              dynamicOptions = fetchedProds
                .filter((p: any) => p.is_available !== false)
                .map((p: any, idx: number) => {
                  optionIds.add(String(p.id));
                  const entry = overrides[String(p.id)];
                  const customPrice = typeof entry === 'object' && entry?.price !== undefined ? entry.price : (typeof entry === 'number' ? entry : null);
                  const customSortOrder = (typeof entry === 'object' && entry?.sort_order !== undefined && entry?.sort_order !== '') 
                    ? Number(entry.sort_order) 
                    : (p.sort_order ?? idx);

                  const finalPrice = customPrice !== null ? Number(customPrice) : (p.price || 0);

                  return {
                    id: `dyn_${p.id}`,
                    name: p.name,
                    price: finalPrice,
                    sort_order: Number(customSortOrder),
                    image: p.image || '',
                    description: p.description || '',
                    is_dynamic: true,
                    original_product_id: p.id,
                    group_name: groupName,
                    option_group_name: groupName,
                    groupName: groupName,
                    option_group_id: groupGroupId,
                    is_menu: isMenuGroup
                  };
                });
            }

            const allOptionsForStep = [...validOptions];
            dynamicOptions.forEach(dynOpt => {
              if (!allOptionsForStep.some(o => o.name.toLowerCase() === dynOpt.name.toLowerCase())) {
                allOptionsForStep.push(dynOpt);
              }
            });

            allOptionsForStep.sort((a, b) => {
              const orderA = a.sort_order ?? 0;
              const orderB = b.sort_order ?? 0;
              if (orderA !== orderB) return orderA - orderB;
              return (a.name || '').localeCompare(b.name || '');
            });

            const finalFreeChoices = rule.free_choices_count != null 
              ? Number(rule.free_choices_count) 
              : (rule.option_groups?.free_choices_count || 0);

            return { 
              id: `base_${rule.id}`, 
              min_choices: rule.min_choices != null ? Number(rule.min_choices) : 0, 
              max_choices: rule.max_choices != null ? Number(rule.max_choices) : 1, 
              step_order: rule.step_order, 
              group_name: groupName, 
              allow_multiple: rule.option_groups?.allow_multiple === true, 
              free_choices_count: finalFreeChoices,
              options: allOptionsForStep,
              option_group_id: groupGroupId,
              is_menu: isMenuGroup
            };
          }));

          if (product.isSolo) {
            const motsAExclure = ['boisson', 'accompagnement', 'frite']; 
            formattedBaseSteps = formattedBaseSteps.filter(step => !motsAExclure.some(mot => step.group_name.toLowerCase().includes(mot)));
          }
          formattedBaseSteps = formattedBaseSteps.filter(step => step.options.length > 0);
        }

        let subGroupsData: any[] = subProdRes.data || [];

        const optArray = Array.from(optionIds).map(cleanId).filter(Boolean);
        if (optArray.length > 0) {
            const { data: sgOpt } = await supabase
              .from('sub_option_groups')
              .select(`id, name, min_choices, max_choices, free_choices_count, sort_order, option_id, product_id, is_menu, sub_option_choices ( id, name, price, is_available, sort_order )`)
              .in('option_id', optArray);
            if (sgOpt) subGroupsData = [...subGroupsData, ...sgOpt];
        }

        const validIngredients = (ingRes.data || [])
          .map((row: any) => row.global_ingredients)
          .filter((ing: any) => ing && ing.is_available !== false);

        const finalProdGroups = subGroupsData.filter(g => String(g.product_id) === String(product.id));
        const hasValidSubGroups = finalProdGroups.some(g => formatSubGroup(g).options.length > 0);

        if (formattedBaseSteps.length === 0 && !hasValidSubGroups && validIngredients.length === 0) {
            if (isMounted) { 
               onAddToCartRef.current(product, []); 
               onCloseRef.current(); 
            }
            return;
        }

        if (isMounted) {
          setBaseSteps(formattedBaseSteps);
          setAllSubGroups(subGroupsData);
          setIngredients(validIngredients);
          
          if (initialSelections && Object.keys(initialSelections).length > 0) {
            setStepSelections(initialSelections);
          } else {
            setStepSelections({});
          }
        }

      } catch (e) { 
        console.error("Erreur chargement options :", e);
      } finally { 
        if (isMounted) setIsLoading(false); 
      }
    };

    fetchRulesAndOptions();

    return () => { isMounted = false; };
  }, [product?.id, product?.isSolo, formatSubGroup]); 

  // 🟢 BASCULE DU MODE SEUL / MENU ET PURGE DES SÉLECTIONS INCOMPATIBLES
  const handleToggleSoloMode = (soloState: boolean) => {
    setIsSoloMode(soloState);

    if (soloState) {
      setStepSelections(prev => {
        const nextState = { ...prev };
        
        baseSteps.forEach(step => {
          if (step.is_menu) {
            delete nextState[step.id];
          }
        });

        allSubGroups.forEach(sg => {
          if (sg.is_menu) {
            delete nextState[`sub_${sg.id}`];
          }
        });

        return nextState;
      });

      setCurrentStep(0);
    }
  };

  // 🟢 CONSTRUCTION DES ÉTAPES ACTIVES
  const activeSteps = useMemo(() => {
    const optionSteps: StepData[] = [];
    const prodGroups = allSubGroups.filter(g => String(g.product_id) === String(product.id)).sort((a,b)=> (a.sort_order||0) - (b.sort_order||0));
    
    prodGroups.forEach(g => {
        if (isSoloMode && g.is_menu) return;
        const formatted = formatSubGroup(g);
        if (formatted.options.length > 0) optionSteps.push(formatted);
    });
    
    baseSteps.forEach(baseStep => {
        if (isSoloMode && baseStep.is_menu) return;
        if (baseStep.options.length > 0) optionSteps.push(baseStep);
    });

    optionSteps.sort((a, b) => (a.step_order || 0) - (b.step_order || 0));

    const steps: StepData[] = [];

    if (ingredients.length > 0) {
      steps.push({
        id: 'ingredients_step',
        min_choices: 0,
        max_choices: ingredients.length,
        step_order: -9999,
        group_name: 'Ingrédients',
        allow_multiple: true,
        options: [],
        isIngredientStep: true
      });
    }

    steps.push(...optionSteps);
    return steps;
  }, [baseSteps, allSubGroups, product.id, formatSubGroup, ingredients, isSoloMode]);

  activeStepsRef.current = activeSteps;

  // 🟢 POSITIONNE AUTOMATIQUEMENT L'ÉTAPE INITIALE SUR LA PREMIÈRE ETAPE D'OPTION (ET NON INGRÉDIENTS)
  useEffect(() => {
    if (!hasInitializedStepRef.current && activeSteps.length > 0) {
      const firstOptIndex = activeSteps.findIndex(s => !s.isIngredientStep);
      if (firstOptIndex !== -1) {
        setCurrentStep(firstOptIndex);
        hasInitializedStepRef.current = true;
      }
    } else if (currentStep >= activeSteps.length && activeSteps.length > 0) {
      setCurrentStep(Math.max(0, activeSteps.length - 1));
    }
  }, [activeSteps, currentStep]);

  const lastOptionStepIndex = useMemo(() => {
    const optionSteps = activeSteps.filter(s => !s.isIngredientStep);
    if (optionSteps.length === 0) return 0;
    const lastId = optionSteps[optionSteps.length - 1].id;
    return activeSteps.findIndex(s => s.id === lastId);
  }, [activeSteps]);

  // 🟢 VÉRIFICATION ET DÉTECTION DU PREMIER GROUPE D'OPTIONS INCOMPLET (INCLUANT LES SOUS-GROUPES SECONDARIES)
  const firstIncompleteStepIndex = useMemo(() => {
    const parentOptionIds = new Set(allSubGroups.map(g => cleanId(g.option_id)));

    for (let i = 0; i < activeSteps.length; i++) {
      const step = activeSteps[i];
      if (step.isIngredientStep) continue;
      if (isSoloMode && step.is_menu) continue;

      const sels = stepSelections[step.id] || [];
      if (sels.length < step.min_choices) {
        return i;
      }

      for (const opt of sels) {
        const cleanOptId = cleanId(opt.id);
        if (parentOptionIds.has(cleanOptId)) {
          const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId);
          for (const cg of childGroups) {
            if (isSoloMode && cg.is_menu) continue;
            const min = cg.min_choices != null ? Number(cg.min_choices) : 0;
            const childSels = stepSelections[`sub_${cg.id}`] || [];
            if (childSels.length < min) return i;
          }
        }
      }
    }
    return -1;
  }, [activeSteps, stepSelections, allSubGroups, isSoloMode]);

  // 🟢 CANFINISH : TRUE SEULEMENT SI AUCUNE ÉTAPE N'EST INCOMPLÈTE DANS TOUTE LA MODALE
  const canFinish = firstIncompleteStepIndex === -1;

  const toggleIngredient = useCallback((ingredientId: number) => {
    setRemovedIngredientIds(prev => {
      const next = new Set(prev);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  }, []);

  const compileFinalOptionsAndSubmit = useCallback(() => {
    if (isProcessing) return;
    setIsProcessing(true);

    setTimeout(() => {
        const flatOrderedOptions: any[] = [];
        let absoluteOrder = 1;
        const parentOptionIds = new Set(allSubGroups.map(g => cleanId(g.option_id)));

        const latestSelections = stepSelectionsRef.current;

        activeStepsRef.current.forEach((step, stepIdx) => {
            if (step.isIngredientStep) return;
            if (isSoloMode && step.is_menu) return;

            const sels = latestSelections[step.id] || [];
            const mappedSels = sels.map((opt, index) => ({ ...opt, originalIndex: index }));
            const paidSels = mappedSels.filter(x => x.price > 0).sort((a,b) => a.price - b.price);
            
            for(let i = 0; i < Math.min(step.free_choices_count || 0, paidSels.length); i++) {
                paidSels[i].price = 0;
            }

            sels.forEach((opt, optIndex) => {
                const finalOptPrice = mappedSels[optIndex].price;
                let hasSelectedChildren = false;
                const childrenToPush: any[] = [];
                const cleanOptId = cleanId(opt.id);

                if (parentOptionIds.has(cleanOptId)) {
                    const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId);
                    childGroups.forEach(cg => {
                        if (isSoloMode && cg.is_menu) return;
                        const childSels = latestSelections[`sub_${cg.id}`] || [];
                        if (childSels.length > 0) hasSelectedChildren = true;
                        
                        const mappedChild = childSels.map((cOpt, cIndex) => ({ ...cOpt, originalCIndex: cIndex }));
                        const paidChild = mappedChild.filter(x => x.price > 0).sort((a,b) => a.price - b.price);
                        
                        for(let i = 0; i < Math.min(cg.free_choices_count || 0, paidChild.length); i++) {
                            paidChild[i].price = 0;
                        }

                        childSels.forEach((cOpt, cIndex) => {
                            const groupName = cOpt.group_name || cg.name || step.group_name;
                            childrenToPush.push({
                                id: cOpt.id, 
                                name: cOpt.name, 
                                option_name: cOpt.name,
                                price: mappedChild[cIndex].price,
                                step_order: stepIdx, 
                                sort_order: optIndex,
                                group_name: groupName,
                                option_group_name: groupName,
                                groupName: groupName,
                                option_group_id: cOpt.option_group_id || cg.id || step.option_group_id,
                                _print_order: absoluteOrder++, 
                                isSubOption: true,
                                is_sub_option: true
                            });
                        });
                    });
                }

                if (!hasSelectedChildren) {
                    const groupName = opt.group_name || step.group_name || 'Options';
                    flatOrderedOptions.push({
                        id: opt.id, 
                        name: opt.name, 
                        option_name: opt.name,
                        price: finalOptPrice,
                        step_order: stepIdx, 
                        sort_order: optIndex,
                        group_name: groupName,
                        option_group_name: groupName,
                        groupName: groupName,
                        option_group_id: opt.option_group_id || step.option_group_id,
                        _print_order: absoluteOrder++, 
                        isSubOption: step.isSubOption,
                        is_sub_option: step.isSubOption
                    });
                }

                if (childrenToPush.length > 0) flatOrderedOptions.push(...childrenToPush);
            });
        });

        const removedList = ingredients.filter(ing => removedIngredientIds.has(ing.id));
        const optionsSignature = flatOrderedOptions.map(o => `${o.id}${o.isSubOption ? '_sub' : ''}`).join('-');
        const removedSignature = removedList.map(i => `no_${i.id}`).join('-');
        const soloSignature = isSoloMode ? 'solo' : 'menu';
        const cartItemId = `${product.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${optionsSignature}-${removedSignature}-${soloSignature}`;

        const finalOptionsToCart = flatOrderedOptions.map(opt => ({
            ...opt,
            _fusionId: cartItemId 
        }));

        // CALCUL DU NOM ET DU PRIX FINAL EN MODE SEUL
        const finalName = formatProductName(product.name, isSoloMode);
        const originalPrice = Number(product.price || 0);
        const finalBasePrice = isSoloMode && soloDiscount > 0
          ? Math.max(0, originalPrice - soloDiscount)
          : originalPrice;

        const uniqueProduct = {
            ...product,
            name: finalName,
            price: finalBasePrice,
            isSolo: isSoloMode,
            cartItemId: cartItemId, 
            uniqueId: cartItemId,   
            uuid: cartItemId,
            options: finalOptionsToCart,
            selectedOptions: finalOptionsToCart,
            flatOptions: finalOptionsToCart,
            selectedSubOptions: finalOptionsToCart,
            removedIngredients: removedList,
            rawSelections: latestSelections
        };

        const optionsPayload = finalOptionsToCart as any;
        optionsPayload.flatOptions = finalOptionsToCart;
        optionsPayload.rawSelections = latestSelections;
        optionsPayload.removedIngredients = removedList;
        optionsPayload.isSolo = isSoloMode;

        onAddToCartRef.current(uniqueProduct, optionsPayload);
        
        setIsProcessing(false);
        onCloseRef.current();
    }, 150);
  }, [isProcessing, allSubGroups, product, ingredients, removedIngredientIds, isSoloMode, soloDiscount]);

  // 🟢 NAVIGATION SUIVANT SÉCURISÉE AVEC REDIRECTION SUR LE PREMIER GROUPE INCOMPLET
  const handleNextStep = useCallback(() => {
    if (currentStep >= lastOptionStepIndex) {
      if (canFinish) {
        compileFinalOptionsAndSubmit();
      } else if (firstIncompleteStepIndex !== -1) {
        setCurrentStep(firstIncompleteStepIndex);
      }
    } else {
      let nextIndex = currentStep + 1;
      while (nextIndex < activeSteps.length && activeSteps[nextIndex].isIngredientStep) {
        nextIndex++;
      }
      if (nextIndex >= activeSteps.length) {
        if (canFinish) {
          compileFinalOptionsAndSubmit();
        } else if (firstIncompleteStepIndex !== -1) {
          setCurrentStep(firstIncompleteStepIndex);
        }
      } else {
        setCurrentStep(nextIndex);
      }
    }
  }, [currentStep, lastOptionStepIndex, activeSteps, canFinish, firstIncompleteStepIndex, compileFinalOptionsAndSubmit]);

  const handleSkipStep = useCallback(() => {
    const stepId = activeStepsRef.current[currentStep].id;
    setStepSelections(prev => ({ ...prev, [stepId]: [] })); 
    handleNextStep();
  }, [currentStep, handleNextStep]);

  const handleRemoveOption = useCallback((option: CustomizationOption, e: React.MouseEvent) => {
    e.stopPropagation();
    const stepId = activeSteps[currentStep].id;
    const cleanOptId = cleanId(option.id);
    
    setStepSelections(prev => {
        const currentSels = prev[stepId] || [];
        const indexToRemove = currentSels.map(o => String(o.id)).lastIndexOf(String(option.id));
        
        if (indexToRemove !== -1) {
            const newSels = [...currentSels];
            newSels.splice(indexToRemove, 1);
            const newState = { ...prev, [stepId]: newSels };
            
            if (!newSels.some(s => cleanId(s.id) === cleanOptId)) {
                const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId);
                childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; });
            }
            return newState;
        }
        return prev;
    });
  }, [currentStep, activeSteps, allSubGroups]);

  const toggleOption = useCallback((option: CustomizationOption) => {
    const stepData = activeSteps[currentStep];
    const stepId = stepData.id;
    const max = stepData.max_choices;
    const allowMultiple = stepData.allow_multiple;
    const cleanOptId = cleanId(option.id);
    
    setStepSelections(prev => {
        const currentSels = prev[stepId] || [];
        const occurrenceCount = currentSels.filter(s => String(s.id) === String(option.id)).length;
        const isAlreadySelected = occurrenceCount > 0;
        
        const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId)
                                        .filter(g => formatSubGroup(g).options.length > 0)
                                        .sort((a,b)=> (a.sort_order||0) - (b.sort_order||0));

        if (childGroups.length > 0) {
            if (isAlreadySelected && max === 1) {
                const newState = { ...prev, [stepId]: currentSels.filter(s => String(s.id) !== String(option.id)) };
                childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; }); 
                return newState;
            } else {
                if (max > 1 && currentSels.length >= max && !isAlreadySelected) return prev;
                setTimeout(() => setBubbleOption({ parentItem: option, childGroups, baseStepId: stepId }), 0);
            }
            return prev;
        }

        let newSels = [...currentSels];
        let removedOptions = [];

        if (max === 1) {
          if (isAlreadySelected) {
              newSels = [];
              removedOptions.push(option);
          } else {
              removedOptions = [...currentSels]; 
              newSels = [option];
          }
        } else {
          if (allowMultiple) {
             if (currentSels.length < max) newSels.push(option);
          } else {
             if (isAlreadySelected) {
                 newSels = currentSels.filter(s => String(s.id) !== String(option.id));
                 removedOptions.push(option);
             } else if (currentSels.length < max) {
                 newSels.push(option);
             }
          }
        }

        const newState = { ...prev, [stepId]: newSels };
        removedOptions.forEach(removedOpt => {
            const cgs = allSubGroups.filter(g => cleanId(g.option_id) === cleanId(removedOpt.id));
            cgs.forEach(cg => { newState[`sub_${cg.id}`] = []; });
        });

        if (!isAlreadySelected && newSels.length >= max) {
           setTimeout(() => {
             handleNextStep();
           }, 150);
        }

        return newState;
    });
  }, [currentStep, allSubGroups, activeSteps, handleNextStep, formatSubGroup]);

  const handleBubbleRemove = useCallback((stepId: string, choice: any, e: React.MouseEvent) => {
      e.stopPropagation();
      setStepSelections(prev => {
          const currentSels = prev[stepId] || [];
          const indexToRemove = currentSels.map(o => String(o.id)).lastIndexOf(String(choice.id));
          if (indexToRemove !== -1) {
              const newSels = [...currentSels];
              newSels.splice(indexToRemove, 1);
              return { ...prev, [stepId]: newSels };
          }
          return prev;
      });
  }, []);

  const handleBubbleChoice = (stepId: string, choice: any, max: number, allowMultiple: boolean) => {
      setStepSelections(prev => {
          const currentSels = prev[stepId] || [];
          const isAlreadySelected = currentSels.some(s => String(s.id) === String(choice.id));
          let newSels = [...currentSels];

          if (max === 1) {
              if (isAlreadySelected) newSels = [];
              else newSels = [choice];
          } else {
              if (allowMultiple) {
                  if (currentSels.length < max) newSels.push(choice);
              } else {
                  if (isAlreadySelected) newSels = currentSels.filter(s => String(s.id) === String(choice.id));
                  else if (currentSels.length < max) newSels.push(choice);
              }
          }
          return { ...prev, [stepId]: newSels };
      });
  };

  const isBubbleValid = () => {
      if (!bubbleOption) return false;
      return bubbleOption.childGroups.every(group => {
          const sels = stepSelections[`sub_${group.id}`] || [];
          return sels.length >= (group.min_choices != null ? Number(group.min_choices) : 0);
      });
  };

  const validateBubble = () => {
      if (!bubbleOption || !isBubbleValid()) return;
      const { parentItem, baseStepId } = bubbleOption;
      const stepData = activeSteps.find(s => s.id === baseStepId);
      if (!stepData) return;

      const max = stepData.max_choices;

      setStepSelections(prev => {
          const currentSels = prev[baseStepId] || [];
          const isAlreadySelected = currentSels.some(s => String(s.id) === String(parentItem.id));
          let newSels = [...currentSels];
          let removedOptions = [];

          if (max === 1) {
              if (!isAlreadySelected) {
                  removedOptions = [...currentSels]; 
                  newSels = [parentItem];
              }
          } else {
              if (!isAlreadySelected && currentSels.length < max) newSels.push(parentItem);
          }

          const newState = { ...prev, [baseStepId]: newSels };
          removedOptions.forEach(removedOpt => {
              const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanId(removedOpt.id));
              childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; });
          });

          if (!isAlreadySelected && newSels.length >= max) {
            setTimeout(() => {
                handleNextStep();
            }, 200);
          }
          
          return newState;
      });
      setBubbleOption(null);
  };

  // CALCUL DU TOTAL AVEC DÉDUCTION DU PRIX EN MODE SEUL
  const total = useMemo(() => {
    let basePrice = Number(product.price || 0);
    if (isSoloMode && soloDiscount > 0) {
      basePrice = Math.max(0, basePrice - soloDiscount);
    }
    
    let t = basePrice;
    const parentOptionIds = new Set(allSubGroups.map(g => cleanId(g.option_id)));

    activeSteps.forEach((step) => {
        if (step.isIngredientStep) return;

        const sels = stepSelections[step.id] || [];
        let stepPrices: number[] = [];

        sels.forEach((opt) => {
            const cleanOptId = cleanId(opt.id);
            if (parentOptionIds.has(cleanOptId)) {
                stepPrices.push(opt.price || 0);
                const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId);
                childGroups.forEach(cg => {
                    const childSels = stepSelections[`sub_${cg.id}`] || [];
                    const subFreeCount = cg.free_choices_count || 0;
                    const subPrices = childSels.map(cOpt => cOpt.price || 0).filter(p => p > 0);
                    subPrices.sort((a, b) => a - b);
                    const paidSubPrices = subPrices.slice(subFreeCount);
                    t += paidSubPrices.reduce((sum, p) => sum + p, 0);
                });
            } else {
                stepPrices.push(opt.price || 0);
            }
        });

        const freeCount = step.free_choices_count || 0;
        const paidPrices = stepPrices.filter(p => p > 0).sort((a, b) => a - b);
        const remainingPaidPrices = paidPrices.slice(freeCount);
        t += remainingPaidPrices.reduce((sum, p) => sum + p, 0);
    });
    return t;
  }, [product.price, stepSelections, allSubGroups, activeSteps, isSoloMode, soloDiscount]);

  if (isLoading || activeSteps.length === 0 || !activeSteps[currentStep]) return null;

  const stepData = activeSteps[currentStep];
  const currentSels = stepSelections[stepData.id] || [];
  
  // 🟢 VALIDATION ÉTAPE COURANTE
  const canProceed = stepData.isIngredientStep 
    ? true 
    : (currentSels.length >= stepData.min_choices && currentSels.length <= stepData.max_choices);

  const isFinalAction = currentStep >= lastOptionStepIndex;

  // 🟢 ÉTAT DU BOUTON SUIVANT/VALIDER (Si c'est l'action finale, il exige que canFinish soit true)
  const isButtonEnabled = isFinalAction ? canFinish : canProceed;

  const paidSelectionCount = currentSels.filter(s => (s.price || 0) > 0).length;
  const isNextChoiceFree = paidSelectionCount < (stepData.free_choices_count || 0);

  const displayName = formatProductName(product.name, isSoloMode);

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center font-helvetica p-4">
      <div className="bg-[#F3F4F6] w-full h-full flex flex-col overflow-hidden select-none">
        
        {/* Header */}
        <div className="bg-white border-b border-gray-200 shadow-sm p-4 flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={onClose} className="bg-red-500 text-white font-black px-6 py-3.5 rounded-xl uppercase tracking-wider active:scale-95 transition-transform text-sm">
              Annuler
            </button>
            <div className="h-10 w-px bg-gray-200"></div>

            <h2 className="text-2xl font-black text-secondary uppercase tracking-widest flex items-center gap-4">
              Options : {displayName}
              {!stepData.isIngredientStep && (stepData.free_choices_count ?? 0) > 0 && (
                  <span className="text-sm text-white font-bold bg-[#04B855] px-3 py-1.5 rounded-lg shadow-sm tracking-normal whitespace-nowrap">
                      {stepData.free_choices_count === 1 ? '1er choix offert' : `${stepData.free_choices_count} choix offerts`}
                  </span>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-6">
             <div className="text-right">
                <p className="text-gray-400 font-bold text-xs uppercase">Total Produit</p>
                <p className="text-3xl font-black text-primary">{total.toFixed(2)} €</p>
             </div>

             <div className="flex items-center gap-3">
                {/* 🟢 BOUTON SEUL */}
                {isCategoryMenu && (
                  <button
                    onClick={() => handleToggleSoloMode(!isSoloMode)}
                    className={`px-6 py-3.5 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-md ${
                      isSoloMode
                        ? 'bg-amber-500 text-white shadow-amber-500/20'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Seul
                  </button>
                )}

                {/* 🟢 BOUTON TERMINER */}
                <button
                  disabled={!canFinish}
                  onClick={() => { if (canFinish) compileFinalOptionsAndSubmit(); }}
                  className={`px-6 py-3.5 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 ${
                    canFinish
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  title={canFinish ? "Valider immédiatement le produit" : "Remplissez tous les choix obligatoires pour terminer"}
                >
                  Terminer
                </button>

                {/* 🟢 BOUTON SUIVANT / VALIDER (Bloqué si isFinalAction et canFinish = false) */}
                <button 
                  disabled={!isButtonEnabled}
                  onClick={() => { if (isButtonEnabled) handleNextStep(); }}
                  className={`px-8 py-3.5 rounded-xl font-black text-base uppercase tracking-wider shadow-lg transition-all active:scale-95 ${
                    isButtonEnabled ? 'bg-[#04B855] text-white shadow-[#04B855]/20' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {isFinalAction ? 'Valider' : 'Suivant ➔'}
                </button>
             </div>
          </div>
        </div>

        {/* 🟢 BARRE D'ONGLETS AVEC INDICATEURS DE SÉLECTION INCOMPLÈTE */}
        <div className="bg-white border-b border-gray-200 p-4 flex gap-3 overflow-x-auto no-scrollbar">
            {activeSteps.map((s, i) => {
                const sels = stepSelections[s.id] || [];
                
                // Détection de choix manquant dans ce groupe principal ou ses sous-groupes obligatoires
                let isMissingRequired = !s.isIngredientStep && sels.length < s.min_choices;
                if (!isMissingRequired && !s.isIngredientStep) {
                  const parentOptionIds = new Set(allSubGroups.map(g => cleanId(g.option_id)));
                  for (const opt of sels) {
                    const cleanOptId = cleanId(opt.id);
                    if (parentOptionIds.has(cleanOptId)) {
                      const childGroups = allSubGroups.filter(g => cleanId(g.option_id) === cleanOptId);
                      for (const cg of childGroups) {
                        if (isSoloMode && cg.is_menu) continue;
                        const min = cg.min_choices != null ? Number(cg.min_choices) : 0;
                        const childSels = stepSelections[`sub_${cg.id}`] || [];
                        if (childSels.length < min) {
                          isMissingRequired = true;
                          break;
                        }
                      }
                    }
                    if (isMissingRequired) break;
                  }
                }

                const countText = s.isIngredientStep 
                  ? (removedIngredientIds.size > 0 ? `${removedIngredientIds.size} retiré(s)` : 'Tous inclus')
                  : `${sels.length} / ${s.max_choices}`;

                return (
                  <button
                      key={s.id}
                      onClick={() => setCurrentStep(i)}
                      className={`h-[60px] px-8 rounded-xl font-black text-sm uppercase tracking-wide transition-all border-4 flex flex-col items-center justify-center min-w-[200px] ${
                          currentStep === i
                          ? 'bg-secondary text-white border-secondary shadow-md'
                          : isMissingRequired
                          ? 'bg-amber-50 text-amber-800 border-amber-300 hover:border-amber-400'
                          : 'bg-gray-50 text-secondary border-gray-100'
                      }`}
                  >
                      <span className="flex items-center gap-1">
                        <span>{s.group_name}</span>
                        {isMissingRequired && <span className="text-amber-600 font-black text-xs">*</span>}
                      </span>
                      <span className="text-[10px] opacity-70">
                          {countText} {s.min_choices > 0 && `(min ${s.min_choices})`}
                      </span>
                  </button>
                );
            })}
        </div>

        {/* Contenu principal */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          {stepData.isIngredientStep ? (
            /* --- VUE ONGLET INGRÉDIENTS (Optionnel, uniquement si cliqué) --- */
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-primary/10 border border-primary/20 p-4 rounded-xl">
                <p className="text-sm font-bold text-secondary uppercase tracking-wider">
                  Cliquez sur un ingrédient pour le retirer de votre préparation
                </p>
                <span className="text-xs font-bold text-primary bg-white px-3 py-1 rounded-full border border-primary/20">
                  {removedIngredientIds.size > 0 ? `${removedIngredientIds.size} ingrédient(s) retiré(s)` : 'Tous les ingrédients sont inclus'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-4 content-start">
                {ingredients.map(ing => {
                  const isRemoved = removedIngredientIds.has(ing.id);

                  return (
                    <div
                      key={ing.id}
                      onClick={() => toggleIngredient(ing.id)}
                      className={`w-full h-[100px] rounded-xl border-[3px] flex flex-col justify-between p-3 select-none transition-all duration-75 relative cursor-pointer ${
                        isRemoved
                          ? 'bg-red-50 border-red-400 shadow-md scale-[0.98]'
                          : 'bg-white border-gray-100 shadow-sm hover:border-gray-300'
                      }`}
                    >
                      <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10 ${
                        isRemoved ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
                      }`}>
                        {isRemoved ? '✕' : '✓'}
                      </div>

                      <div className="flex items-center gap-2">
                        {ing.image_url && (
                          <img src={ing.image_url} alt={ing.name} className="w-8 h-8 object-contain shrink-0" />
                        )}
                        <h3 className={`text-[16px] font-bold leading-tight line-clamp-2 ${isRemoved ? 'text-red-600 line-through' : 'text-gray-800'}`}>
                          {ing.name}
                        </h3>
                      </div>

                      <div className="flex items-end justify-end w-full">
                        <span className={`text-[11px] font-bold uppercase ${isRemoved ? 'text-red-500 font-black' : 'text-gray-400'}`}>
                          {isRemoved ? 'Retiré' : 'Inclus'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* --- VUE OPTIONS STANDARD --- */
            <div className="grid grid-cols-4 gap-4 content-start">
              
              {stepData.min_choices === 0 && (
                <div 
                  onClick={handleSkipStep}
                  className={`w-full h-[100px] rounded-xl border-[3px] flex flex-col justify-center items-center p-3 select-none transition-all duration-75 relative cursor-pointer group ${
                    currentSels.length === 0
                      ? 'bg-red-50 border-red-400 shadow-md scale-[0.98]'
                      : 'bg-white border-gray-100 hover:border-red-300 hover:bg-red-50/30 shadow-sm'
                  }`}
                >
                  {currentSels.length === 0 && (
                    <div className="absolute -top-2 -right-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10">
                      ✓
                    </div>
                  )}
                  <svg className={`w-8 h-8 mb-1 transition-transform group-hover:scale-110 ${currentSels.length === 0 ? 'text-red-500' : 'text-gray-400 group-hover:text-red-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <h3 className={`text-[14px] font-black uppercase tracking-widest ${currentSels.length === 0 ? 'text-red-500' : 'text-gray-500 group-hover:text-red-500'}`}>
                    Non merci
                  </h3>
                </div>
              )}

              {stepData.options.map(opt => {
                const occurrences = currentSels.filter(o => String(o.id) === String(opt.id));
                const qty = occurrences.length;
                const isSel = qty > 0;
                let displayPrice = opt.price;
                if (opt.price === 0 || isNextChoiceFree) displayPrice = 0;

                return (
                  <div 
                    key={opt.id} 
                    className={`w-full h-[100px] rounded-xl border-[3px] flex flex-col justify-between p-3 select-none transition-all duration-75 relative ${
                      isSel
                        ? 'bg-primary/5 border-primary shadow-md scale-[0.98]'
                        : 'bg-white border-gray-100 shadow-sm cursor-pointer hover:border-gray-300'
                    }`} 
                    onClick={() => toggleOption(opt)}
                  >
                    {isSel && (
                      <>
                        <div className="absolute -top-2 -right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10">
                          {qty > 1 ? `${qty}x` : '✓'}
                        </div>
                        <button 
                          onClick={(e) => handleRemoveOption(opt, e)} 
                          className="absolute -top-2 -left-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-lg shadow-md border-2 border-white z-20 hover:bg-red-600 transition-transform active:scale-90"
                        >
                          −
                        </button>
                      </>
                    )}
                    <h3 className={`text-[16px] font-bold leading-tight line-clamp-2 ${isSel ? 'text-primary' : 'text-gray-800'}`}>
                      {opt.name}
                    </h3>
                    <div className="flex items-end justify-end w-full">
                      {displayPrice > 0 ? (
                        <span className="text-[18px] font-black tracking-tight text-primary">+{displayPrice.toFixed(2)} €</span>
                      ) : (
                        <span className="text-[12px] font-bold text-gray-300 uppercase">Inclus</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bulle d'options secondaires */}
      {bubbleOption && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setBubbleOption(null)}>
          <div 
            className="bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col relative animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-2xl font-black text-secondary tracking-tight">Personnaliser : {bubbleOption.parentItem.name}</h3>
              <button onClick={() => setBubbleOption(null)} className="bg-gray-200 hover:bg-gray-300 rounded-full p-2 text-gray-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              {bubbleOption.childGroups.map(group => {
                  const stepId = `sub_${group.id}`;
                  const max = group.max_choices != null ? Number(group.max_choices) : 1;
                  const min = group.min_choices != null ? Number(group.min_choices) : 0;
                  const allowMultipleSub = max > 1; 
                  const choices = group.sub_option_choices.filter((c: any) => c.is_available !== false).sort((a: any, b: any) => a.sort_order - b.sort_order);
                  const currentSubSels = stepSelections[stepId] || [];

                  const paidSubSelsCount = currentSubSels.filter(s => (s.price || 0) > 0).length;
                  const isSubNextChoiceFree = paidSubSelsCount < (group.free_choices_count || 0);

                  return (
                      <div key={group.id} className="space-y-4">
                          <div className="flex items-center justify-between">
                              <h4 className="text-lg font-bold text-secondary uppercase tracking-widest">{group.name} {min > 0 && <span className="text-red-500 text-sm">*</span>}</h4>
                              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full uppercase tracking-wider">
                                  {currentSubSels.length} / {max}
                              </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                              
                              {min === 0 && (
                                  <div
                                      onClick={() => setStepSelections(prev => ({ ...prev, [stepId]: [] }))}
                                      className={`flex flex-col justify-center items-center p-4 rounded-xl border-[3px] cursor-pointer transition-all min-h-[80px] relative group ${
                                        currentSubSels.length === 0 
                                        ? 'border-red-400 bg-red-50 shadow-sm' 
                                        : 'border-gray-100 bg-white hover:border-red-300 hover:bg-red-50/30'
                                      }`}
                                  >
                                      {currentSubSels.length === 0 && (
                                          <div className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] shadow-sm border border-white z-10">
                                              ✓
                                          </div>
                                      )}
                                      <svg className={`w-6 h-6 mb-1 transition-transform group-hover:scale-110 ${currentSubSels.length === 0 ? 'text-red-500' : 'text-gray-400 group-hover:text-red-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                      <span className={`font-black text-xs uppercase tracking-wider ${currentSubSels.length === 0 ? 'text-red-500' : 'text-gray-500 group-hover:text-red-500'}`}>
                                        Non merci
                                      </span>
                                  </div>
                              )}

                              {choices.map((choice: any) => {
                                  const occurrences = currentSubSels.filter(s => String(s.id) === String(choice.id));
                                  const qty = occurrences.length;
                                  const isSelected = qty > 0;
                                  let effectiveChoicePrice = choice.price;
                                  if (choice.price === 0 || isSubNextChoiceFree) effectiveChoicePrice = 0;

                                  return (
                                      <div
                                          key={choice.id}
                                          onClick={() => handleBubbleChoice(stepId, choice, max, allowMultipleSub)}
                                          className={`flex flex-col justify-center p-4 rounded-xl border-[3px] cursor-pointer transition-all min-h-[80px] relative ${isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-300'}`}
                                      >
                                          {isSelected && (
                                            <>
                                              <div className="absolute -top-2 -right-2 bg-primary text-white w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] shadow-sm border border-white z-10">
                                                {qty > 1 ? `${qty}x` : '✓'}
                                              </div>
                                              <button 
                                                onClick={(e) => handleBubbleRemove(stepId, choice, e)} 
                                                className="absolute -top-2 -left-2 bg-red-500 text-white w-5 h-5 rounded-full flex items-center justify-center font-black text-[12px] shadow-sm border border-white z-20 hover:bg-red-600 transition-transform active:scale-90"
                                              >
                                                −
                                              </button>
                                            </>
                                          )}
                                          <span className={`font-bold text-md leading-tight ${isSelected ? 'text-primary' : 'text-gray-700'}`}>{choice.name}</span>
                                          {effectiveChoicePrice > 0 ? (
                                            <span className="text-sm font-black text-primary mt-1">+{effectiveChoicePrice.toFixed(2)}€</span>
                                          ) : (
                                            <span className="text-[10px] font-bold text-gray-400 uppercase mt-1">Inclus</span>
                                          )}
                                      </div>
                                  )
                              })}
                          </div>
                      </div>
                  )
              })}
            </div>

            <div className="p-6 border-t border-gray-100 bg-white">
                <button
                    disabled={!isBubbleValid()}
                    onClick={validateBubble}
                    className={`w-full py-5 rounded-2xl text-xl font-black uppercase tracking-wide transition-all shadow-lg ${isBubbleValid() ? 'bg-[#04B855] text-white hover:bg-[#039349]' : 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'}`}
                >
                    Valider ce choix
                </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default OptionsModal;