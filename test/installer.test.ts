import { describe, expect, it } from 'vitest';
import { buildCranScript, buildGithubScript, safeRepos } from '../src/main/installer';

describe('safeRepos', () => {
  it('accepts clean http(s) mirrors', () => {
    expect(safeRepos('https://cloud.r-project.org')).toMatch(/^https:\/\/cloud\.r-project\.org/);
    expect(safeRepos('http://cran.example.org/')).toMatch(/^http:\/\//);
  });

  it('rejects non-URLs', () => {
    expect(() => safeRepos('not a url')).toThrow();
  });

  it('rejects non-http protocols', () => {
    expect(() => safeRepos('file:///etc/passwd')).toThrow();
    expect(() => safeRepos('javascript:alert(1)')).toThrow();
  });

  it('rejects injection attempts that would break the R string', () => {
    // a quote/paren payload must never survive into the R source
    expect(() => safeRepos('https://x"); system("rm -rf /"); ("')).toThrow();
  });
});

describe('install script builders', () => {
  it('rejects invalid package and repo names', () => {
    expect(() => buildCranScript('bad;name', '/lib', 'https://x')).toThrow();
    expect(() => buildGithubScript('not-a-repo', '/lib', 'https://x', true)).toThrow();
  });

  it('produces a fully-qualified, quoted install call', () => {
    const s = buildCranScript('molpathR', '/lib', 'https://cloud.r-project.org');
    expect(s).toContain('install.packages("molpathR"');
    expect(s).toContain('INSTALL_OK');
  });
});
