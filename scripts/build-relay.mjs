import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
// The browser bundle is imported as text; a .txt suffix works on Windows and Unix.
await build({entryPoints:['web/connect.js'],outfile:'dist/connect.txt',bundle:true,minify:true,platform:'browser',target:'es2022'});
await build({entryPoints:['workers/worker.mjs'],outfile:'dist/worker.mjs',bundle:true,minify:true,platform:'neutral',mainFields:['module','main'],format:'esm',conditions:['workerd','worker','browser'],target:'es2022',external:['node:*','cloudflare:*'],loader:{'.png':'binary','.html':'text','.css':'text','.txt':'text'}});
