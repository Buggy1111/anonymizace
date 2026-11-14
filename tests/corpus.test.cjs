// tests/corpus.test.cjs — společný smyšlený korpus (stejný jako v anonymize-mcp/tests/corpus).
// Měří hlavně ÚNIKY (secret zůstal ve výstupu) a přetažení (must_keep zmizelo).
const fs=require('fs'),path=require('path'),os=require('os');
const {anonymize}=new Function(fs.readFileSync(path.join(__dirname,'..','js','ner-common.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'..','js','anonymize-engine.js'),'utf8')+'\nreturn {anonymize};')();
const C=JSON.parse(fs.readFileSync(path.join(__dirname,'corpus.json'),'utf8'));
let leaks=0,over=0,total=0;
for(const d of C.docs){const o=anonymize(d.text,null).anonymized;
  const L=d.secrets.filter(s=>o.includes(s)), K=(d.must_keep||[]).filter(s=>!o.includes(s)); total+=d.secrets.length; leaks+=L.length; over+=K.length;
  console.log((L.length||K.length?'  FAIL ':'  ok   ')+d.id+(L.length?' | únik: '+L.join(', '):'')+(K.length?' | přetaženo: '+K.join(', '):''));}
console.log(`\nweb: ${total-leaks}/${total} skryto, úniků ${leaks}, přetažení ${over}`);process.exit(leaks||over?1:0);
