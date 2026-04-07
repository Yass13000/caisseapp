import React from 'react';

type Props = React.SVGProps<SVGSVGElement> & { useCurrentColor?: boolean };

// Two-tone restaurants/location icon using accent (yellow) and primary (orange/red)
// If useCurrentColor is true, render a monochrome variant using currentColor
export const RestaurantsIcon: React.FC<Props> = ({ useCurrentColor = false, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    {useCurrentColor ? (
      <>
        <path d="M12 2C8.686 2 6 4.686 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.314-2.686-6-6-6z" fill="currentColor" />
        <circle cx="12" cy="8" r="3" fill="white" />
      </>
    ) : (
      <>
        <path d="M12 2C8.686 2 6 4.686 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.314-2.686-6-6-6z" fill="#fdc209" />
        <circle cx="12" cy="8" r="3" fill="#f24e2b" />
        <path d="M8.5 21h7" stroke="#f24e2b" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
  </svg>
);

export default RestaurantsIcon;
