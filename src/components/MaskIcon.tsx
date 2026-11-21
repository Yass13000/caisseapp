import React from 'react';

/**
 * Chemin d'un fichier du dossier `public`, utilisable en ligne ET en mode secours hors-ligne.
 * L'exe charge parfois `dist/index.html` en file:// : un chemin absolu « /SVG/x.svg » pointerait
 * alors à la racine du disque. Avec `base: './'` et des routes en « #/… », un chemin relatif
 * se résout toujours à côté de index.html.
 */
export const publicAsset = (path: string): string => path.replace(/^\/+/, '');

/**
 * Icône SVG maison (dossier public) affichée en masque : elle prend la couleur du texte
 * (classe text-… ou currentColor), sans fond.
 */
export const MaskIcon = ({
  src,
  size,
  ratio,
  className = '',
  title,
}: {
  src: string;
  /** Hauteur et largeur en px (icône carrée). Sinon, dimensionner avec className (ex. « h-6 »). */
  size?: number;
  /** Rapport largeur / hauteur quand l'icône n'est pas carrée (ex. « 944 / 538 »). */
  ratio?: string;
  className?: string;
  title?: string;
}) => {
  const url = `url(${publicAsset(src)})`;
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        ...(size ? { width: size, height: size } : {}),
        ...(ratio ? { aspectRatio: ratio } : {}),
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
};

/** Icône « tap to pay » (paiement sans contact), sans fond. */
export const TapToPayIcon = ({ className = '', title = 'Paiement sans contact' }: { className?: string; title?: string }) => (
  <MaskIcon src="SVG/ttp.svg" ratio="944 / 538" className={className} title={title} />
);
