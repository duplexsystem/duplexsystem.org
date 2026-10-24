export const SITE = {
  url: 'https://duplexsystem.org/',
  name: 'duplexsystem',
  description: 'Making slow things fast',
  author: 'Zoë Gidiere',
  contentLicense: 'https://creativecommons.org/licenses/by-sa/4.0/',
  fediverse: '@duplexsys@duplexsystem.org',
  elsewhere: [
    { label: 'github', href: 'https://github.com/duplexsystem' },
    { label: 'modrinth', href: 'https://modrinth.com/user/duplexsystem' },
    { label: 'mastodon', href: 'https://mastodon.duplexsystem.org/duplexsys' },
    { label: 'ko-fi', href: 'https://ko-fi.com/duplexsystem' },
  ],
} as const;

export const PERSON_ID = `${SITE.url}#me`;

export function personLd() {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: SITE.author,
    alternateName: SITE.name,
    url: SITE.url,
    sameAs: SITE.elsewhere.map((l) => l.href),
  };
}

export function jsonLdScript(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
