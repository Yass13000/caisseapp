import React from 'react';
import { motion } from 'framer-motion';
import { CategoryCardVM } from '../types';

interface CategoryCardProps {
  category: CategoryCardVM;
  onClick: (categoryName: string) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = React.memo(({ category, onClick }) => (
  <div className="w-[280px] h-[300px]">
    <motion.div
      // C'est ICI qu'on recrée le cadre parfait de la Photo 2 : 
      // border, border-black/10 (le contour fin), rounded-xl (les bords arrondis) et shadow-sm
      className="relative flex flex-col w-full h-full rounded-xl overflow-hidden border border-black/10 shadow-sm transition-all duration-300 ease-in-out hover:scale-[1.03] cursor-pointer"
      onClick={() => onClick(category.name)}
      whileHover={{ y: -4 }}
    >
      {/* La zone image avec le fond légèrement assombri qui crée la démarcation avec le site */}
      <div className="relative w-full flex-1 bg-black/[0.06] overflow-hidden">
        <img
          src={category.image || '/placeholder.svg'}
          alt={category.name}
          className="object-cover w-full h-full"
          loading="lazy"
          decoding="async"
          style={{ filter: 'brightness(1.18)' }}
        />
      </div>
      
      {/* La zone texte avec son fond blanc pur et un tout petit filet gris en haut pour la propreté */}
      <div className="p-3 md:p-4 text-center w-full bg-white flex-shrink-0 border-t border-black/5">
        <h3 className="text-base md:text-2xl font-bold font-dunkin text-secondary uppercase leading-tight">
          {category.name}
        </h3>
      </div>
    </motion.div>
  </div>
));

CategoryCard.displayName = 'CategoryCard';

export default CategoryCard;