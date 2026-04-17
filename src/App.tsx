import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// 👇 CHANGEMENT ICI : On importe HashRouter au lieu de BrowserRouter
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import { ConfigProvider } from "@/context/ConfigContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { StatusBar } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

// --- IMPORTS DES PAGES ---
const Caisse = lazy(() => import("./pages/Caisse"));
const NotFound = lazy(() => import("./pages/NotFound"));

const PageLoader = () => (
  <div className="flex-1 w-full flex items-center justify-center bg-background">
    <div className="text-center">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-secondary"></div>
      <p className="mt-4 text-lg text-secondary font-helvetica font-bold tracking-widest uppercase">Chargement...</p>
    </div>
  </div>
);

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // Masque la barre de statut sur les tablettes Android/iOS
    if (Capacitor.isNativePlatform()) {
      const hideSystemBars = async () => {
        try {
          await StatusBar.hide();
        } catch (e) {
          console.error("Erreur lors du masquage de la barre d'état", e);
        }
      };
      hideSystemBars();
    }
  }, []);

  return (
    <ErrorBoundary>
      <ConfigProvider>
        <QueryClientProvider client={queryClient}>
          <CartProvider>
            <TooltipProvider>
              
              <main className="min-h-screen w-full flex flex-col bg-background relative overflow-x-hidden font-helvetica select-none">
                <Toaster />
                <Sonner position="top-center" />
                
                <div className="flex-1 flex flex-col w-full relative">
                  {/* 👇 CHANGEMENT ICI : On utilise <Router> (qui est notre HashRouter) */}
                  <Router>
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                        {/* Redirection par défaut vers la caisse */}
                        <Route path="/" element={<Navigate to="/caisse" replace />} />
                        
                        {/* Route principale de la caisse */}
                        <Route path="/caisse" element={<Caisse />} />
                        
                        {/* Page 404 */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </Router>
                </div>
                
              </main>

            </TooltipProvider>
          </CartProvider>
        </QueryClientProvider>
      </ConfigProvider>
    </ErrorBoundary>
  );
};

export default App;