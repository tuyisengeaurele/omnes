/**
 * A Zod object schema with optional fields infers each one as `T | undefined`
 * in the value position, which is a wider type than the "key is either
 * present with T or entirely absent" shape our repository update functions
 * declare (matching what Prisma's own update input types expect under
 * exactOptionalPropertyTypes). This bridges the two: a partial update object
 * built from parsed request data should never explicitly set a key to
 * undefined for Prisma, only omit fields the caller did not provide.
 */

/**
 * Same shape as T, but every property's value type has `undefined` removed
 * from it. No `?` in the mapped type itself: omitting it (rather than
 * writing `[K in keyof T]?:`) is what makes TypeScript carry over each key's
 * own optionality from T instead of forcing every key optional, which would
 * also silently make already-required fields like `name` optional here.
 */
type WithoutUndefinedValues<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function omitUndefined<T extends Record<string, unknown>>(
  input: T
): WithoutUndefinedValues<T> {
  const result = {} as WithoutUndefinedValues<T>;
  for (const key of Object.keys(input) as Array<keyof T>) {
    const value = input[key];
    if (value !== undefined) {
      result[key] = value as WithoutUndefinedValues<T>[typeof key];
    }
  }
  return result;
}
