import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
const [page,client,imports,worker,logo] = await Promise.all(
  ['src/page.html','src/client.js','src/import.js','src/worker.mjs','assets/servicio-proteccion.png'].map(path => readFile(path))
);
const archive = process.argv[2] ? (await readFile(process.argv[2])).toString('base64') : '';
await mkdir('dist/server',{recursive:true});
const document = page.toString().replace('/* CLIENT */',() => client.toString()+'\n'+imports.toString());
const contents = 'const PROJECT_ARCHIVE = '+JSON.stringify(archive)+';\nconst PAGE = '+JSON.stringify(document)+
  ';\nconst REPORT_LOGO = '+JSON.stringify(logo.toString('base64'))+';\n'+worker.toString();
const bundled = await build({stdin:{contents,resolveDir:process.cwd(),sourcefile:'portal.mjs'},bundle:true,write:false,format:'esm',target:'es2022'});
await writeFile('dist/server/index.js',bundled.outputFiles[0].contents);
