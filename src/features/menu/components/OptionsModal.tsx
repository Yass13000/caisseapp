// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';

export interface CustomizationOption { id: number | string; name: string; price: number; }
interface StepData { id: string; min_choices: number; max_choices: number; step_order: number; group_name: string; allow_multiple: boolean; options: CustomizationOption[]; isSubOption?: boolean; }

const OptionsModal = ({ product, onAddToCart, onClose }: any) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [baseSteps, setBaseSteps] = useState<StepData[]>([]);
  const [allSubGroups, setAllSubGroups] = useState<any[]>([]);
  const [stepSelections, setStepSelections] = useState<Record<string, CustomizationOption[]>>({});
  
  const [isLoading, setIsLoading] = useState(true);
  const [bubbleOption, setBubbleOption] = useState<{ parentItem: CustomizationOption, childGroups: any[], baseStepId: string } | null>(null);

  // --- FORMATAGE DES SOUS-OPTIONS ---
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
        min_choices: sg.min_choices || 0,
        max_choices: sg.max_choices || 1,
        step_order: sg.sort_order || 0,
        group_name: parentOptName ? `${sg.name} (${parentOptName})` : sg.name,
        allow_multiple: (sg.max_choices || 1) > 1, 
        options: validChoices,
        isSubOption: true
    };
  }, []);

  // --- CHARGEMENT DES DONNÉES (BASE + SOUS-OPTIONS) ---
  useEffect(() => {
    const fetchRules = async () => {
      setIsLoading(true);
      try {
        // 1. Fetch Options de base
        const { data: baseData, error } = await supabase
          .from('product_option_groups')
          .select(`id, min_choices, max_choices, step_order, option_groups (id, name, allow_multiple, option_group_links ( sort_order, options ( id, name, price, is_available ) ))`)
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

            return { 
              id: `base_${rule.id}`, min_choices: rule.min_choices, max_choices: rule.max_choices, 
              step_order: rule.step_order, group_name: rule.option_groups?.name || 'Options', 
              allow_multiple: rule.option_groups?.allow_multiple === true, options: validOptions 
            };
          });

          // Filtrage pour mode Solo
          if (product.isSolo) {
            const motsAExclure = ['boisson', 'accompagnement', 'frite']; 
            formattedBaseSteps = formattedBaseSteps.filter(step => !motsAExclure.some(mot => step.group_name.toLowerCase().includes(mot)));
          }

          // Filtre des étapes vides
          formattedBaseSteps = formattedBaseSteps.filter(step => step.options.length > 0);
        }

        // 2. Fetch Sous-Options
        let subGroupsData: any[] = [];
        if (product.id) {
            const { data: sgProd } = await supabase.from('sub_option_groups').select(`id, name, min_choices, max_choices, sort_order, option_id, product_id, sub_option_choices ( id, name, price, is_available, sort_order )`).eq('product_id', product.id);
            if (sgProd) subGroupsData = [...subGroupsData, ...sgProd];
        }

        const optArray = Array.from(optionIds);
        if (optArray.length > 0) {
            const { data: sgOpt } = await supabase.from('sub_option_groups').select(`id, name, min_choices, max_choices, sort_order, option_id, product_id, sub_option_choices ( id, name, price, is_available, sort_order )`).in('option_id', optArray);
            if (sgOpt) subGroupsData = [...subGroupsData, ...sgOpt];
        }

        const finalProdGroups = subGroupsData.filter(g => String(g.product_id) === String(product.id));
        const hasValidSubGroups = finalProdGroups.some(g => formatSubGroup(g).options.length > 0);

        if (formattedBaseSteps.length === 0 && !hasValidSubGroups) {
            setTimeout(() => { onAddToCart(product, []); onClose(); }, 0);
            return;
        }

        setBaseSteps(formattedBaseSteps);
        setAllSubGroups(subGroupsData);
        setStepSelections({});
      } catch (e) { 
        onAddToCart(product, []); onClose(); 
      } finally { 
        setIsLoading(false); 
      }
    };
    fetchRules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, product.isSolo]); 

  // --- CONSTRUCTION DES ÉTAPES ACTIVES ---
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

  useEffect(() => {
    if (!isLoading && activeSteps.length === 0) {
      onAddToCart(product, []);
      onClose();
    }
  }, [isLoading, activeSteps.length, product, onAddToCart, onClose]);

  // --- COMPILATION FINALE DE L'ORDRE D'IMPRESSION ---
  // <-- CORRECTION ICI : On permet d'injecter manuellement le state pour éviter le décalage (stale closure)
  const compileFinalOptionsAndSubmit = useCallback((forcedSelections?: Record<string, CustomizationOption[]>) => {
    const activeSelections = forcedSelections || stepSelections;
    const flatOrderedOptions: any[] = [];
    let absoluteOrder = 1;
    const parentOptionIds = new Set(allSubGroups.map(g => String(g.option_id)));

    activeSteps.forEach((step, stepIdx) => {
        const sels = activeSelections[step.id] || [];
        sels.forEach((opt, optIndex) => {
            if (parentOptionIds.has(String(opt.id))) {
                const childGroups = allSubGroups.filter(g => String(g.option_id) === String(opt.id));
                childGroups.forEach(cg => {
                    const childSels = activeSelections[`sub_${cg.id}`] || [];
                    childSels.forEach(cOpt => {
                        flatOrderedOptions.push({
                            id: cOpt.id, name: cOpt.name, price: cOpt.price,
                            step_order: stepIdx, sort_order: optIndex,
                            _print_order: absoluteOrder++, isSubOption: true
                        });
                    });
                });
            } else {
                flatOrderedOptions.push({
                    id: opt.id, name: opt.name, price: opt.price,
                    step_order: stepIdx, sort_order: optIndex,
                    _print_order: absoluteOrder++, isSubOption: step.isSubOption
                });
            }
        });
    });

    onAddToCart(product, flatOrderedOptions);
    onClose();
  }, [activeSteps, stepSelections, allSubGroups, onAddToCart, product, onClose]);

  // --- SÉLECTION CLASSIQUE ET DÉCLENCHEMENT BUBBLE ---
  const toggleOption = useCallback((option: CustomizationOption) => {
    const stepData = activeSteps[currentStep];
    const stepId = stepData.id;
    const max = stepData.max_choices;
    const currentSels = stepSelections[stepId] || [];
    const isAlreadySelected = currentSels.some(s => String(s.id) === String(option.id));
    
    const childGroups = allSubGroups.filter(g => String(g.option_id) === String(option.id)).sort((a,b)=> (a.sort_order||0) - (b.sort_order||0));

    if (childGroups.length > 0) {
        if (isAlreadySelected && max === 1) {
            setStepSelections(prev => {
                const newState = { ...prev, [stepId]: currentSels.filter(s => String(s.id) !== String(option.id)) };
                childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; }); 
                return newState;
            });
        } else {
            if (max > 1 && currentSels.length >= max && !isAlreadySelected) return;
            setBubbleOption({ parentItem: option, childGroups, baseStepId: stepId });
        }
        return;
    }

    setStepSelections(prev => {
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
        if (isAlreadySelected) newSels = currentSels.filter(s => String(s.id) !== String(option.id));
        else if (currentSels.length < max) newSels = [...currentSels, option];
      }

      const newState = { ...prev, [stepId]: newSels };

      removedOptions.forEach(removedOpt => {
          const cgs = allSubGroups.filter(g => String(g.option_id) === String(removedOpt.id));
          cgs.forEach(cg => { newState[`sub_${cg.id}`] = []; });
      });

      // <-- CORRECTION ICI : Si on doit valider, on passe directement la nouvelle sélection sans attendre que React mette à jour le composant !
      if (!isAlreadySelected && newSels.length === max) {
         setTimeout(() => {
           if (currentStep < activeSteps.length - 1) setCurrentStep(s => s + 1);
           else compileFinalOptionsAndSubmit(newState);
         }, 150);
      }

      return newState;
    });
  }, [currentStep, stepSelections, allSubGroups, activeSteps, compileFinalOptionsAndSubmit]);

  // --- LOGIQUE BUBBLE (SOUS-OPTIONS) ---
  const handleBubbleChoice = (stepId: string, choice: any, max: number) => {
      setStepSelections(prev => {
          const currentSels = prev[stepId] || [];
          const isAlreadySelected = currentSels.some(s => String(s.id) === String(choice.id));
          let newSels = [...currentSels];

          if (max === 1) {
              if (isAlreadySelected) newSels = [];
              else newSels = [choice];
          } else {
              if (isAlreadySelected) newSels = currentSels.filter(s => String(s.id) !== String(choice.id));
              else if (currentSels.length < max) newSels = [...currentSels, choice];
          }
          return { ...prev, [stepId]: newSels };
      });
  };

  const isBubbleValid = () => {
      if (!bubbleOption) return false;
      return bubbleOption.childGroups.every(group => {
          const sels = stepSelections[`sub_${group.id}`] || [];
          return sels.length >= (group.min_choices || 0);
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
              if (!isAlreadySelected && currentSels.length < max) newSels = [...currentSels, parentItem];
          }

          const newState = { ...prev, [baseStepId]: newSels };

          removedOptions.forEach(removedOpt => {
              const childGroups = allSubGroups.filter(g => String(g.option_id) === String(removedOpt.id));
              childGroups.forEach(cg => { newState[`sub_${cg.id}`] = []; });
          });

          // <-- CORRECTION ICI : Même logique pour la Bubble
          if (!isAlreadySelected && newSels.length === max) {
            setTimeout(() => {
                if (currentStep < activeSteps.length - 1) setCurrentStep(s => s + 1);
                else compileFinalOptionsAndSubmit(newState);
            }, 200);
          }

          return newState;
      });
      setBubbleOption(null);
  };

  // --- CALCUL DU TOTAL ---
  const total = useMemo(() => {
    let t = product.price || 0;
    const parentOptionIds = new Set(allSubGroups.map(g => String(g.option_id)));

    activeSteps.forEach((step) => {
        const sels = stepSelections[step.id] || [];
        sels.forEach((opt) => {
            if (parentOptionIds.has(String(opt.id))) {
                const childGroups = allSubGroups.filter(g => String(g.option_id) === String(opt.id));
                childGroups.forEach(cg => {
                    const childSels = stepSelections[`sub_${cg.id}`] || [];
                    childSels.forEach(cOpt => { t += cOpt.price || 0; });
                });
            } else {
                t += opt.price || 0;
            }
        });
    });
    return t;
  }, [product.price, stepSelections, allSubGroups, activeSteps]);

  if (isLoading || activeSteps.length === 0 || !activeSteps[currentStep]) return null;

  const stepData = activeSteps[currentStep];
  const currentSels = stepSelections[stepData.id] || [];
  const canProceed = currentSels.length >= stepData.min_choices && currentSels.length <= stepData.max_choices;

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center font-helvetica p-4">
      <div className="bg-[#F3F4F6] w-full h-full flex flex-col overflow-hidden select-none">
        
        {/* 1. HEADER */}
        <div className="bg-white border-b border-gray-200 shadow-sm p-4 flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={onClose} className="bg-red-500 text-white font-black px-6 py-3 rounded-xl uppercase tracking-wider active:scale-95 transition-transform">
              Annuler
            </button>
            <div className="h-10 w-px bg-gray-200"></div>
            <h2 className="text-2xl font-black text-secondary uppercase tracking-widest">
              Options : {product.name}
            </h2>
          </div>

          <div className="flex items-center gap-6">
             <div className="text-right">
                <p className="text-gray-400 font-bold text-xs uppercase">Total Produit</p>
                <p className="text-3xl font-black text-primary">{total.toFixed(2)} €</p>
             </div>
             <button 
                disabled={!canProceed}
                onClick={() => {
                   if (currentStep < activeSteps.length - 1) setCurrentStep(s => s + 1);
                   else compileFinalOptionsAndSubmit();
                }}
                className={`px-10 py-4 rounded-xl font-black text-xl uppercase tracking-widest shadow-lg transition-all active:scale-95 ${canProceed ? 'bg-[#04B855] text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
             >
                {currentStep < activeSteps.length - 1 ? 'Suivant ➔' : 'Valider'}
             </button>
          </div>
        </div>

        {/* 2. CATÉGORIES D'OPTIONS */}
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
                        {stepSelections[s.id]?.length || 0} / {s.max_choices}
                    </span>
                </button>
            ))}
        </div>

        {/* 3. GRILLE DES OPTIONS */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-4 gap-4 content-start">
            {stepData.options.map(opt => {
              const isSel = currentSels.some(o => String(o.id) === String(opt.id));
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
                    <div className="absolute -top-2 -right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10">✓</div>
                  )}
                  
                  <h3 className={`text-[16px] font-bold leading-tight line-clamp-2 ${isSel ? 'text-primary' : 'text-gray-800'}`}>
                    {opt.name}
                  </h3>

                  <div className="flex items-end justify-end w-full">
                    {opt.price > 0 ? (
                      <span className="text-[18px] font-black tracking-tight text-primary">
                        +{opt.price.toFixed(2)} €
                      </span>
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

      {/* 4. MODALE BUBBLE (POUR LES SOUS-OPTIONS) */}
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
                  const max = group.max_choices || 1;
                  const min = group.min_choices || 0;
                  const choices = group.sub_option_choices.filter((c: any) => c.is_available !== false).sort((a: any, b: any) => a.sort_order - b.sort_order);
                  const currentSubSels = stepSelections[stepId] || [];

                  return (
                      <div key={group.id} className="space-y-4">
                          <div className="flex items-center justify-between">
                              <h4 className="text-lg font-bold text-secondary uppercase tracking-widest">{group.name} {min > 0 && <span className="text-red-500 text-sm">*</span>}</h4>
                              <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full uppercase tracking-wider">
                                  {currentSubSels.length} / {max}
                              </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                              {choices.map((choice: any) => {
                                  const isSelected = currentSubSels.some(s => String(s.id) === String(choice.id));
                                  return (
                                      <div
                                          key={choice.id}
                                          onClick={() => handleBubbleChoice(stepId, choice, max)}
                                          className={`flex flex-col justify-center p-4 rounded-xl border-[3px] cursor-pointer transition-all min-h-[80px] relative ${isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-300'}`}
                                      >
                                          {isSelected && (
                                            <div className="absolute -top-2 -right-2 bg-primary text-white w-5 h-5 rounded-full flex items-center justify-center font-black text-[10px] shadow-sm border border-white">✓</div>
                                          )}
                                          <span className={`font-bold text-md leading-tight ${isSelected ? 'text-primary' : 'text-gray-700'}`}>{choice.name}</span>
                                          {choice.price > 0 && (
                                            <span className="text-sm font-black text-primary mt-1">+{choice.price.toFixed(2)}€</span>
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