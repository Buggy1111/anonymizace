"use strict";
/* anonymize-app.js — DOM vrstva stránky anonymizéru.
   Závisí na anonymize-engine.js (anonymize/fetchNER/…) a extract-text.js (extractText). */

const MAX_CHARS=500000; // limit dokumentu; delší se NEořízne potichu — výsledek je označen jako neúplný
const input=document.getElementById("input"), output=document.getElementById("output");
const tableEl=document.getElementById("table"), statsEl=document.getElementById("stats");
const repcount=document.getElementById("repcount"), incount=document.getElementById("incount");
const nerinfo=document.getElementById("nerinfo");
const custom=new Map();   // ručně skryté (malá písmena → původní zápis)
const customEl=document.getElementById("custom");
const ignEl=document.getElementById("ignored"), catsEl=document.getElementById("cats"), docxBtn=document.getElementById("docx-dl");

function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}
function span(cls,text){const s=document.createElement("span");if(cls)s.className=cls;s.textContent=text;return s;}

let lastAnon="", lastMap=new Map(), lastReps=[], lastDocx=null, lastIncomplete=false, lastName="";
// ── co skrývat: skupiny druhů (vypnutá skupina se vrátí do textu) + ručně vrácené falešné nálezy ──
const CATS=[
  ["Osoby",["OSOBA"]],["Firmy a úřady",["FIRMA","INSTITUCE"]],["Adresy",["MESTO","ULICE","CP","PSC"]],
  ["Kontakty",["TELEFON","EMAIL","URL"]],["Identifikátory",["RC","ICO","DIC","COP","PAS","RP","ICP","DSCHRANKA","SPZ","VIN","SSN","TOKEN"]],
  ["Peníze a účty",["UCET","IBAN","KARTA","CASTKA","KRYPTO"]],["Data",["DATUM"]],["Spisy a čísla",["SPZN","DOKID"]],["Zdraví",["MKN"]]];
const offTypes=new Set(), ignored=new Map();   // malá písmena → původní zápis
try{(JSON.parse(localStorage.getItem("anon-off")||"[]")).forEach(t=>offTypes.add(t));}catch(_){}
function anon(text,ents){
  const r=anonymize(text,ents,[...custom.values()]);
  const keep=[], back=new Map();
  for(const x of r.replacements){
    // ručně skryté má přednost před vypnutou skupinou i dřívějším „vrátit“ (nikdy se neodkryje samo)
    if(!x.manual&&(offTypes.has(x.type)||ignored.has(x.original.toLowerCase()))) back.set(x.placeholder,x.original); else keep.push(x);
  }
  if(!back.size) return r;
  return {anonymized:r.anonymized.replace(PH_RE,m=>back.has(m)?back.get(m):m),replacements:keep,reverted:[...back].map(([p,o])=>({placeholder:p,original:o}))};
}
// zpětné doplnění: značky v odpovědi AI → původní údaje (jen v paměti stránky, nikam se neposílá)
const aiIn=document.getElementById("ai-in"), aiOut=document.getElementById("ai-out");
function reveal(){
  clear(aiOut);
  const t=aiIn.value;
  if(!t.trim()){aiOut.appendChild(span("placeholder","Doplněná odpověď se zobrazí tady."));return;}
  aiOut.textContent=t.replace(PH_RE,m=>lastMap.has(m)?lastMap.get(m):m);
}
aiIn.addEventListener("input",reveal);
document.getElementById("ai-copy").addEventListener("click",function(){
  navigator.clipboard.writeText(aiOut.textContent).then(()=>{this.textContent="Zkopírováno";setTimeout(()=>this.textContent="Kopírovat",1400);},()=>{});
});
// jeden obří textový uzel (stovky tisíc znaků bez značky) shodí vykreslení v Chromiu → po kouscích
function addText(el,t){for(let i=0;i<t.length;i+=8000) el.appendChild(document.createTextNode(t.slice(i,i+8000)));}
function render(anonymized,replacements){
  lastAnon=anonymized;
  lastMap=new Map(replacements.map(x=>[x.placeholder,x.original])); lastReps=replacements; reveal(); docxBtn.hidden=!lastDocx; document.getElementById("keep-img-wrap").hidden=!lastDocx;

  // výstup s zvýrazněnými placeholdery — čisté DOM uzly (matchAll, žádný innerHTML)
  clear(output);
  if(!anonymized){output.appendChild(span("placeholder","Výsledek se zobrazí tady."));}
  else{
    let last=0;
    for(const m of anonymized.matchAll(PH_RE)){
      if(m.index>last) addText(output,anonymized.slice(last,m.index));
      const tok=span("ph-tok t-"+m[0].replace(/\d+$/,""),m[0]);
      if(lastMap.has(m[0])){tok.tabIndex=0;tok.setAttribute("role","button");tok.title="Není to osobní údaj? Kliknutím vrátíte do textu.";tok.dataset.ph=m[0];}
      output.appendChild(tok);
      last=m.index+m[0].length;
    }
    if(last<anonymized.length) addText(output,anonymized.slice(last));
  }

  // statistiky
  clear(statsEl);
  const byType={}; replacements.forEach(x=>{if(!x.variant)byType[x.type]=(byType[x.type]||0)+1;});
  Object.keys(byType).forEach(t=>{
    const s=span("stat","");const b=document.createElement("b");b.textContent=byType[t];
    s.appendChild(b);s.appendChild(document.createTextNode(" "+(TYPE_LABELS[t]||t)));statsEl.appendChild(s);
  });
  if(replacements.length){
    const s=span("stat total","");
    const b=document.createElement("b");b.textContent=replacements.filter(x=>!x.variant).length;
    s.appendChild(b);s.appendChild(document.createTextNode(" celkem"));statsEl.appendChild(s);
  }

  // tabulka
  repcount.textContent=replacements.filter(x=>!x.variant).length;
  clear(tableEl);
  if(!replacements.length){tableEl.appendChild(span("empty","Zatím nic k nahrazení. Vložte text nebo zkuste ukázku."));return;}
  const table=document.createElement("table");
  const thead=document.createElement("thead");const htr=document.createElement("tr");
  ["Originál","Značka","Druh"].forEach(h=>{const th=document.createElement("th");th.textContent=h;htr.appendChild(th);});
  thead.appendChild(htr);table.appendChild(thead);
  const tbody=document.createElement("tbody");
  const seen=new Set();
  replacements.forEach(x=>{
    if(seen.has(x.placeholder))return; seen.add(x.placeholder);
    const tr=document.createElement("tr");
    const td1=document.createElement("td");td1.className="orig";td1.textContent=x.original;
    const td2=document.createElement("td");td2.appendChild(span("ph-tok t-"+x.type,x.placeholder));
    const td3=document.createElement("td");td3.appendChild(span("badge",x.label||x.type));
    tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tbody.appendChild(tr);
  });
  table.appendChild(tbody);tableEl.appendChild(table);
}
function renderCustom(){
  clear(customEl); if(!custom.size){customEl.hidden=true;return;} customEl.hidden=false;
  customEl.appendChild(span("ign-h","Ručně skryto:"));
  custom.forEach((o,key)=>{const b=document.createElement("button");b.type="button";b.className="chip ign";b.textContent=o+" ✕";b.title="Vrátit do textu";
    b.onclick=()=>{custom.delete(key);renderCustom();rerender();};customEl.appendChild(b);});
}
// ── ruční skrytí: výběr myší (nebo prstem) ve vstupu i výstupu → tlačítko „Skrýt“ ──
const hideBtn=document.createElement("button");
hideBtn.type="button";hideBtn.className="hide-sel";hideBtn.textContent="Skrýt výběr";hideBtn.hidden=true;
document.body.appendChild(hideBtn);
let pendingSel="";
function selectedText(){
  if(document.activeElement===input&&input.selectionEnd>input.selectionStart)
    return input.value.slice(input.selectionStart,input.selectionEnd);
  const sel=window.getSelection();
  if(sel&&sel.rangeCount&&output.contains(sel.anchorNode)&&output.contains(sel.focusNode))
    return sel.toString().replace(new RegExp(PH_RE.source,"g"),t=>lastMap.get(t)||t);  // značky zpět na originál
  return "";
}
function showHide(ev){
  const t=selectedText().replace(/\s+/g," ").trim();
  if(t.length<2||t.length>120||!/[\p{L}\p{N}]/u.test(t)||custom.has(t.toLowerCase())){hideBtn.hidden=true;return;}
  pendingSel=t;
  // Dotyk: systémová nabídka (Kopírovat, Vyhledat…) bývá u výběru → tlačítko dáme NAD slovo
  // a dál od něj; na počítači pod výběr. Když nahoře není místo, jde pod.
  const touch=matchMedia("(pointer: coarse)").matches;
  let x=ev&&ev.clientX, top=ev&&ev.clientY, bottom=top;
  const sel=window.getSelection();
  if(sel&&sel.rangeCount&&output.contains(sel.anchorNode)){const r=sel.getRangeAt(0).getBoundingClientRect();x=r.left+r.width/2;top=r.top;bottom=r.bottom;}
  if(x==null){const r=input.getBoundingClientRect();x=r.left+r.width/2;top=r.top+40;bottom=top;}
  const h=40, gap=touch?58:10;
  let y=touch?top-gap-h:bottom+gap;
  if(touch&&y<56) y=bottom+gap+40;            // nahoře málo místa (lišta) → pod výběr, pod nabídku
  hideBtn.style.left=Math.max(8,Math.min(innerWidth-140,x-60))+"px";
  hideBtn.style.top=Math.max(56,Math.min(innerHeight-48,y))+"px";
  hideBtn.hidden=false;
}
for(const el of [input,output]){
  el.addEventListener("mouseup",e=>setTimeout(()=>showHide(e),0));
  el.addEventListener("touchend",()=>setTimeout(()=>showHide(null),350));
  el.addEventListener("keyup",e=>{if(e.shiftKey)showHide(null);});
}
document.addEventListener("selectionchange",()=>{if(!selectedText())hideBtn.hidden=true;});
window.addEventListener("scroll",()=>{hideBtn.hidden=true;},{passive:true});
hideBtn.addEventListener("mousedown",e=>e.preventDefault());   // nezrušit výběr před kliknutím
hideBtn.addEventListener("click",()=>{
  if(!pendingSel)return;
  custom.set(pendingSel.toLowerCase(),pendingSel); ignored.delete(pendingSel.toLowerCase()); renderIgnored(); hideBtn.hidden=true;
  const s=window.getSelection(); if(s)s.removeAllRanges();
  renderCustom(); rerender();
});
function renderIgnored(){
  clear(ignEl); if(!ignored.size){ignEl.hidden=true;return;} ignEl.hidden=false;
  ignEl.appendChild(span("ign-h","Vráceno do textu:"));
  ignored.forEach((o,key)=>{const b=document.createElement("button");b.type="button";b.className="chip ign";b.textContent=o+" ✕";b.title="Znovu skrýt";
    b.onclick=()=>{ignored.delete(key);renderIgnored();rerender();};ignEl.appendChild(b);});
}
function rerender(){
  if(currentMode()==="ner"&&lastEnts){const r=anon(input.value,lastEnts);render(r.anonymized,r.replacements);} else run();
}

const EXAMPLES={
  "Právní spis":"Žalobce Jan Novák, nar. 15.3.1980, rodné číslo 800315/1234, bytem Sokolovská 12, Praha, podal dne 3.2.2026 ke Krajskému soudu návrh na zaplacení 85 000 Kč proti žalované Marii Svobodové (IČO 12345679, DIČ CZ12345679). Kontakt: jan.novak@email.cz, tel. 777 123 456. Spis sp. zn. 25 C 145/2026. Účet 1234567890/0800.",
  "Faktura":"Odběratel: Petr Dvořák, Husova 5, Ostrava, PSČ 702 00. IČO 87654326, DIČ CZ87654326. Splatnost 30.4.2026. Platba na účet 19-2000145399/0800, IBAN CZ65 0800 0000 1920 0014 5399. Dotazy: petr.dvorak@firma.cz, 605 999 111 nebo https://faktury.firma.cz.",
  "E-mail":"Dobrý den, jmenuji se Eva Černá, bydlím v Brně. Moje číslo je 720 555 333 a email eva.cerna@seznam.cz. Narozena 22.11.1990, rodné číslo 905322/4567.",
  "Lékařská zpráva":"Pacientka Marie Nováková, nar. 14.6.1975, rodné číslo 755614/1234, bytem Tyršova 8, Olomouc, byla přijata 12.5.2026 na interní oddělení s diagnózou arteriální hypertenze. Ošetřující lékař MUDr. Petr Svoboda, kontakt petr.svoboda@nemocnice.cz, tel. 585 111 222. Doporučena kontrola za 14 dní."
};
// ── režim (lokální regex / plný NER) + debounce ──
let nerTimer=null, nerSeq=0, lastEnts=null, localTimer=null;
function currentMode(){const el=document.querySelector('input[name="mode"]:checked');return el?el.value:"local";}
// auto-grow: vstupní pole roste s obsahem (jako výstup), uživatel nemusí scrolovat
function autoGrow(){input.style.overflowY="hidden";input.style.height="auto";input.style.height=Math.max(input.scrollHeight,300)+"px";}
function run(){
  if(input.value.length>MAX_CHARS) input.value=input.value.slice(0,MAX_CHARS); // pojistka k maxlength (review #18)
  const text=input.value;
  autoGrow();
  incount.textContent=text.length.toLocaleString("cs-CZ")+" / "+MAX_CHARS.toLocaleString("cs-CZ")+" znaků";
  if(currentMode()==="local"){
    nerinfo.textContent="";
    // dlouhý text: nepřepočítávat při každém stisku klávesy
    clearTimeout(localTimer);
    if(text.length>30000){localTimer=setTimeout(()=>{const r=anon(input.value);render(r.anonymized,r.replacements);},250);return;}
    const r=anon(text); render(r.anonymized,r.replacements);
    return;
  }
  // NER mód — počkej na ÚFAL, debounce ať netřískáme API při psaní
  const seq=++nerSeq;
  nerinfo.textContent="Zpracovává server LINDAT…";
  clearTimeout(nerTimer);
  nerTimer=setTimeout(async function(){
    if(!text.trim()){const r=anon(text);render(r.anonymized,r.replacements);nerinfo.textContent="";return;}
    try{
      const ents=await fetchNER(text);
      if(seq!==nerSeq) return;            // zastaralý výsledek, zahoď
      lastEnts=ents; const r=anon(text,ents); render(r.anonymized,r.replacements);
      nerinfo.textContent="Přesný režim: jména a firmy rozpoznal NameTag (ÚFAL). Text byl odeslán na server LINDAT.";
    }catch(e){
      if(seq!==nerSeq) return;
      const r=anon(text); render(r.anonymized,r.replacements);
      nerinfo.textContent="Server LINDAT teď neodpovídá ("+e.message+"). Použil se lokální režim.";
    }
  },550);
}

const exWrap=document.getElementById("examples");
Object.keys(EXAMPLES).forEach(name=>{
  const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=name;b.setAttribute("aria-pressed",String(name==="Právní spis"));
  b.onclick=function(){input.value=EXAMPLES[name];lastIncomplete=false;lastDocx=null;lastName="";document.getElementById("anon-fst").textContent="";run();exWrap.querySelectorAll(".chip").forEach(c=>c.setAttribute("aria-pressed",String(c===b)));};exWrap.appendChild(b);
});
document.getElementById("copy").onclick=function(){
  const b=document.getElementById("copy");
  const done=t=>{b.textContent=t;setTimeout(function(){b.textContent="Kopírovat";},1600);};
  if(navigator.clipboard) navigator.clipboard.writeText(lastAnon).then(()=>done(lastIncomplete?"Zkopírováno — POZOR, dokument je NEÚPLNÝ":"Zkopírováno"),()=>done("Kopírování se nepovedlo"));
  else done("Kopírování se nepovedlo");
};
input.addEventListener("input",()=>{if(!input.value){lastIncomplete=false;lastName="";lastDocx=null;custom.clear();renderCustom();}run();});
document.querySelectorAll('input[name="mode"]').forEach(r=>r.addEventListener("change",run));
// klik/Enter na značku ve výstupu = falešný nález → vrátit
function unredact(e){const t=e.target.closest&&e.target.closest(".ph-tok[data-ph]");if(!t)return;
  if(e.type==="keydown"&&e.key!=="Enter"&&e.key!==" ")return; e.preventDefault();
  const o=lastMap.get(t.dataset.ph); if(o){ignored.set(o.toLowerCase(),o);renderIgnored();rerender();}}
output.addEventListener("click",unredact); output.addEventListener("keydown",unredact);
// přepínače skupin
catsEl.appendChild(span("cats-h","Skrývat:"));
CATS.forEach(([name,types])=>{const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=name;
  b.setAttribute("aria-pressed",String(!types.every(t=>offTypes.has(t))));
  b.onclick=()=>{const on=b.getAttribute("aria-pressed")==="true";types.forEach(t=>on?offTypes.add(t):offTypes.delete(t));b.setAttribute("aria-pressed",String(!on));
    try{localStorage.setItem("anon-off",JSON.stringify([...offTypes]));}catch(_){} rerender();};
  catsEl.appendChild(b);});
input.addEventListener("input",()=>{if(lastDocx&&!lastDocx.edited){lastDocx.edited=true;docxBtn.title="Text jste upravili; DOCX se anonymizuje podle aktuální tabulky náhrad.";}});
docxBtn.onclick=async function(){
  if(!lastDocx)return; const b=this;
  if(lastDocx.truncated){const f=document.getElementById("anon-fst");f.className="fst err";f.textContent="Dokument je delší než "+MAX_CHARS.toLocaleString("cs-CZ")+" znaků, část by se neprohledala. DOCX proto nestáhnu, rozdělte ho prosím na menší části.";return;} b.disabled=true; const fst=document.getElementById("anon-fst");
  try{
    const keep=document.getElementById("keep-img").checked;
    const {blob,count,images}=await anonymizeDocx(lastDocx.buf,lastReps,{keepImages:keep});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="anonymizovany-dokument.docx";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    fst.className="fst ok";fst.textContent="Staženo: "+count+" náhrad ve Wordu, formátování zachováno, autor odstraněn z vlastností."+(images?(keep?" Obrázky ("+images+") jsou ponechané a NEPROHLEDANÉ — zkontrolujte je.":" Obrázky ("+images+") jsme nahradili šedou plochou, mohly obsahovat osobní údaje."):"");
  }catch(e){fst.className="fst err";fst.textContent="DOCX se nepodařilo vytvořit: "+e.message;}
  b.disabled=false;
};
input.value=EXAMPLES["Právní spis"];
run();

// ── upload souboru (PDF/Word/TXT) → vyplní vstup ──
(function(){
  const fi=document.getElementById("anon-file"), fst=document.getElementById("anon-fst");
  if(!fi) return;
  fi.addEventListener("change",async function(){
    if(fi.files&&fi.files.length>1){const list=[...fi.files];fi.value="";return batch(list,fst);}
    const f=fi.files&&fi.files[0]; if(!f) return;
    fst.className="fst"; fst.textContent="Načítám "+f.name+"…";
    try{
      if(f.size>20*1024*1024) throw new Error("soubor je moc velký (max 20 MB)");
      const info={}; let txt=await extractText(f,msg=>{fst.className="fst";fst.textContent=msg;},info);
      lastDocx=/\.docx$/i.test(f.name)?{name:f.name,buf:await f.arrayBuffer()}:null;
      if(lastDocx){const extra=await docxExtraText(lastDocx.buf); if(extra) txt="— Záhlaví, zápatí, komentáře, odkazy a revize —\n"+extra+"\n— Text dokumentu —\n"+txt;
        // oříznutý text = část Wordu by se neprohledala → DOCX nenabízet
        if(txt.length>MAX_CHARS) lastDocx.truncated=true;}
      input.value=txt.slice(0,MAX_CHARS); run();
      const d=describeExtract(f.name,txt.length,info,MAX_CHARS);
      lastIncomplete=d.incomplete; lastName=f.name; fst.dataset.last=describeExtract("Dokument",txt.length,info,MAX_CHARS).text; fst.className=d.incomplete?"fst err":"fst ok"; fst.textContent=d.text;
    }catch(e){ fst.className="fst err"; fst.textContent="Soubor se nepodařilo načíst: "+e.message; }
    fi.value="";
  });
})();

// ── hromadně: víc souborů najednou → ZIP s anonymizovanými soubory (vše v prohlížeči) ──
const BATCH_MAX=MAX_CHARS;   // znaků na soubor; delší se zpracuje jen zčásti a je označen NEÚPLNÉ
async function batch(files,fst){
  const enc=new TextEncoder(), entries=[], log=[];
  const add=(name,bytes)=>entries.push({name,nameBytes:enc.encode(name),flags:0x0800,method:0,crc:crc32(bytes),csize:bytes.length,usize:bytes.length,data:bytes});
  const used=new Set(), uniq=n=>{let x=n,i=2;while(used.has(x))x=n.replace(/(\.[^.]+)$/,"-"+(i++)+"$1");used.add(x);return x;};
  for(let k=0;k<files.length;k++){
    const f=files[k], ext=(f.name.match(/\.([a-z0-9]{1,5})$/i)||["",""])[1].toLowerCase(), base="dokument-"+String(k+1).padStart(2,"0");
    fst.className="fst"; fst.textContent=`Zpracovávám ${k+1} z ${files.length}: ${f.name}…`;
    try{
      if(f.size>20*1024*1024) throw new Error("větší než 20 MB");
      const info={}; let txt=await extractText(f,msg=>{fst.textContent=`${k+1} z ${files.length}: ${msg}`;},info);
      const isDocx=/\.docx$/i.test(f.name), buf=isDocx?await f.arrayBuffer():null;
      if(isDocx){const extra=await docxExtraText(buf); if(extra) txt=extra+"\n"+txt;}
      const d=describeExtract(`${base} (${ext||"soubor"})`,txt.length,info,BATCH_MAX);   // původní název souboru do ZIPu nedáváme
      if(isDocx&&d.incomplete) throw new Error("Word je delší než "+BATCH_MAX.toLocaleString("cs-CZ")+" znaků — neúplný DOCX nevydám");
      const r=anon(txt.slice(0,BATCH_MAX));
      const tag=d.incomplete?"-NEUPLNE":"";
      if(isDocx){const {blob}=await anonymizeDocx(buf,r.replacements);add(uniq(base+"-anonymizovano.docx"),new Uint8Array(await blob.arrayBuffer()));}
      else{
        add(uniq(base+tag+"-anonymizovano.txt"),enc.encode((d.incomplete?"!!! NEÚPLNÉ — "+d.text+"\n\n":"")+r.anonymized));
        if(r.anonymized.trim()){
          try{const pdf=await buildPdf(r.anonymized,r.replacements,d.incomplete,d.text);add(uniq(base+tag+"-anonymizovano.pdf"),new Uint8Array(pdf.output("arraybuffer")));}
          catch(e){d.text+=" · PDF se nepodařilo vytvořit ("+e.message+"), je jen .txt";}
        }
      }
      log.push(`${d.incomplete?"NEÚPLNÉ":"OK     "} ${d.text} — ${r.replacements.length} náhrad`);
    }catch(e){log.push(`CHYBA  ${base} (${ext||"soubor"}): ${e.message} — soubor není v ZIPu`);}
  }
  add("souhrn.txt",enc.encode("Anonymizace — https://anonymizace.js.org (zpracováno ve vašem prohlížeči)\n"+
    "Značky (OSOBA1, RC1…) se číslují v každém souboru zvlášť. Výsledek před sdílením zkontrolujte.\n"+
    "Soubory jsou očíslované v pořadí, v jakém jste je vybrali (původní názvy mohou obsahovat jména, proto se nepoužívají).\n"+
    "PDF, text i fotky mají formátované PDF a čistý .txt na kopírování; Word zůstává Wordem s původním formátováním.\n\n"+log.join("\n")+"\n"));
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([zipEntries(entries)],{type:"application/zip"}));a.download="anonymizovano.zip";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  const bad=log.filter(l=>l.startsWith("CHYBA")).length, part=log.filter(l=>l.startsWith("NEÚPLNÉ")).length;
  fst.className=bad||part?"fst err":"fst ok"; fst.textContent=`Staženo anonymizovano.zip: ${files.length-bad} z ${files.length} souborů`+(bad?`, ${bad} se nepodařilo`:"")+(part?`, ${part} NEÚPLNÉ`:"")+(bad||part?" (viz souhrn.txt)":"")+".";
}
// ── stáhnout PDF: generuje se v prohlížeči (jsPDF + písmo Inter s českou a slovenskou diakritikou,
//    obojí na vlastní doméně), obsahuje jen anonymizovaný text. Knihovna se načte až při kliknutí.
async function fetchB64(url){const b=new Uint8Array(await (await fetch(url)).arrayBuffer());let s="";for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);}
let pdfFonts=null;
// Sestaví hezké PDF z anonymizovaného textu (stejné pro jednotlivé stažení i hromadný ZIP).
async function buildPdf(lastAnon,lastReps,lastIncomplete,incompleteMsg){
    await loadScriptOnce("js/vendor/jspdf/jspdf.umd.min.js");
    const {jsPDF}=window.jspdf, doc=new jsPDF({unit:"mm",format:"a4",compress:true});
    pdfFonts=pdfFonts||await Promise.all([fetchB64("fonts/pdf/inter-cz-400.ttf"),fetchB64("fonts/pdf/inter-cz-700.ttf")]);
    const [r,b]=pdfFonts;
    doc.addFileToVFS("Inter-400.ttf",r);doc.addFont("Inter-400.ttf","Inter","normal");
    doc.addFileToVFS("Inter-700.ttf",b);doc.addFont("Inter-700.ttf","Inter","bold");
    doc.setProperties({title:"Anonymizovaný dokument",creator:"anonymizace.js.org",author:""});
    // vzhled jako web: Apple šedé, černé štítky značek, jemné linky
    const INK=[29,29,31], MUT=[134,134,139], LINE=[226,226,231], SOFT=[245,245,247], RED=[215,0,21];
    const PW=210,PH=297,M=22,W=PW-2*M,TOP=30,BOT=PH-20,FS=10.5,LH=6.1;
    const col=c=>doc.setTextColor(c[0],c[1],c[2]);
    const header=()=>{
      doc.setFillColor(...INK);doc.roundedRect(M,12,5.2,5.2,1.3,1.3,"F");          // značka webu
      doc.setFillColor(255,255,255);doc.rect(M+1.3,14.1,2.6,0.55,"F");doc.rect(M+1.3,15.2,1.8,0.55,"F");
      doc.setFont("Inter","bold");doc.setFontSize(10);col(INK);doc.text("Anonymizace",M+7.2,16.2);
      doc.setFont("Inter","normal");doc.setFontSize(8.5);col(MUT);doc.text(new Date().toLocaleDateString("cs-CZ"),PW-M,16.2,{align:"right"});
      doc.setDrawColor(...LINE);doc.setLineWidth(0.2);doc.line(M,21,PW-M,21);
    };
    header(); let y=TOP+8;
    // titulek a souhrn
    doc.setFont("Inter","bold");doc.setFontSize(24);col(INK);doc.text("Anonymizovaný dokument",M,y);y+=8;
    const types={};lastReps.forEach(x=>types[x.type]=(types[x.type]||0)+1);
    doc.setFont("Inter","normal");doc.setFontSize(10);col(MUT);
    doc.text(`${lastReps.length} ${lastReps.length===1?"náhrada":lastReps.length<5&&lastReps.length>0?"náhrady":"náhrad"} · zpracováno ve vašem prohlížeči, nic se neodeslalo`,M,y);y+=7;
    // štítky s počty podle druhu
    let x=M; doc.setFontSize(8.5);
    for(const [t,n] of Object.entries(types)){
      const lab=`${n} × ${TYPE_LABELS[t]||t}`, w=doc.getTextWidth(lab)+6;
      if(x+w>PW-M){x=M;y+=7.5;}
      doc.setFillColor(...SOFT);doc.roundedRect(x,y-4.3,w,6.2,3.1,3.1,"F");col(INK);doc.text(lab,x+3,y);x+=w+2.2;
    }
    y+=Object.keys(types).length?9:2;
    if(lastIncomplete){
      const msg=doc.splitTextToSize("NEÚPLNÉ — "+(incompleteMsg||"část dokumentu nebyla zpracována"),W-10);
      const h=msg.length*4.6+6; doc.setFillColor(255,241,242);doc.roundedRect(M,y-4,W,h,2.5,2.5,"F");
      doc.setFont("Inter","bold");doc.setFontSize(9);col(RED);msg.forEach((l,k)=>doc.text(l,M+5,y+1.6+k*4.6));y+=h+4;
    }
    doc.setDrawColor(...LINE);doc.line(M,y,PW-M,y);y+=9;
    // tělo: struktura dokumentu (nadpisy, seznamy, odstavce) + značky jako tmavé štítky
    const PHR=new RegExp(PH_RE.source,"g"), PH1=new RegExp(PH_RE.source), PH0=new RegExp("^(?:"+PH_RE.source+")");
    const newPage=()=>{doc.addPage();header();y=TOP;};
    // 1) bloky: řádky rozdělené uprostřed věty (typické pro text z PDF) se spojí zpět
    const isHeading=l=>{const t=l.trim(),letters=t.replace(/[^\p{L}]/gu,"");
      if(!t||t.length>80||/[,;]$/.test(t)) return false;
      if(/^(Článek|Čl\.|Část|Hlava|Oddíl|Díl|Příloha)\s+[\dIVXLC]/i.test(t)) return true;
      if(/^[IVXLC]+\.?$/.test(t)||/^\d+(\.\d+)*\.?\s+\p{Lu}{2}/u.test(t)) return true;
      return letters.length>=4&&letters===letters.toUpperCase()&&!PH1.test(t);};
    const LIST=/^\s*([-•–*·]|\d{1,2}[.)]|[a-zA-Z][)]|[IVX]+\))\s+/;
    const blocks=[];
    for(const raw of lastAnon.replace(/\t/g,"    ").split("\n")){
      const l=raw.replace(/\s+$/,""), t=l.trim(), prev=blocks[blocks.length-1];
      if(!t){if(prev&&prev.k!=="gap")blocks.push({k:"gap"});continue;}
      if(isHeading(t)){blocks.push({k:"h",t});continue;}
      // krátký řádek hned pod nadpisem článku = podnadpis („Článek II.“ → „Předmět smlouvy“)
      if(prev&&prev.k==="h"&&t.length<=60&&!/[.,;:]$/.test(t)&&/^\p{Lu}/u.test(t)&&!LIST.test(t)){blocks.push({k:"sub",t});continue;}
      const m=t.match(LIST);
      if(m){blocks.push({k:"li",mark:m[1],t:t.slice(m[0].length)});continue;}
      // pokračování věty z předchozího řádku (malé písmeno, číslo nebo značka na začátku)
      if(prev&&(prev.k==="p"||prev.k==="li")&&!/[.!?:;)"“]$/.test(prev.t)&&(/^[\p{Ll}\d(„"]/u.test(t)||(PH0.test(t)&&prev.t.length>50))){prev.t+=" "+t;continue;}
      blocks.push({k:"p",t});
    }
    // 2) sazba řádku s tokeny (slova + štítky), zalamování na šířku a odsazení
    const runText=(txt,x0,fs,bold,color=INK)=>{
      // bez spread operátoru — dlouhý odstavec (statisíce slov) by přetekl zásobník
      const parts=[];let last=0;
      const words=str=>{for(const t of str.split(/(\s+)/)) if(t) parts.push({t});};
      for(const m of txt.matchAll(PHR)){if(m.index>last)words(txt.slice(last,m.index));parts.push({t:m[0],ph:true});last=m.index+m[0].length;}
      if(last<txt.length)words(txt.slice(last));
      const lh=fs*0.58; let lx=x0; if(y>BOT-lh)newPage();
      for(const p of parts){
        doc.setFont("Inter",p.ph||bold?"bold":"normal");doc.setFontSize(p.ph?fs*0.78:fs);
        const sp=!p.ph&&/^\s+$/.test(p.t), w=doc.getTextWidth(sp?" ":p.t)+(p.ph?3.2:0);
        if(sp){if(lx>x0)lx+=w;continue;}
        if(lx+w>PW-M&&lx>x0){y+=lh;lx=x0;if(y>BOT)newPage();}
        if(w>PW-M-x0&&!p.ph){for(const l of doc.splitTextToSize(p.t,PW-M-x0)){col(color);doc.text(l,x0,y);y+=lh;if(y>BOT)newPage();}lx=x0;continue;}
        if(p.ph){doc.setFillColor(...INK);doc.roundedRect(lx,y-fs*0.325,w,fs*0.44,1.1,1.1,"F");doc.setTextColor(255,255,255);doc.text(p.t,lx+1.6,y-0.15);}
        else{col(color);doc.text(p.t,lx,y);}
        lx+=w;
      }
      return lh;
    };
    // 3) vykreslení bloků
    let prevK="";
    for(const bl of blocks){
      if(bl.k==="gap"){y+=2.2;prevK="gap";continue;}
      if(bl.k==="h"){ if(prevK)y+=4.5; if(y>BOT-18)newPage(); {const h=runText(bl.t,M,prevK?12.5:15,true);y+=h+2.6;} prevK="h"; continue; }
      if(bl.k==="sub"){ y-=0.6; {const h=runText(bl.t,M,10.5,true,MUT);y+=h+2.8;} prevK="sub"; continue; }
      if(bl.k==="li"){ if(y>BOT-LH)newPage();
        const mk=/^[-•–*·]$/.test(bl.mark)?"•":bl.mark;
        doc.setFont("Inter",mk==="•"?"normal":"bold");doc.setFontSize(FS);col(MUT);doc.text(mk,M+1.5,y);
        {const h=runText(bl.t,M+8,FS,false);y+=h+1.6;} prevK="li"; continue; }
      if(prevK==="li")y+=1.8;
      {const h=runText(bl.t,M,FS,false);y+=h+3.2;} prevK="p";
    }
    // patička na každé straně
    const n=doc.getNumberOfPages();
    for(let i=1;i<=n;i++){doc.setPage(i);doc.setDrawColor(...LINE);doc.line(M,PH-14,PW-M,PH-14);
      doc.setFont("Inter","normal");doc.setFontSize(7.5);col(MUT);
      doc.text("anonymizace.js.org · před sdílením výsledek zkontrolujte",M,PH-9.5);doc.text(`${i} / ${n}`,PW-M,PH-9.5,{align:"right"});}
    return doc;
}
async function exportPdf(){
  const fst=document.getElementById("anon-fst");
  if(!lastAnon.trim()){fst.className="fst err";fst.textContent="Není co uložit — nejdřív vložte nebo nahrajte text.";return;}
  fst.className="fst";fst.textContent="Připravuji PDF…";
  try{
    const doc=await buildPdf(lastAnon,lastReps,lastIncomplete,fst.dataset.last);
    doc.save("anonymizovany-dokument.pdf");   // název souboru může obsahovat jméno → nikdy do výstupu
    fst.className=lastIncomplete?"fst err":"fst ok";fst.textContent="PDF staženo"+(lastIncomplete?" — POZOR, dokument je NEÚPLNÝ (vyznačeno i v PDF).":".");
  }catch(e){fst.className="fst err";fst.textContent="PDF se nepodařilo vytvořit: "+e.message+". Text můžete zkopírovat tlačítkem Kopírovat.";}
}
document.getElementById("pdf-dl").addEventListener("click",exportPdf);

// ── Vymazat vše (vstup, výsledek, odpověď AI, ručně skryté, stav souboru) s 6s možností vrátit ──
(function(){
  const btn=document.getElementById("clear-all"); if(!btn) return;
  let saved=null, timer=null;
  btn.addEventListener("click",function(){
    if(saved){  // Vrátit
      input.value=saved.text; aiIn.value=saved.ai; saved.custom.forEach((v,k)=>custom.set(k,v));
      saved.ignored.forEach((v,k)=>ignored.set(k,v)); lastName=saved.name; lastIncomplete=saved.incomplete; lastDocx=saved.docx;
      saved=null; clearTimeout(timer); btn.textContent="Vymazat"; btn.classList.remove("undo");
      renderCustom(); renderIgnored(); run(); reveal(); input.focus(); return;
    }
    if(!input.value&&!aiIn.value) return;
    saved={text:input.value, ai:aiIn.value, custom:new Map(custom), ignored:new Map(ignored),
           name:lastName, incomplete:lastIncomplete, docx:lastDocx};
    input.value=""; aiIn.value=""; custom.clear(); ignored.clear();
    lastName=""; lastIncomplete=false; lastDocx=null;
    const fst=document.getElementById("anon-fst"); fst.textContent=""; fst.className="fst"; delete fst.dataset.last;
    renderCustom(); renderIgnored(); run(); reveal(); hideBtn.hidden=true;
    btn.textContent="Vrátit"; btn.classList.add("undo");
    timer=setTimeout(()=>{saved=null; btn.textContent="Vymazat"; btn.classList.remove("undo");},6000);
  });
})();
