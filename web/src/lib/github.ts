// Pulls a user's public GitHub repositories to enrich their CV. Anonymous,
// read-only calls to the public REST API — no auth token, no PII sent. Returns
// the top repos by star count so the user can append the highlights to their CV.

export interface GithubProject {
  name: string;
  stars: number;
  language: string | null;
  description: string | null;
  url: string;
}

interface GithubRepo {
  name: string;
  fork: boolean;
  stargazers_count: number;
  language: string | null;
  description: string | null;
  html_url: string;
}

export async function fetchGithubProjects(username: string): Promise<GithubProject[]> {
  const u = username.trim().replace(/^@/, '');
  if (!u) throw new Error('Enter a GitHub username.');

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(u)}/repos?sort=stars&per_page=100`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
  } catch {
    throw new Error('Could not reach GitHub. Check your connection.');
  }

  if (res.status === 404) throw new Error(`No GitHub user named “${u}”.`);
  if (res.status === 403) throw new Error('GitHub rate limit hit — try again in a few minutes.');
  if (!res.ok) throw new Error(`GitHub API error (${res.status}).`);

  const repos = (await res.json()) as GithubRepo[];
  return repos
    .filter((r) => !r.fork)
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 6)
    .map((r) => ({
      name: r.name,
      stars: r.stargazers_count,
      language: r.language,
      description: r.description,
      url: r.html_url,
    }));
}
