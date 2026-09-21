import { readFileSync, appendFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const zenodo = JSON.parse(readFileSync('.zenodo.json', 'utf8'));
const citation = readFileSync('CITATION.cff', 'utf8').match(/^version:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1];
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid candidate/release version.');
if ([lock.version, lock.packages[''].version, zenodo.version, citation].some(value => value !== version)) {
  throw new Error('package, lockfile, CITATION and Zenodo versions must agree.');
}
const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(`Tag must match package metadata: expected ${tag}.`);
}
const prerelease = version.includes('-');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nprerelease=${prerelease}\n`);
console.log(`Release metadata agrees: ${tag}; prerelease=${prerelease}.`);
