#!/usr/bin/env node
/**
 * Script d'optimisation des images
 * Convertit toutes les images PNG/JPG en WebP avec qualité 80%
 * Sauvegarde les originaux dans un dossier backup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Navigate to project root (2 levels up from docs/scripts/)
const projectRoot = path.join(__dirname, '..', '..');

// Vérifier si sharp est installé
let sharp;
try {
  sharp = (await import('sharp')).default;
  console.log('✅ Module sharp détecté');
} catch (err) {
  console.error('❌ Le module "sharp" n\'est pas installé.');
  console.error('📦 Installez-le avec: npm install --save-dev sharp');
  console.error('🔧 Ou exécutez: sudo chown -R 502:20 "/Users/yacine/.npm" puis npm install --save-dev sharp');
  process.exit(1);
}

const imagesDir = path.join(projectRoot, 'public', 'images');
const backupDir = path.join(projectRoot, 'public', 'images-backup');

// Créer le dossier de backup s'il n'existe pas
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`📁 Dossier de backup créé: ${backupDir}`);
}

/**
 * Récupère tous les fichiers images récursivement
 */
function getAllImageFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllImageFiles(filePath, fileList);
    } else if (/\.(png|jpg|jpeg)$/i.test(file)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Convertit une image en WebP
 */
async function convertToWebP(imagePath) {
  try {
    const relativePath = path.relative(imagesDir, imagePath);
    const backupPath = path.join(backupDir, relativePath);
    const webpPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '.webp');

    // Créer les sous-dossiers dans le backup si nécessaire
    const backupSubDir = path.dirname(backupPath);
    if (!fs.existsSync(backupSubDir)) {
      fs.mkdirSync(backupSubDir, { recursive: true });
    }

    // Sauvegarder l'original
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(imagePath, backupPath);
      console.log(`💾 Backup: ${relativePath}`);
    }

    // Obtenir la taille de l'original
    const originalStats = fs.statSync(imagePath);
    const originalSize = (originalStats.size / 1024 / 1024).toFixed(2);

    // Convertir en WebP
    await sharp(imagePath)
      .webp({ quality: 80 })
      .toFile(webpPath);

    // Obtenir la taille du fichier WebP
    const webpStats = fs.statSync(webpPath);
    const webpSize = (webpStats.size / 1024 / 1024).toFixed(2);
    const reduction = ((1 - webpStats.size / originalStats.size) * 100).toFixed(0);

    console.log(`✅ ${relativePath} → ${path.basename(webpPath)}`);
    console.log(`   📊 ${originalSize} MB → ${webpSize} MB (-${reduction}%)`);

    // Supprimer l'original
    fs.unlinkSync(imagePath);

    return {
      original: relativePath,
      originalSize: originalStats.size,
      webpSize: webpStats.size,
      reduction: reduction
    };
  } catch (error) {
    console.error(`❌ Erreur lors de la conversion de ${imagePath}:`, error.message);
    return null;
  }
}

/**
 * Fonction principale
 */
async function main() {
  console.log('🚀 Démarrage de l\'optimisation des images...\n');

  const imageFiles = getAllImageFiles(imagesDir);
  console.log(`📸 ${imageFiles.length} images trouvées\n`);

  if (imageFiles.length === 0) {
    console.log('✨ Aucune image à optimiser !');
    return;
  }

  const results = [];
  let totalOriginalSize = 0;
  let totalWebpSize = 0;

  for (const imagePath of imageFiles) {
    const result = await convertToWebP(imagePath);
    if (result) {
      results.push(result);
      totalOriginalSize += result.originalSize;
      totalWebpSize += result.webpSize;
    }
  }

  // Résumé
  console.log('\n' + '='.repeat(60));
  console.log('📊 RÉSUMÉ DE L\'OPTIMISATION');
  console.log('='.repeat(60));
  console.log(`✅ Images converties: ${results.length}/${imageFiles.length}`);
  console.log(`📦 Taille originale: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📦 Taille optimisée: ${(totalWebpSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`💰 Réduction totale: ${((1 - totalWebpSize / totalOriginalSize) * 100).toFixed(0)}%`);
  console.log(`📁 Backup disponible dans: ${path.relative(__dirname, backupDir)}`);
  console.log('='.repeat(60));
  console.log('\n⚠️  PROCHAINES ÉTAPES:');
  console.log('1. Mettez à jour les imports d\'images dans votre code (.png/.jpg → .webp)');
  console.log('2. Testez l\'application pour vérifier que toutes les images s\'affichent');
  console.log('3. Si tout fonctionne, vous pouvez supprimer le dossier de backup');
  console.log('\n✨ Optimisation terminée !');
}

main().catch(console.error);
