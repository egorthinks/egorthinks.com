/**
 * Types for the vendored git-bonsai engine. Hand-written, covering only the
 * surface the playground island touches; the shapes follow src/types.ts in
 * egorthinks/git-bonsai.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type SizeClass = 'shohin' | 'chuhin' | 'dai';
export type SpeciesId = 'pine' | 'maple' | 'cherry' | 'juniper' | 'elm';
export type Style =
    | 'formal'
    | 'slanted'
    | 'han-kengai'
    | 'cascade'
    | 'bunjin'
    | 'windswept'
    | 'broom'
    | 'sokan'
    | 'kabudachi'
    | 'yose-ue'
    | 'sekijoju';

export interface Metrics {
    username: string;
    createdAt: string;
    fetchedAt: string;
    totalContributions: number;
    topLanguages: { name: string; ratio: number }[];
    epochLanguages: { epoch: 0 | 1 | 2; lang: string }[];
    currentStreak: number;
    maxStreak: number;
    longestGapDays: number;
    gapsOver60d: number;
    weekendRatio: number;
    potWeeks: number[];
    weeklyCv?: number;
    burstiness?: number;
    repoCount?: number;
    topRepoShare?: number;
    flagshipCount?: number;
    isOrg?: boolean;
}

export interface BonsaiDNA {
    seedKey: string;
    style: Style;
    species: SpeciesId;
    palettes: [string, string, string];
    flowers: number;
    sumo: boolean;
    shari: boolean;
    uro: boolean;
    sizeClass: SizeClass;
    ageYears: number;
    [key: string]: unknown;
}

/** Opaque to the page: built by the engine, passed straight back to it. */
export interface Skeleton {
    [key: string]: unknown;
}

/** One rasterized 256x256 frame: palette indices, one byte per pixel. */
export interface Frame {
    w: number;
    h: number;
    color: Uint8Array;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Day {
    date: string;
    count: number;
}

export interface RepoNode {
    createdAt: string;
    languages: { edges: { size: number; node: { name: string } }[] };
}

export type Rng = () => number;

export interface BonsaiEngine {
    normalize(username: string, createdAt: string, now: Date, days: Day[], repos: RepoNode[], isOrg?: boolean): Metrics;
    synthMetrics(username: string): Metrics;
    makeRng(seed: string): Rng;
    deriveDna(metrics: Metrics, rng: Rng): BonsaiDNA;
    buildSkeleton(dna: BonsaiDNA, rng: Rng): Skeleton;
    applyThickness(skel: Skeleton, dna: BonsaiDNA): void;
    buildPalette(palettes: [string, string, string], species: SpeciesId, season: Season): number[];
    seasonFromDate(isoDate: string): Season;
    renderFrame(dna: BonsaiDNA, skel: Skeleton, opts?: { growthT?: number; windPhase?: number | null }): Frame;
    fitBox(frames: Frame[], pad?: number): Box;
    cropFrame(frame: Frame, box: Box): Frame;
    encodeGif(
        frames: Uint8Array[],
        w: number,
        h: number,
        palette: number[],
        opts: { delays: number[]; transparentIndex: number; loops: number }
    ): Uint8Array;
    PALETTE_SIZE: number;
    TRANSPARENT: number;
}

declare const Bonsai: BonsaiEngine;
export default Bonsai;
