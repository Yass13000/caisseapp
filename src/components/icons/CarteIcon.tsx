import React from 'react';

type Props = React.SVGProps<SVGSVGElement> & { useCurrentColor?: boolean };

// Two-tone menu/carte icon using accent (yellow) and primary (orange/red)
// If useCurrentColor is true, render a monochrome variant using currentColor
export const CarteIcon: React.FC<Props> = ({ useCurrentColor = false, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    {useCurrentColor ? (
      <>
        <rect x="3" y="4" width="7" height="16" rx="2" fill="currentColor" />
        <rect x="14" y="4" width="7" height="16" rx="2" fill="currentColor" />
        <rect x="10" y="4" width="4" height="16" fill="currentColor" />
      </>
    ) : (
      <>
        <rect x="3" y="4" width="7" height="16" rx="2" fill="#fdc209" />
        <rect x="14" y="4" width="7" height="16" rx="2" fill="#f24e2b" />
        <rect x="10" y="4" width="4" height="16" fill="#fdc209" />
        <circle cx="7" cy="8" r="1.2" fill="#f24e2b" />
        <circle cx="7" cy="12" r="1.2" fill="#f24e2b" />
        <circle cx="7" cy="16" r="1.2" fill="#f24e2b" />
      </>
    )}
  </svg>
);

export default CarteIcon;
