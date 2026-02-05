import { useEffect, useState, RefObject, useCallback } from 'react';

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
  baseWidth: 1040,  // 380 (deck) + 20 (gap) + 224 (mixer) + 20 (gap) + 380 (deck) + 36 (padding)
  baseHeight: 720,  // Approximate natural height at comfortable density
  minScale: 0.72,   // Minimum usable scale
  maxScale: 1.0,    // Maximum scale (no enlargement beyond design size)
  padding: 32,      // Breathing room on all sides
};

/**
 * Dynamically computes the scale factor for the central console panel
 * to fit within available space while maintaining aspect ratio and never overlapping.
 * 
 * Strategy:
 * 1. Observe container size changes via ResizeObserver
 * 2. Calculate available space (container - padding)
 * 3. Compute scale for both dimensions: scaleX = availW / baseW, scaleY = availH / baseH
 * 4. Take minimum to ensure panel fits in BOTH dimensions
 * 5. Clamp to [minScale, maxScale]
 * 
 * This prevents:
 * - Overlap with side panels (considers width constraint)
 * - Clipping at small heights (considers height constraint)
 * - Broken intermediate widths (uniform scale, not responsive columns)
 */
export function useFitCentralStage(
  containerRef: RefObject<HTMLElement>,
  panelRef: RefObject<HTMLElement>,
  config: Partial<ScaleConfig> = {}
): number {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const [scale, setScale] = useState(1.0);

  const calculateScale = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 1.0;

    // Get available space in container
    const containerRect = container.getBoundingClientRect();
    const availableWidth = Math.max(0, containerRect.width - finalConfig.padding * 2);
    const availableHeight = Math.max(0, containerRect.height - finalConfig.padding * 2);

    // Calculate scale factors for both dimensions
    const scaleX = availableWidth / finalConfig.baseWidth;
    const scaleY = availableHeight / finalConfig.baseHeight;

    // Take the minimum to ensure panel fits in BOTH dimensions
    // and clamp to allowed range
    const computedScale = Math.max(
      finalConfig.minScale,
      Math.min(scaleX, scaleY, finalConfig.maxScale)
    );

    return computedScale;
  }, [containerRef, finalConfig.baseWidth, finalConfig.baseHeight, finalConfig.minScale, finalConfig.maxScale, finalConfig.padding]);

  useEffect(() => {
    const container = containerRef.current;
    const panel = panelRef.current;

    if (!container || !panel) {
      return;
    }

    // Debounce to avoid excessive re-calculations during window resize
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      timeoutId = setTimeout(() => {
        const newScale = calculateScale();
        setScale(newScale);
      }, 10);
    });

    observer.observe(container);

    // Initial calculation
    const initialScale = calculateScale();
    setScale(initialScale);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      observer.disconnect();
    };
  }, [containerRef, panelRef, calculateScale]);

  return scale;
}
