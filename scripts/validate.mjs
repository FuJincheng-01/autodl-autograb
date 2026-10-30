import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFile(path.join(root,p),'utf8');
const manifest=JSON.parse(await read('plugin.json'));
const market=JSON.parse(await read('.agents/plugins/marketplace.json'));
assert.equal(market.name,'autodl-autograb');
assert.equal(market.plugins[0].name,manifest.name);
assert.equal(path.resolve(root,market.plugins[0].source.path),root);
assert.equal(manifest.version,'1.0.0');
for(const doc of ['README.md','README.zh-CN.md']){
 const text=await read(doc);
 for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
  const link=m[1];if(/^(https?:|#)/.test(link))continue;
  await fs.access(path.resolve(root,link.split('#')[0]));
 }
 assert.ok(text.includes('INSTALL-PROMPT'));
}
for(const p of ['skills/autodl-autograb/SKILL.md','skills/autodl-autograb/scripts/lib.mjs','LICENSE'])await fs.access(path.join(root,p));
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
 if(['.git','dist','node_modules'].includes(e.name))continue;
 const p=path.join(dir,e.name);if(e.isDirectory()){await walk(p);continue;}
 assert.ok(!/^(auth\.txt|run\.lock|state\.json|clone-state\.json|notification-state\.json)$|\.log$/.test(e.name),'Private runtime file: '+p);
 const t=await fs.readFile(p,'utf8');
 assert.ok(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}/.test(t),'Credential-like content: '+p);
 assert.ok(!/C:[\\/]Users[\\/]Administrator|E:[\\/]迁移数据/.test(t),'Publisher-specific path: '+p);
}}
await walk(root);console.log('Manifests, local documentation links and release hygiene validated.');
