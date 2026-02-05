import { useEffect, useState, RefObject } from 'react';

interface ScaleConfig {
  /** Base natural width of the central panel (Deck A + Mixer + Deck B + gaps + padding) */
  baseWidth: number;
  /** Base natural height of the central panel */
  baseHeight: number;
  /** Minimum allowed scale factor */
  minScale: number;
  /** Maximum allowed scale factor */
  maxScale: number;
  /** Padding/breathing room around the panel (in px) */
  padding: number;
}

const DEFAULT_CONFIG: ScaleConfig = {
  baseWidth: 1000, // ~360 (deck) + 20 (gap) + 224 (mixer) + 20 (gap) + 360 (deck) + 36 (padding)
  baseHeight: 720, // Approximate natural height at comfortable density
  minScale: 0.72,
  maxScale: 1.0,
  padding: 32, // Breathing room on all sides
};

/**
 * Dynamically computes the scale factor for the central console panel
 * to fit within available space while maintaining aspect ratio and never overlapping.
 * 
 * Uses ResizeObserver to watch the container and computes:
 * scale = min(availableW / baseW, availableH / baseH, maxScale)
 * clamped to [minScale, maxScale]
 */
export function useFitCentralStage(
  containerRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  config: Partial<ScaleConfig> = {}
): number {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const [scale, setScale] = useState(1.0);

  useEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;

    if (!container || !panel) {
      return;
    }

    const observer = new ResizeObserver(() => {
      // Get available space in container
      const containerRect = container.getBoundingClientRect();
      const availableWidth = containerRect.width - finalConfig.padding * 2;
      const availableHeight = containerRect.height - finalConfig.padding * 2;

      // Calculate scale factors for both dimensions
      const scaleX = availableWidth / finalConfig.baseWidth;
      const scaleY = availableHeight / finalConfig.baseHeight;

      // Take the minimum to ensure panel fits in both dimensions
      // and clamp to allowed range
      const computedScale = Math.max(
        finalConfig.minScale,
        Math.min(scaleX, scaleY, finalConfig.maxScale)
      );

      setScale(computedScale);
    });

    observer.observe(container);

    // Initial calculation
    const containerRect = container.getBoundingClientRect();
    const availableWidth = containerRect.width - finalConfig.padding * 2;
    const availableHeight = containerRect.height - finalConfig.padding * 2;
    const scaleX = availableWidth / finalConfig.baseWidth;
    const scaleY = availableHeight / finalConfig.baseHeight;
    const computedScale = Math.max(
      finalConfig.minScale,
      Math.min(scaleX, scaleY, finalConfig.maxScale)
    );
    setScale(computedScale);

    return () => {
      observer.disconnect();
    };
  }, [containerRef, panelRef, finalConfig.baseWidth, finalConfig.baseHeight, finalConfig.minScale, finalConfig.maxScale, finalConfig.padding]);

  return scale;
}
