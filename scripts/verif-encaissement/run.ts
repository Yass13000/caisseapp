// Vérification de l'encaissement sur les VRAIES commandes (lecture seule) :
//   npm run verif:encaissement            → commandes des 30 derniers jours
//   npm run verif:encaissement -- 90      → 90 derniers jours
//
// Pour chaque commande (borne, app, caisse) :
//   1. ses lignes et son total sont cohérents (aucune option comptée deux fois ou oubliée) ;
//   2. rouverte à la caisse (suivi → ticket), elle garde exactement son total ;
//   3. enregistrée puis rouverte à nouveau (2 fois), le total ne bouge pas ;
//   4. +1 sur une ligne puis enregistrée : le total augmente d'exactement une unité.
// Le test utilise le code de la caisse lui-même (src/lib/loadedOrderPricing.ts).
import fs from 'fs';
import path from 'path';
import {
  mapOrderItemsForTill, buildLoadedCartItem, tillLineTotal, normalizeLinesForSave,
  extractOrderItems, resolveBaseUnitPrice, optionsUnitPrice,
} from '../../src/lib/loadedOrderPricing';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const env: Record<string, string> = {};
for (const file of ['.env', '.env.local']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) { console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants dans .env'); process.exit(2); }

const days = Number(process.argv[2]) || 30;
const since = new Date(Date.now() - days * 86400000).toISOString();
const get = async (q: string, from: number) => {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: { apikey: KEY, Range: `${from}-${from + 999}` } });
  if (!r.ok) throw new Error(`${q}: ${r.status} ${await r.text()}`);
  return r.json();
};
const getAll = async (q: string) => {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) { const chunk = await get(q, from); out.push(...chunk); if (chunk.length < 1000) break; }
  return out;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const open = (order: any, details: any[], catalog: any[]) =>
  mapOrderItemsForTill({ ...order, order_details: details }).map((it, idx) => buildLoadedCartItem(it, idx, order.id, catalog));
const total = (cart: any[]) => r2(cart.reduce((s, it) => s + tillLineTotal(it), 0));

const main = async () => {
  const orders = await getAll(`orders?select=id,order_number,restaurant_id,order_origin,total_price,delivery_fee,discount_amount,status,order_details,created_at&created_at=gte.${since}&order=created_at.desc`);
  const products = await getAll('product?select=*');
  const catalogs = new Map<string, any[]>();
  products.forEach((p: any) => { const k = String(p.restaurant_id); if (!catalogs.has(k)) catalogs.set(k, []); catalogs.get(k)!.push(p); });

  const fails: string[] = [];
  let checked = 0;
  for (const o of orders) {
    if (/annul/i.test(o.status || '')) continue;
    const raw = extractOrderItems(o.order_details);
    if (!raw.length) continue;
    if (raw.some((i: any) => String(i.id || '').startsWith('loaded-'))) continue; // déjà rouverte : son état d'origine est perdu
    checked++;
    const label = `${o.order_number || o.id} (${o.order_origin}, ${String(o.created_at).slice(0, 16)})`;
    const expected = r2(Number(o.total_price) - Number(o.delivery_fee || 0) + Number(o.discount_amount || 0));
    const catalog = catalogs.get(String(o.restaurant_id)) || [];

    // 1. Lignes cohérentes avec le total de la commande
    const lines = r2(raw.reduce((s: number, it: any) => s + (resolveBaseUnitPrice(it) + optionsUnitPrice(it)) * (Number(it.quantity) || 1), 0));
    if (Math.abs(lines - expected) > 0.009) { fails.push(`${label} : lignes ${lines} € ≠ total ${expected} €`); continue; }

    // 2 et 3. Rouverte, enregistrée, rouverte (2 fois)
    let details: any[] = raw;
    for (let pass = 1; pass <= 2; pass++) {
      const cart = open(o, details, catalog);
      const t = total(cart);
      if (Math.abs(t - expected) > 0.009) { fails.push(`${label} : rouverte (passage ${pass}) à ${t} € au lieu de ${expected} €`); break; }
      details = JSON.parse(JSON.stringify(normalizeLinesForSave(cart)));
    }

    // 4. +1 sur la première ligne
    const cart = open(o, raw, catalog);
    const unit = tillLineTotal(cart[0]) / (cart[0].quantity || 1);
    cart[0] = { ...cart[0], quantity: (cart[0].quantity || 1) + 1 };
    const t2 = total(open(o, JSON.parse(JSON.stringify(normalizeLinesForSave(cart))), catalog));
    if (Math.abs(t2 - r2(expected + unit)) > 0.009) fails.push(`${label} : +1 « ${cart[0].product?.name} » donne ${t2} € au lieu de ${r2(expected + unit)} €`);
  }

  console.log(`Commandes vérifiées : ${checked} (sur ${days} jours)`);
  if (fails.length) {
    console.log(`❌ ${fails.length} anomalie(s) :`);
    fails.slice(0, 50).forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('✅ Aucune anomalie : totaux, réouverture, réenregistrement et quantités sont justes.');
};
main().catch((e) => { console.error(e); process.exit(2); });
