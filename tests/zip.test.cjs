// tests/zip.test.cjs — odolnost vlastního čtečky ZIP (DOCX) proti poškozeným a podvrženým souborům.
// Náhodné mutace + ručně sestavené útoky: vždy srozumitelná česká chyba, nikdy pád, zaseknutí ani tichý únik.
// Spuštění: node tests/zip.test.cjs   (deterministické, seed v kódu)
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const SRC=fs.readFileSync(path.join(__dirname,'..','js','docx-anon.js'),'utf8');
const {unzipEntries,inflate,zipEntries,crc32}=new Function(SRC+'\nreturn {unzipEntries,inflate,zipEntries,crc32};')();
const OK=/DOCX|ZIP|Word|část/;   // naše hlášky; RangeError z DataView sem nepatří
let pass=0,fail=0; const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok  ':'  FAIL ')+n+(c||!d?'':' — '+d));};
let seed=20261115; const rnd=n=>{seed=(seed*1103515245+12345)>>>0;return seed%n;};

async function attempt(buf){   // → null = v pořádku přečteno, jinak text chyby
  const t0=Date.now();
  try{const es=unzipEntries(buf); for(const en of es) await inflate(en); return {err:null,ms:Date.now()-t0};}
  catch(e){return {err:e,ms:Date.now()-t0};}
}
const enc=new TextEncoder();
function entry(name,raw,{method=8,flags=0}={}){
  const data=method===8?new Uint8Array(zlib.deflateRawSync(raw)):new Uint8Array(raw);
  return {nameBytes:enc.encode(name),flags,method,crc:crc32(new Uint8Array(raw)),csize:data.length,usize:raw.length,data};
}
const zip=async es=>(await zipEntries(es).arrayBuffer());

(async()=>{
  const base=fs.readFileSync(path.join(__dirname,'fixtures','zaloba.docx'));
  const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  t('neporušený DOCX se přečte',(await attempt(ab(base))).err===null);

  // 1) náhodné mutace: bajty kdekoli i cíleně v centrálním adresáři, zkrácení
  let bad=[],slow=0,ok=0,rejected=0;
  for(let i=0;i<1500;i++){
    const b=Buffer.from(base); const mode=i%3;
    if(mode===0) for(let k=0;k<1+rnd(8);k++) b[rnd(b.length)]=rnd(256);
    else if(mode===1) for(let k=0;k<1+rnd(6);k++) b[b.length-1-rnd(Math.min(2500,b.length))]=rnd(256);
    const cut=mode===2?b.subarray(0,rnd(b.length)):b;
    const r=await attempt(ab(Buffer.from(cut)));
    if(r.ms>3000) slow++;
    if(r.err===null) ok++; else if(r.err instanceof RangeError||r.err instanceof TypeError||!OK.test(r.err.message)) bad.push(r.err.constructor.name+': '+r.err.message); else rejected++;
  }
  t('1500 mutací: jen srozumitelné chyby',bad.length===0,[...new Set(bad)].slice(0,5).join(' | '));
  t('1500 mutací: nic se nezasekne (>3 s)',slow===0,slow+' pomalých');
  console.log(`       (přečteno ${ok}, odmítnuto ${rejected})`);

  // 2) ručně sestavené útoky
  const good=await zip([entry('word/document.xml',Buffer.from('<w:document/>'))]);
  const patch=(buf,off,bytes,le)=>{const c=buf.slice(0);const dv=new DataView(c);bytes===2?dv.setUint16(off,le,true):dv.setUint32(off,le,true);return c;};
  const eocd=b=>{const u=new Uint8Array(b);for(let i=u.length-22;i>=0;i--)if(u[i]===0x50&&u[i+1]===0x4b&&u[i+2]===5&&u[i+3]===6)return i;};
  const cdOf=b=>new DataView(b).getUint32(eocd(b)+16,true);
  const cases=[
    ['počet částí 65535 (víc, než je v souboru)',patch(good,eocd(good)+10,2,65535),/mnoho částí/],
    ['offset centrálního adresáře mimo soubor',patch(good,eocd(good)+16,4,0xFFFFFF00),/poškozený/],
    ['offset lokální hlavičky mimo soubor',patch(good,cdOf(good)+42,4,0x7FFFFFFF),/poškozený/],
    ['komprimovaná velikost větší než soubor',patch(good,cdOf(good)+20,4,0x7FFFFFFF),/poškozený/],
    ['délka jména přes konec adresáře',patch(good,cdOf(good)+28,2,65535),/poškozený/],
    ['zašifrovaný DOCX',patch(good,cdOf(good)+8,2,1),/zašifrovaný/],
    ['neznámá komprese',patch(good,cdOf(good)+10,2,99),/komprese/],
    ['dvě části se stejným jménem',await zip([entry('word/document.xml',Buffer.from('<a/>')),entry('word/document.xml',Buffer.from('<b/>'))]),/poškozený/],
    ['vadná deflate data',await zip([{...entry('word/document.xml',Buffer.from('<a/>')),data:new Uint8Array([255,255,255,255,1,2,3])}]),/poškozená/],
    ['jedna část nad 64 MB (hlavička lže 1 kB)',await zip([{...entry('word/document.xml',Buffer.alloc(70*1024*1024)),usize:1024}]),/zip bomba/],
    ['součet částí nad 256 MB (každá pod limitem)',await zip([0,1,2,3,4].map(i=>({...entry('word/p'+i+'.xml',Buffer.alloc(60*1024*1024)),usize:1024}))),/zip bomba/],
  ];
  for(const [name,buf,re] of cases){const r=await attempt(buf); t(name,r.err&&re.test(r.err.message)&&!(r.err instanceof RangeError),r.err?r.err.message:'přečteno bez chyby');}

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
