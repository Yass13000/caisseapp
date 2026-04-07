#!/bin/bash
# Script pour redémarrer complètement l'environnement de développement

echo "🔄 Redémarrage complet de l'environnement..."

# Arrêter tous les processus sur les ports 8080-8090
echo "📡 Libération des ports..."
for port in {8080..8090}; do
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
done

# Nettoyer les caches npm/yarn
echo "🧹 Nettoyage des caches..."
npm cache clean --force 2>/dev/null || true

# Supprimer node_modules et reinstaller (optionnel)
# echo "📦 Réinstallation des dépendances..."
# rm -rf node_modules package-lock.json
# npm install

# Redémarrer le serveur de développement
echo "🚀 Redémarrage du serveur..."
npm run dev

echo "✅ Redémarrage terminé! Ouvrez http://localhost:8085"
