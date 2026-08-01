/**
 * Plot maths, shared by the server render and the client islands.
 *
 * Both sides import this so an interactive artifact redraws using exactly the
 * geometry it was built with - there is no second implementation to drift.
 *
 * The drawing area is a normalised 1000x1000 box that CSS stretches to whatever
 * width the container has (preserveAspectRatio="none"). Strokes survive that
 * because they carry vector-effect: non-scaling-stroke, and tick labels live in
 * HTML outside the SVG so they stay at a real font size on a phone.
 */

export const BOX = 1000;

export type TickFormat = 'number' | 'percent' | 'day' | 'compact';

export type Axis = {
    min: number;
    max: number;
    /** Tick positions in data space. */
    ticks?: number[];
    label?: string;
    format?: TickFormat;
};

/** Data value to normalised x, 0 at the left. */
export function nx(v: number, axis: Axis): number {
    return ((v - axis.min) / (axis.max - axis.min || 1)) * BOX;
}

/** Data value to normalised y, 0 at the top - SVG counts downward. */
export function ny(v: number, axis: Axis): number {
    return BOX - ((v - axis.min) / (axis.max - axis.min || 1)) * BOX;
}

/** Fraction of the box, for positioning HTML labels over the plot. */
export function fx(v: number, axis: Axis): number {
    return (v - axis.min) / (axis.max - axis.min || 1);
}

export function fy(v: number, axis: Axis): number {
    return 1 - (v - axis.min) / (axis.max - axis.min || 1);
}

/**
 * Catmull-Rom through the points, converted to cubic beziers. Straight segments
 * make a plotted curve look like a chart; this makes it look drawn.
 *
 * `span` is the coordinate space to emit into: BOX for the SVG, 1 for a
 * clipPath with objectBoundingBox units.
 */
export function curvePath(points: [number, number][], x: Axis, y: Axis, span = BOX): string {
    if (points.length === 0) return '';
    const k = span / BOX;
    const dp = span === BOX ? 1 : 4;
    const p = points.map(([dx, dy]) => [nx(dx, x) * k, ny(dy, y) * k] as [number, number]);
    if (p.length === 1) return `M${r(p[0][0], dp)} ${r(p[0][1], dp)}`;

    let d = `M${r(p[0][0], dp)} ${r(p[0][1], dp)}`;
    for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] ?? p[i];
        const p1 = p[i];
        const p2 = p[i + 1];
        const p3 = p[i + 2] ?? p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ` C${r(c1x, dp)} ${r(c1y, dp)}, ${r(c2x, dp)} ${r(c2y, dp)}, ${r(p2[0], dp)} ${r(p2[1], dp)}`;
    }
    return d;
}

/**
 * The curve closed down to the baseline, for filled areas.
 *
 * At `span` 1 this is a clipPath in objectBoundingBox units. Hatching is a CSS
 * gradient on an HTML layer clipped to that path, not an SVG pattern: the plot
 * box is stretched horizontally to fit its container, and a pattern inside it
 * would shear with it - 45 degrees at one window width, 30 at another. A CSS
 * gradient on an unstretched element holds its angle.
 */
export function areaPath(points: [number, number][], x: Axis, y: Axis, span = BOX): string {
    const line = curvePath(points, x, y, span);
    if (!line) return '';
    const k = span / BOX;
    const dp = span === BOX ? 1 : 4;
    const first = r(nx(points[0][0], x) * k, dp);
    const last = r(nx(points[points.length - 1][0], x) * k, dp);
    return `${line} L${last} ${span} L${first} ${span} Z`;
}

export function formatTick(v: number, format: TickFormat = 'number'): string {
    switch (format) {
        case 'percent':
            return `${Math.round(v * 100)}%`;
        case 'day':
            return v === 0 ? '0' : `${v}d`;
        case 'compact':
            return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v);
        default:
            return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    }
}

function r(n: number, decimals = 1): number {
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
}

/** Hatch fills available to a plot series. Defined in global.css. */
export const HATCHES = [
    'hatch-up',
    'hatch-down',
    'hatch-vertical',
    'hatch-horizontal',
    'hatch-cross',
    'hatch-grid',
    'hatch-dots',
    'hatch-dense',
    'hatch-wide',
    'hatch-bold',
    'hatch-faint'
] as const;

export type Hatch = (typeof HATCHES)[number];

/* ---------------------------------------------------------------------------
   Retention model, used by the forgetting-curve artifact.
   --------------------------------------------------------------------------- */

/**
 * Ebbinghaus retention: R = e^(-t/S).
 * `stability` is roughly how many days it takes recall to fall to 37%.
 */
export function retention(days: number, stability: number): number {
    return Math.exp(-days / Math.max(stability, 0.01));
}

/**
 * Stability after n spaced reviews. Offloading the encoding - letting the agent
 * write it and accepting the diff - costs most of the initial trace, which is
 * the claim the curve is here to make arguable rather than assert.
 */
export function stabilityAfter(reviews: number, offloaded: boolean, base = 1.7): number {
    const spaced = base * Math.pow(1.85, reviews);
    return offloaded ? spaced * 0.38 : spaced;
}

/** Samples a retention curve across the horizon. */
export function retentionCurve(stability: number, horizon: number, steps = 36): [number, number][] {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const t = (i / steps) * horizon;
        return [t, retention(t, stability)] as [number, number];
    });
}
