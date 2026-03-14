interface LogoProps {
  size?: number;
  className?: string;
}

export default function Logo({ size = 40, className = '' }: LogoProps) {
  return (
    <img
      src="/Wise.png"
      alt="WasteWise Logo"
      width={size}
      height={size}
      className={className}
    />
  );
}
