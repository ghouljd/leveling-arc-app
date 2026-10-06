import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

test('privacidad detecta credenciales retiradas del HEAD pero presentes en historial', () => {
  const cwd=mkdtempSync(join(tmpdir(),'privacy-test-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'});
  const scanner=resolve('scripts/privacy.mjs');
  const value='sb_'+'secret_'+ 'x'.repeat(32);
  try {
    git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    writeFileSync(join(cwd,'config.txt'),value);git('add','.');git('commit','-m','chore: baseline');
    writeFileSync(join(cwd,'config.txt'),'removed');git('add','.');git('commit','-m','fix: remove value');
    const result=spawnSync(process.execPath,[scanner],{cwd,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/historial|valor sensible/);
    assert(!result.stderr.includes(value));
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

test('privacidad permite código genérico y rechaza documentación operativa versionada', () => {
  const cwd=mkdtempSync(join(tmpdir(),'privacy-test-'));
  const git=(...args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'});
  const scanner=resolve('scripts/privacy.mjs');
  try {
    git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
    writeFileSync(join(cwd,'README.md'),'Generic source');git('add','.');git('commit','-m','chore: baseline');
    assert.equal(spawnSync(process.execPath,[scanner],{cwd,encoding:'utf8'}).status,0);
    git('update-index','--add','--cacheinfo','100644',gitBlob(cwd),'Docs/private.md');
    assert.equal(spawnSync(process.execPath,[scanner],{cwd,encoding:'utf8'}).status,1);
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
function gitBlob(cwd:string) {return execFileSync('git',['hash-object','-w','--stdin'],{cwd,input:'private notes',encoding:'utf8'}).trim();}
