const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
eval(src.replace('root.I18N','globalThis.__II'));
process.stdout.write(JSON.stringify(globalThis.__II.DICT));
