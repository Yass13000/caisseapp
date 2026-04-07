import { supabase } from '@/lib/supabaseClient';
import { DatabaseConfig, defaultDatabaseConfig, detectDatabaseSchema, mergeConfigs } from '@/config/database';

// Interface générique pour les produits
export interface AdaptableProduct {
  id: string | number;
  name: string;
  description: string;
  price: number;
  image: string;
  image_url?: string;
  category: string;
  category_id?: string | number;
  is_available: boolean;
  [key: string]: any; // Permettre des propriétés additionnelles
}

// Interface générique pour les catégories
export interface AdaptableCategory {
  id: string | number;
  name: string;
  description: string;
  image?: string;
  [key: string]: any;
}

class AdaptableDataService {
  private config: DatabaseConfig = defaultDatabaseConfig;
  // Cache pour éviter les requêtes répétées
  private cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private isInitialized = false;

  // Initialiser le service avec détection automatique
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
            
      // Détecter automatiquement le schéma
      const detectedConfig = await detectDatabaseSchema(supabase);
      
      // Fusionner avec la configuration par défaut
      this.config = mergeConfigs(detectedConfig, defaultDatabaseConfig);
      
            this.isInitialized = true;
      
    } catch (error) {
            this.config = defaultDatabaseConfig;
      this.isInitialized = true;
    }
  }

  // Méthodes de cache pour optimiser les performances
  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data as T;
  }

  private setCached<T>(key: string, data: T, ttl: number = this.CACHE_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  async getProducts(): Promise<AdaptableProduct[]> {
    await this.initialize();
    
    // Vérifier le cache d'abord
    const cached = this.getCached<AdaptableProduct[]>('products');
    if (cached) return cached;
    
    try {
      const { data, error } = await supabase
        .from(this.config.tables.products)
        .select('*');
      
      if (error) throw error;
      
      const products = this.normalizeProducts(data || []);
      this.setCached('products', products);
      return products;
      
    } catch (error) {
      return [];
    }
  }

  // Récupérer les catégories de manière adaptable
  async getCategories(): Promise<AdaptableCategory[]> {
    await this.initialize();
    
    // Vérifier le cache d'abord
    const cached = this.getCached<AdaptableCategory[]>('categories');
    if (cached) return cached;
    
    try {
      const { data, error } = await supabase
        .from(this.config.tables.categories)
        .select('*');
      
      if (error) throw error;
      
      return this.normalizeCategories(data || []);
      
    } catch (error) {
      // Retourner des catégories par défaut basées sur les produits
      return this.generateCategoriesFromProducts();
    }
  }

  // Récupérer les options de customisation
  async getCustomizationOptions(): Promise<any[]> {
    await this.initialize();
    
    try {
      const { data, error } = await supabase
        .from(this.config.tables.customization_options)
        .select('*');
      
      if (error) throw error;
      return data || [];
      
    } catch (error) {
            return [];
    }
  }

  // Récupérer les sous-options
  async getSubOptions(): Promise<any[]> {
    await this.initialize();
    
    try {
      const { data, error } = await supabase
        .from(this.config.tables.option_sub_choices)
        .select('*');
      
      if (error) throw error;
      return data || [];
      
    } catch (error) {
            return [];
    }
  }

  // Normaliser les produits selon différents schémas
  private normalizeProducts(rawProducts: any[]): AdaptableProduct[] {
    return rawProducts.map(product => {
      const cols = this.config.productColumns;
      
      return {
        id: this.getFieldValue(product, cols.id, product.id || ''),
        name: this.getFieldValue(product, cols.name, product.name || 'Produit sans nom'),
        description: this.getFieldValue(product, cols.description, product.description || ''),
        price: this.normalizePrice(this.getFieldValue(product, cols.price, product.price || 0)),
        image: this.normalizeImage(this.getFieldValue(product, cols.image, product.image || '')),
        image_url: this.normalizeImage(this.getFieldValue(product, cols.image, product.image_url || product.image || '')),
        category: this.getFieldValue(product, cols.category, product.category || 'Divers'),
        category_id: product.category_id || product.categoryId || product.cat_id,
        is_available: this.normalizeBoolean(this.getFieldValue(product, cols.is_available, product.is_available !== false)),
        ...product // Garder toutes les propriétés originales
      };
    });
  }

  // Normaliser les catégories
  private normalizeCategories(rawCategories: any[]): AdaptableCategory[] {
    return rawCategories.map(category => {
      const cols = this.config.categoryColumns;
      
      return {
        id: this.getFieldValue(category, cols.id, category.id || ''),
        name: this.getFieldValue(category, cols.name, category.name || 'Catégorie'),
        description: this.getFieldValue(category, cols.description, category.description || ''),
        image: this.normalizeImage(category.image || ''),
        ...category
      };
    });
  }

  // Générer des catégories à partir des produits si la table catégories n'existe pas
  private async generateCategoriesFromProducts(): Promise<AdaptableCategory[]> {
    try {
      const products = await this.getProducts();
      const categoryNames = [...new Set(products.map(p => p.category))];
      
      return categoryNames.map((name, index) => ({
        id: index + 1,
        name,
        description: `Catégorie ${name}`,
        image: this.config.imageConfig.fallback_image,
      }));
      
    } catch (error) {
      return [];
    }
  }

  // Utilitaires de normalisation
  private getFieldValue(object: any, fieldName: string, defaultValue: any): any {
    // Essayer différentes variations du nom de champ
    const variations = [
      fieldName,
      fieldName.toLowerCase(),
      fieldName.toUpperCase(),
      fieldName.replace(/_/g, ''),
      fieldName.replace(/_/g, '').toLowerCase(),
    ];
    
    for (const variation of variations) {
      if (object[variation] !== undefined) {
        return object[variation];
      }
    }
    
    return defaultValue;
  }

  private normalizePrice(price: any): number {
    if (typeof price === 'number') return price;
    if (typeof price === 'string') {
      const parsed = parseFloat(price.replace(/[^\d.,]/g, '').replace(',', '.'));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private normalizeBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true' || value === '1';
    }
    if (typeof value === 'number') return value === 1;
    return true; // Par défaut, les produits sont disponibles
  }

  private normalizeImage(imageField: any): string {
    if (!imageField || imageField === '') {
      return this.config.imageConfig.fallback_image;
    }
    
    // Si c'est déjà une URL complète, la retourner
    if (imageField.startsWith('http')) {
      return imageField;
    }
    
    // Si c'est un chemin relatif et qu'on a une base URL Supabase
    if (this.config.imageConfig.base_url && this.config.imageConfig.storage_bucket) {
      return `${this.config.imageConfig.base_url}${this.config.imageConfig.storage_bucket}/${imageField}`;
    }
    
    // Sinon, traiter comme un chemin local
    return imageField.startsWith('/') ? imageField : `/${imageField}`;
  }

  // Getter pour la configuration (utile pour debugging)
  getConfig(): DatabaseConfig {
    return this.config;
  }
}

// Instance singleton
export const dataService = new AdaptableDataService();
