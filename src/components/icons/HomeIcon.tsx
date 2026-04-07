import React from 'react';

type Props = React.SVGProps<SVGSVGElement> & { useCurrentColor?: boolean };

// Two-tone home icon using accent (yellow) and primary (orange/red)
// If useCurrentColor is true, render a monochrome variant using currentColor
export const HomeIcon: React.FC<Props> = ({ useCurrentColor = false, ...props }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    {useCurrentColor ? (
      <>
        <path d="M2 11.5l10-8 10 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M5 10v10h14V10" fill="currentColor" />
      </>
    ) : (
      <>
        <path d="M3 10.5L12 3l9 7.5" fill="#fdc209" />
        <path d="M5 10v10h14V10" fill="#f24e2b" />
        <path d="M9 20v-5a3 3 0 0 1 6 0v5" fill="#fdc209" />
        <path d="M2 11.5l10-8 10 8" stroke="#f24e2b" strokeWidth="2" strokeLinejoin="round" />
      </>
    )}
  </svg>
);

export default HomeIcon;
