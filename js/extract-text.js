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
  const span=Math.max(1,hi-lo);
  for(let i=0;i<d.length;i+=4){const v=Math.max(0,Math.min(255,(d[i]-lo)*255/span));d[i]=d[i+1]=d[i+2]=v;}
  g.putImageData(img,0,0);return c;
}
async function ocrImage(source,progress,label){
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
  return (best.data&&best.data.text||"").replace(/[ \t]+\n/g,"\n").trim();
}
async function ocrPdf(pdf,progress){
  const n=Math.min(pdf.numPages,OCR_MAX_PAGES); let out="";
  for(let i=1;i<=n;i++){
    const pg=await pdf.getPage(i); const vp=pg.getViewport({scale:2.2});
    const c=document.createElement("canvas"); c.width=Math.ceil(vp.width); c.height=Math.ceil(vp.height);
    await pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;
    out+=await ocrImage(c,progress,`Rozpoznávám text ze skenu, strana ${i} z ${n}…`)+"\n\n";
    c.width=c.height=0;
  }
  if(pdf.numPages>OCR_MAX_PAGES) out+=`\n[… dalších ${pdf.numPages-OCR_MAX_PAGES} stran nepřečteno, limit ${OCR_MAX_PAGES} stran]`;
  return out.trim();
}

async function extractText(file,progress){
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
    let out="", textChars=0;
    for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const tc=await pg.getTextContent();
      out+=joinPdfItems(tc.items)+"\n"; textChars+=tc.items.reduce((n,it)=>n+(it.str||"").trim().length,0); }
    // sken = stránky jsou jen obrázky bez textové vrstvy → přečíst přes OCR
    if(textChars<20) return await ocrPdf(pdf,progress);
    return out.trim();
  }
  if(name.endsWith(".docx")){
    if(!window.mammoth) throw new Error("mammoth se nenačetlo");
    return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value.trim();
  }
  if(/\.(png|jpe?g|webp|bmp|gif)$/.test(name)||/^image\//.test(file.type)) return await ocrImage(file,progress,"Rozpoznávám text z obrázku…");
  throw new Error("nepodporovaný formát (TXT, PDF, DOCX nebo obrázek)");
}
