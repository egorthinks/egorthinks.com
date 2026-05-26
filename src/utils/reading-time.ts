const WORDS_PER_MINUTE = 200;

export function getReadingTime(body: string, wordsPerMinute = WORDS_PER_MINUTE) {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function formatReadingTime(minutes: number) {
    return `${minutes} min read`;
}
