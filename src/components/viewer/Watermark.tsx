import { useState, useEffect } from "react";

interface WatermarkProps {
  tokenCode: string;
}

const Watermark = ({ tokenCode }: WatermarkProps) => {
  const [position, setPosition] = useState({ top: 10, left: 10 });
  const code = `RT-${tokenCode.slice(-4)}`;

  useEffect(() => {
    setPosition({
      top: Math.random() * 60 + 10,
      left: Math.random() * 60 + 10,
    });

    const interval = setInterval(() => {
      setPosition({
        top: Math.random() * 60 + 10,
        left: Math.random() * 60 + 10,
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-[9999] select-none font-mono text-xs font-bold text-foreground/30 transition-all duration-[2000ms] md:text-sm"
      style={{
        top: `${position.top}%`,
        left: `${position.left}%`,
        position: "absolute",
      }}
    >
      {code}
    </div>
  );
};

export default Watermark;
