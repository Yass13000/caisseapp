#!/usr/bin/env node
/**
 * Script de vérification pré-déploiement
 * Vérifie que le projet est prêt pour Vercel
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Navigate to project root (2 levels up from docs/scripts/)
const projectRoot = path.join(__dirname, '..', '..');

const checks = [];
let hasErrors = false;

// Fonction helper pour ajouter une vérification
function addCheck(name, status, message) {
  checks.push({ name, status, message });
  if (!status) hasErrors = true;
}

console.log('🔍 Vérification pré-déploiement Vercel\n');
console.log('='.repeat(60));

// 1. Vérifier que vercel.json existe
const vercelJsonPath = path.join(projectRoot, 'vercel.json');
const hasVercelJson = fs.existsSync(vercelJsonPath);
addCheck(
  'Configuration Vercel',
  hasVercelJson,
  hasVercelJson ? 'vercel.json trouvé ✓' : 'vercel.json manquant ✗'
);

// 2. Vérifier que .env.example existe
const envExamplePath = path.join(projectRoot, '.env.example');
const hasEnvExample = fs.existsSync(envExamplePath);
addCheck(
  'Template variables d\'environnement',
  hasEnvExample,
  hasEnvExample ? '.env.example trouvé ✓' : '.env.example manquant ✗'
);

// 3. Vérifier que .env n'est PAS commité
const gitignorePath = path.join(projectRoot, '.gitignore');
let envIsIgnored = false;
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  envIsIgnored = gitignoreContent.includes('.env');
}
addCheck(
  'Fichiers sensibles exclus',
  envIsIgnored,
  envIsIgnored ? '.env est dans .gitignore ✓' : '.env doit être ajouté au .gitignore ✗'
);

// 4. Vérifier que dist n'est pas commité
const distPath = path.join(projectRoot, 'dist');
const distExists = fs.existsSync(distPath);
let distIgnored = false;
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  distIgnored = gitignoreContent.includes('dist/');
}
addCheck(
  'Build artifacts exclus',
  distIgnored,
  distIgnored ? 'dist/ est dans .gitignore ✓' : 'dist/ doit être ignoré ✗'
);

// 5. Vérifier package.json pour le script de build
const packageJsonPath = path.join(projectRoot, 'package.json');
let hasBuildScript = false;
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  hasBuildScript = packageJson.scripts && packageJson.scripts.build;
}
addCheck(
  'Script de build',
  hasBuildScript,
  hasBuildScript ? 'npm run build configuré ✓' : 'Script build manquant ✗'
);

// 6. Vérifier que node_modules n'est pas commité
let nodeModulesIgnored = false;
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  nodeModulesIgnored = gitignoreContent.includes('node_modules');
}
addCheck(
  'Dependencies exclus',
  nodeModulesIgnored,
  nodeModulesIgnored ? 'node_modules/ ignoré ✓' : 'node_modules/ doit être ignoré ✗'
);

// 7. Vérifier les images optimisées
const imagesPath = path.join(projectRoot, 'public', 'images');
let webpCount = 0;
let totalImageSize = 0;

if (fs.existsSync(imagesPath)) {
  const files = fs.readdirSync(imagesPath);
  files.forEach(file => {
    if (file.endsWith('.webp')) {
      webpCount++;
      const stats = fs.statSync(path.join(imagesPath, file));
      totalImageSize += stats.size;
    }
  });
}

const imageSizeMB = (totalImageSize / 1024 / 1024).toFixed(2);
const imagesOptimized = webpCount > 0 && totalImageSize < 10 * 1024 * 1024; // < 10 MB

addCheck(
  'Images optimisées',
  imagesOptimized,
  imagesOptimized
    ? `${webpCount} images WebP trouvées (${imageSizeMB} MB total) ✓`
    : `Optimisez vos images avec: node docs/scripts/optimize-images.mjs ✗`
);

// 8. Vérifier les variables d'environnement dans .env.example
let hasRequiredEnvVars = false;
if (fs.existsSync(envExamplePath)) {
  const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
  hasRequiredEnvVars =
    envExampleContent.includes('VITE_SUPABASE_URL') &&
    envExampleContent.includes('VITE_SUPABASE_ANON_KEY');
}
addCheck(
  'Variables Supabase documentées',
  hasRequiredEnvVars,
  hasRequiredEnvVars ? 'Variables VITE_SUPABASE_* documentées ✓' : 'Ajoutez les variables Supabase ✗'
);

// 9. Vérifier la présence du README
const readmePath = path.join(projectRoot, 'README.md');
const hasReadme = fs.existsSync(readmePath);
addCheck(
  'Documentation',
  hasReadme,
  hasReadme ? 'README.md présent ✓' : 'Ajoutez un README.md ⚠'
);

// 10. Vérifier la présence du guide de déploiement
const deployGuidePath = path.join(projectRoot, 'docs', 'deployment', 'VERCEL_DEPLOYMENT_GUIDE.md');
const hasDeployGuide = fs.existsSync(deployGuidePath);
addCheck(
  'Guide de déploiement',
  hasDeployGuide,
  hasDeployGuide ? 'VERCEL_DEPLOYMENT_GUIDE.md présent ✓' : 'Guide manquant ⚠'
);

// Afficher les résultats
console.log('\n📋 RÉSULTATS DES VÉRIFICATIONS\n');
checks.forEach((check, index) => {
  const icon = check.status ? '✅' : '❌';
  console.log(`${index + 1}. ${icon} ${check.name}`);
  console.log(`   ${check.message}\n`);
});

console.log('='.repeat(60));

if (hasErrors) {
  console.log('\n❌ ÉCHEC : Certaines vérifications ont échoué');
  console.log('\n📝 Actions recommandées:');
  console.log('1. Corrigez les erreurs listées ci-dessus');
  console.log('2. Re-lancez ce script pour vérifier');
  console.log('3. Consultez docs/deployment/VERCEL_DEPLOYMENT_GUIDE.md pour plus d\'infos\n');
  process.exit(1);
} else {
  console.log('\n✅ SUCCÈS : Toutes les vérifications sont passées !');
  console.log('\n🚀 Votre projet est prêt pour Vercel !');
  console.log('\nProchaines étapes:');
  console.log('1. Committez vos changements: git add . && git commit -m "Ready for Vercel"');
  console.log('2. Poussez sur GitHub: git push origin main');
  console.log('3. Déployez sur Vercel: vercel --prod');
  console.log('4. Ou utilisez l\'interface web: https://vercel.com/new\n');
  process.exit(0);
}
