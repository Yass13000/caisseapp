// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, Search, ChevronDown, ChevronRight, Layers, AlertOctagon, ListTree } from 'lucide-react';
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface StockItem {
  id: number | string;
  name: string;
  description: string; 
  category: string;
  is_available: boolean;
  image: string;
  type: 'product' | 'option' | 'sub_option';
}

interface StockModalProps {
  onClose: () => void;
}

const StockModal = ({ onClose }: StockModalProps) => {
  const [items, setItems] = useState<StockItem[]>([]);
  
  const [selectedType, setSelectedType] = useState<'product' | 'option' | 'sub_option' | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  
  const [isProductsOpen, setIsProductsOpen] = useState(true);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isSubOptionsOpen, setIsSubOptionsOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    setIsLoading(true);
    try {
      const activeRestoId = localStorage.getItem('pos_restaurant_id') || localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;
      
      if (!activeRestoId) {
        toast.error("Veuillez configurer la caisse (ID restaurant manquant)");
        setIsLoading(false);
        return;
      }

      const { data: productsData, error: productsError } = await supabase
        .from('product').select('id, name, description, category, is_available, image').eq('restaurant_id', activeRestoId);

      if (productsError) throw productsError;

      const { data: optionsData, error: optionsError } = await supabase
        .from('options').select('id, name, description, is_available, image_url').eq('restaurant_id', activeRestoId);

      if (optionsError) throw optionsError;

      const { data: groupsData } = await supabase
        .from('option_groups').select(`name, option_group_links (option_id)`).eq('restaurant_id', activeRestoId);

      const optionCategoryMap: Record<string, string> = {};
      if (groupsData) {
        groupsData.forEach((group: any) => {
          if (group.option_group_links) {
            group.option_group_links.forEach((link: any) => {
              if (link.option_id && !optionCategoryMap[link.option_id]) {
                optionCategoryMap[link.option_id] = group.name;
              }
            });
          }
        });
      }

      const { data: subGroupsData } = await supabase
        .from('sub_option_groups').select(`name, sub_option_choices (id, name, is_available)`);

      const formattedProducts: StockItem[] = (productsData || []).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        category: p.category,
        is_available: p.is_available,
        image: p.image || '',
        type: 'product'
      }));

      const formattedOptions: StockItem[] = (optionsData || []).map((o: any) => ({
        id: o.id,
        name: o.name,
        description: o.description || '',
        category: optionCategoryMap[o.id] || 'Autres', 
        is_available: o.is_available,
        image: o.image_url || '',
        type: 'option'
      }));

      const formattedSubOptions: StockItem[] = [];
      if (subGroupsData) {
        subGroupsData.forEach((group: any) => {
          if (group.sub_option_choices) {
            group.sub_option_choices.forEach((choice: any) => {
              if (!formattedSubOptions.find(so => so.id === choice.id)) {
                formattedSubOptions.push({
                  id: choice.id,
                  name: choice.name,
                  description: '', 
                  category: group.name || 'Autres',
                  is_available: choice.is_available,
                  image: '',
                  type: 'sub_option'
                });
              }
            });
          }
        });
      }

      setItems([...formattedProducts, ...formattedOptions, ...formattedSubOptions]);
    } catch (e) {
      toast.error("Erreur lors du chargement des stocks");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeactivateAll = async (itemsToDisable: StockItem[]) => {
    const activeToDisable = itemsToDisable.filter(i => i.is_available);
    if (activeToDisable.length === 0) {
      toast.info("Tous les éléments correspondants sont déjà en rupture.");
      return;
    }

    if (!confirm(`Voulez-vous vraiment passer ces ${activeToDisable.length} éléments en rupture d'un coup ?`)) return;

    setIsLoading(true);

    const productIds = activeToDisable.filter(i => i.type === 'product').map(i => i.id);
    const optionIds = activeToDisable.filter(i => i.type === 'option').map(i => i.id);
    const subOptionIds = activeToDisable.filter(i => i.type === 'sub_option').map(i => i.id);

    try {
      const batchQueries = [];
      if (productIds.length > 0) {
        batchQueries.push(supabase.from('product').update({ is_available: false }).in('id', productIds));
      }
      if (optionIds.length > 0) {
        batchQueries.push(supabase.from('options').update({ is_available: false }).in('id', optionIds));
      }
      if (subOptionIds.length > 0) {
        batchQueries.push(supabase.from('sub_option_choices').update({ is_available: false }).in('id', subOptionIds));
      }

      const results = await Promise.all(batchQueries);
      const hasError = results.some(r => r.error);
      if (hasError) throw new Error("Erreur lors de la désactivation groupée.");

      setItems(current => 
        current.map(item => {
          const match = activeToDisable.some(d => d.id === item.id && d.type === item.type);
          return match ? { ...item, is_available: false } : item;
        })
      );

      toast.success(`${activeToDisable.length} éléments passés en rupture !`);
    } catch (err: any) {
      toast.error(err.message || "Impossible de désactiver les éléments.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStock = async (itemId: number | string, currentStatus: boolean, type: 'product' | 'option' | 'sub_option') => {
    const newStatus = !currentStatus;
    
    let tableName = 'product';
    if (type === 'option') tableName = 'options';
    if (type === 'sub_option') tableName = 'sub_option_choices';

    setItems(current => 
      current.map(item => (item.id === itemId && item.type === type) ? { ...item, is_available: newStatus } : item)
    );

    try {
      const { data, error } = await supabase
        .from(tableName).update({ is_available: newStatus }).eq('id', itemId).select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Action bloquée (RLS).");
      
      const typeLabel = type === 'product' ? 'Produit' : type === 'option' ? 'Option' : 'Sous-option';
      toast.success(newStatus ? `${typeLabel} disponible` : `${typeLabel} désactivé(e)`);
    } catch (e: any) {
      setItems(current => 
        current.map(item => (item.id === itemId && item.type === type) ? { ...item, is_available: currentStatus } : item)
      );
      toast.error(`Échec : ${e.message || "Impossible de mettre à jour le stock"}`);
    }
  };

  const productCategories = Array.from(new Set(items.filter(i => i.type === 'product').map(i => i.category).filter(Boolean))).sort();
  const optionCategories = Array.from(new Set(items.filter(i => i.type === 'option').map(i => i.category).filter(Boolean))).sort();
  const subOptionCategories = Array.from(new Set(items.filter(i => i.type === 'sub_option').map(i => i.category).filter(Boolean))).sort();

  const filteredItems = items.filter(item => {
    const matchType = selectedType === 'all' || item.type === selectedType;
    const matchCategory = selectedCategory === 'Tous' || item.category === selectedCategory;
    
    const query = searchQuery.toLowerCase().trim();
    const matchName = item.name.toLowerCase().includes(query);
    const matchDesc = item.description.toLowerCase().includes(query);
    
    return matchType && matchCategory && (matchName || matchDesc);
  });

  const outOfStockItems = filteredItems.filter(i => !i.is_available).sort((a, b) => a.name.localeCompare(b.name));
  const availableItems = filteredItems.filter(i => i.is_available);
  
  const groupedAvailable = availableItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, StockItem[]>);

  const handleSelectMenu = (type: 'product' | 'option' | 'sub_option' | 'all', category: string) => {
    setSelectedType(type);
    setSelectedCategory(category);
  };

  const renderItemCard = (item: StockItem) => {
    const isProduct = item.type === 'product';
    const isAvailable = item.is_available;

    let typeLabel = '';
    if (item.type === 'option') typeLabel = 'OPTION';
    if (item.type === 'sub_option') typeLabel = 'SOUS-OPTION';

    return (
      <button
        key={`${item.type}-${item.id}`}
        onClick={() => toggleStock(item.id, item.is_available, item.type)}
        className={`w-full rounded-2xl p-4 border-2 flex items-center justify-start gap-4 transition-all active:scale-95 shadow-sm text-left ${
          isAvailable 
            ? 'bg-[#04B855] border-[#04B855] text-white hover:bg-[#03a04a]' 
            : 'bg-red-500 border-red-500 text-white hover:bg-red-600'
        }`}
      >
        {isProduct && (
          <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
            {item.image ? (
              <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />
            ) : (
              <Package size={24} className={isAvailable ? 'text-[#04B855]' : 'text-red-500'} />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* ✅ FIX : Suppression de line-through pour garder le texte propre et lisible */}
          <h4 className="font-black text-base uppercase leading-tight">
            {item.name}
          </h4>
          <span className="text-[11px] mt-1 block font-bold uppercase tracking-widest text-white/80">
            {isProduct ? item.category : `${typeLabel} • ${item.category}`}
          </span>
        </div>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-[#F3F4F6] flex flex-col font-helvetica select-none">
      
      {/* EN-TÊTE */}
      <div className="bg-white h-[110px] border-b border-gray-200 flex items-center justify-between px-10 flex-shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-secondary text-white rounded-2xl flex items-center justify-center shadow-md">
            <Package size={36} />
          </div>
          <div>
            <h1 className="text-4xl font-black text-secondary uppercase tracking-tight leading-none">Gestion des Stocks</h1>
            <p className="text-base font-bold text-gray-400 uppercase tracking-widest mt-1">Produits et Options</p>
          </div>
        </div>
        
        <div className="flex-1 max-w-xl mx-8 relative">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
          <input 
            type="text" 
            placeholder="Rechercher par nom ou ingrédient..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl pl-16 pr-6 py-4 text-xl font-bold text-secondary focus:outline-none focus:border-primary focus:bg-white transition-colors"
          />
        </div>

        <button 
          onClick={onClose} 
          className="h-16 px-8 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center font-black text-xl hover:bg-red-100 active:scale-95 transition-all gap-3 border border-red-100"
        >
          <X size={28} /> FERMER
        </button>
      </div>

      {/* CORPS */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* SIDEBAR CATÉGORIES */}
        <div className="w-[420px] bg-white border-r border-gray-200 flex flex-col py-8 overflow-y-auto custom-scrollbar z-0">
          <div className="flex flex-col gap-5 px-6">
            
            <button
              onClick={() => {
                handleSelectMenu('all', 'Tous');
                setIsProductsOpen(false);
                setIsOptionsOpen(false);
                setIsSubOptionsOpen(false);
              }}
              className={`w-full flex items-center gap-4 p-5 rounded-2xl transition-all font-black text-xl uppercase tracking-wider text-left ${
                selectedType === 'all' && selectedCategory === 'Tous'
                  ? 'bg-secondary text-white shadow-lg shadow-secondary/20' 
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Layers size={26} />
              TOUT AFFICHER
            </button>

            <div className="my-2 border-b-2 border-gray-100"></div>

            {/* ACCORDÉON PRODUITS */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setIsProductsOpen(!isProductsOpen)}
                className={`w-full flex items-center justify-between p-5 transition-all font-black text-xl uppercase tracking-wider text-left hover:bg-gray-50 ${isProductsOpen ? 'bg-gray-50 text-primary' : 'text-secondary'}`}
              >
                <div className="flex items-center gap-4">
                  <Package size={26} className={isProductsOpen ? 'text-primary' : 'text-gray-400'} />
                  PRODUITS
                </div>
                {isProductsOpen ? <ChevronDown size={28} /> : <ChevronRight size={28} className="text-gray-400" />}
              </button>
              
              {isProductsOpen && (
                <div className="flex flex-col gap-1 p-3 bg-gray-50/50">
                  <button
                    onClick={() => handleSelectMenu('product', 'Tous')}
                    className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                      selectedType === 'product' && selectedCategory === 'Tous'
                        ? 'bg-primary/10 text-primary shadow-sm' 
                        : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                    }`}
                  >
                    Tous les produits
                  </button>
                  {productCategories.map((cat) => (
                    <button
                      key={`prod-${cat}`}
                      onClick={() => handleSelectMenu('product', cat)}
                      className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                        selectedType === 'product' && selectedCategory === cat 
                          ? 'bg-primary/10 text-primary shadow-sm' 
                          : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ACCORDÉON OPTIONS */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                className={`w-full flex items-center justify-between p-5 transition-all font-black text-xl uppercase tracking-wider text-left hover:bg-gray-50 ${isOptionsOpen ? 'bg-gray-50 text-blue-600' : 'text-secondary'}`}
              >
                <div className="flex items-center gap-4">
                  <Layers size={26} className={isOptionsOpen ? 'text-blue-500' : 'text-gray-400'} />
                  OPTIONS
                </div>
                {isOptionsOpen ? <ChevronDown size={28} /> : <ChevronRight size={28} className="text-gray-400" />}
              </button>
              
              {isOptionsOpen && (
                <div className="flex flex-col gap-1 p-3 bg-gray-50/50">
                  <button
                    onClick={() => handleSelectMenu('option', 'Tous')}
                    className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                      selectedType === 'option' && selectedCategory === 'Tous'
                        ? 'bg-blue-100 text-blue-700 shadow-sm' 
                        : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                    }`}
                  >
                    Toutes les options
                  </button>
                  {optionCategories.map((cat) => (
                    <button
                      key={`opt-${cat}`}
                      onClick={() => handleSelectMenu('option', cat)}
                      className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                        selectedType === 'option' && selectedCategory === cat 
                          ? 'bg-blue-100 text-blue-700 shadow-sm' 
                          : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ACCORDÉON SOUS-OPTIONS */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setIsSubOptionsOpen(!isSubOptionsOpen)}
                className={`w-full flex items-center justify-between p-5 transition-all font-black text-xl uppercase tracking-wider text-left hover:bg-gray-50 ${isSubOptionsOpen ? 'bg-gray-50 text-purple-600' : 'text-secondary'}`}
              >
                <div className="flex items-center gap-4">
                  <ListTree size={26} className={isSubOptionsOpen ? 'text-purple-500' : 'text-gray-400'} />
                  SOUS-OPTIONS
                </div>
                {isSubOptionsOpen ? <ChevronDown size={28} /> : <ChevronRight size={28} className="text-gray-400" />}
              </button>
              
              {isSubOptionsOpen && (
                <div className="flex flex-col gap-1 p-3 bg-gray-50/50">
                  <button
                    onClick={() => handleSelectMenu('sub_option', 'Tous')}
                    className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                      selectedType === 'sub_option' && selectedCategory === 'Tous'
                        ? 'bg-purple-100 text-purple-700 shadow-sm' 
                        : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                    }`}
                  >
                    Toutes les sous-options
                  </button>
                  {subOptionCategories.map((cat) => (
                    <button
                      key={`subopt-${cat}`}
                      onClick={() => handleSelectMenu('sub_option', cat)}
                      className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                        selectedType === 'sub_option' && selectedCategory === cat 
                          ? 'bg-purple-100 text-purple-700 shadow-sm' 
                          : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ZONE DE DROITE : LISTE DES ITEMS */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-[#F3F4F6]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-gray-400 font-bold text-xl uppercase tracking-widest animate-pulse">Chargement des stocks...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-gray-400 font-bold text-2xl uppercase tracking-widest">Aucun élément trouvé</p>
            </div>
          ) : (
            <div className="space-y-10 pb-16">
              
              {searchQuery.trim().length > 0 && filteredItems.some(i => i.is_available) && (
                <button 
                  onClick={() => handleDeactivateAll(filteredItems)}
                  className="w-full bg-red-600 hover:bg-red-700 text-white active:scale-[0.99] py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-md text-center"
                >
                  Désactiver tout ce qui contient "{searchQuery}"
                </button>
              )}
              
              {/* BLOC 1 : RUPTURES DE STOCK */}
              {outOfStockItems.length > 0 && (
                <div className="bg-white p-8 rounded-[2rem] shadow-sm border-2 border-red-200">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                      <AlertOctagon size={28} />
                    </div>
                    <h2 className="text-2xl font-black text-red-600 uppercase tracking-wide">Actuellement en rupture</h2>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {outOfStockItems.map(renderItemCard)}
                  </div>
                </div>
              )}

              {/* BLOC 2 : ÉLÉMENTS DISPONIBLES */}
              {Object.keys(groupedAvailable).sort().map(category => (
                <div key={category} className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                  <h2 className="text-2xl font-black text-secondary uppercase tracking-widest mb-8 border-b-2 border-gray-100 pb-4">
                    {category}
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {groupedAvailable[category].sort((a, b) => a.name.localeCompare(b.name)).map(renderItemCard)}
                  </div>
                </div>
              ))}

            </div>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
};

export default StockModal;