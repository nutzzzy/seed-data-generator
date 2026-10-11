import { describe, expect, it } from 'vitest';
import { ConfluenceError, resolvePageRef } from './confluencePlugin.ts';

const BASE = 'https://confluence.snappfood.ir';

describe('resolvePageRef', () => {
  it('reads the page id from the usual link forms', () => {
    expect(resolvePageRef(BASE, 'https://confluence.snappfood.ir/spaces/FP/pages/154408734/Partner+Use+Cases+by+Domain')).toEqual({ id: '154408734' });
    expect(resolvePageRef(BASE, 'https://confluence.snappfood.ir/pages/viewpage.action?pageId=154411387')).toEqual({ id: '154411387' });
    expect(resolvePageRef(BASE, 'https://confluence.snappfood.ir/display/QC/View+Coupon+List')).toEqual({ spaceKey: 'QC', title: 'View Coupon List' });
  });

  it('refuses other hosts, so the token is never sent anywhere else', () => {
    expect(() => resolvePageRef(BASE, 'https://example.com/spaces/FP/pages/1/x')).toThrow(ConfluenceError);
    expect(() => resolvePageRef(BASE, 'not a link')).toThrow(ConfluenceError);
    expect(() => resolvePageRef(BASE, 'https://confluence.snappfood.ir/x/AbCd')).toThrow(/شناسهٔ صفحه/);
  });
});
