// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';

export interface CustomizationOption { id: number; name: string; price: number; }
interface StepData { id: number; min_choices: number; max_choices: number; step_order: number; group_name: string; options: CustomizationOption[]; }

const OptionsModal = ({ product, onAddToCart, onClose }: any) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepSelections, setStepSelections] = useState<Record<number, CustomizationOption[]>>({});
  const [steps, setSteps] = useState<StepData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      try {
        // NOUVEAU : On ajoute 'is_available' dans le select des options
        const { data, error } = await supabase
          .from('product_option_groups')
          .select(`id, min_choices, max_choices, step_order, option_groups (name, option_group_links (options (id, name, price, is_available)))`)
          .eq('product_id', product.id)
          .order('step_order');
          
        if (error || !data || data.length === 0) { onAddToCart(product, {}); return; }

        let formattedSteps = data.map((rule: any) => {
          const rawOptions = rule.option_groups?.option_group_links?.map((l: any) => l.options) || [];
          
          // NOUVEAU : On filtre pour ne garder que les options qui sont "is_available === true"
          const validOptions = rawOptions
            .filter((opt: any) => opt && opt.is_available !== false)
            .map((opt: any) => ({
              id: opt.id, name: opt.name, price: opt.price
            }))
            .sort((a: any, b: any) => a.price - b.price || a.name.localeCompare(b.name));
            
          return { 
            id: rule.id, 
            // Sécurité : on empêche min_choices d'être plus grand que le nombre d'options dispo
            min_choices: Math.min(rule.min_choices, validOptions.length), 
            max_choices: rule.max_choices, 
            step_order: rule.step_order, 
            group_name: rule.option_groups?.name || 'Options', 
            options: validOptions 
          };
        });

        // NOUVEAU : On supprime les étapes (groupes) qui se retrouveraient vides à cause des ruptures
        formattedSteps = formattedSteps.filter(s => s.options.length > 0);

        if (product.isSolo) formattedSteps = formattedSteps.filter(s => !['boisson', 'accompagnement', 'frite'].some(m => s.group_name.toLowerCase().includes(m)));

        if (formattedSteps.length > 0) {
          setSteps(formattedSteps);
          const initSels: any = {};
          formattedSteps.forEach((_, i) => initSels[i] = []);
          setStepSelections(initSels);
        } else { onAddToCart(product, {}); }
      } catch (e) { onAddToCart(product, {}); } finally { setIsLoading(false); }
    };
    fetchRules();
  }, [product]);

  const toggleOption = (option: CustomizationOption) => {
    const stepData = steps[currentStep];
    const current = stepSelections[currentStep] || [];
    const isSelected = current.some(o => o.id === option.id);
    let newCurrent;
    
    if (stepData.max_choices === 1) { 
      newCurrent = isSelected ? [] : [option]; 
    } else {
      if (isSelected) newCurrent = current.filter(o => o.id !== option.id);
      else if (current.length < stepData.max_choices) newCurrent = [...current, option];
      else return;
    }

    const newStepSelections = { ...stepSelections, [currentStep]: newCurrent };
    setStepSelections(newStepSelections);

    if (!isSelected && newCurrent.length === stepData.max_choices) {
      setTimeout(() => {
        if (currentStep < steps.length - 1) setCurrentStep(s => s + 1);
        else {
          const final: any = {};
          Object.entries(newStepSelections).forEach(([idx, opts]) => { final[steps[parseInt(idx)].id] = opts; });
          onAddToCart(product, final);
        }
      }, 150);
    }
  };

  const currentSels = stepSelections[currentStep] || [];
  const stepData = steps[currentStep];
  const canProceed = stepData && currentSels.length >= stepData.min_choices && currentSels.length <= stepData.max_choices;
  const total = useMemo(() => { let t = product.price || 0; Object.values(stepSelections).flat().forEach(o => t += o.price || 0); return t; }, [product.price, stepSelections]);

  if (isLoading || !stepData) return null;

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
                   if (currentStep < steps.length - 1) setCurrentStep(s => s + 1);
                   else {
                      const final: any = {};
                      Object.entries(stepSelections).forEach(([idx, opts]) => { final[steps[parseInt(idx)].id] = opts; });
                      onAddToCart(product, final);
                   }
                }}
                className={`px-10 py-4 rounded-xl font-black text-xl uppercase tracking-widest shadow-lg transition-all active:scale-95 ${canProceed ? 'bg-[#04B855] text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
             >
                {currentStep < steps.length - 1 ? 'Suivant ➔' : 'Valider'}
             </button>
          </div>
        </div>

        {/* 2. CATÉGORIES D'OPTIONS */}
        <div className="bg-white border-b border-gray-200 p-4 flex gap-3 overflow-x-auto no-scrollbar">
            {steps.map((s, i) => (
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
                        {stepSelections[i]?.length || 0} / {s.max_choices}
                    </span>
                </button>
            ))}
        </div>

        {/* 3. GRILLE DES OPTIONS */}
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-4 gap-4 content-start">
            {stepData.options.map(opt => {
              const isSel = currentSels.some(o => o.id === opt.id);
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
                    <div className="absolute -top-2 -right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white">✓</div>
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
    </div>,
    document.body
  );
};

export default OptionsModal;