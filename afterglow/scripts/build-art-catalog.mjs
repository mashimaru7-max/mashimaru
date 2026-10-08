import {readdir,writeFile} from 'node:fs/promises';
const files=(await readdir(new URL('../images/',import.meta.url),{withFileTypes:true})).filter(file=>file.isFile()).map(file=>'images/'+file.name);
await writeFile(new URL('../art-files.local.json',import.meta.url),JSON.stringify(files));
console.log('Local image catalog ready');
