// Identifiants des types de commande dans la base Supabase (table order_types).
// ⚠️ SEUL endroit où ces identifiants doivent être écrits : tous les fichiers importent d'ici.

export const ORDER_TYPE_ID = {
  SUR_PLACE: '633425b1-f86c-4c17-8cba-b258906ad317',
  EMPORTER: '2cac3f10-73e2-40a5-a7e0-053bd861b4d9',
  LIVRAISON: 'c48b80a4-0dcd-4f75-9e67-a99d30bf4f9d',
} as const;
