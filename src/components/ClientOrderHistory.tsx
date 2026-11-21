// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { History, ChevronDown, ChevronUp, RotateCcw, Loader2, Check, AlertTriangle, ShoppingBag } from 'lucide-react';
import { supabase, getActiveRestaurantId } from '@/lib/supabaseClient';
import { getFormattedOrderOptions } from '@/lib/orderFormatter';
import { extractOrderItems, orderItemName } from '@/lib/loadedOrderPricing';
import { ORDER_TYPE_ID } from '@/lib/orderTypes';
import { MaskIcon } from '@/components/MaskIcon';

type ReorderResult = { added: number; skipped: { name: string; reason: string }[] };

const TYPE_ICON: Record<string, { src: string; label: string }> = {
  [ORDER_TYPE_ID.LIVRAISON]: { src: 'SVG/liv.svg', label: 'Livraison' },
  [ORDER_TYPE_ID.EMPORTER]: { src: 'SVG/EMP.svg', label: 'À emporter' },
  [ORDER_TYPE_ID.SUR_PLACE]: { src: 'SVG/SP.svg', label: 'Sur place' },
};

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).replace('.', '');
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const euro = (n: any) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

/**
 * Historique des commandes d'un client (fiche livraison) : date, type, contenu en un toucher,
 * et bouton pour remettre toute la commande dans le ticket.
 */
export const ClientOrderHistory = ({
  clientId,
  phone,
  onReorder,
}: {
  clientId?: string | null;
  phone?: string;
  onReorder?: (order: any) => Promise<ReorderResult> | ReorderResult;
}) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | number | null>(null);
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [results, setResults] = useState<Record<string, ReorderResult>>({});

  const digits = String(phone || '').replace(/\D/g, '');

  useEffect(() => {
    const restoId = getActiveRestaurantId();
    if (!restoId || (!clientId && digits.length < 8)) {
      setOrders([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        // Même client : compte (profil / utilisateur) ou même numéro, saisi avec ou sans espaces
        const conds: string[] = [];
        if (clientId) conds.push(`profile_id.eq.${clientId}`, `user_id.eq.${clientId}`);
        const rawPhone = String(phone || '').trim();
        [...new Set([rawPhone, digits].filter(Boolean))].forEach(p => conds.push(`customer_phone.eq."${p.replace(/"/g, '')}"`));

        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, created_at, total_price, order_details, order_type_id, status')
          .eq('restaurant_id', restoId)
          .neq('status', 'Annulée')
          .or(conds.join(','))
          .order('created_at', { ascending: false })
          .limit(10);
        if (error) throw error;
        if (alive) setOrders(data || []);
      } catch (e) {
        console.error('Historique client :', e);
        if (alive) setOrders([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [clientId, digits]);

  const rows = useMemo(() => orders.map(o => {
    const items = extractOrderItems(o.order_details).filter(Boolean);
    return {
      order: o,
      items,
      count: items.reduce((s, it) => s + (Number(it.quantity) || 1), 0),
      type: TYPE_ICON[o.order_type_id],
    };
  }), [orders]);

  const reorder = async (order: any) => {
    if (!onReorder || busyId) return;
    setBusyId(order.id);
    try {
      const res = await onReorder(order);
      setResults(prev => ({ ...prev, [String(order.id)]: res }));
    } finally {
      setBusyId(null);
    }
  };

  if (!clientId && digits.length < 8) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-gray-500">
        <History className="w-4 h-4" />
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <span className="text-xs font-black tabular-nums bg-white border border-gray-200 rounded-full px-2 py-0.5">{rows.length}</span>
        )}
      </div>

      {!loading && rows.length === 0 && (
        <div className="px-3 py-3 flex items-center gap-2 text-gray-300">
          <ShoppingBag className="w-5 h-5" />
          <span className="text-lg font-black">0</span>
        </div>
      )}

      <div className="max-h-[230px] overflow-y-auto custom-scrollbar divide-y divide-gray-200">
        {rows.map(({ order, items, count, type }) => {
          const isOpen = openId === order.id;
          const res = results[String(order.id)];
          return (
            <div key={order.id} className={isOpen ? 'bg-white' : ''}>
              <div className="flex items-stretch">
                {/* Ligne : un toucher déplie le contenu */}
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : order.id)}
                  className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 text-left active:bg-gray-100"
                  aria-expanded={isOpen}
                >
                  <span className="w-14 shrink-0 leading-tight">
                    <span className="block text-sm font-black text-secondary">{fmtDay(order.created_at)}</span>
                    <span className="block text-[11px] font-bold text-gray-400 tabular-nums">{fmtTime(order.created_at)}</span>
                  </span>
                  {type
                    ? <MaskIcon src={type.src} size={22} className="text-gray-500" title={type.label} />
                    : <span className="w-[22px]" />}
                  <span className="flex-1 min-w-0 text-xs font-bold text-gray-600 truncate">
                    {items.slice(0, 2).map(it => `${Number(it.quantity) || 1}× ${orderItemName(it)}`).join(' · ')}
                    {items.length > 2 ? ` +${items.length - 2}` : ''}
                  </span>
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-black text-gray-400">
                    <ShoppingBag className="w-3.5 h-3.5" />{count}
                  </span>
                  <span className="shrink-0 w-16 text-right text-sm font-black text-secondary tabular-nums">{euro(order.total_price)}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />}
                </button>

                {/* Remettre toute la commande dans le ticket */}
                {onReorder && (
                  <button
                    type="button"
                    onClick={() => reorder(order)}
                    disabled={!!busyId}
                    title="Remettre cette commande dans le ticket"
                    aria-label="Recommander"
                    className="w-14 shrink-0 flex items-center justify-center bg-primary text-white active:brightness-90 disabled:opacity-50"
                  >
                    {busyId === order.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" strokeWidth={2.5} />}
                  </button>
                )}
              </div>

              {/* Résultat du « recommander » : ajoutés / écartés */}
              {res && (
                <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  {res.added > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5">
                      <Check className="w-3 h-3" /> {res.added}
                    </span>
                  )}
                  {res.skipped.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                      <AlertTriangle className="w-3 h-3" /> {s.name} · {s.reason}
                    </span>
                  ))}
                </div>
              )}

              {/* Contenu détaillé */}
              {isOpen && (
                <ul className="px-3 pb-3 space-y-1.5">
                  {items.map((it, i) => {
                    const opts = getFormattedOrderOptions(it)
                      .flatMap(g => g.items)
                      .map(o => `${o.qty > 1 ? `${o.qty}× ` : ''}${o.name}`);
                    return (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="font-black text-primary tabular-nums shrink-0">{Number(it.quantity) || 1}×</span>
                        <span className="min-w-0">
                          <span className="font-bold text-secondary">{orderItemName(it)}</span>
                          {opts.length > 0 && <span className="block text-[11px] text-gray-500 leading-snug">{opts.join(', ')}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ClientOrderHistory;
