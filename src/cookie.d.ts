/**
 * @file Type declarations for the 'cookie' module.
 */
declare module "cookie" {
    type SerializeOptions = {
        domain?: string;
        encode?(val: string): string;
        expires?: Date;
        httpOnly?: boolean;
        maxAge?: number;
        path?: string;
        priority?: "low" | "medium" | "high";
        sameSite?: boolean | "lax" | "strict" | "none";
        secure?: boolean;
        partitioned?: boolean;
    };

    type ParseOptions = {
        decode?(val: string): string;
    };

    /**
     * Parse an HTTP Cookie header string and return an object of name-value pairs.
     * @param str - The Cookie header string to parse
     * @param options - Optional parsing options
     * @returns Object mapping cookie names to values
     */
    export function parse(str: string, options?: ParseOptions): Record<string, string>;

    /**
     * Serialize a cookie name-value pair into a Set-Cookie header string.
     * @param name - The cookie name
     * @param val - The cookie value
     * @param options - Optional serialization options
     * @returns The serialized Set-Cookie header string
     */
    export function serialize(name: string, val: string, options?: SerializeOptions): string;
}
