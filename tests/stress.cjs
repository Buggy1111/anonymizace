// tests/stress.cjs — zátěž: dokument těsně pod limitem 500 000 znaků se smyšlenými údaji rozesetými po celé délce.
// Měří čas do výsledku a hlídá úniky. Spuštění: BROWSER=chromium|webkit node tests/stress.cjs (server jako u e2e)
const pw=require('@playwright/test'); const BASE=process.env.BASE||'http://localhost:8765/anonymize.html';
const NAME=process.env.BROWSER||'chromium', LIMIT_MS=+(process.env.LIMIT_MS||20000);
(async()=>{
  const b=await pw[NAME].launch(); const p=await b.newPage({acceptDownloads:true}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE); await p.waitForTimeout(600);
  const block=i=>`Odstavec ${i}. Kupující Jan Novák, RČ 800315/1234, tel. 777 123 456, e-mail jan.novak@example.cz, účet 1234567890/0800, bytem Sokolovská 12, Praha. Výplňový text bez údajů pro délku.\n`;
  let txt='',i=0; while(txt.length<495000) txt+=block(++i);
  const t0=Date.now();
  await p.evaluate(v=>{const t=document.getElementById('input');t.value=v;t.dispatchEvent(new Event('input',{bubbles:true}));},txt);
  await p.waitForFunction(n=>{const o=document.getElementById('output').textContent;return o.includes('Odstavec '+n+'.')&&!o.includes('Novák');},i,{timeout:120000,polling:250});
  const ms=Date.now()-t0, out=await p.textContent('#output');
  const leaks=['Novák','800315','777 123','jan.novak','1234567890','Sokolovská'].filter(s=>out.includes(s));
  const t1=Date.now(); const [dl]=await Promise.all([p.waitForEvent('download',{timeout:180000}),p.click('#pdf-dl')]);
  const pdfMs=Date.now()-t1, pdfSize=require('fs').statSync(await dl.path()).size;
  console.log(`${NAME}: PDF export ${pdfMs} ms, ${(pdfSize/1048576).toFixed(1)} MB`);
  const heap=await p.evaluate(()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null);
  console.log(`${NAME}: ${txt.length.toLocaleString('cs-CZ')} znaků, ${i} odstavců → ${ms} ms${heap?`, heap ${heap} MB`:''}, úniky: ${leaks.join(',')||'0'}, chyby JS: ${errs.length}`);
  await b.close(); process.exit(leaks.length||errs.length||ms>LIMIT_MS?1:0);
})();
