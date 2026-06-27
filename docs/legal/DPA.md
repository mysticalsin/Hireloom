# Data Processing Addendum (DPA) — Hireloom

> **DRAFT — review with counsel before launch.** Forms part of the [Terms](./TERMS.md) for
> business/enterprise customers who process personal data of third parties via Hireloom.

## Roles
- **Customer** = data controller. **Hireloom** = data processor.
- **Sub-processors:** Supabase (auth/db/vault/storage/functions), Stripe (billing), and the
  **AI provider(s) the Customer configures** (Anthropic/OpenAI/Gemini/OpenRouter/Kimi), plus
  the transactional email provider. AI calls run on the Customer's own key.

## Scope
- **Subject matter / duration:** for the term of the subscription.
- **Nature & purpose:** career evaluation, truthful CV/cover-letter tailoring, and assisted
  application drafting on the Customer's instruction and BYO key.
- **Data categories:** account identifiers and career PII (CV/résumé text, job descriptions,
  generated materials). **Special-category data must not be submitted.**
- **Data subjects:** the Customer's authorized users / candidates.

## Processor obligations
1. Process personal data only on the Customer's documented instructions (use of the product).
2. Ensure confidentiality of personnel with access.
3. Security measures: per-tenant Row-Level Security, Vault-encrypted secrets, TLS in transit,
   strict CSP, rate-limited auth, append-only audit log of sensitive actions.
4. Engage sub-processors only under equivalent obligations; give **30 days' notice** of changes
   (sub-processor list maintained in the [Privacy Policy](./PRIVACY.md)).
5. Assist the Customer with data-subject requests (export + erasure are self-serve in-product).
6. Notify the Customer without undue delay on becoming aware of a personal-data breach.
7. Delete or return personal data on termination (account deletion erases all tenant rows +
   Vault secrets).
8. Make available information needed to demonstrate compliance and allow reasonable audits.

## International transfers
Where personal data is transferred outside the EEA/UK, transfers rely on Standard Contractual
Clauses or an equivalent safeguard.

## Liability & governing law
As set out in the Terms. _Governing law / venue: TBD._
