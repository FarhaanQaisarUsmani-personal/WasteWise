import wiseLogo from '../assets/Wise.png';

interface LogoProps {
  className?: string;
  size?: number;
}

export default function Logo({ className = '', size = 48 }: LogoProps) {
  return (
    <img 
      src={wiseLogo}
      alt="WISE Logo" 
      width={size} 
      height={size} 
      className={className} 
    />
  );
}
