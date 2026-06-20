// Pure inbox-signal classification — mirrors the engine's gmail-signals heuristics.
// Pure so it's fully unit-tested (the Gmail fetch in gmail.ts is the unverifiable part).

export type SignalType = 'offer' | 'interview' | 'rejection' | 'response';

export function classifySignal(subject = '', snippet = ''): SignalType | null {
  const t = `${subject} ${snippet}`.toLowerCase();
  if (/\boffer\b|pleased to offer|offer letter|extend an offer|job offer/.test(t)) return 'offer';
  if (/interview|schedule a (call|chat|time)|your availability|book a time|phone screen|meet (with|the team)|next steps|technical screen/.test(t)) return 'interview';
  if (/unfortunately|not (moving|proceeding|progressing) forward|other candidates|won'?t be moving|decided not to (move|proceed)|regret to inform|not be progressing|position has been filled/.test(t)) return 'rejection';
  if (/your application|received your application|thanks for applying|thank you for applying|application (was )?(received|submitted)/.test(t)) return 'response';
  return null;
}

// "Acme Careers <noreply@acme.com>" → "acme"
export function companyFromSender(from = ''): string {
  const m = from.match(/@(?:[\w-]+\.)*([\w-]+)\.[a-z]{2,}/i);
  return m ? m[1].toLowerCase() : '';
}
