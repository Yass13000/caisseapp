#!/usr/bin/env node
/**
 * Script pour utiliser les images locales au lieu de Supabase Storage
 * Plus rapide et plus fiable pour les options
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variables d\'environnement manquantes');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Mapping des noms d'options vers les fichiers locaux
const imageMapping = {
  // Boissons
  'Lipton Ice Tea': '/images/boissons/lipton.webp',
  'Eau Gazeuse': '/images/boissons/sweppes.webp',  // ou eau.webp selon votre choix
  '7up Cherry': '/images/boissons/pepsi.webp',  // À ajuster
  '7up Mojito': '/images/boissons/mojito',  // Pas d'extension - à vérifier
  '7up': '/images/boissons/pepsi.webp',  // À ajuster
  'Eau': '/images/boissons/eau.webp',
  'Oasis': '/images/boissons/oasis.webp',
  'Pepsi': '/images/boissons/pepsi.webp',
  'Pepsi Zero': '/images/boissons/pepsizero.webp',

  // Accompagnements
  'Frites': '/images/frite.webp',
  'Onion Rings X4': '/images/onion rings.webp',
  'Frite Cheesy Bacon': '/images/bacon.webp',
  'Frites Cheesy Onions': '/images/bacon.webp',  // Utiliser bacon.webp ou créer une nouvelle image
};

async function useLocalImages() {
  console.log('🔍 Basculement vers images locales...\n');

  // Vérifier que les fichiers existent
  console.log('📋 Vérification des fichiers locaux:\n');
  const missingFiles = [];

  for (const [name, path] of Object.entries(imageMapping)) {
    const fullPath = join(__dirname, 'public', path.replace(/^\//, ''));
    if (fs.existsSync(fullPath)) {
      console.log(`  ✅ ${name}: ${path}`);
    } else {
      console.log(`  ❌ ${name}: ${path} (FICHIER MANQUANT)`);
      missingFiles.push({ name, path });
    }
  }

  if (missingFiles.length > 0) {
    console.log(`\n⚠️  ${missingFiles.length} fichier(s) manquant(s). Voulez-vous continuer ? (Les images manquantes ne seront pas mises à jour)`);
  }

  console.log('\n🔧 Mise à jour de la base de données...\n');

  try {
    const { data: options, error } = await supabase
      .from('customization_options')
      .select('*')
      .in('type', ['boissons', 'accompagnements']);

    if (error) {
      console.error('❌ Erreur:', error);
      return;
    }

    let successCount = 0;
    let skippedCount = 0;

    for (const option of options) {
      const newPath = imageMapping[option.name];

      if (!newPath) {
        console.log(`  ⚠️  ${option.name}: Pas de mapping défini, ignoré`);
        skippedCount++;
        continue;
      }

      // Vérifier que le fichier existe
      const fullPath = join(__dirname, 'public', newPath.replace(/^\//, ''));
      if (!fs.existsSync(fullPath)) {
        console.log(`  ⚠️  ${option.name}: Fichier ${newPath} manquant, ignoré`);
        skippedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('customization_options')
        .update({ image: newPath })
        .eq('id', option.id);

      if (updateError) {
        console.error(`  ❌ ${option.name}: Erreur -`, updateError.message);
      } else {
        console.log(`  ✅ ${option.name}: ${newPath}`);
        successCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n🎉 Basculement terminé !`);
    console.log(`   ✅ Mis à jour: ${successCount}`);
    console.log(`   ⏭️  Ignorés: ${skippedCount}\n`);

    console.log('💡 Les images locales devraient maintenant s\'afficher correctement !');
    console.log('   Avantages: plus rapide, pas de dépendance à Supabase Storage\n');

  } catch (err) {
    console.error('❌ Erreur:', err);
  }
}

useLocalImages();
