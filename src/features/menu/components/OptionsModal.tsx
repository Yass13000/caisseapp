// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';

export interface CustomizationOption { id: number | string; name: string; price: number; }
interface StepData { id: string; min_choices: number; max_choices: number; step_order: number; group_name: string; allow_multiple: boolean; options: CustomizationOption[]; isSubOption?: boolean; free_choices_count?: number; }

const OptionsModal = ({ product, onAddToCart, onClose, initialSelections }: any) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [baseSteps, setBaseSteps] = useState<StepData[]>([]);
  const [allSubGroups, setAllSubGroups] = useState<any[]>([]);
  const [stepSelections, setStepSelections] = useState<Record<string, CustomizationOption[]>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [bubbleOption, setBubbleOption] = useState<{ parentItem: CustomizationOption, childGroups: any[], baseStepId: string } | null>(null);

  const stepSelectionsRef = useRef(stepSelections);
  stepSelectionsRef.current = stepSelections;
  const activeStepsRef = useRef<StepData[]>([]);

  const formatSubGroup = useCallback((sg: any, parentOptName?: string): StepData => {
    const validChoices = (sg.sub_option_choices || [])
        .filter((c: any) => c.is_available !== false)
        .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((c: any) => ({
            id: c.id, 
            name: c.name,
            price: c.price || 0
        }));

    return {
        id: `sub_${sg.id}`,
        min_choices: sg.min_choices != null ? Number(sg.min_choices) : 0,
        max_choices: sg.max_choices != null ? Number(sg.max_choices) : 1,
        step_order: sg.sort_order || 0,
        group_name: parentOptName ? `${sg.name} (${parentOptName})` : sg.name,
        allow_multiple: (sg.max_choices != null ? Number(sg.max_choices) : 1) > 1, 
        options: validChoices,
        isSubOption: true,
        free_choices_count: sg.free_choices_count || 0 
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const fetchRules = async () => {
      setIsLoading(true);
      try {
        // ✅ REQUÊTE MODIFIÉE : Récupération de free_choices_count au niveau de product_option_groups + option_groups
        const { data: baseData, error } = await supabase
          .from('product_option_groups')
          .select(`id, min_choices, max_choices, step_order, free_choices_count, option_groups (id, name, allow_multiple, free_choices_count, option_group_links ( sort_order, options ( id, name, price, is_available ) ))`)
          .eq('product_id', product.id)
          .order('step_order');

        if (error) throw error;

        let formattedBaseSteps: StepData[] = [];
        const optionIds = new Set<string>();

        if (baseData && baseData.length > 0) {
          formattedBaseSteps = baseData.map((rule: any) => {
            const rawLinks = rule.option_groups?.option_group_links || [];
            const sortedLinks = rawLinks.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
            
            const validOptions = sortedLinks
              .map((link: any) => link.options)
              .filter((opt: any) => opt && opt.is_available !== false)
              .map((opt: any) => {
                 optionIds.add(String(opt.id));
                 return { id: opt.id, name: opt.name, price: opt.price };
              });

            // ✅ BACKWARD COMPATIBILITY : On priorise la règle produit, sinon on prend la règle du groupe global
            const finalFreeChoices = rule.free_choices_count != null 
              ? Number(rule.free_choices_count) 
              : (rule.option_groups?.free_choices_count || 0);

            return { 
              id: `base_${rule.id}`, 
              min_choices: rule.min_choices != null ? Number(rule.min_choices) : 0, 
              max_choices: rule.max_choices != null ? Number(rule.max_choices) : 1, 
              step_order: rule.step_order, 
              group_name: rule.option_groups?.name || 'Options', 
              allow_multiple: rule.option_groups?.allow_multiple === true, 
              free_choices_count: finalFreeChoices,
              options: validOptions 
            };
          });

          if (product.isSolo) {
            const motsAExclure = ['boisson', 'accompagnement', 'frite']; 
            formattedBaseSteps = formattedBaseSteps.filter(step => !motsAExclure.some(mot => step.group_name.toLowerCase().includes(mot)));
          }
          formattedBaseSteps = formattedBaseSteps.filter(step => step.options.length > 0);
        }

        let subGroupsData: any[] = [];
        if (product.id) {
            const { data: sgProd } = await supabase.from('sub_option_groups').select(`id, name, min_choices, max_choices, free_choices_count, sort_order, option_id, product_id, sub_option_choices ( id, name, price, is_available, sort_order )`).eq('product_id', product.id);
            if (sgProd) subGroupsData = [...subGroupsData, ...sgProd];
        }

        const optArray = Array.from(optionIds);
        if (optArray.length > 0) {
            const { data: sgOpt } = await supabase.from('sub_option_groups').select(`id, name, min_choices, max_choices, free_choices_count, sort_order, option_id, product_id, sub_option_choices ( id, name, price, is_available, sort_order )`).in('option_id', optArray);
            if (sgOpt) subGroupsData = [...subGroupsData, ...sgOpt];
        }

        const finalProdGroups = subGroupsData.filter(g => String(g.product_id) === String(product.id));
        const hasValidSubGroups = finalProdGroups.some(g => formatSubGroup(g).options.length > 0);

        if (formattedBaseSteps.length === 0 && !hasValidSubGroups) {
            if (isMounted) { setTimeout(() => { onAddToCart(product, []); onClose(); }, 0); }
            return;
        }

        if (isMounted) {
          setBaseSteps(formattedBaseSteps);
          setAllSubGroups(subGroupsData);
          
          if (initialSelections && Object.keys(initialSelections).length > 0) {
            setStepSelections(initialSelections);
          } else {
            setStepSelections({});
          }
        }

      } catch (e) { 
        if (isMounted) { onAddToCart(product, []); onClose(); }
      } finally { 
        if (isMounted) setIsLoading(false); 
      }
    };

    fetchRules();

    return () => { isMounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, product.isSolo]); 

  const activeSteps = useMemo(() => {
    const steps: StepData[] = [];
    const prodGroups = allSubGroups.filter(g => String(g.product_id) === String(product.id)).sort((a,b)=> (a.sort_order||0) - (b.sort_order||0));
    prodGroups.forEach(g => {
        const formatted = formatSubGroup(g);
        if (formatted.options.length > 0) steps.push(formatted);
    });
    baseSteps.forEach(baseStep => {
        if (baseStep.options.length > 0) steps.push(baseStep);
    });
    return steps.sort((a, b) => (a.step_order || 0) - (b.step_order || 0));
  }, [baseSteps, allSubGroups, product.id, formatSubGroup]);

  activeStepsRef.current = activeSteps;

  const compileFinalOptionsAndSubmit = useCallback(() => {
    if (isProcessing) return;
    setIsProcessing(true);

    setTimeout(() => {
        const flatOrderedOptions: any[] = [];
        let absoluteOrder = 1;
        const parentOptionIds = new Set(allSubGroups.map(g => String(g.option_id)));

        const latestSelections = stepSelectionsRef.current;

        activeStepsRef.current.forEach((step, stepIdx) => {
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

                if (parentOptionIds.has(String(opt.id))) {
                    const childGroups = allSubGroups.filter(g => String(g.option_id) === String(opt.id));
                    childGroups.forEach(cg => {
                        const childSels = latestSelections[`sub_${cg.id}`] || [];
                        if (childSels.length > 0) hasSelectedChildren = true;
                        
                        const mappedChild = childSels.map((cOpt, cIndex) => ({ ...cOpt, originalCIndex: cIndex }));
                        const paidChild = mappedChild.filter(x => x.price > 0).sort((a,b) => a.price - b.price);
                        
                        for(let i = 0; i < Math.min(cg.free_choices_count || 0, paidChild.length); i++) {
                            paidChild[i].price = 0;
                        }

                        childSels.forEach((cOpt, cIndex) => {
                            childrenToPush.push({
                                id: cOpt.id, name: cOpt.name, price: mappedChild[cIndex].price,
                                step_order: stepIdx, sort_order: optIndex,
                                _print_order: absoluteOrder++, isSubOption: true
                            });
                        });
                    });
                }

                if (!hasSelectedChildren) {
                    flatOrderedOptions.push({
                        id: opt.id, name: opt.name, price: finalOptPrice,
                        step_order: stepIdx, sort_order: optIndex,
                        _print_order: absoluteOrder++, isSubOption: step.isSubOption
                    });
                }

                if (childrenToPush.length > 0) flatOrderedOptions.push(...childrenToPush);
            });
        });

        const optionsSignature = flatOrderedOptions.map(o => `${o.id}${o.isSubOption ? '_sub' : ''}`).join('-');
        const cartItemId = `${product.id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${optionsSignature}`;

        const uniqueProduct = {
            ...product,
            cartItemId: cartItemId, 
            uniqueId: cartItemId,   
            uuid: cartItemId        
        };

        const finalOptionsToCart = flatOrderedOptions.map(opt => ({
            ...opt,
            _fusionId: cartItemId 
        }));

        onAddToCart(uniqueProduct, { flatOptions: finalOptionsToCart, rawSelections: latestSelections });
        
        setIsProcessing(false);
        onClose();
    }, 150);
  }, [isProcessing, allSubGroups, onAddToCart, product, onClose]);

  const handleNextStep = useCallback(() => {
    const maxIndex = activeStepsRef.current.length - 1;
    if (currentStep < maxIndex) setCurrentStep(prev => prev + 1);
    else compileFinalOptionsAndSubmit();
  }, [currentStep, compileFinalOptionsAndSubmit]);

  const handleSkipStep = useCallback(() => {
    const stepId = activeStepsRef.current[currentStep].id;
    setStepSelections(prev => ({ ...prev, [stepId]: [] })); 
    handleNextStep();
  }, [currentStep, handleNextStep]);

  const handleRemoveOption = useCallback((option: CustomizationOption, e: React.MouseEvent) => {
    e.stopPropagation();
    const stepId = activeSteps[currentStep].id;
    
    setStepSelections(prev => {
        const currentSels = prev[stepId] || [];
        const indexToRemove = currentSels.map(o => String(o.id)).lastIndexOf(String(option.id));
        
        if (indexToRemove !== -1) {
            const newSels = [...currentSels];
            newSels.splice(indexToRemove, 1);
            const newState = { ...prev, [stepId]: newSels };
            
            if (!newSels.some(s => String(s.id) === String(option.id))) {
                const childGroups = allSubGroups.filter(g => String(g.option_id) === String(option.id));
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
    
    setStepSelections(prev => {
        const currentSels = prev[stepId] || [];
        const occurrenceCount = currentSels.filter(s => String(s.id) === String(option.id)).length;
        const isAlreadySelected = occurrenceCount > 0;
        
        const childGroups = allSubGroups.filter(g => String(g.option_id) === String(option.id))
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
            const cgs = allSubGroups.filter(g => String(g.option_id) === String(removedOpt.id));
            cgs.forEach(cg => { newState[`sub_${cg.id}`] = []; });
        });

        if (!isAlreadySelected && newSels.length === max && !allowMultiple) {
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
                  if (isAlreadySelected) newSels = currentSels.filter(s => String(s.id) !== String(choice.id));
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
      const allowMultiple = stepData.allow_multiple;

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
              const childGroups = allSubGroups.filter(g => String(g.option_id) === String(removedOpt.id));
              childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; });
          });

          if (!isAlreadySelected && newSels.length === max && !allowMultiple) {
            setTimeout(() => {
                handleNextStep();
            }, 200);
          }
          
          return newState;
      });
      setBubbleOption(null);
  };

  const total = useMemo(() => {
    let t = product.price || 0;
    const parentOptionIds = new Set(allSubGroups.map(g => String(g.option_id)));

    activeSteps.forEach((step) => {
        const sels = stepSelections[step.id] || [];
        let stepPrices: number[] = [];

        sels.forEach((opt) => {
            if (parentOptionIds.has(String(opt.id))) {
                stepPrices.push(opt.price || 0);
                const childGroups = allSubGroups.filter(g => String(g.option_id) === String(opt.id));
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
  }, [product.price, stepSelections, allSubGroups, activeSteps]);

  if (isLoading || activeSteps.length === 0 || !activeSteps[currentStep]) return null;

  const stepData = activeSteps[currentStep];
  const currentSels = stepSelections[stepData.id] || [];
  const canProceed = currentSels.length >= stepData.min_choices && currentSels.length <= stepData.max_choices;

  const paidSelectionCount = currentSels.filter(s => (s.price || 0) > 0).length;
  const isNextChoiceFree = paidSelectionCount < (stepData.free_choices_count || 0);

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center font-helvetica p-4">
      <div className="bg-[#F3F4F6] w-full h-full flex flex-col overflow-hidden select-none">
        
        <div className="bg-white border-b border-gray-200 shadow-sm p-4 flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={onClose} className="bg-red-500 text-white font-black px-6 py-3 rounded-xl uppercase tracking-wider active:scale-95 transition-transform">
              Annuler
            </button>
            <div className="h-10 w-px bg-gray-200"></div>
            <h2 className="text-2xl font-black text-secondary uppercase tracking-widest flex items-center gap-4">
              Options : {product.name}
              {(stepData.free_choices_count ?? 0) > 0 && (
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
             <button 
                disabled={!canProceed}
                onClick={() => { if (canProceed) handleNextStep(); }}
                className={`px-10 py-4 rounded-xl font-black text-xl uppercase tracking-widest shadow-lg transition-all active:scale-95 ${canProceed ? 'bg-[#04B855] text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
             >
                {currentStep < activeSteps.length - 1 ? 'Suivant ➔' : 'Valider'}
             </button>
          </div>
        </div>

        <div className="bg-white border-b border-gray-200 p-4 flex gap-3 overflow-x-auto no-scrollbar">
            {activeSteps.map((s, i) => (
                <button
                    key={s.id}
                    onClick={() => setCurrentStep(i)}
                    className={`h-[60px] px-8 rounded-xl font-black text-sm uppercase tracking-wide transition-all border-4 flex flex-col items-center justify-center min-w-[200px] ${
                        currentStep === i
                        ? 'bg-secondary text-white border-secondary shadow-md'
                        : 'bg-gray-50 text-secondary border-gray-100'
                    }`}
                >
                    <span>{s.group_name}</span>
                    <span className="text-[10px] opacity-70">
                        {(stepSelections[s.id] || []).length} / {s.max_choices}
                    </span>
                </button>
            ))}
        </div>

        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
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
        </div>
      </div>

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