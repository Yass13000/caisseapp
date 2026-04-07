import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Trash2, Edit, Plus, Link } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Checkbox } from './ui/checkbox';
import { toast } from 'sonner';

interface SubOption {
  id: number;
  name: string;
  price: number;
  image?: string;
  is_default: boolean;
  parent_option_id: number;
  created_at: string;
  updated_at: string;
}

interface CustomizationOption {
  id: number;
  name: string;
  type: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export default function SubOptionsManager() {
  const [subOptions, setSubOptions] = useState<SubOption[]>([]);
  const [customizationOptions, setCustomizationOptions] = useState<CustomizationOption[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productLinks, setProductLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOptionFilter, setSelectedOptionFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [editingSubOption, setEditingSubOption] = useState<SubOption | null>(null);
  const [selectedSubOption, setSelectedSubOption] = useState<SubOption | null>(null);
  const [editingLinkedProducts, setEditingLinkedProducts] = useState<string[]>([]);
  const [editingLinkedOptions, setEditingLinkedOptions] = useState<number[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    price: 0,
    image: '',
    is_default: false,
    parent_option_id: 0
  });

  // Charger les données
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Charger les sous-options
      const { data: subOptionsData, error: subOptionsError } = await supabase
        .from('option_sub_choices')
        .select('*')
        .order('created_at', { ascending: false });

      if (subOptionsError) {
        return;
      }

      // Charger les options de personnalisation
      const { data: optionsData, error: optionsError } = await supabase
        .from('customization_options')
        .select('id, name, type')
        .order('name');

      if (optionsError) {
        return;
      }

      // Charger les produits
      const { data: productsData, error: productsError } = await supabase
        .from('product')
        .select('id, name, category, price')
        .order('name');

      if (productsError) {
        return;
      }

      setSubOptions(subOptionsData || []);
      setCustomizationOptions(optionsData || []);
      setProducts(productsData || []);

      // Charger les liaisons existantes
      await loadProductLinks();
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  // Charger les liaisons produit-sous-options
  const loadProductLinks = async () => {
    try {
            const allLinks: any[] = [];

      // Charger les liaisons produit-sous-options (sans jointure pour éviter l'erreur)
      const { data: productLinks, error: productError } = await supabase
        .from('product_sub_options')
        .select('*');

      if (!productError && productLinks) {
                
        // Charger les noms des produits séparément
        const productIds = [...new Set(productLinks.map(link => link.product_id))];
        const { data: products } = await supabase
          .from('product')
          .select('id, name')
          .in('id', productIds);

        const productsMap = products?.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}) || {};

        allLinks.push(...productLinks.map(link => ({
          ...link,
          type: 'product',
          target_name: productsMap[link.product_id]?.name || 'Produit inconnu'
        })));
      } else if (productError) {
              }

      // Charger les liaisons option-sous-options (sans jointure)
      const { data: optionLinks, error: optionError } = await supabase
        .from('option_sub_option_links')
        .select('*');

      if (!optionError && optionLinks) {
                
        // Charger les noms des options séparément
        const optionIds = [...new Set(optionLinks.map(link => link.option_id))];
        const { data: options } = await supabase
          .from('customization_options')
          .select('id, name')
          .in('id', optionIds);

        const optionsMap = options?.reduce((acc, o) => ({ ...acc, [o.id]: o }), {}) || {};

        allLinks.push(...optionLinks.map(link => ({
          ...link,
          type: 'option',
          target_name: optionsMap[link.option_id]?.name || 'Option inconnue'
        })));
      } else if (optionError) {
              }

      // Si pas de données dans les tables, fallback vers JSONB
      if (allLinks.length === 0) {
        // Charger depuis les métadonnées des produits
        const { data: productsWithLinks, error: productMetaError } = await supabase
          .from('product')
          .select('id, name, linked_sub_options')
          .not('linked_sub_options', 'is', null);

        if (!productMetaError && productsWithLinks) {
          const flatProductLinks = productsWithLinks.flatMap(product => 
            (product.linked_sub_options || []).map((subOption: any) => ({
              product_id: product.id,
              sub_option_id: subOption.id,
              type: 'product',
              target_name: product.name,
              sub_option: { name: subOption.name }
            }))
          );
          allLinks.push(...flatProductLinks);
        }

        // Charger depuis les métadonnées des options
        const { data: optionsWithLinks, error: optionMetaError } = await supabase
          .from('customization_options')
          .select('id, name, linked_sub_options')
          .not('linked_sub_options', 'is', null);

        if (!optionMetaError && optionsWithLinks) {
          const flatOptionLinks = optionsWithLinks.flatMap(option => 
            (option.linked_sub_options || []).map((subOption: any) => ({
              option_id: option.id,
              sub_option_id: subOption.id,
              type: 'option',
              target_name: option.name,
              sub_option: { name: subOption.name }
            }))
          );
          allLinks.push(...flatOptionLinks);
        }
      }

      setProductLinks(allLinks);
    } catch (error) {
    }
  };

  // Filtrer les sous-options
  const filteredSubOptions = selectedOptionFilter === 'all' 
    ? subOptions 
    : subOptions.filter(sub => sub.parent_option_id === parseInt(selectedOptionFilter));

  // Ouvrir le modal pour créer/éditer
  const openModal = async (subOption?: SubOption) => {
    if (subOption) {
      setEditingSubOption(subOption);
      setFormData({
        name: subOption.name,
        price: subOption.price,
        image: subOption.image || '',
        is_default: subOption.is_default,
        parent_option_id: subOption.parent_option_id
      });

      // Charger les produits liés à cette sous-option
      await loadLinkedProductsForSubOption(subOption.id);
      await loadLinkedOptionsForSubOption(subOption.id);
    } else {
      setEditingSubOption(null);
      setEditingLinkedProducts([]);
      setEditingLinkedOptions([]);
      setFormData({
        name: '',
        price: 0,
        image: '',
        is_default: false,
        parent_option_id: 0
      });
    }
    setIsModalOpen(true);
  };

  // Charger les produits liés à une sous-option
  const loadLinkedProductsForSubOption = async (subOptionId: number) => {
    try {
      const linkedProductIds: string[] = [];

      // Charger depuis la table product_sub_options
      const { data: links, error } = await supabase
        .from('product_sub_options')
        .select('product_id')
        .eq('sub_option_id', subOptionId);

      if (!error && links) {
        linkedProductIds.push(...links.map(link => link.product_id));
      } else {
        // Fallback: charger depuis les métadonnées JSONB
        const { data: productsWithLinks, error: productError } = await supabase
          .from('product')
          .select('id, linked_sub_options')
          .not('linked_sub_options', 'is', null);

        if (!productError && productsWithLinks) {
          for (const product of productsWithLinks) {
            const linkedSubs = product.linked_sub_options || [];
            if (linkedSubs.some((sub: any) => sub.id === subOptionId)) {
              linkedProductIds.push(product.id);
            }
          }
        }
      }

      setEditingLinkedProducts(linkedProductIds);
    } catch (error) {
      setEditingLinkedProducts([]);
    }
  };

  // Charger les options liées à une sous-option
  const loadLinkedOptionsForSubOption = async (subOptionId: number) => {
    try {
      const linkedOptionIds: number[] = [];

      // Charger depuis la table option_sub_option_links
      const { data: links, error } = await supabase
        .from('option_sub_option_links')
        .select('option_id')
        .eq('sub_option_id', subOptionId);

      if (!error && links) {
        linkedOptionIds.push(...links.map(link => link.option_id));
      } else {
        // Fallback: charger depuis les métadonnées JSONB
        const { data: optionsWithLinks, error: optionError } = await supabase
          .from('customization_options')
          .select('id, linked_sub_options')
          .not('linked_sub_options', 'is', null);

        if (!optionError && optionsWithLinks) {
          for (const option of optionsWithLinks) {
            const linkedSubs = option.linked_sub_options || [];
            if (linkedSubs.some((sub: any) => sub.id === subOptionId)) {
              linkedOptionIds.push(option.id);
            }
          }
        }
      }

      setEditingLinkedOptions(linkedOptionIds);
    } catch (error) {
      setEditingLinkedOptions([]);
    }
  };

  // Fermer le modal
  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSubOption(null);
    setEditingLinkedProducts([]);
    setEditingLinkedOptions([]);
    setFormData({
      name: '',
      price: 0,
      image: '',
      is_default: false,
      parent_option_id: 0
    });
  };

  // Sauvegarder (créer ou modifier)
  const handleSave = async () => {
    try {

      if (!formData.name.trim() || formData.parent_option_id === 0) {
        toast.error('Champs obligatoires', {
          description: 'Veuillez remplir tous les champs obligatoires',
          duration: 3000,
        });
        return;
      }

      const dataToSave = {
        name: formData.name.trim(),
        price: formData.price,
        image: formData.image.trim() || null,
        is_default: formData.is_default,
        parent_option_id: formData.parent_option_id,
        updated_at: new Date().toISOString()
      };

      let subOptionId: number;

      if (editingSubOption) {
                
        // Modification
        const { error } = await supabase
          .from('option_sub_choices')
          .update(dataToSave)
          .eq('id', editingSubOption.id);

        if (error) {
          toast.error('Erreur de modification', {
            description: error.message,
            duration: 3000,
          });
          return;
        }

        subOptionId = editingSubOption.id;
      } else {

        // Création
        const { data: newSubOption, error } = await supabase
          .from('option_sub_choices')
          .insert([{
            ...dataToSave,
            created_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (error) {
          toast.error('Erreur de création', {
            description: error.message,
            duration: 3000,
          });
          return;
        }

        subOptionId = newSubOption.id;
      }

      // Sauvegarder les liaisons produits (même si vide pour nettoyer)
      const linksSaved = await saveProductLinks(subOptionId);
      if (!linksSaved) {
        toast.warning('Avertissement', {
          description: 'Sous-option sauvegardée mais erreur avec les liaisons produits',
          duration: 3000,
        });
      }

      // Sauvegarder les liaisons options (même si vide pour nettoyer)
      const optionLinksSaved = await saveOptionLinks(subOptionId);
      if (!optionLinksSaved) {
        toast.warning('Avertissement', {
          description: 'Sous-option sauvegardée mais erreur avec les liaisons options',
          duration: 3000,
        });
      }

      toast.success('Succès', {
        description: editingSubOption ? 'Sous-option modifiée' : 'Sous-option créée',
        duration: 2000,
      });
      closeModal();
      loadData();
      loadProductLinks();
    } catch (error: any) {
      toast.error('Erreur de sauvegarde', {
        description: error.message || 'Erreur inconnue',
        duration: 3000,
      });
    }
  };

  // Supprimer une sous-option
  const handleDelete = async (id: number) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette sous-option ?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('option_sub_choices')
        .delete()
        .eq('id', id);

      if (error) {
        toast.error('Erreur de suppression', {
          description: 'Impossible de supprimer cette sous-option',
          duration: 3000,
        });
        return;
      }

      toast.success('Sous-option supprimée', {
        duration: 2000,
      });
      loadData();
    } catch (error) {
      toast.error('Erreur de suppression', {
        description: 'Une erreur est survenue',
        duration: 3000,
      });
    }
  };

  // Obtenir le nom de l'option parent
  const getParentOptionName = (parentId: number) => {
    const option = customizationOptions.find(opt => opt.id === parentId);
    return option ? option.name : `Option ${parentId}`;
  };

  // Ouvrir le modal de liaison
  const openLinkModal = (subOption: SubOption) => {
    setSelectedSubOption(subOption);
    setIsLinkModalOpen(true);
  };

  // Fermer le modal de liaison
  const closeLinkModal = () => {
    setIsLinkModalOpen(false);
    setSelectedSubOption(null);
  };

  // Lier une sous-option à un produit
  const linkToProduct = async (productId: string) => {
    if (!selectedSubOption) return;
    
    try {
      // Créer une entrée dans la table product_sub_options (ou similaire)
      // D'abord, vérifier si la liaison existe déjà
      const { data: existing, error: checkError } = await supabase
        .from('product_sub_options')
        .select('*')
        .eq('product_id', productId)
        .eq('sub_option_id', selectedSubOption.id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        // Si la table n'existe pas, on va la créer via une requête SQL
        if (checkError.message.includes('relation "product_sub_options" does not exist')) {
          // Créer la table de liaison
          const { error: createTableError } = await supabase.rpc('exec_sql', {
            sql: `
              CREATE TABLE IF NOT EXISTS product_sub_options (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                product_id UUID NOT NULL,
                sub_option_id INTEGER NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(product_id, sub_option_id)
              );
              
              -- Activer RLS
              ALTER TABLE product_sub_options ENABLE ROW LEVEL SECURITY;
              
              -- Policy pour permettre toutes les opérations (ajuste selon tes besoins)
              CREATE POLICY "Allow all operations on product_sub_options" ON product_sub_options
              FOR ALL USING (true) WITH CHECK (true);
            `
          });

          if (createTableError) {
            // Fallback: utiliser une approche différente
            await createLinkWithoutTable(productId);
            return;
          }
        } else {
          throw checkError;
        }
      }

      if (existing) {
        toast.warning('Liaison existante', {
          description: 'Cette liaison existe déjà !',
          duration: 2000,
        });
        closeLinkModal();
        return;
      }

      // Créer la nouvelle liaison
      const { error: insertError } = await supabase
        .from('product_sub_options')
        .insert([{
          product_id: productId,
          sub_option_id: selectedSubOption.id
        }]);

      if (insertError) {
        // Fallback
        await createLinkWithoutTable(productId);
        return;
      }

      const product = products.find(p => p.id === productId);
      toast.success('Liaison créée', {
        description: `Sous-option "${selectedSubOption.name}" liée au produit "${product?.name}"`,
        duration: 2000,
      });

      closeLinkModal();
      loadProductLinks(); // Recharger les liaisons
    } catch (error) {
      await createLinkWithoutTable(productId);
    }
  };

  // Fallback: créer une liaison via les métadonnées du produit
  const createLinkWithoutTable = async (productId: string) => {
    try {
      if (!selectedSubOption) return;

      // Récupérer le produit actuel
      const { data: product, error: getError } = await supabase
        .from('product')
        .select('*')
        .eq('id', productId)
        .single();

      if (getError) {
        toast.error('Erreur', {
          description: 'Erreur lors de la récupération du produit',
          duration: 3000,
        });
        return;
      }

      // Ajouter la sous-option aux métadonnées du produit
      const linkedSubOptions = product.linked_sub_options || [];

      // Vérifier si déjà lié
      if (linkedSubOptions.some((sub: any) => sub.id === selectedSubOption.id)) {
        toast.warning('Liaison existante', {
          description: 'Cette liaison existe déjà !',
          duration: 2000,
        });
        closeLinkModal();
        return;
      }

      linkedSubOptions.push({
        id: selectedSubOption.id,
        name: selectedSubOption.name,
        price: selectedSubOption.price,
        parent_option_id: selectedSubOption.parent_option_id
      });

      // Mettre à jour le produit
      const { error: updateError } = await supabase
        .from('product')
        .update({ 
          linked_sub_options: linkedSubOptions,
          updated_at: new Date().toISOString()
        })
        .eq('id', productId);

      if (updateError) {
        toast.error('Erreur de liaison', {
          description: 'Impossible de créer la liaison',
          duration: 3000,
        });
        return;
      }

      const productName = products.find(p => p.id === productId)?.name;
      toast.success('Liaison créée', {
        description: `Sous-option "${selectedSubOption.name}" liée au produit "${productName}"`,
        duration: 2000,
      });

      closeLinkModal();
      loadProductLinks(); // Recharger les liaisons
    } catch (error) {
      toast.error('Erreur de liaison', {
        description: 'Une erreur est survenue',
        duration: 3000,
      });
      closeLinkModal();
    }
  };

  // Supprimer une liaison
  const removeLinkage = async (link: any) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette liaison ?')) {
      return;
    }

    try {
      if (link.type === 'product') {
        // Supprimer liaison produit
        const { error } = await supabase
          .from('product_sub_options')
          .delete()
          .eq('product_id', link.product_id)
          .eq('sub_option_id', link.sub_option_id);

        if (error && error.message.includes('relation "product_sub_options" does not exist')) {
          // Fallback: supprimer depuis les métadonnées du produit
          const { data: product, error: getError } = await supabase
            .from('product')
            .select('linked_sub_options')
            .eq('id', link.product_id)
            .single();

          if (!getError && product) {
            const updatedLinks = (product.linked_sub_options || []).filter(
              (sub: any) => sub.id !== link.sub_option_id
            );

            await supabase
              .from('product')
              .update({ 
                linked_sub_options: updatedLinks.length > 0 ? updatedLinks : null,
                updated_at: new Date().toISOString()
              })
              .eq('id', link.product_id);
          }
        } else if (error) {
          throw error;
        }
      } else if (link.type === 'option') {
        // Supprimer liaison option
        const { error } = await supabase
          .from('option_sub_option_links')
          .delete()
          .eq('option_id', link.option_id)
          .eq('sub_option_id', link.sub_option_id);

        if (error && error.message.includes('relation "option_sub_option_links" does not exist')) {
          // Fallback: supprimer depuis les métadonnées de l'option
          const { data: option, error: getError } = await supabase
            .from('customization_options')
            .select('linked_sub_options')
            .eq('id', link.option_id)
            .single();

          if (!getError && option) {
            const updatedLinks = (option.linked_sub_options || []).filter(
              (sub: any) => sub.id !== link.sub_option_id
            );

            await supabase
              .from('customization_options')
              .update({ 
                linked_sub_options: updatedLinks.length > 0 ? updatedLinks : null,
                updated_at: new Date().toISOString()
              })
              .eq('id', link.option_id);
          }
        } else if (error) {
          throw error;
        }
      }

      toast.success('Liaison supprimée', {
        description: 'La liaison a été supprimée avec succès',
        duration: 2000,
      });
      loadProductLinks(); // Recharger les liaisons
    } catch (error) {
      toast.error('Erreur de suppression', {
        description: 'Impossible de supprimer la liaison',
        duration: 3000,
      });
    }
  };

  // Mass linking removed

  // Toggle produit dans le modal d'édition
  const toggleEditingProduct = (productId: string) => {
    setEditingLinkedProducts(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  };

  // Toggle option dans le modal d'édition
  const toggleEditingOption = (optionId: number) => {
    setEditingLinkedOptions(prev => 
      prev.includes(optionId) 
        ? prev.filter(id => id !== optionId)
        : [...prev, optionId]
    );
  };

  // Sauvegarder les liaisons produits dans le modal d'édition
  const saveProductLinks = async (subOptionId: number) => {
    try {
            
      // Récupérer les liaisons actuelles
      const { data: currentLinks, error: fetchError } = await supabase
        .from('product_sub_options')
        .select('product_id')
        .eq('sub_option_id', subOptionId);

      if (fetchError) {
        // Fallback: créer directement les liaisons
        for (const productId of editingLinkedProducts) {
          const { error: insertError } = await supabase
            .from('product_sub_options')
            .upsert([{
              product_id: productId,
              sub_option_id: subOptionId
            }], {
              onConflict: 'product_id,sub_option_id'
            });

          if (insertError) {
          } else {
                      }
        }
        return true;
      }

      const currentProductIds = currentLinks?.map(link => link.product_id) || [];
      
      // Supprimer les liaisons qui ne sont plus sélectionnées
      const toRemove = currentProductIds.filter(id => !editingLinkedProducts.includes(id));
            
      for (const productId of toRemove) {
        const { error: deleteError } = await supabase
          .from('product_sub_options')
          .delete()
          .eq('product_id', productId)
          .eq('sub_option_id', subOptionId);

        if (deleteError) {
        } else {
                  }
      }

      // Ajouter les nouvelles liaisons
      const toAdd = editingLinkedProducts.filter(id => !currentProductIds.includes(id));
            
      for (const productId of toAdd) {
        const { error: insertError } = await supabase
          .from('product_sub_options')
          .insert([{
            product_id: parseInt(productId.toString()), // S'assurer que c'est un entier
            sub_option_id: subOptionId
          }]);

        if (insertError) {
          
          // Si erreur de type UUID, essayer le fallback JSONB
          if (insertError.message.includes('uuid') || insertError.message.includes('invalid input syntax')) {
                        try {
              // Récupérer la sous-option actuelle
              const { data: currentSubOption } = await supabase
                .from('option_sub_choices')
                .select('linked_products')
                .eq('id', subOptionId)
                .single();

              const currentLinked = currentSubOption?.linked_products || [];
              const newLinked = [...currentLinked, productId];

              // Mettre à jour la colonne JSONB
              await supabase
                .from('option_sub_choices')
                .update({ linked_products: newLinked })
                .eq('id', subOptionId);

                          } catch (fallbackError) {
            }
          }
        } else {
                  }
      }

            return true;
    } catch (error) {
      return false;
    }
  };

  // Sauvegarder les liaisons options dans le modal d'édition
  const saveOptionLinks = async (subOptionId: number) => {
    try {
            
      // Récupérer les liaisons actuelles
      const { data: currentLinks, error: fetchError } = await supabase
        .from('option_sub_option_links')
        .select('option_id')
        .eq('sub_option_id', subOptionId);

      if (fetchError) {
        // Fallback: créer directement les liaisons
        for (const optionId of editingLinkedOptions) {
          const { error: insertError } = await supabase
            .from('option_sub_option_links')
            .upsert([{
              option_id: optionId,
              sub_option_id: subOptionId
            }], {
              onConflict: 'option_id,sub_option_id'
            });

          if (insertError) {
          } else {
                      }
        }
        return true;
      }

      const currentOptionIds = currentLinks?.map(link => link.option_id) || [];
      
      // Supprimer les liaisons qui ne sont plus sélectionnées
      const toRemove = currentOptionIds.filter(id => !editingLinkedOptions.includes(id));
            
      for (const optionId of toRemove) {
        const { error: deleteError } = await supabase
          .from('option_sub_option_links')
          .delete()
          .eq('option_id', optionId)
          .eq('sub_option_id', subOptionId);

        if (deleteError) {
        } else {
                  }
      }

      // Ajouter les nouvelles liaisons
      const toAdd = editingLinkedOptions.filter(id => !currentOptionIds.includes(id));
            
      for (const optionId of toAdd) {
        const { error: insertError } = await supabase
          .from('option_sub_option_links')
          .insert([{
            option_id: optionId,
            sub_option_id: subOptionId
          }]);

        if (insertError) {
        } else {
                  }
      }

            return true;
    } catch (error) {
      return false;
    }
  };

  // Lier une sous-option à une option
  const linkToOption = async (optionId: number) => {
    if (!selectedSubOption) return;
    
    try {
      // Au lieu de modifier parent_option_id, créer une liaison dans une table séparée
      // D'abord vérifier si la liaison existe déjà
      const { data: existing, error: checkError } = await supabase
        .from('option_sub_option_links')
        .select('*')
        .eq('option_id', optionId)
        .eq('sub_option_id', selectedSubOption.id)
        .maybeSingle();

      if (checkError && checkError.message.includes('relation "option_sub_option_links" does not exist')) {
        // Créer la table de liaison option-sous-option si elle n'existe pas
        const { error: createTableError } = await supabase.rpc('exec_sql', {
          sql: `
            CREATE TABLE IF NOT EXISTS option_sub_option_links (
              id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              option_id INTEGER NOT NULL,
              sub_option_id INTEGER NOT NULL,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(option_id, sub_option_id)
            );
            
            -- Activer RLS
            ALTER TABLE option_sub_option_links ENABLE ROW LEVEL SECURITY;
            
            -- Policy pour permettre toutes les opérations
            CREATE POLICY "Allow all operations on option_sub_option_links" ON option_sub_option_links
            FOR ALL USING (true) WITH CHECK (true);
          `
        });

        if (createTableError) {
          // Fallback: utiliser une approche avec métadonnées
          await createOptionLinkWithoutTable(optionId);
          return;
        }
      } else if (existing) {
        toast.warning('Liaison existante', {
          description: 'Cette liaison existe déjà !',
          duration: 2000,
        });
        closeLinkModal();
        return;
      }

      // Créer la nouvelle liaison
      const { error: insertError } = await supabase
        .from('option_sub_option_links')
        .insert([{
          option_id: optionId,
          sub_option_id: selectedSubOption.id
        }]);

      if (insertError) {
        await createOptionLinkWithoutTable(optionId);
        return;
      }

      const option = customizationOptions.find(o => o.id === optionId);
      toast.success('Liaison créée', {
        description: `Sous-option "${selectedSubOption.name}" liée à l'option "${option?.name}"`,
        duration: 2000,
      });

      closeLinkModal();
      loadData(); // Recharger les données
    } catch (error) {
      await createOptionLinkWithoutTable(optionId);
    }
  };

  // Fallback pour liaison option sans table
  const createOptionLinkWithoutTable = async (optionId: number) => {
    try {
      if (!selectedSubOption) return;

      // Récupérer l'option actuelle
      const { data: option, error: getError } = await supabase
        .from('customization_options')
        .select('*')
        .eq('id', optionId)
        .single();

      if (getError) {
        toast.error('Erreur', {
          description: 'Erreur lors de la récupération de l\'option',
          duration: 3000,
        });
        return;
      }

      // Ajouter la sous-option aux métadonnées de l'option
      const linkedSubOptions = option.linked_sub_options || [];

      // Vérifier si déjà lié
      if (linkedSubOptions.some((sub: any) => sub.id === selectedSubOption.id)) {
        toast.warning('Liaison existante', {
          description: 'Cette liaison existe déjà !',
          duration: 2000,
        });
        closeLinkModal();
        return;
      }

      linkedSubOptions.push({
        id: selectedSubOption.id,
        name: selectedSubOption.name,
        price: selectedSubOption.price,
        image: selectedSubOption.image
      });

      // Mettre à jour l'option
      const { error: updateError } = await supabase
        .from('customization_options')
        .update({ 
          linked_sub_options: linkedSubOptions,
          updated_at: new Date().toISOString()
        })
        .eq('id', optionId);

      if (updateError) {
        toast.error('Erreur de liaison', {
          description: 'Impossible de créer la liaison',
          duration: 3000,
        });
        return;
      }

      const optionName = customizationOptions.find(o => o.id === optionId)?.name;
      toast.success('Liaison créée', {
        description: `Sous-option "${selectedSubOption.name}" liée à l'option "${optionName}"`,
        duration: 2000,
      });

      closeLinkModal();
      loadData();
    } catch (error) {
      toast.error('Erreur de liaison', {
        description: 'Une erreur est survenue',
        duration: 3000,
      });
      closeLinkModal();
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Chargement des sous-options...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Gestion des Sous-Options
          <div className="flex gap-2">
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => openModal()} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Nouvelle Sous-Option
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingSubOption ? 'Modifier la Sous-Option' : 'Nouvelle Sous-Option'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Informations de base */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">Nom *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Nom de la sous-option"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="price">Prix (€)</Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="parent_option">Option Parent *</Label>
                  <Select
                    value={formData.parent_option_id.toString()}
                    onValueChange={(value) => setFormData({ ...formData, parent_option_id: parseInt(value) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une option parent" />
                    </SelectTrigger>
                    <SelectContent>
                      {customizationOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id.toString()}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="image">URL de l'image</Label>
                  <Input
                    id="image"
                    value={formData.image}
                    onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                    placeholder="https://example.com/image.jpg"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="is_default"
                    checked={formData.is_default}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_default: !!checked })}
                  />
                  <Label htmlFor="is_default">Option par défaut</Label>
                </div>

                {/* Section produits liés */}
                <div className="border-t pt-4">
                  <Label className="text-lg font-semibold">Produits Liés</Label>
                  <p className="text-sm text-gray-600 mb-3">
                    Sélectionnez les produits auxquels cette sous-option sera disponible
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border rounded">
                    {products.map((product) => (
                      <div key={product.id} className="flex items-center space-x-2 p-2 border rounded hover:bg-gray-50">
                        <Checkbox
                          checked={editingLinkedProducts.includes(product.id)}
                          onCheckedChange={() => toggleEditingProduct(product.id)}
                        />
                        <div className="flex-1">
                          <Label className="text-sm font-medium cursor-pointer" onClick={() => toggleEditingProduct(product.id)}>
                            {product.name}
                          </Label>
                          <div className="text-xs text-gray-500">{product.category} - {product.price.toFixed(2)}€</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="text-sm text-gray-500 mt-2">
                    {editingLinkedProducts.length} produit(s) sélectionné(s)
                  </div>

                  {/* Boutons de sélection rapide */}
                  <div className="flex gap-2 mt-2">
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        const burgerIds = products
                          .filter(p => p.category.toLowerCase().includes('burger'))
                          .map(p => p.id);
                        setEditingLinkedProducts(prev => [...new Set([...prev, ...burgerIds])]);
                      }}
                    >
                      + Tous les Burgers
                    </Button>
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        const wrapIds = products
                          .filter(p => p.category.toLowerCase().includes('wrap'))
                          .map(p => p.id);
                        setEditingLinkedProducts(prev => [...new Set([...prev, ...wrapIds])]);
                      }}
                    >
                      + Tous les Wraps
                    </Button>
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => setEditingLinkedProducts([])}
                    >
                      Tout désélectionner
                    </Button>
                  </div>
                </div>

                {/* Section options liées */}
                <div className="border-t pt-4">
                  <Label className="text-lg font-semibold">Options Liées</Label>
                  <p className="text-sm text-gray-600 mb-3">
                    Sélectionnez les options auxquelles cette sous-option sera disponible
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded">
                    {customizationOptions
                      .filter(option => option.id !== formData.parent_option_id) // Exclure l'option parent
                      .map((option) => (
                      <div key={option.id} className="flex items-center space-x-2 p-2 border rounded hover:bg-gray-50">
                        <Checkbox
                          checked={editingLinkedOptions.includes(option.id)}
                          onCheckedChange={() => toggleEditingOption(option.id)}
                        />
                        <div className="flex-1">
                          <Label className="text-sm font-medium cursor-pointer" onClick={() => toggleEditingOption(option.id)}>
                            {option.name}
                          </Label>
                          <div className="text-xs text-gray-500">{option.type}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="text-sm text-gray-500 mt-2">
                    {editingLinkedOptions.length} option(s) sélectionnée(s)
                  </div>

                  {/* Boutons de sélection rapide pour options */}
                  <div className="flex gap-2 mt-2">
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        const allOptionIds = customizationOptions
                          .filter(opt => opt.id !== formData.parent_option_id)
                          .map(opt => opt.id);
                        setEditingLinkedOptions(allOptionIds);
                      }}
                    >
                      Toutes les options
                    </Button>
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => setEditingLinkedOptions([])}
                    >
                      Désélectionner options
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button onClick={handleSave} className="flex-1">
                    {editingSubOption ? 'Modifier' : 'Créer'}
                  </Button>
                  <Button variant="outline" onClick={closeModal} className="flex-1">
                    Annuler
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Modal de liaison */}
        <Dialog open={isLinkModalOpen} onOpenChange={setIsLinkModalOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Lier "{selectedSubOption?.name}" à un produit ou une option
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Lier à un produit */}
              <div>
                <Label className="text-lg font-semibold">Lier à un produit</Label>
                <div className="mt-2 grid gap-2 max-h-40 overflow-y-auto">
                  {products.map((product) => (
                    <Button
                      key={product.id}
                      variant="outline"
                      className="justify-start h-auto p-3"
                      onClick={() => linkToProduct(product.id)}
                    >
                      <div className="text-left">
                        <div className="font-medium">{product.name}</div>
                        <div className="text-sm text-gray-500">
                          {product.category} - {product.price.toFixed(2)}€
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Lier à une option */}
              <div>
                <Label className="text-lg font-semibold">Lier à une option</Label>
                <div className="mt-2 grid gap-2 max-h-40 overflow-y-auto">
                  {customizationOptions.map((option) => (
                    <Button
                      key={option.id}
                      variant="outline"
                      className="justify-start h-auto p-3"
                      onClick={() => linkToOption(option.id)}
                    >
                      <div className="text-left">
                        <div className="font-medium">{option.name}</div>
                        <div className="text-sm text-gray-500">Type: {option.type}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={closeLinkModal} className="flex-1">
                  Annuler
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

  {/* Liaison en masse supprimée */}
        {/* Filtre par option parent */}
        <div className="mb-4">
          <Label htmlFor="filter">Filtrer par option parent</Label>
          <Select value={selectedOptionFilter} onValueChange={setSelectedOptionFilter}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les options</SelectItem>
              {customizationOptions.map((option) => (
                <SelectItem key={option.id} value={option.id.toString()}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Liste des sous-options */}
        <div className="space-y-2">
          {filteredSubOptions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Aucune sous-option trouvée
            </div>
          ) : (
            filteredSubOptions.map((subOption) => (
              <Card key={subOption.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{subOption.name}</h3>
                      {subOption.is_default && (
                        <Badge variant="secondary">Par défaut</Badge>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Option parent: {getParentOptionName(subOption.parent_option_id)}</div>
                      <div>Prix: {subOption.price.toFixed(2)}€</div>
                      {subOption.image && (
                        <div className="flex items-center gap-2">
                          Image: 
                          <img 
                            src={subOption.image} 
                            alt={subOption.name}
                            className="h-8 w-8 object-cover rounded"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openLinkModal(subOption)}
                      title="Lier à un produit ou une option"
                    >
                      <Link className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openModal(subOption)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(subOption.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Statistiques */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-semibold mb-2">Statistiques</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>Total des sous-options: {subOptions.length}</div>
            <div>Options par défaut: {subOptions.filter(s => s.is_default).length}</div>
            <div>Liaisons produits: {productLinks.length}</div>
            <div>Options parentes: {customizationOptions.length}</div>
          </div>
        </div>

        {/* Liaisons actuelles */}
        {productLinks.length > 0 && (
          <div className="mt-6">
            <h4 className="font-semibold mb-3">Toutes les Liaisons</h4>
            <div className="space-y-2">
              {productLinks.map((link, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Badge variant={link.type === 'product' ? 'default' : 'secondary'}>
                      {link.type === 'product' ? 'Produit' : 'Option'}
                    </Badge>
                    <span className="font-medium">{link.target_name}</span>
                    <span>↔</span>
                    <Badge variant="outline">Sous-option</Badge>
                    <span>{link.sub_option?.name || 'Sous-option inconnue'}</span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => removeLinkage(link)}
                    title="Supprimer la liaison"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
