import { describe, it } from 'vitest';
import { validateAndResolveTarget } from '../../../src/adapters/ingestion/validate-and-resolve-target.js';

describe('scratch', () => {
  it('bracketed ipv4-mapped literal', async () => {
    try {
      const r = await validateAndResolveTarget('http://[::ffff:127.0.0.1]/');
      console.log('RESOLVED:', r);
    } catch (e: any) {
      console.log('THREW:', e.constructor.name, e.name, e.message, e.code);
    }
  });
  it('plain ::1 bracketed literal', async () => {
    try {
      const r = await validateAndResolveTarget('http://[::1]/');
      console.log('RESOLVED ::1:', r);
    } catch (e: any) {
      console.log('THREW ::1:', e.constructor.name, e.name, e.message, e.code);
    }
  });
});
