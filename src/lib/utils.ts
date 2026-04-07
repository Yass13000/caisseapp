import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper pour résoudre la meilleure URL d'image produit
export function resolveProductImage(product: any): string {
  if (!product) return '/placeholder.svg';
  // Essayer champs classiques
  const candidates = [
    product.image_url,
    product.image,
    product.imageUrl,
    product.img,
    // Modules ES importés (peuvent être { default: 'url' })
    product.image?.default,
    product.image_url?.default
  ].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return '/placeholder.svg';
}
