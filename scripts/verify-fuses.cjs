const { verify } = require('./after-pack.cjs');
if (!process.argv[2]) throw new Error('Usage: npm run verify:fuses -- <packaged executable or macOS .app>');
verify(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
