import { useRef, useCallback, useEffect } from 'react';

interface UseNaturalCarouselProps {
  itemsCount?: number;
  itemWidth?: number; // Width of each item in pixels
  gap?: number; // Gap between items in pixels
  infinite?: boolean; // Enable infinite scroll
}

interface UseNaturalCarouselReturn {
  handleTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
  handleTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;
  handleTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  scrollBy: (amount: number) => void;
}

export const useNaturalCarousel = (
  props?: UseNaturalCarouselProps
): UseNaturalCarouselReturn => {
  const { infinite = false, itemsCount = 0, itemWidth = 140, gap = 8 } = props || {};
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartScrollXRef = useRef<number>(0);
  const touchStartTimeRef = useRef<number | null>(null);
  const velocityRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    touchStartXRef.current = e.touches[0].clientX;
    touchStartScrollXRef.current = containerRef.current?.scrollLeft || 0;
    touchStartTimeRef.current = Date.now();
    velocityRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartXRef.current === null || !containerRef.current) return;

    const currentX = e.touches[0].clientX;
    const deltaX = touchStartXRef.current - currentX;

    // Move the carousel smoothly as the user drags
    containerRef.current.scrollLeft = touchStartScrollXRef.current + deltaX;
  }, []);

  // Fonction pour repositionner le scroll en mode infini
  const checkInfiniteScroll = useCallback(() => {
    if (!infinite || !containerRef.current || itemsCount === 0) return;

    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const itemTotalWidth = itemWidth + gap;
    const sectionWidth = itemsCount * itemTotalWidth;

    // Si on est dans la première section (clone de gauche), on se repositionne dans la section du milieu
    if (scrollLeft < sectionWidth * 0.5) {
      container.scrollLeft = scrollLeft + sectionWidth;
    }
    // Si on est dans la dernière section (clone de droite), on se repositionne dans la section du milieu
    else if (scrollLeft > sectionWidth * 2.5) {
      container.scrollLeft = scrollLeft - sectionWidth;
    }
  }, [infinite, itemsCount, itemWidth, gap]);

  const handleTouchEnd = useCallback(() => {
    if (touchStartXRef.current === null || touchStartTimeRef.current === null || !containerRef.current) return;

    const deltaTime = Date.now() - touchStartTimeRef.current;
    const currentScrollLeft = containerRef.current.scrollLeft;
    const deltaScroll = currentScrollLeft - touchStartScrollXRef.current;

    // Calculate velocity (pixels per millisecond)
    const velocity = deltaScroll / deltaTime;

    touchStartXRef.current = null;
    touchStartTimeRef.current = null;

    // Apply momentum scrolling with deceleration
    if (Math.abs(velocity) > 0.5) {
      const applyMomentum = () => {
        velocityRef.current *= 0.95; // Friction

        if (Math.abs(velocityRef.current) > 0.1 && containerRef.current) {
          containerRef.current.scrollLeft += velocityRef.current;
          animationFrameRef.current = requestAnimationFrame(applyMomentum);
        } else {
          velocityRef.current = 0;
          checkInfiniteScroll();
        }
      };

      velocityRef.current = velocity;
      applyMomentum();
    } else {
      checkInfiniteScroll();
    }
  }, [checkInfiniteScroll]);

  const scrollBy = useCallback((amount: number) => {
    if (containerRef.current) {
      containerRef.current.scrollLeft += amount;
      // Vérifier le repositionnement infini après le scroll
      if (infinite) {
        setTimeout(() => checkInfiniteScroll(), 300);
      }
    }
  }, [infinite, checkInfiniteScroll]);

  // Initialiser la position au milieu pour le mode infini
  useEffect(() => {
    if (infinite && containerRef.current && itemsCount > 0) {
      const itemTotalWidth = itemWidth + gap;
      const sectionWidth = itemsCount * itemTotalWidth;
      // Positionner au début de la deuxième section (la section du milieu)
      containerRef.current.scrollLeft = sectionWidth;
    }
  }, [infinite, itemsCount, itemWidth, gap]);

  // Vérifier le repositionnement infini pendant le scroll
  useEffect(() => {
    if (!infinite || !containerRef.current) return;

    const container = containerRef.current;
    const handleScroll = () => {
      // On vérifie périodiquement si on doit se repositionner
      checkInfiniteScroll();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [infinite, checkInfiniteScroll]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    containerRef,
    scrollBy,
  };
};
