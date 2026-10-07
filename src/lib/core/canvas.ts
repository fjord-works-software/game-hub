/** A canvas's displayed size, in CSS pixels. */
export interface CanvasSize {
	width: number;
	height: number;
}

/**
 * Keeps a canvas's drawing buffer matched to its displayed size × devicePixelRatio, so drawing
 * stays sharp on high-density screens. Style the canvas to fill its container; its 2D context is
 * pre-scaled, so games draw in CSS pixels. Resizing clears the canvas, so `onResize` should redraw.
 * Returns a cleanup function.
 */
export function fitCanvas(canvas: HTMLCanvasElement, onResize: (size: CanvasSize) => void): () => void {
	const context = canvas.getContext('2d');

	const observer = new ResizeObserver(([entry]) => {
		const { width, height } = entry.contentRect;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(width * ratio));
		canvas.height = Math.max(1, Math.round(height * ratio));
		context?.setTransform(ratio, 0, 0, ratio, 0, 0);
		onResize({ width, height });
	});
	observer.observe(canvas);

	return () => observer.disconnect();
}
