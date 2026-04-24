import { useEffect, useRef } from 'react';

interface SpectrumProps {
  data: Uint8Array;
  bassHit: boolean;
  trebleHit: boolean;
  climaxMode: boolean;
}

export default function Spectrum({ data, bassHit, trebleHit, climaxMode }: SpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peakHolds = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    
    if (peakHolds.current.length !== data.length) {
      peakHolds.current = new Array(data.length).fill(0);
    }

    ctx.clearRect(0, 0, w, h);
    
    const bw = w / data.length;
    
    data.forEach((val, i) => {
      const barH = (val / 255) * h * 0.9;
      
      if (barH > peakHolds.current[i]) peakHolds.current[i] = barH;
      else peakHolds.current[i] = Math.max(0, peakHolds.current[i] - 1.5);

      // Create gradient for the bar
      const gradient = ctx.createLinearGradient(0, h, 0, h - barH);
      let color1 = "#00f2ff";
      let color2 = "rgba(0, 242, 255, 0.2)";

      if (i < 8) {
        // Bass region - Orange
        color1 = "#f27d26";
        color2 = "rgba(242, 125, 38, 0.2)";
      } else if (i > 20) {
        // Highs - White/Cyan
        color1 = "#ffffff";
        color2 = "rgba(255, 255, 255, 0.1)";
      }

      gradient.addColorStop(0, color1);
      gradient.addColorStop(1, color2);
      
      ctx.fillStyle = gradient;
      ctx.fillRect(i * bw + 1, h - barH, bw - 2, barH);
      
      // Peak hold bar
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fillRect(i * bw + 1, h - peakHolds.current[i] - 1, bw - 2, 1);
    });

    if (climaxMode) {
      ctx.fillStyle = "rgba(255, 0, 68, 0.05)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#ff0044";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, w, h);
    }
  }, [data, bassHit, trebleHit, climaxMode]);

  return (
    <canvas 
      ref={canvasRef} 
      width={600} 
      height={200} 
      className="w-full h-full bg-[#05050A] border border-[#333] rounded"
    />
  );
}
