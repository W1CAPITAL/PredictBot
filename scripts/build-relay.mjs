import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['web/connect.js'],outfile:'dist/connect.js',bundle:true,minify:true,platform:'browser',target:'es2022'});
await build({entryPoints:['workers/worker.mjs'],outfile:'dist/worker.mjs',bundle:true,minify:true,platform:'neutral',mainFields:['module','main'],format:'esm',conditions:['workerd','worker','browser'],target:'es2022',external:['node:*','cloudflare:*'],loader:{'.html':'text','.css':'text'},plugins:[{name:'browser-bundle-as-text',setup(build){build.onLoad({filter:/dist\/connect\.js$/},async args=>({contents:await (await import('node:fs/promises')).readFile(args.path,'utf8'),loader:'text'}));}}]});
