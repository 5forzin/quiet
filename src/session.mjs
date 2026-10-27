export function normalizeSession(cookies, approvedDomains) {
  if (!Array.isArray(cookies) || cookies.length > 20000 || !Array.isArray(approvedDomains) || !approvedDomains.length || approvedDomains.length > 20000) throw new Error('Invalid session payload.');
  const approved = new Set(approvedDomains.map(canonicalDomain));
  const mapped = cookies.map(cookie => {
    const domain = canonicalDomain(cookie.domain);
    if (!approved.has(domain)) throw new Error('Session contains cookies outside the approved domains.');
    if (cookie.partitionKey) throw new Error('Partitioned cookies are not supported by this MVP.');
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || cookie.name.length > 1024 || cookie.value.length > 16384) throw new Error('Invalid cookie data.');
    if (cookie.path !== undefined && (typeof cookie.path !== 'string' || !cookie.path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(cookie.path))) throw new Error('Invalid cookie path.');
    const result = {
      name: cookie.name, value: cookie.value, path: cookie.path || '/',
      secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly)
    };
    if (cookie.hostOnly) result.url = `${result.secure ? 'https' : 'http'}://${domain}${result.path}`;
    else result.domain = cookie.domain;
    const sameSite = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' }[cookie.sameSite];
    if (sameSite) result.sameSite = sameSite;
    if (!cookie.session && Number.isFinite(cookie.expirationDate)) result.expires = cookie.expirationDate;
    return result;
  });
  return mapped;
}

export function canonicalDomain(value) {
  if (typeof value !== 'string') throw new Error('Invalid cookie domain.');
  const domain = value.replace(/^\./, '').toLowerCase();
  if (domain.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..')) throw new Error('Invalid cookie domain.');
  return domain;
}

export function webUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  return url.href;
}
