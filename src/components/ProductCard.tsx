import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import OptimizedImage from './OptimizedImage';

interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
}

const ProductCard = ({ product }: { product: Product }) => (
  <motion.div
    className="flex w-full overflow-hidden rounded-lg bg-cream transition-all duration-300 ease-in-out hover:scale-[1.01] no-select"
    whileHover={{ y: -2 }}
  >
    <div className="flex flex-grow flex-col justify-between p-4">
      <div>
        <h3 className="text-xl font-bold text-gray-800 no-select">{product.name}</h3>
        <p className="mt-1 text-base font-semibold text-gray-900 no-select">{product.price.toFixed(2)} €</p>
        <p className="mt-2 text-sm text-secondary line-clamp-2 no-select">{product.description}</p>
      </div>
    </div>
    <div className="relative flex-shrink-0">
      <OptimizedImage 
        src={product.image} 
        alt={product.name} 
        className="h-full w-36 object-cover no-select" 
        width={144}
        height={144}
        lazy={true}
      />
      <Button
        className="absolute bottom-2 right-2 h-10 w-10 rounded-full bg-orange-500 font-dunkin text-white hover:bg-orange-600"
        size="icon"
      >
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  </motion.div>
);