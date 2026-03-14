import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = '', size = 48 }: LogoProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <g fill="currentColor">
        {/* Left stroke of W */}
        <path d="M 22 34 C 30 35 38 32 38 40 L 38 60 C 38 68 32 72 26 72 C 34 75 42 72 42 63 L 42 38 C 42 32 36 29 22 34 Z" />
        
        {/* Right stroke of W */}
        <path d="M 44 34 C 52 35 60 32 60 40 L 60 60 C 60 68 54 72 48 72 C 56 75 64 72 64 63 L 64 38 C 64 32 58 29 44 34 Z" />
        
        {/* Teardrop/Dot */}
        <path d="M 72 31 C 65 31 64 38 64 38 C 64 43 68 43 72 43 C 76 43 78 40 78 43 C 78 40 78 31 72 31 Z" />
        
        {/* The word WISE */}
        <text 
          x="66" 
          y="62" 
          fontSize="4.5" 
          fontFamily="sans-serif" 
          letterSpacing="1.5" 
          transform="rotate(-65, 66, 62)"
        >
          WISE
        </text>
      </g>
    </svg>
  );
}
