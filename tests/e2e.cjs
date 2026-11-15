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
  const own=new URL(BASE).origin; p.on('request',r=>{const u=r.url();if(!u.startsWith(own)&&!/^(blob:|data:)/.test(u))ext.push(u)}); p.on('pageerror',e=>errs.push(e.message));
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
  // obrázky a náhled → šedá plocha, popisek obrázku prohledán; vložený objekt → DOCX odmítnut
  st=await load(path.join(F,'images.docx'));
  const [di]=await Promise.all([p.waitForEvent('download'),p.click('#docx-dl')]); const oi=path.join(tmp,'i.docx'); await di.saveAs(oi);
  const cp=require('child_process'), gray=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4CQAA2wDaZNW9eAAAAABJRU5ErkJggg==','base64');
  t('DOCX: obrázek i náhled nahrazeny šedou plochou',['word/media/image1.png','docProps/thumbnail.jpeg'].every(n=>cp.execFileSync('unzip',['-p',oi,n]).equals(gray)));
  t('DOCX: náhled má typ obsahu PNG',/PartName="\/docProps\/thumbnail\.jpeg" ContentType="image\/png"/.test(cp.execFileSync('unzip',['-p',oi,'\\[Content_Types].xml']).toString()));
  t('DOCX: popisek obrázku bez jména',!/Dvořák/.test(cp.execFileSync('unzip',['-p',oi]).toString('utf8')));
  t('DOCX s obrázky jde otevřít',cp.spawnSync('python3',['-c','import docx,sys;docx.Document(sys.argv[1])',oi]).status===0);
  t('DOCX: hláška o nahrazených obrázcích',/Obrázky \(2\)/.test(await p.textContent('#anon-fst')),await p.textContent('#anon-fst'));
  st=await load(path.join(F,'bad','embedded.docx')); await p.click('#docx-dl'); await p.waitForTimeout(500);
  t('DOCX s vloženým objektem: odmítnut',/vložený objekt/.test(await p.textContent('#anon-fst')),await p.textContent('#anon-fst'));
  const [z]=await Promise.all([p.waitForEvent('download',{timeout:300000}),p.setInputFiles('#anon-file',[path.join(F,'mixed.pdf'),long,path.join(F,'zaloba.docx')])]);
  const zp=path.join(tmp,'b.zip'); await z.saveAs(zp); const names=require('child_process').execFileSync('unzip',['-Z1',zp]).toString();
  t('hromadně: PDF i TXT pro ne-Word soubory, Word zůstane DOCX',/dokument-01-NEUPLNE-anonymizovano\.pdf/.test(names)&&/dokument-02-NEUPLNE-anonymizovano\.pdf/.test(names)&&/dokument-03-anonymizovano\.docx/.test(names),names);
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
  // poškozené a podvržené soubory: srozumitelná chyba, žádný pád, žádné spojení ven, nic z /etc/passwd
  for(const [f,re] of [['truncated.pdf',/nepodařilo/],['fake.pdf',/nepodařilo/],['truncated.docx',/nepodařilo/],
                       ['bomb-body.docx',/zip bomba/],['xxe.docx',/nepodařilo/],['huge.png',/Mpx/]]){
    const st2=await load(path.join(F,'bad',f)); const v=await p.inputValue('#input');
    t('podvržený soubor '+f+': bezpečně odmítnut',re.test(st2)&&!/root:/.test(v),st2);
  }
  // firmy podle právní formy + ruční skrytí výběru (myš i dotyk), přednost před vypnutou skupinou
  await p.fill('#input','Dodavatel Baller sro dodá. Kontakt Pekárna U Lípy, PEKÁRNA U LÍPY, Klient Jan Novák.');await p.waitForTimeout(600);
  let o=await p.textContent('#output');
  t('firma podle právní formy → FIRMA, „Dodavatel“ zůstane',/Dodavatel FIRMA1/.test(o)&&!o.includes('Baller'),o);
  await p.evaluate(()=>{const t=document.getElementById('input');const i=t.value.indexOf('U Lípy');t.focus();t.setSelectionRange(i,i+6);});
  await p.dispatchEvent('#input','mouseup');await p.waitForTimeout(200);
  t('po výběru se ukáže „Skrýt výběr“',await p.isVisible('.hide-sel'));
  await p.click('.hide-sel');await p.waitForTimeout(400);o=await p.textContent('#output');
  t('ručně skryté všude a v obou zápisech',!/Lípy|LÍPY/.test(o)&&(o.match(/SKRYTO1/g)||[]).length===2,o);
  await p.click('#cats button:has-text("Osoby")');await p.waitForTimeout(300);
  await p.evaluate(()=>{const t=document.getElementById('input');const i=t.value.indexOf('Jan Novák');t.focus();t.setSelectionRange(i,i+9);});
  await p.dispatchEvent('#input','mouseup');await p.waitForTimeout(200);await p.click('.hide-sel');await p.waitForTimeout(400);
  o=await p.textContent('#output');t('ruční skrytí platí i při vypnuté skupině Osoby',!o.includes('Novák'),o);
  await p.click('#cats button:has-text("Osoby")');
  await p.click('#custom button >> nth=0');await p.waitForTimeout(300);
  t('křížek ručně skryté vrátí',(await p.textContent('#output')).includes('U Lípy'));
  // dotyk (mobil): výběr ve výstupu prstem
  const m=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await m.goto(BASE);await m.waitForTimeout(600);await m.fill('#input','Objednal Karel z firmy Kovo Lípa.');await m.waitForTimeout(500);
  await m.evaluate(()=>{const o=document.getElementById('output');const w=document.createTreeWalker(o,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.textContent.indexOf('Kovo Lípa');if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+9);const s=getSelection();s.removeAllRanges();s.addRange(r);break;}}});
  await m.dispatchEvent('#output','touchend');await m.waitForTimeout(600);
  t('mobil: po výběru prstem se ukáže „Skrýt výběr“',await m.isVisible('.hide-sel'));
  await m.tap('.hide-sel');await m.waitForTimeout(400);
  t('mobil: skryto',!(await m.textContent('#output')).includes('Kovo Lípa'));
  await m.close();
  // Vymazat vše + Vrátit
  await p.fill('#input','Jan Novák, RČ 800315/1234.');await p.fill('#ai-in','OSOBA1 ok');await p.waitForTimeout(400);
  await p.click('#clear-all');await p.waitForTimeout(300);
  t('Vymazat: vstup i odpověď AI prázdné',!(await p.inputValue('#input'))&&!(await p.inputValue('#ai-in')));
  await p.click('#clear-all');await p.waitForTimeout(300);
  t('Vrátit obnoví text',(await p.inputValue('#input')).includes('Jan Novák'));
  t('lokální režim: 0 externích požadavků',ext.length===0,ext.join()); t('žádné JS chyby',errs.length===0,errs.join());
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
