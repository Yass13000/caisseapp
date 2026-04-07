#!/usr/bin/env node
/**
 * Script pour corriger les chemins des images locales des options
 * Met à jour les chemins relatifs pour qu'ils fonctionnent correctement
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

async function updateLocalPaths() {
  console.log('🔍 Correction des chemins locaux...\n');

  try {
    const { data: options, error } = await supabase
      .from('customization_options')
      .select('*')
      .in('type', ['boissons', 'accompagnements']);

    if (error) {
      console.error('❌ Erreur:', error);
      return;
    }

    const updates = [];

    for (const option of options) {
      const image = option.image || '';
      let newImage = image;

      // Corriger les chemins relatifs sans /
      if (image.startsWith('images/')) {
        newImage = '/' + image;
      }
      // Les chemins avec / au début sont corrects
      else if (image.startsWith('/images/')) {
        // Déjà correct
        continue;
      }
      // Les URLs Supabase sont correctes
      else if (image.startsWith('http')) {
        continue;
      }

      if (newImage !== image) {
        updates.push({
          id: option.id,
          name: option.name,
          oldImage: image,
          newImage: newImage
        });
      }
    }

    if (updates.length === 0) {
      console.log('✅ Tous les chemins sont déjà corrects !');
      return;
    }

    console.log(`🔄 ${updates.length} chemins à corriger:\n`);

    for (const update of updates) {
      console.log(`  ${update.name}:`);
      console.log(`    ${update.oldImage} → ${update.newImage}`);

      const { error: updateError } = await supabase
        .from('customization_options')
        .update({ image: update.newImage })
        .eq('id', update.id);

      if (updateError) {
        console.error(`    ❌ Erreur:`, updateError.message);
      } else {
        console.log(`    ✅ Mis à jour\n`);
      }
    }

    console.log('✅ Correction des chemins terminée !');

  } catch (err) {
    console.error('❌ Erreur:', err);
  }
}

updateLocalPaths();
