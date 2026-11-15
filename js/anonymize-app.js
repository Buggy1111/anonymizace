"use strict";
/* anonymize-app.js — DOM vrstva stránky anonymizéru.
   Závisí na anonymize-engine.js (anonymize/fetchNER/…) a extract-text.js (extractText). */

const MAX_CHARS=500000; // limit dokumentu; delší se NEořízne potichu — výsledek je označen jako neúplný
const input=document.getElementById("input"), output=document.getElementById("output");
const tableEl=document.getElementById("table"), statsEl=document.getElementById("stats");
const repcount=document.getElementById("repcount"), incount=document.getElementById("incount");
const nerinfo=document.getElementById("nerinfo");
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
  const r=anonymize(text,ents);
  const keep=[], back=new Map();
  for(const x of r.replacements){
    if(offTypes.has(x.type)||ignored.has(x.original.toLowerCase())) back.set(x.placeholder,x.original); else keep.push(x);
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
function render(anonymized,replacements){
  lastAnon=anonymized;
  lastMap=new Map(replacements.map(x=>[x.placeholder,x.original])); lastReps=replacements; reveal(); docxBtn.hidden=!lastDocx;

  // výstup s zvýrazněnými placeholdery — čisté DOM uzly (matchAll, žádný innerHTML)
  clear(output);
  if(!anonymized){output.appendChild(span("placeholder","Výsledek se zobrazí tady."));}
  else{
    let last=0;
    for(const m of anonymized.matchAll(PH_RE)){
      if(m.index>last) output.appendChild(document.createTextNode(anonymized.slice(last,m.index)));
      const tok=span("ph-tok t-"+m[0].replace(/\d+$/,""),m[0]);
      if(lastMap.has(m[0])){tok.tabIndex=0;tok.setAttribute("role","button");tok.title="Není to osobní údaj? Kliknutím vrátíte do textu.";tok.dataset.ph=m[0];}
      output.appendChild(tok);
      last=m.index+m[0].length;
    }
    if(last<anonymized.length) output.appendChild(document.createTextNode(anonymized.slice(last)));
  }

  // statistiky
  clear(statsEl);
  const byType={}; replacements.forEach(x=>byType[x.type]=(byType[x.type]||0)+1);
  Object.keys(byType).forEach(t=>{
    const s=span("stat","");const b=document.createElement("b");b.textContent=byType[t];
    s.appendChild(b);s.appendChild(document.createTextNode(" "+(TYPE_LABELS[t]||t)));statsEl.appendChild(s);
  });
  if(replacements.length){
    const s=span("stat total","");
    const b=document.createElement("b");b.textContent=replacements.length;
    s.appendChild(b);s.appendChild(document.createTextNode(" celkem"));statsEl.appendChild(s);
  }

  // tabulka
  repcount.textContent=replacements.length;
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
input.addEventListener("input",()=>{if(!input.value){lastIncomplete=false;lastName="";lastDocx=null;}run();});
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
    const {blob,count}=await anonymizeDocx(lastDocx.buf,lastReps);
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="anonymizovany-dokument.docx";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    fst.className="fst ok";fst.textContent="Staženo: "+count+" náhrad ve Wordu, formátování zachováno, autor odstraněn z vlastností.";
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
      else add(uniq(base+tag+"-anonymizovano.txt"),enc.encode((d.incomplete?"!!! NEÚPLNÉ — "+d.text+"\n\n":"")+r.anonymized));
      log.push(`${d.incomplete?"NEÚPLNÉ":"OK     "} ${d.text} — ${r.replacements.length} náhrad`);
    }catch(e){log.push(`CHYBA  ${base} (${ext||"soubor"}): ${e.message} — soubor není v ZIPu`);}
  }
  add("souhrn.txt",enc.encode("Anonymizace — https://anonymizace.js.org (zpracováno ve vašem prohlížeči)\n"+
    "Značky (OSOBA1, RC1…) se číslují v každém souboru zvlášť. Výsledek před sdílením zkontrolujte.\n"+
    "Soubory jsou očíslované v pořadí, v jakém jste je vybrali (původní názvy mohou obsahovat jména, proto se nepoužívají).\n\n"+log.join("\n")+"\n"));
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([zipEntries(entries)],{type:"application/zip"}));a.download="anonymizovano.zip";
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  const bad=log.filter(l=>l.startsWith("CHYBA")).length, part=log.filter(l=>l.startsWith("NEÚPLNÉ")).length;
  fst.className=bad||part?"fst err":"fst ok"; fst.textContent=`Staženo anonymizovano.zip: ${files.length-bad} z ${files.length} souborů`+(bad?`, ${bad} se nepodařilo`:"")+(part?`, ${part} NEÚPLNÉ`:"")+(bad||part?" (viz souhrn.txt)":"")+".";
}
// ── stáhnout PDF: generuje se v prohlížeči (jsPDF + písmo Inter s českou a slovenskou diakritikou,
//    obojí na vlastní doméně), obsahuje jen anonymizovaný text. Knihovna se načte až při kliknutí.
async function fetchB64(url){const b=new Uint8Array(await (await fetch(url)).arrayBuffer());let s="";for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s);}
async function exportPdf(){
  const fst=document.getElementById("anon-fst");
  if(!lastAnon.trim()){fst.className="fst err";fst.textContent="Není co uložit — nejdřív vložte nebo nahrajte text.";return;}
  fst.className="fst";fst.textContent="Připravuji PDF…";
  try{
    await loadScriptOnce("js/vendor/jspdf/jspdf.umd.min.js");
    const {jsPDF}=window.jspdf, doc=new jsPDF({unit:"mm",format:"a4",compress:true});
    const [r,b]=await Promise.all([fetchB64("fonts/pdf/inter-cz-400.ttf"),fetchB64("fonts/pdf/inter-cz-700.ttf")]);
    doc.addFileToVFS("Inter-400.ttf",r);doc.addFont("Inter-400.ttf","Inter","normal");
    doc.addFileToVFS("Inter-700.ttf",b);doc.addFont("Inter-700.ttf","Inter","bold");
    doc.setProperties({title:"Anonymizovaný dokument",creator:"anonymizace.js.org",author:""});
    const M=20,W=210-2*M,H=297,LH=5.2; let y=M;
    doc.setFont("Inter","bold");doc.setFontSize(14);doc.text("Anonymizovaný dokument",M,y);y+=6;
    doc.setFont("Inter","normal");doc.setFontSize(8.5);doc.setTextColor(110);
    doc.text("Vytvořeno v prohlížeči na anonymizace.js.org · "+new Date().toLocaleDateString("cs-CZ")+" · před sdílením zkontrolujte",M,y);y+=5;
    if(lastIncomplete){doc.setTextColor(200,30,30);doc.setFont("Inter","bold");
      for(const l of doc.splitTextToSize("NEÚPLNÉ: "+(document.getElementById("anon-fst").dataset.last||"část dokumentu nebyla zpracována"),W)){doc.text(l,M,y);y+=4.2;}doc.setFont("Inter","normal");}
    doc.setTextColor(0);doc.setFontSize(10.5);y+=3;
    for(const para of lastAnon.replace(/\t/g,"    ").split("\n")){
      const lines=para?doc.splitTextToSize(para,W):[""];
      for(const l of lines){ if(y>H-M){doc.addPage();y=M;} doc.text(l,M,y); y+=LH; }
    }
    const n=doc.getNumberOfPages(); doc.setFontSize(8);doc.setTextColor(140);
    for(let i=1;i<=n;i++){doc.setPage(i);doc.text(`${i} / ${n}`,210-M,H-10,{align:"right"});}
    doc.save("anonymizovany-dokument.pdf");   // název souboru může obsahovat jméno → nikdy do výstupu
    fst.className=lastIncomplete?"fst err":"fst ok";fst.textContent="PDF staženo"+(lastIncomplete?" — POZOR, dokument je NEÚPLNÝ (vyznačeno i v PDF).":".");
  }catch(e){fst.className="fst err";fst.textContent="PDF se nepodařilo vytvořit: "+e.message+". Text můžete zkopírovat tlačítkem Kopírovat.";}
}
document.getElementById("pdf-dl").addEventListener("click",exportPdf);
