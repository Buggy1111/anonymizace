// tests/e2e.cjs — prohlížečové testy anonymizéru na SMYŠLENÝCH souborech (tests/fixtures).
// Spuštění: python3 -m http.server 8765 (v kořeni repa) a pak  node tests/e2e.cjs
// Vyžaduje @playwright/test (NODE_PATH). Ověřuje: OCR po stránkách, označení neúplných
// dokumentů, DOCX bez úniků, hromadný ZIP, nulové externí požadavky v lokálním režimu.
const {chromium}=require('@playwright/test');const fs=require('fs'),path=require('path'),os=require('os');
const F=path.join(__dirname,'fixtures'), BASE=process.env.BASE||'http://localhost:8765/anonymize.html';
const SECRETS=['Novák','800315','Svobodová','777 123','1234567890','Dvořák','12345679','Novotný','eva.mala','Sokolovská'];
let pass=0,fail=0; const t=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok  ':'  FAIL ')+n+(c||!d?'':' — '+d));};
(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'anon-e2e-'));
  const long=path.join(tmp,'long.txt'); fs.writeFileSync(long,'Žalobce Jan Novák, rodné číslo 800315/1234. '+'Výplňový text bez údajů. '.repeat(26000)+'Na konci Eva Malá, eva.mala@seznam.cz.');
  const b=await chromium.launch(); const p=await b.newPage({acceptDownloads:true}); const ext=[],errs=[];
  p.on('request',r=>{if(!/^(http:\/\/localhost|blob:|data:)/.test(r.url()))ext.push(r.url())}); p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(800);
  const load=async f=>{await p.setInputFiles('#anon-file',f);let st='';for(let i=0;i<300;i++){await p.waitForTimeout(1000);st=await p.textContent('#anon-fst');if(/načten|nepodařilo/.test(st))break;}return st;};
  const leaks=async()=>{const o=await p.textContent('#output');return SECRETS.filter(s=>o.includes(s));};
  let st=await load(path.join(F,'mixed.pdf'));
  t('kombinované PDF: OCR jen naskenované strany',/OCR: 2\b/.test(st),st); t('kombinované PDF: prázdná strana označena NEÚPLNÉ',/NEÚPLNÉ: nepřečtené strany 3/.test(st),st);
  t('kombinované PDF: žádné úniky',!(await leaks()).length,(await leaks()).join());
  st=await load(path.join(F,'many.pdf'));
  t('23 naskenovaných stran: nad limit 20 označeno',/nepřečtené strany 21, 22, 23/.test(st),st); t('23 stran: žádné úniky',!(await leaks()).length,(await leaks()).join());
  st=await load(long);
  t('dlouhý text: NEÚPLNÉ, žádné tiché oříznutí',/NEÚPLNÉ: dokument má 650/.test(st),st); t('dlouhý text: žádné úniky',!(await leaks()).length);
  st=await load(path.join(F,'zaloba.docx'));
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#docx-dl')]); const out=path.join(tmp,'z.docx'); await dl.saveAs(out);
  const raw=require('child_process').execFileSync('unzip',['-p',out]).toString('utf8');
  t('DOCX: žádný originál v souboru',!SECRETS.concat(['605 999','Petr Svoboda','Marie Svobodová']).some(s=>raw.includes(s)));
  const [z]=await Promise.all([p.waitForEvent('download',{timeout:300000}),p.setInputFiles('#anon-file',[path.join(F,'mixed.pdf'),long,path.join(F,'zaloba.docx')])]);
  const zp=path.join(tmp,'b.zip'); await z.saveAs(zp); const names=require('child_process').execFileSync('unzip',['-Z1',zp]).toString();
  t('hromadně: neúplné soubory mají -NEUPLNE',/dokument-01-NEUPLNE/.test(names)&&/dokument-02-NEUPLNE/.test(names)&&!/mixed|long|zaloba/.test(names),names);
  // přímý export PDF (jsPDF v prohlížeči): prázdný vstup, diakritika, více stran, žádný originál
  await p.fill('#input','');await p.waitForTimeout(400);await p.click('#pdf-dl');await p.waitForTimeout(400);
  t('PDF: prázdný vstup = srozumitelná hláška',/Není co uložit/.test(await p.textContent('#anon-fst')));
  let longTxt='';for(let i=1;i<=300;i++)longTxt+=`Odstavec ${i}: Kupující Jan Novák, RČ 800315/1234, zaplatí ${i*1000} Kč. Příliš žluťoučký kůň úpěl ďábelské ódy; ľĺŕôä „ok“.\n`;
  await p.fill('#input',longTxt);await p.waitForTimeout(900);
  const [pd]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#pdf-dl')]);const pp=path.join(tmp,'x.pdf');await pd.saveAs(pp);
  const ptxt=require('child_process').execFileSync('pdftotext',['-enc','UTF-8',pp,'-']).toString('utf8');
  const npages=(ptxt.match(/\f/g)||[]).length;
  t('PDF: více stran',npages>=5,'stran '+npages); t('PDF: diakritika čitelná',['žluťoučký','úpěl','ďábelské','ľĺŕôä','„ok“'].every(w=>ptxt.includes(w)));
  t('PDF: žádný originál',!/Novák|800315/.test(ptxt));
  t('lokální režim: 0 externích požadavků',ext.length===0,ext.join()); t('žádné JS chyby',errs.length===0,errs.join());
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
