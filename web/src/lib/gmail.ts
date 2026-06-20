import { supabase } from './supabase';
import { classifySignal, companyFromSender, type SignalType } from './gmail-classify';

// Reads the user's recent mail with their own Google token (gmail.readonly) and
// classifies job-search signals — entirely client-side; the token never leaves the
// browser. provider_token is present after a Google sign-in with the gmail scope;
// if absent (or expired), callers prompt a reconnect.

export interface Signal { id: string; from: string; subject: string; date: string; type: SignalType; company: string; }

async function providerToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.provider_token ?? null;
}

function header(msg: { payload?: { headers?: { name: string; value: string }[] } }, name: string): string {
  return (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

export async function getInboxSignals(): Promise<{ error?: string; needsConnect?: boolean; signals?: Signal[] }> {
  const token = await providerToken();
  if (!token) return { needsConnect: true };
  const auth = { Authorization: `Bearer ${token}` };
  try {
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=newer_than:45d', { headers: auth });
    if (listRes.status === 401 || listRes.status === 403) return { needsConnect: true };
    if (!listRes.ok) return { error: `Gmail API ${listRes.status}` };
    const list = await listRes.json();
    const ids: string[] = (list.messages || []).map((m: { id: string }) => m.id).slice(0, 25);

    const signals: Signal[] = [];
    for (const id of ids) {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth });
      if (!r.ok) continue;
      const m = await r.json();
      const subject = header(m, 'subject');
      const from = header(m, 'from');
      const type = classifySignal(subject, m.snippet || '');
      if (type) signals.push({ id, from, subject, date: header(m, 'date'), type, company: companyFromSender(from) });
    }
    return { signals };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
