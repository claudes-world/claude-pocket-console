import { useEffect, useRef } from "react";

interface WaveformVisualizerProps {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
}

export function WaveformVisualizer({ analyserNode, isRecording }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const frozenRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawFlat = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#3b3d57"; // --color-subtle (canvas API doesn't support var())
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    };

    if (!isRecording || !analyserNode) {
      cancelAnimationFrame(rafRef.current);
      if (frozenRef.current) {
        ctx.putImageData(frozenRef.current, 0, 0);
      } else {
        drawFlat();
      }
      return;
    }

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.clearRect(0, 0, width, height);

      // Only use lower ~60% of frequency bins (more musical range)
      const usableBins = Math.floor(bufferLength * 0.6);
      const barCount = 48;
      const gap = 2;
      const barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);
      const totalWidth = barCount * (barWidth + gap) - gap;
      const startX = (width - totalWidth) / 2;

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.floor((i / barCount) * usableBins);
        const value = dataArray[binIndex] / 255;
        const barHeight = Math.max(2, value * (height - 8));
        const x = startX + i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        // Blue gradient: dim at bottom, bright at top
        const grad = ctx.createLinearGradient(0, y + barHeight, 0, y);
        grad.addColorStop(0, "rgba(122, 162, 247, 0.35)");
        grad.addColorStop(0.5, "rgba(122, 162, 247, 0.75)");
        grad.addColorStop(1, "rgba(122, 162, 247, 1)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }

      // Freeze a copy of the current frame
      frozenRef.current = ctx.getImageData(0, 0, width, height);
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserNode, isRecording]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.round(width * devicePixelRatio);
        canvas.height = Math.round(height * devicePixelRatio);
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(devicePixelRatio, devicePixelRatio);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 80,
        display: "block",
        background: "transparent",
        borderRadius: 8,
      }}
    />
  );
}
