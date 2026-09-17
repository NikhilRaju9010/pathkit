import { multiply } from './helper';

export async function usesHelper(x: number): Promise<number> {
  return multiply(x, 2);
}
