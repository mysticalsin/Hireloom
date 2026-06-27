# Third-Party Notices

Hireloom is distributed under PolyForm-Shield-1.0.0 (see `LICENSE`). It incorporates or
builds upon the following third-party works, retained under their own licenses.

## Origin / engine attribution (MIT — required)
The career-evaluation engine, archetypes, scoring logic, and proof-point structure
originate from Santiago Fernández's open-source work (see the MIT attribution block in
`LICENSE`). That MIT notice and permission text must be retained in all distributions.
Portfolio reference: https://github.com/santifer/cv-santiago

## Hosted web runtime dependencies
| Package | License |
|---|---|
| react, react-dom | MIT |
| @supabase/supabase-js | MIT |
| lucide-react | ISC |
| framer-motion | MIT |
| lenis | MIT |
| react-router-dom | MIT |
| vite, @vitejs/plugin-react | MIT |
| tailwindcss, postcss, autoprefixer | MIT |
| typescript | Apache-2.0 |
| vitest | MIT |

## Engine / CLI dependencies
| Package | License |
|---|---|
| js-yaml | MIT |
| pdf-lib | MIT |
| playwright | Apache-2.0 |

## Edge function dependencies (Deno, npm: specifiers)
| Package | License |
|---|---|
| stripe | MIT |
| @supabase/supabase-js | MIT |

## Pending (not yet incorporated)
- **interviewstreet/hiring-agent** (MIT © HackerRank): if the optional "Recruiter
  Scorecard" feature ships (it would adapt that project's fairness-constraint rubric as
  prompt text, not code), add the HackerRank MIT copyright + permission notice here.

Full license texts are available from each project's repository. Run a dependency license
audit (`npx license-checker --summary` for npm) before each release to keep this current.
