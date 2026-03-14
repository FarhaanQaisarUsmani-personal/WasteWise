import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = '', size = 48 }: LogoProps) {
  return (
    <img 
      src="/Wise.png" 
      alt="WISE Logo" 
      width={size} 
      height={size} 
      className={`object-contain ${className}`} 
      referrerPolicy="no-referrer"
    />
  );
}
