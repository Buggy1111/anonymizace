"use strict";
/* extract-text.js — extrakce textu z nahraného souboru (TXT/PDF/DOCX), vše v prohlížeči.
   Sdíleno anonymizérem i toolkitem. Vyžaduje pdf.js a mammoth.js (js/vendor/, vlastní kopie). */
// pdf.js 5.x je ES modul (type="module" = deferred) → workerSrc nastavujeme líně
// až při prvním použití, ne při načtení tohoto (klasického) skriptu.
const PDF_WORKER="js/vendor/pdf.worker.min.mjs"; // vlastní kopie (ověřená proti cdnjs i npm), worker nejde chránit SRI

// Skládání textu z PDF podle skutečných pozic: mezera jen tam, kde v dokumentu opravdu je
// (mezera v textu nebo viditelná mezera mezi kousky), konec řádku podle hasEOL / nového řádku.
// Dřív se každý kousek spojoval mezerou → „Okresn í", „2 4 .0 9 .202 6", „jan @ firma.cz"
// a rozsekané údaje anonymizace nepoznala.
function joinPdfItems(items){
  let out="", prev=null;
  for(const it of items){
    const str=it.str||"";
    if(prev){
      const sameLine=Math.abs(it.transform[5]-prev.transform[5])<Math.max(2,Math.abs(prev.transform[3])*0.5);
      if(prev.hasEOL||!sameLine){ if(!/\s$/.test(out)) out+="\n"; }
      else{
        const fs=Math.abs(prev.transform[0])||Math.abs(prev.transform[3])||10;
        const gap=it.transform[4]-(prev.transform[4]+(prev.width||0));
        if(gap>fs*0.18 && !/\s$/.test(out) && !/^\s/.test(str)) out+=" ";
      }
    }
    out+=str; if(str||it.hasEOL) prev=it;
  }
  return out.replace(/[ \t]+\n/g,"\n").replace(/[ \t]{2,}/g," ");
}

// ── OCR (sken PDF, fotka dokumentu) — tesseract.js 7 hostovaný na vlastní doméně,
//    běží ve vašem prohlížeči (WebAssembly), nic se neodesílá. Načítá se líně, až když je potřeba.
const OCR_BASE="js/vendor/tesseract/";
const OCR_LANGS=["ces","slk","eng"];
const OCR_MAX_PAGES=20;
let ocrWorkerP=null;
function loadScriptOnce(src){
  return new Promise((res,rej)=>{
    if(document.querySelector(`script[data-src="${src}"]`)) return res();
    const s=document.createElement("script"); s.src=src; s.dataset.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error("OCR se nepodařilo načíst")); document.head.appendChild(s);
  });
}
async function ocrWorker(progress){
  if(!ocrWorkerP) ocrWorkerP=(async()=>{
    await loadScriptOnce(OCR_BASE+"tesseract.min.js");
    return Tesseract.createWorker(OCR_LANGS,1,{
      workerPath:OCR_BASE+"worker.min.js", corePath:OCR_BASE, langPath:OCR_BASE+"lang", gzip:true, workerBlobURL:false,
      logger:m=>{ if(progress&&m.status==="loading language traineddata") progress("Připravuji rozpoznávání textu…"); }
    });
  })();
  try{ return await ocrWorkerP; }catch(e){ ocrWorkerP=null; throw e; }
}
// Úprava obrázku před OCR: správná orientace z EXIF (fotky z mobilu), velikost ~2 400 px
// na delší straně (malé fotky zvětšit, obří zmenšit), šedá a roztažení kontrastu (1.–99. percentil).
async function ocrPrepare(source,rotate){
  const bmp=source instanceof HTMLCanvasElement?source:await createImageBitmap(source,{imageOrientation:"from-image"});
  const W=bmp.width,H=bmp.height,long=Math.max(W,H),k=Math.min(1.5,Math.max(0.35,2400/long));
  const w=Math.round(W*k),h=Math.round(H*k),sw=rotate%180?h:w,sh=rotate%180?w:h;
  const c=document.createElement("canvas");c.width=sw;c.height=sh;const g=c.getContext("2d",{willReadFrequently:true});
  g.imageSmoothingQuality="high";g.translate(sw/2,sh/2);g.rotate(rotate*Math.PI/180);g.drawImage(bmp,-w/2,-h/2,w,h);
  if(bmp.close)bmp.close();
  const img=g.getImageData(0,0,sw,sh),d=img.data,hist=new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){const y=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0;d[i]=y;hist[y]++;}
  const n=d.length/4;let lo=0,hi=255,acc=0;
  for(;lo<255&&(acc+=hist[lo])<n*0.01;lo++);acc=0;for(;hi>0&&(acc+=hist[hi])<n*0.01;hi--);
  // stránka s málo textem: 1. percentil je pořád bílá (lo≈hi) → roztažení by ji zčernalo; necháme jen šedou
  const span=hi-lo;
  for(let i=0;i<d.length;i+=4){const v=span>=48?Math.max(0,Math.min(255,(d[i]-lo)*255/span)):d[i];d[i]=d[i+1]=d[i+2]=v;}
  g.putImageData(img,0,0);return c;
}
async function ocrImage(source,progress,label){ return (await ocrRecognize(source,progress,label)).text; }
async function ocrRecognize(source,progress,label){
  const w=await ocrWorker(progress);
  if(progress) progress(label||"Rozpoznávám text…");
  let best=await w.recognize(await ocrPrepare(source,0));
  // nízká jistota u fotky → možná je otočená; zkusí 90°, 270° a 180° a vezme nejlepší výsledek
  if(!(source instanceof HTMLCanvasElement)&&best.data.confidence<45){
    for(const rot of [90,270,180]){
      if(progress) progress("Text je nejasný, zkouším fotku otočit…");
      const r=await w.recognize(await ocrPrepare(source,rot));
      if(r.data.confidence>best.data.confidence+8) best=r;
    }
  }
  return {text:(best.data&&best.data.text||"").replace(/[ \t]+\n/g,"\n").trim(), conf:Math.round(best.data&&best.data.confidence||0)};
}
// stránka PDF → canvas pro OCR; strop ~16 Mpx, ať velký formát (A3, plán) nevyčerpá paměť
async function renderPdfPage(pg){
  const v1=pg.getViewport({scale:1}), scale=Math.min(2.2,Math.sqrt(16e6/(v1.width*v1.height)));
  const vp=pg.getViewport({scale}); const c=document.createElement("canvas"); c.width=Math.ceil(vp.width); c.height=Math.ceil(vp.height);
  await pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise; return c;
}
const PAGE_TEXT_MIN=20;   // méně znaků textové vrstvy = stránka je (asi) sken → OCR
const OCR_WEAK=40;        // jistota OCR pod touto hranicí = špatně čitelná stránka

async function extractText(file,progress,info={}){
  const name=(file.name||"").toLowerCase();
  if(name.endsWith(".txt")||file.type==="text/plain") return await file.text();
  if(name.endsWith(".pdf")||file.type==="application/pdf"){
    if(!window.pdfjsLib) throw new Error("pdf.js se nenačetlo");
    if(!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER;
    const task=pdfjsLib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false});
    // PDF zamčené heslem (např. výpisy z banky, dokumenty z datové schránky) — heslo zůstane jen v prohlížeči
    task.onPassword=(update,reason)=>{
      const pw=window.prompt(reason===2?"Heslo nesedí. Zadejte heslo k PDF znovu:":"PDF je chráněné heslem. Zadejte heslo (zůstane jen ve vašem prohlížeči):");
      if(pw===null){task.destroy();return;} update(pw);
    };
    const pdf=await task.promise.catch(e=>{throw new Error(/password|destroy/i.test(e&&(e.name+e.message))?"PDF je chráněné heslem a heslo nebylo zadáno":e.message);});
    // Každá stránka zvlášť: s textovou vrstvou se čte přímo, bez ní (sken) přes OCR.
    // Kombinované PDF (text + naskenované přílohy) tak nic tiše nevynechá; co se přečíst
    // nepodaří, je v textu označené a info.incomplete=true.
    Object.assign(info,{pages:pdf.numPages,textPages:[],ocrPages:[],weakPages:[],failedPages:[],skippedPages:[]});
    const parts=[]; let ocrCount=0;
    for(let i=1;i<=pdf.numPages;i++){
      const pg=await pdf.getPage(i); const tc=await pg.getTextContent();
      const txt=joinPdfItems(tc.items); const chars=tc.items.reduce((n,it)=>n+(it.str||"").trim().length,0);
      if(chars>=PAGE_TEXT_MIN){parts.push(txt);info.textPages.push(i);continue;}
      if(ocrCount>=OCR_MAX_PAGES){parts.push(`[Strana ${i}: NEPŘEČTENO — limit OCR ${OCR_MAX_PAGES} stran]`);info.skippedPages.push(i);continue;}
      ocrCount++;
      try{
        const c=await renderPdfPage(pg);
        const r=await ocrRecognize(c,progress,`Rozpoznávám text ze skenu, strana ${i} z ${pdf.numPages}…`); c.width=c.height=0;
        if(!r.text.trim()){parts.push(`[Strana ${i}: NEPŘEČTENO — na skenu se nenašel žádný text]`);info.failedPages.push(i);continue;}
        parts.push(r.text); info.ocrPages.push(i); if(r.conf<OCR_WEAK) info.weakPages.push(i);
      }catch(e){parts.push(`[Strana ${i}: NEPŘEČTENO — ${e.message}]`);info.failedPages.push(i);}
    }
    info.incomplete=info.failedPages.length+info.skippedPages.length>0;
    return parts.join("\n\n").trim();
  }
  if(name.endsWith(".docx")){
    if(!window.mammoth) throw new Error("mammoth se nenačetlo");
    return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value.trim();
  }
  if(/\.(png|jpe?g|webp|bmp|gif)$/.test(name)||/^image\//.test(file.type)){
    const r=await ocrRecognize(file,progress,"Rozpoznávám text z obrázku…");
    Object.assign(info,{pages:1,ocrPages:[1],weakPages:r.conf<OCR_WEAK?[1]:[],failedPages:r.text?[]:[1],textPages:[],skippedPages:[]});
    info.incomplete=!r.text; return r.text;
  }
  throw new Error("nepodporovaný formát (TXT, PDF, DOCX nebo obrázek)");
}

// Lidský popis výsledku čtení souboru: kolik stránek, které přes OCR, které špatně čitelné
// a hlavně co se NEPŘEČETLO nebo neprošlo kvůli limitu. Vrací {text, incomplete}.
function describeExtract(name,fullLen,info,limit){
  const L=n=>n.toLocaleString("cs-CZ"), pg=a=>a.length>5?a.slice(0,5).join(", ")+"…":a.join(", ");
  let msg=`${name} načten (${L(Math.min(fullLen,limit))} znaků)`, incomplete=false;
  if(info.pages>1||(info.ocrPages&&info.ocrPages.length)){
    const parts=[`${info.pages} ${info.pages===1?"strana":info.pages<5?"strany":"stran"}`];
    if(info.ocrPages&&info.ocrPages.length) parts.push(info.ocrPages.length===info.pages?"vše přes OCR":`OCR: ${pg(info.ocrPages)}`);
    if(info.weakPages&&info.weakPages.length) parts.push(`špatně čitelné: ${pg(info.weakPages)} — zkontrolujte`);
    msg+=" · "+parts.join(" · ");
  }
  const bad=[...(info.failedPages||[]),...(info.skippedPages||[])].sort((a,b)=>a-b);
  if(bad.length){incomplete=true; msg+=` · NEÚPLNÉ: nepřečtené strany ${pg(bad)} (v textu označené „NEPŘEČTENO“)`;}
  if(fullLen>limit){incomplete=true; msg+=` · NEÚPLNÉ: dokument má ${L(fullLen)} znaků, zpracováno jen prvních ${L(limit)}`;}
  return {text:msg,incomplete};
}
