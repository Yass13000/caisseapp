import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // 👇 LA LIGNE MAGIQUE POUR ELECTRON (Chemins relatifs)
  base: './', 

  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Cache tous les fichiers statiques de l'app
        globPatterns: ['**/*.{js,css,html,png,svg,otf,woff2,webp}'],
        
        // STRATÉGIE DE CACHE POUR SUPABASE (Plus de freeze d'images)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: 'CacheFirst', // Lit dans la tablette d'abord
            options: {
              cacheName: 'supabase-media-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // Garde 30 jours
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Module Caisse',
        short_name: 'Caisse',
        description: 'Caisse',
        theme_color: '#E2E8F0',
        icons: [
          {
            src: 'iconmob.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'iconmob.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Optimisation pour tablette Elo (Android WebView)
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Accélère l'exécution en retirant les logs
        drop_debugger: true,
      },
    },
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: false,
    cssCodeSplit: true, // Améliore le chargement du CSS
    
    // --- NOUVEAU : DÉCOUPAGE DU CODE POUR LIGHTHOUSE ---
    rollupOptions: {
      output: {
        manualChunks: {
          // Chunk 1 : Le moteur React (doit charger très vite)
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Chunk 2 : Supabase (très lourd, on l'isole)
          'vendor-supabase': ['@supabase/supabase-js'],
          // Chunk 3 : UI et Animations (Framer Motion pèse lourd)
          'vendor-ui': ['framer-motion', 'lucide-react'],
        }
      }
    }
  },
});