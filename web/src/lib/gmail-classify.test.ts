import { describe, it, expect } from 'vitest';
import { classifySignal, companyFromSender } from './gmail-classify';

describe('classifySignal', () => {
  it('detects offers, interviews, rejections, responses', () => {
    expect(classifySignal('Your offer from Anthropic')).toBe('offer');
    expect(classifySignal('We are pleased to offer you the role')).toBe('offer');
    expect(classifySignal('Interview availability for the Staff role')).toBe('interview');
    expect(classifySignal('Let’s schedule a call', 'pick a time that works')).toBe('interview');
    expect(classifySignal('Update on your application', 'Unfortunately we are not moving forward')).toBe('rejection');
    expect(classifySignal('We received your application')).toBe('response');
  });
  it('returns null for unrelated mail', () => {
    expect(classifySignal('Your weekly newsletter', 'top stories')).toBeNull();
    expect(classifySignal('')).toBeNull();
  });
  it('prioritizes offer over interview when both present', () => {
    expect(classifySignal('Offer + next steps interview')).toBe('offer');
  });
});

describe('companyFromSender', () => {
  it('extracts the company token from an email address', () => {
    expect(companyFromSender('Acme Careers <noreply@acme.com>')).toBe('acme');
    expect(companyFromSender('jobs@careers.bigco.io')).toBe('bigco');
    expect(companyFromSender('no email here')).toBe('');
  });
});
