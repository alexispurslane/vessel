import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Returns a deterministic hue (0–359) from a string hash.
 */
export function hashHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    return ((hash % 360) + 360) % 360;
}

/**
 * Returns a deterministic HSL color from a string hash.
 * Uses the string's hash to pick a hue, with fixed saturation and lightness
 * for pleasant, consistent pill text colors that work on both light and dark backgrounds.
 */
export function hashColor(str: string): string {
    const hue = hashHue(str);
    return `hsl(${hue}, 60%, 42%)`;
}

/**
 * Returns a deterministic light HSL background color from a string hash,
 * suitable for pill backgrounds with the hashColor as text.
 */
export function hashColorBg(str: string): string {
    const hue = hashHue(str);
    return `hsl(${hue}, 55%, 88%)`;
}

/**
 * Returns a deterministic dark HSL background color from a string hash,
 * suitable for pill backgrounds in dark mode.
 */
export function hashColorBgDark(str: string): string {
    const hue = hashHue(str);
    return `hsl(${hue}, 40%, 20%)`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
