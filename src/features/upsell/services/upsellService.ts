import { supabase, RESTAURANT_ID } from '@/lib/supabaseClient';
import { UpsellProduct } from '../types';
import React from 'react';

// --- FONCTION POUR RÉCUPÉRER L'ID DU RESTAURANT ACTIF ---
const getActiveRestaurantId = () => {
  return localStorage.getItem('admin_override_restaurant_id') || RESTAURANT_ID;
};

/**
 * Récupère tous les produits upsell actifs depuis Supabase
 * Utilise la table product avec le flag is_upsell = true
 * Triés par upsell_order
 * Pour les produits avec variantes, affiche la plus petite variante
 */
export const fetchUpsellProducts = async (): Promise<UpsellProduct[]> => {
  try {
    const activeRestoId = getActiveRestaurantId();

    const { data, error } = await supabase
      .from('product')
      .select('*')
      .eq('is_upsell', true)
      .eq('is_available', true)
      .eq('restaurant_id', activeRestoId) // <--- CORRECTION DU FILTRE RESTAURANT ICI
      .order('upsell_order', { ascending: true });

    if (error) {
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Pour chaque produit, vérifier s'il a des variantes et récupérer la plus petite
    const productsWithVariants = await Promise.all(
      data.map(async (product) => {
        if (!product.name) {
          return null;
        }

        // Vérifier s'il y a des variantes pour ce produit
        const { data: variants, error: variantsError } = await supabase
          .from('product_variants')
          .select('*')
          .eq('product_id', product.id)
          .order('price', { ascending: true }); // Trier par prix croissant

        if (!variantsError && variants && variants.length > 0) {
          // Il y a des variantes, prendre la première (la moins chère)
          const smallestVariant = variants[0];
          return {
            ...product,
            price: smallestVariant.price || product.price || 0,
            name: `${product.name} ${smallestVariant.pieces_count || ''} pièces`.trim(),
            variant_id: smallestVariant.id,
            pieces_count: smallestVariant.pieces_count
          };
        } else {
          // Pas de variantes, utiliser le produit tel quel
          if (product.price === null || product.price === undefined) {
            product.price = 0;
          }
          return product;
        }
      })
    );

    // Filtrer les produits null
    const validProducts = productsWithVariants.filter(product => product !== null) as UpsellProduct[];

    return validProducts;
  } catch (error) {
    return [];
  }
};

/**
 * Récupère un produit upsell spécifique par son ID
 */
export const fetchUpsellProductById = async (id: string): Promise<UpsellProduct | null> => {
  try {
    const activeRestoId = getActiveRestaurantId();

    const { data, error } = await supabase
      .from('product')
      .select('*')
      .eq('id', id)
      .eq('is_upsell', true)
      .eq('is_available', true)
      .eq('restaurant_id', activeRestoId) // <--- CORRECTION DU FILTRE RESTAURANT ICI
      .single();

    if (error) {
      return null;
    }

    return data;
  } catch (error) {
    return null;
  }
};

/**
 * Hook React pour gérer le chargement des produits upsell
 */
export const useUpsellProducts = () => {
  const [products, setProducts] = React.useState<UpsellProduct[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const loadProducts = async () => {
      try {
        setLoading(true);
        const data = await fetchUpsellProducts();
        setProducts(data);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  return { products, loading, error };
};