export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category_id: string;
  is_available: boolean;
  is_upsell?: boolean;
  upsell_order?: number;
  created_at: string;
  updated_at: string;
  sub_option_groups?: ProductSubOptionGroup[];
}

export interface Category {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SubOptionGroup {
  id: string;
  name: string;
  description?: string;
  is_required: boolean;
  max_selections: number;
  min_selections: number;
  created_at: string;
  updated_at: string;
  sub_options?: SubOption[];
}

export interface SubOption {
  id: string;
  group_id: string;
  parent_id?: string | null; // optional parent to allow nested sub-options (option of an option)
  name: string;
  price: number;
  description?: string;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductSubOptionGroup {
  id: string;
  product_id: string;
  group_id: string;
  is_required: boolean;
  sort_order: number;
  created_at: string;
  group?: SubOptionGroup;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image_url: string;
  product: Product;
  // Distinguish items sharing same product/options
  customKey?: string;
  // Loyalty reward metadata (optional)
  isReward?: boolean;
  rewardPoints?: number; // points spent to get this item
  redemptionId?: number; // id from loyalty_redemption (if tracked)
  
  // Nouvelles propriétés pour le système de sous-options
  selectedSubOptions?: SelectedSubOption[];
  
  // Propriétés legacy pour compatibilité (à supprimer progressivement)
  boisson?: CustomizationOption;
  accompagnement?: CustomizationOption;
  boissonSubChoices?: any[];
  accompagnementSubChoices?: any[];
  directSubOptions?: any[];
}

export interface SelectedSubOption {
  groupId: string;
  groupName: string;
  options: {
    id: string;
    name: string;
    price: number;
  }[];
}

export interface User {
  id: string;
  email: string;
  name?: string;
}

// Legacy interfaces pour compatibilité (à supprimer progressivement)
export interface CustomizationOption {
  id: number;
  name: string;
  price: number;
  type: string;
  image: string;
}