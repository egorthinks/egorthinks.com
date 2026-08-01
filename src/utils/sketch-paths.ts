/**
 * Sketch path registry.
 *
 * Every hand-drawn glyph on the site lives here as raw SVG path data so that
 * <Sketch />, <Arrow /> and <Mark /> all render from one source of truth.
 *
 * Conventions:
 * - Only the shape lives here. Stroke weight and dash rhythm are CSS pixels set
 *   by <Sketch />, so a glyph looks the same at 16px as it does at 200px.
 * - Control points are deliberately uneven: a perfectly symmetric curve reads
 *   as machine-drawn, and the whole point here is graphite on paper.
 * - `head` is the arrow tip: position plus the tangent angle in degrees.
 */

export type SketchHead = { x: number; y: number; a: number };
export type SketchPath = { d: string; head?: SketchHead };
export type SketchGlyph = { w: number; h: number; paths: SketchPath[] };

/** Arrows: a shaft (or two) plus one or more tips. */
export const ARROWS = {
    /** Plain horizontal run with a slight sag. The workhorse. */
    right: {
        w: 200,
        h: 24,
        paths: [{ d: 'M4 12 C 54 9, 128 15, 188 11.5', head: { x: 188, y: 11.5, a: -3 } }]
    },

    /** Vertical drop, used to chain stacked blocks. */
    down: {
        w: 24,
        h: 140,
        paths: [{ d: 'M12 4 C 9 44, 15 92, 11.5 134', head: { x: 11.5, y: 134, a: 95 } }]
    },

    /** Single gentle arc: "this leads to that", one hop. */
    curve: {
        w: 200,
        h: 90,
        paths: [{ d: 'M6 18 C 44 82, 128 88, 190 44', head: { x: 190, y: 44, a: -35 } }]
    },

    /** The S. Connects two things that are not vertically aligned. */
    's-curve': {
        w: 220,
        h: 120,
        paths: [{ d: 'M10 16 C 120 12, 8 104, 206 100', head: { x: 206, y: 100, a: -1 } }]
    },

    /** The S with one loop. The signature connector of the research track. */
    's-loop': {
        w: 240,
        h: 150,
        paths: [
            {
                d: 'M10 28 C 62 28, 96 26, 116 46 C 138 68, 100 100, 80 80 C 60 60, 108 32, 146 48 C 184 64, 196 100, 224 124',
                head: { x: 224, y: 124, a: 41 }
            }
        ]
    },

    /** Down, then right, with a rounded corner. */
    elbow: {
        w: 170,
        h: 110,
        paths: [{ d: 'M10 10 C 8 40, 6 60, 24 74 C 40 86, 90 88, 156 86', head: { x: 156, y: 86, a: -2 } }]
    },

    /** Goes out and comes back: revision, retry, the second pass. */
    'u-turn': {
        w: 180,
        h: 110,
        paths: [
            {
                d: 'M14 22 C 70 18, 120 16, 146 32 C 172 48, 168 78, 130 86 C 100 92, 60 90, 24 88',
                head: { x: 24, y: 88, a: 183 }
            }
        ]
    },

    /** One input, two outcomes. */
    branch: {
        w: 200,
        h: 150,
        paths: [
            { d: 'M8 74 C 60 74, 96 24, 176 22', head: { x: 176, y: 22, a: -3 } },
            { d: 'M8 74 C 60 74, 96 124, 176 128', head: { x: 176, y: 128, a: 3 } }
        ]
    },

    /** Two inputs, one conclusion. */
    merge: {
        w: 200,
        h: 150,
        paths: [
            { d: 'M8 22 C 88 26, 108 74, 176 74', head: { x: 176, y: 74, a: 0 } },
            { d: 'M8 128 C 88 124, 108 74, 172 74' }
        ]
    },

    /** Staircase. Sequential steps that also descend. */
    zigzag: {
        w: 200,
        h: 140,
        paths: [
            {
                d: 'M10 18 L64 18 Q78 18 78 32 L78 56 Q78 70 92 70 L146 70 Q160 70 160 84 L160 112',
                head: { x: 160, y: 112, a: 90 }
            }
        ]
    },

    /** Long dramatic arc. Section-to-section, not word-to-word. */
    swoop: {
        w: 260,
        h: 120,
        paths: [{ d: 'M8 100 C 60 12, 190 8, 250 62', head: { x: 250, y: 62, a: 42 } }]
    },

    /** Short pointer for annotating an element right next to it. */
    nudge: {
        w: 90,
        h: 70,
        paths: [{ d: 'M8 10 C 26 12, 44 24, 56 44 C 62 54, 64 58, 66 62', head: { x: 66, y: 62, a: 72 } }]
    }
} satisfies Record<string, SketchGlyph>;

/** Marks: annotation strokes with no tip. */
export const MARKS = {
    /** Single pass. The default: one confident stroke under a phrase. */
    underline: {
        w: 200,
        h: 18,
        paths: [{ d: 'M5 9 C 62 4, 140 14, 195 6' }]
    },

    /**
     * Two passes, the way you underline something you came back to. Reads as
     * emphasis-on-emphasis, so it is deliberately not the default - at body size
     * the second stroke turns the first into noise rather than weight.
     */
    'underline-double': {
        w: 200,
        h: 22,
        paths: [{ d: 'M5 9 C 62 4, 140 14, 195 6' }, { d: 'M13 16 C 74 11, 130 20, 188 14' }]
    },

    /**
     * Circled-for-emphasis, with the overshoot a real hand leaves. The ellipse
     * runs almost edge to edge of the viewBox so that <Annotate> can size the
     * box to the word and have the loop actually close around it.
     */
    circle: {
        w: 200,
        h: 100,
        paths: [
            {
                d: 'M184 26 C 148 12, 62 9, 26 27 C 2 40, 8 70, 42 83 C 84 98, 166 94, 188 66 C 200 51, 194 31, 166 20 C 146 13, 126 12, 110 14'
            }
        ]
    },

    /**
     * Curly brace, grouping a run of lines. Wide on purpose: at the 1:6 aspect
     * this started out with, the brace collapsed into a wobbly vertical line
     * and stopped reading as a brace at all.
     */
    'bracket-left': {
        w: 44,
        h: 150,
        paths: [{ d: 'M38 6 C 20 10, 27 34, 25 50 C 23 64, 6 70, 6 75 C 6 80, 23 86, 25 100 C 27 116, 20 140, 38 144' }]
    },

    /** Done, shipped, verified. */
    check: {
        w: 40,
        h: 36,
        paths: [{ d: 'M4 18 C 9 21, 14 26, 17 32 C 22 21, 28 10, 37 3' }]
    },

    /** Cut, dropped, wrong. Two strokes with a little overshoot past the join. */
    cross: {
        w: 40,
        h: 40,
        paths: [{ d: 'M6 5 C 15 14, 24 24, 34 35' }, { d: 'M35 6 C 26 15, 16 25, 6 34' }]
    },

    /**
     * Asterisk / footnote sigil. Six separate rays with a gap at the middle,
     * rather than three strokes crossing at one point - at small sizes the
     * crossing turned into an ink blob.
     */
    star: {
        w: 40,
        h: 40,
        paths: [
            { d: 'M20 3 C 20 7, 20 10, 20 14' },
            { d: 'M20 26 C 20 30, 20 33, 20 37' },
            { d: 'M5 11 C 9 13, 12 15, 15 17' },
            { d: 'M25 23 C 28 25, 32 27, 35 29' },
            { d: 'M35 11 C 31 13, 28 15, 25 17' },
            { d: 'M15 23 C 12 25, 8 27, 5 29' }
        ]
    },

    /** Wave divider. Softer than a rule, louder than whitespace. */
    wave: {
        w: 200,
        h: 18,
        paths: [{ d: 'M3 9 C 15 1, 27 17, 39 9 S 63 1, 75 9 S 99 17, 111 9 S 135 1, 147 9 S 171 17, 183 9 S 197 6, 197 9' }]
    },

    /**
     * Scribbled out. For deprecated rows and struck ideas. Two passes that
     * cross each other - a single pass is just a strikethrough, which reads as
     * typography rather than as someone having crossed the thing out.
     */
    scribble: {
        w: 120,
        h: 30,
        paths: [
            { d: 'M4 19 C 24 9, 40 24, 60 13 C 78 4, 94 21, 116 10' },
            { d: 'M6 12 C 28 22, 44 7, 64 18 C 82 28, 98 11, 116 20' }
        ]
    },

    /** Corner tick. Four of these frame a thing without boxing it in. */
    corner: {
        w: 40,
        h: 40,
        paths: [{ d: 'M4 34 C 4 22, 4 10, 5 5 C 14 4, 26 4, 36 5' }]
    },

    /** Hand-drawn node marker for track and changelog spines. Closes on itself. */
    node: {
        w: 28,
        h: 28,
        paths: [{ d: 'M20 5 C 12 1, 3 7, 3 14 C 3 22, 12 27, 19 24 C 26 21, 27 11, 20 6 C 17.5 4.2, 15 3.6, 12 4' }]
    },

    /** Long vertical spine for changelogs and tracks. */
    spine: {
        w: 12,
        h: 200,
        paths: [{ d: 'M6 2 C 4 50, 8 100, 5 150 C 4 172, 6 188, 6 198' }]
    }
} satisfies Record<string, SketchGlyph>;

export type ArrowVariant = keyof typeof ARROWS;
export type MarkVariant = keyof typeof MARKS;

export const ARROW_VARIANTS = Object.keys(ARROWS) as ArrowVariant[];
export const MARK_VARIANTS = Object.keys(MARKS) as MarkVariant[];

/**
 * Dash presets, in CSS pixels.
 *
 * Every stroke carries `vector-effect: non-scaling-stroke`, so these are screen
 * pixels regardless of how large the glyph is drawn. A tick at 16px and the same
 * tick at 120px get identical dash rhythm and stroke weight; without that, dash
 * length scales with the viewBox and small glyphs dissolve into dots.
 *
 * Consequence worth knowing: a short path gets few dashes, which is the point.
 * A 24px tick with `fine` is three strokes, not fifteen specks.
 */
export const DASH = {
    hair: '2 3',
    fine: '4 3',
    default: '7 5',
    coarse: '12 7',
    solid: 'none'
} as const;

export type DashPreset = keyof typeof DASH;

/** Shared knobs for <Sketch />, <Arrow /> and <Mark />. */
export type SketchOptions = {
    class?: string;
    /** Stroke width in CSS pixels, constant at every render size. */
    stroke?: number;
    /** Named preset or a raw stroke-dasharray value. */
    dash?: DashPreset | (string & {});
    /** Draw the glyph in when it scrolls into view. */
    animate?: boolean;
    duration?: number;
    delay?: number;
    /** Arrow tips read better solid; set 'dashed' to keep them in the pattern. */
    headStyle?: 'solid' | 'dashed';
    /** Scales the arrow tip's geometry. 1 is tuned to the authored glyphs. */
    headSize?: number;
    flip?: boolean;
    flipY?: boolean;
    rotate?: number;
    /** Let the glyph distort to fill its box - for underlines and full-width rules. */
    stretch?: boolean;
    /**
     * feTurbulence displacement - graphite grain on the stroke. Off by default:
     * the filter's scale is in viewBox units, so on a small glyph it is a large
     * fraction of the shape and the stroke reads as crooked rather than drawn.
     * Reach for it only on display-size glyphs.
     */
    texture?: boolean;
    /** Accessible name. Omit for purely decorative glyphs. */
    label?: string;
};
