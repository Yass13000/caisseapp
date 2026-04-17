import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Package, Search, ChevronDown, ChevronRight, Layers, AlertOctagon } from 'lucide-react';
// Note: RESTAURANT_ID est gardé juste en dernier recours, mais on priorise le localStorage
import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface StockItem {
  id: number | string;
  name: string;
  category: string;
  is_available: boolean;
  image: string;
  type: 'product' | 'option';
}

interface StockModalProps {
  onClose: () => void;
}

const StockModal = ({ onClose }: StockModalProps) => {
  const [items, setItems] = useState<StockItem[]>([]);
  
  const [selectedType, setSelectedType] = useState<'product' | 'option' | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  
  const [isProductsOpen, setIsProductsOpen] = useState(true);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    setIsLoading(true);
    try {
      // CORRECTION ICI : On utilise en priorité l'ID de la caisse (pos_restaurant_id)
      const activeRestoId = localStorage.getItem('pos_restaurant_id') || localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;
      
      if (!activeRestoId) {
        toast.error("Veuillez configurer la caisse (ID restaurant manquant)");
        setIsLoading(false);
        return;
      }

      const { data: productsData, error: productsError } = await supabase
        .from('product')
        .select('id, name, category, is_available, image')
        .eq('restaurant_id', activeRestoId);

      if (productsError) throw productsError;

      const { data: optionsData, error: optionsError } = await supabase
        .from('options')
        .select('id, name, is_available, image_url')
        .eq('restaurant_id', activeRestoId);

      if (optionsError) throw optionsError;

      const { data: groupsData } = await supabase
        .from('option_groups')
        .select(`name, option_group_links (option_id)`)
        .eq('restaurant_id', activeRestoId);

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

      const formattedProducts: StockItem[] = (productsData || []).map(p => ({
        ...p,
        type: 'product'
      }));

      const formattedOptions: StockItem[] = (optionsData || []).map((o: any) => ({
        id: o.id,
        name: o.name,
        category: optionCategoryMap[o.id] || 'Autres', 
        is_available: o.is_available,
        image: o.image_url || '',
        type: 'option'
      }));

      setItems([...formattedProducts, ...formattedOptions]);
    } catch (e) {
      toast.error("Erreur lors du chargement des stocks");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStock = async (itemId: number | string, currentStatus: boolean, type: 'product' | 'option') => {
    const newStatus = !currentStatus;
    const tableName = type === 'product' ? 'product' : 'options';

    setItems(current => 
      current.map(item => (item.id === itemId && item.type === type) ? { ...item, is_available: newStatus } : item)
    );

    try {
      const { data, error } = await supabase
        .from(tableName)
        .update({ is_available: newStatus })
        .eq('id', itemId)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Action bloquée par la sécurité Supabase (RLS).");
      
      const typeLabel = type === 'product' ? 'Produit' : 'Option';
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

  const filteredItems = items.filter(item => {
    const matchType = selectedType === 'all' || item.type === selectedType;
    const matchCategory = selectedCategory === 'Tous' || item.category === selectedCategory;
    const matchSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchCategory && matchSearch;
  });

  const outOfStockItems = filteredItems.filter(i => !i.is_available).sort((a, b) => a.name.localeCompare(b.name));
  const availableItems = filteredItems.filter(i => i.is_available);
  const groupedAvailable = availableItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, StockItem[]>);

  const handleSelectMenu = (type: 'product' | 'option' | 'all', category: string) => {
    setSelectedType(type);
    setSelectedCategory(category);
  };

  const renderItemCard = (item: StockItem) => {
    const isProduct = item.type === 'product';
    const isAvailable = item.is_available;

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
          <h4 className={`font-black text-base uppercase leading-tight ${!isAvailable && 'line-through opacity-80'}`}>
            {item.name}
          </h4>
          <span className="text-[11px] mt-1 block font-bold uppercase tracking-widest text-white/80">
            {isProduct ? item.category : `OPTION • ${item.category}`}
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
            placeholder="Rechercher..." 
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
        <div className="w-[400px] bg-white border-r border-gray-200 flex flex-col py-8 overflow-y-auto custom-scrollbar z-0">
          <div className="flex flex-col gap-4 px-6">
            
            <button
              onClick={() => handleSelectMenu('all', 'Tous')}
              className={`w-full flex items-center gap-4 p-5 rounded-2xl transition-all font-black text-xl uppercase tracking-wider text-left ${
                selectedType === 'all' && selectedCategory === 'Tous'
                  ? 'bg-secondary text-white shadow-lg' 
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Layers size={26} />
              TOUT AFFICHER
            </button>

            <div className="my-4 border-b-2 border-gray-100"></div>

            {/* ACCORDÉON PRODUITS */}
            <div>
              <button
                onClick={() => setIsProductsOpen(!isProductsOpen)}
                className="w-full flex items-center justify-between p-4 rounded-xl transition-all font-black text-xl uppercase tracking-wider text-left text-secondary hover:bg-gray-50"
              >
                <div className="flex items-center gap-4">
                  <Package size={26} className="text-primary" />
                  PRODUITS
                </div>
                {isProductsOpen ? <ChevronDown size={28} /> : <ChevronRight size={28} />}
              </button>
              
              {isProductsOpen && (
                <div className="flex flex-col gap-2 mt-3 pl-6 border-l-4 border-gray-100 ml-4">
                  <button
                    onClick={() => handleSelectMenu('product', 'Tous')}
                    className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                      selectedType === 'product' && selectedCategory === 'Tous'
                        ? 'bg-primary/10 text-primary' 
                        : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-gray-50'
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
                          ? 'bg-primary/10 text-primary' 
                          : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-gray-50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="my-4 border-b-2 border-gray-100"></div>

            {/* ACCORDÉON OPTIONS */}
            <div>
              <button
                onClick={() => setIsOptionsOpen(!isOptionsOpen)}
                className="w-full flex items-center justify-between p-4 rounded-xl transition-all font-black text-xl uppercase tracking-wider text-left text-secondary hover:bg-gray-50"
              >
                <div className="flex items-center gap-4">
                  <Layers size={26} className="text-blue-500" />
                  OPTIONS
                </div>
                {isOptionsOpen ? <ChevronDown size={28} /> : <ChevronRight size={28} />}
              </button>
              
              {isOptionsOpen && (
                <div className="flex flex-col gap-2 mt-3 pl-6 border-l-4 border-gray-100 ml-4">
                  <button
                    onClick={() => handleSelectMenu('option', 'Tous')}
                    className={`w-full flex items-center p-4 rounded-xl transition-all font-bold text-lg uppercase tracking-wider text-left ${
                      selectedType === 'option' && selectedCategory === 'Tous'
                        ? 'bg-blue-50 text-blue-600' 
                        : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-gray-50'
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
                          ? 'bg-blue-50 text-blue-600' 
                          : 'bg-transparent text-gray-500 hover:text-secondary hover:bg-gray-50'
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