import semanticRelease from 'semantic-release';
import {writeFileSync, appendFileSync} from 'node:fs';
const result = await semanticRelease({ci: !process.argv.includes('--local'), dryRun: process.argv.includes('--dry-run')});
const released = Boolean(result);
writeFileSync('release-result.json', JSON.stringify(result ? {version: result.nextRelease.version, commit: result.nextRelease.gitHead} : {released: false}));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `released=${released}\n`);
