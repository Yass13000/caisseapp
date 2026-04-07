#!/usr/bin/env node
/**
 * Script pour corriger les chemins d'images des options (boissons/accompagnements)
 * Convertit les extensions .png/.jpg en .webp dans Supabase
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Charger les variables d'environnement
dotenv.config({ path: join(__dirname, '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variables d\'environnement manquantes');
  console.error('Assurez-vous que VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont définis dans .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixOptionsImages() {
  console.log('🔍 Vérification des images des options...\n');

  try {
    // Récupérer toutes les options (boissons et accompagnements)
    const { data: options, error } = await supabase
      .from('customization_options')
      .select('*')
      .in('type', ['boissons', 'accompagnements']);

    if (error) {
      console.error('❌ Erreur lors de la récupération des options:', error);
      return;
    }

    if (!options || options.length === 0) {
      console.log('ℹ️  Aucune option trouvée dans la base de données');
      return;
    }

    console.log(`📊 ${options.length} options trouvées\n`);

    const updates = [];
    const alreadyCorrect = [];

    for (const option of options) {
      const image = option.image || '';

      // Vérifier si l'image a une extension .png ou .jpg
      if (image.match(/\.(png|jpg|jpeg)$/i)) {
        const newImage = image.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        updates.push({
          id: option.id,
          name: option.name,
          oldImage: image,
          newImage: newImage
        });
      } else if (image.endsWith('.webp')) {
        alreadyCorrect.push(option.name);
      } else {
        console.log(`⚠️  ${option.name}: Format d'image inhabituel: ${image}`);
      }
    }

    console.log('📋 Résumé:\n');
    console.log(`✅ Déjà en WebP: ${alreadyCorrect.length}`);
    console.log(`🔄 À corriger: ${updates.length}\n`);

    if (updates.length === 0) {
      console.log('✅ Toutes les images sont déjà au format WebP !');
      return;
    }

    console.log('📝 Modifications à effectuer:\n');
    updates.forEach(u => {
      console.log(`  ${u.name}:`);
      console.log(`    Ancien: ${u.oldImage}`);
      console.log(`    Nouveau: ${u.newImage}\n`);
    });

    // Demander confirmation (en production, vous pourriez automatiser)
    console.log('🔧 Application des corrections...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('customization_options')
        .update({ image: update.newImage })
        .eq('id', update.id);

      if (updateError) {
        console.error(`❌ Erreur lors de la mise à jour de ${update.name}:`, updateError);
        errorCount++;
      } else {
        console.log(`✅ ${update.name} mis à jour`);
        successCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n🎉 Correction terminée !`);
    console.log(`   ✅ Succès: ${successCount}`);
    console.log(`   ❌ Erreurs: ${errorCount}\n`);

    if (successCount > 0) {
      console.log('💡 Les images des options devraient maintenant s\'afficher correctement !');
      console.log('   Actualisez votre application pour voir les changements.\n');
    }

  } catch (err) {
    console.error('❌ Erreur inattendue:', err);
  }
}

// Exécuter le script
fixOptionsImages();
