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

async function extractText(file){
  const name=(file.name||"").toLowerCase();
  if(name.endsWith(".txt")||file.type==="text/plain") return await file.text();
  if(name.endsWith(".pdf")||file.type==="application/pdf"){
    if(!window.pdfjsLib) throw new Error("pdf.js se nenačetlo");
    if(!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER;
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
    let out="", textChars=0;
    for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const tc=await pg.getTextContent();
      out+=joinPdfItems(tc.items)+"\n"; textChars+=tc.items.reduce((n,it)=>n+(it.str||"").trim().length,0); }
    // sken = stránky jsou jen obrázky, textová vrstva chybí → anonymizovat není co
    if(textChars<20) throw new Error("PDF je sken (jen obrázek, bez textu). Takový dokument zatím přečíst neumíme, vložte prosím text nebo PDF s textovou vrstvou.");
    return out.trim();
  }
  if(name.endsWith(".docx")){
    if(!window.mammoth) throw new Error("mammoth se nenačetlo");
    return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value.trim();
  }
  throw new Error("nepodporovaný formát (jen TXT, PDF, DOCX)");
}
