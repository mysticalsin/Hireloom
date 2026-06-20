import { describe, it, expect } from 'vitest';
import { cvHtml, coverHtml } from './print';
import type { Tailoring } from './db';

const T: Tailoring = {
  title: 'Applied AI Engineer',
  summary: 'Built and shipped AI systems.',
  experience: [{ title: 'Staff Engineer', period: '2022–2025', location: 'Remote', bullets: ['Led the platform team', 'Cut incidents 70%'] }],
  competencies: 'AI · Platforms',
  tools: 'Python · TS',
  coverLetter: ['Para one.', 'Para two.', 'Para three.'],
};

describe('cvHtml', () => {
  it('includes the candidate, title, summary, and bullets', () => {
    const html = cvHtml(T, 'Tony Walteur', 'tony@example.com');
    expect(html).toContain('Tony Walteur');
    expect(html).toContain('Applied AI Engineer');
    expect(html).toContain('Built and shipped AI systems.');
    expect(html).toContain('Cut incidents 70%');
    expect(html).toContain('@page');
    expect(html).toContain('size: Letter');
  });

  it('escapes HTML in user content (injection-safe)', () => {
    const evil: Tailoring = { ...T, summary: '<script>alert(1)</script>', title: '<img src=x onerror=y>' };
    const html = cvHtml(evil, '<b>name</b>', 'a@b.com');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<b>name</b>');
  });
});

describe('coverHtml', () => {
  it('renders each paragraph and the signature', () => {
    const html = coverHtml(T, 'Tony Walteur', 'tony@example.com');
    expect(html).toContain('Para one.');
    expect(html).toContain('Para two.');
    expect(html).toContain('Para three.');
    expect(html).toContain('Sincerely');
  });
});
