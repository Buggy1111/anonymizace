"use strict";
/* docx-anon.js — anonymizovaný DOCX se zachovaným formátováním, celé v prohlížeči.
   Rozbalí ZIP (DecompressionStream), v textu Wordu nahradí originály značkami tak, aby
   formátování ostatních částí odstavce zůstalo (Word dělí text do „runů" i uprostřed jména),
   vymaže autora z metadat a revizí a zabalí zpět (změněné soubory bez komprese). */

const DOCX_W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC_T[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}

function unzipEntries(buf){
  const u=new Uint8Array(buf), dv=new DataView(buf);
  let e=-1;for(let i=u.length-22;i>=Math.max(0,u.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50){e=i;break;}
  if(e<0) throw new Error("soubor není platný DOCX (ZIP)");
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true); const out=[];
  const dec=new TextDecoder();
  for(let k=0;k<n;k++){
    if(dv.getUint32(p,true)!==0x02014b50) throw new Error("poškozený ZIP");
    const flags=dv.getUint16(p+8,true), method=dv.getUint16(p+10,true), crc=dv.getUint32(p+16,true);
    const csize=dv.getUint32(p+20,true), usize=dv.getUint32(p+24,true);
    const nl=dv.getUint16(p+28,true), xl=dv.getUint16(p+30,true), cl=dv.getUint16(p+32,true), lo=dv.getUint32(p+42,true);
    const nameBytes=u.slice(p+46,p+46+nl);
    const ds=lo+30+dv.getUint16(lo+26,true)+dv.getUint16(lo+28,true);
    out.push({name:dec.decode(nameBytes),nameBytes,flags,method,crc,csize,usize,data:u.slice(ds,ds+csize)});
    p+=46+nl+xl+cl;
  }
  return out;
}
async function inflate(en){
  if(en.method===0) return en.data;
  if(en.method!==8) throw new Error("nepodporovaná komprese v DOCX");
  const s=new Blob([en.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function zipEntries(entries){
  const parts=[], cd=[]; let off=0;
  for(const en of entries){
    const h=new DataView(new ArrayBuffer(30)), fl=en.flags&0x0800;   // bez data-descriptoru (velikosti známe)
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,fl,true);h.setUint16(8,en.method,true);
    h.setUint32(14,en.crc,true);h.setUint32(18,en.csize,true);h.setUint32(22,en.usize,true);h.setUint16(26,en.nameBytes.length,true);
    parts.push(new Uint8Array(h.buffer),en.nameBytes,en.data);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,fl,true);c.setUint16(10,en.method,true);
    c.setUint32(16,en.crc,true);c.setUint32(20,en.csize,true);c.setUint32(24,en.usize,true);c.setUint16(28,en.nameBytes.length,true);c.setUint32(42,off,true);
    cd.push(new Uint8Array(c.buffer),en.nameBytes);
    off+=30+en.nameBytes.length+en.data.length;
  }
  const cdSize=cd.reduce((a,b)=>a+b.length,0), z=new DataView(new ArrayBuffer(22));
  z.setUint32(0,0x06054b50,true);z.setUint16(8,entries.length,true);z.setUint16(10,entries.length,true);z.setUint32(12,cdSize,true);z.setUint32(16,off,true);
  return new Blob([...parts,...cd,new Uint8Array(z.buffer)],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

// originál → značka; delší dřív, hranice slova, mezery pružně (Word i PDF lámou jinak)
function buildMatchers(pairs){
  return pairs.filter(p=>p.original&&p.original.trim().length>1).sort((a,b)=>b.original.length-a.original.length)
    .map(p=>({re:new RegExp("(?<![\\p{L}\\p{N}])"+p.original.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+")+"(?![\\p{L}\\p{N}])","gu"),ph:p.placeholder}));
}
// najde nepřekrývající se výskyty v textu odstavce
function findEdits(text,matchers){
  const used=[], edits=[];
  for(const m of matchers){ m.re.lastIndex=0; let r;
    while((r=m.re.exec(text))){const s=r.index,e=s+r[0].length;
      if(!used.some(([a,b])=>s<b&&e>a)){used.push([s,e]);edits.push({s,e,ph:m.ph});}
      if(r[0].length===0) m.re.lastIndex++; }
  }
  return edits.sort((a,b)=>b.s-a.s);   // od konce → dřívější offsety platí
}
function nearestP(n){while(n&&!(n.namespaceURI===DOCX_W&&n.localName==="p"))n=n.parentNode;return n;}
function anonymizeWordXml(xml,matchers){
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("část dokumentu nejde přečíst, DOCX nevytvořím (raději nic, než únik)");
  let count=0;
  for(const d of Array.from(doc.getElementsByTagNameNS(DOCX_W,"del"))) if(d.parentNode){d.parentNode.removeChild(d);count++;}
  for(const p of Array.from(doc.getElementsByTagNameNS(DOCX_W,"p"))){
    // w:t = text, w:delText = smazaný text v revizích (Word ho drží v souboru) — oboje v pořadí dokumentu
    const ts=Array.from(p.getElementsByTagNameNS(DOCX_W,"*")).filter(t=>(t.localName==="t"||t.localName==="delText")&&nearestP(t)===p);
    if(!ts.length) continue;
    const texts=ts.map(t=>t.textContent), full=texts.join("");
    for(const ed of findEdits(full,matchers)){
      let acc=0,i=-1,j=-1,si=0,ej=0;
      for(let k=0;k<texts.length;k++){const L=texts[k].length;
        if(i<0&&ed.s<acc+L){i=k;si=ed.s-acc;}
        if(ed.e<=acc+L){j=k;ej=ed.e-acc;break;}
        acc+=L;}
      if(i<0||j<0) continue;
      if(i===j) texts[i]=texts[i].slice(0,si)+ed.ph+texts[i].slice(ej);
      else{texts[i]=texts[i].slice(0,si)+ed.ph;for(let k=i+1;k<j;k++)texts[k]="";texts[j]=texts[j].slice(ej);}
      count++;
    }
    ts.forEach((t,k)=>{if(t.textContent!==texts[k]){t.textContent=texts[k];t.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");}});
  }
  for(const it of Array.from(doc.getElementsByTagNameNS(DOCX_W,"instrText"))){
    let t=it.textContent; for(const m of matchers){m.re.lastIndex=0;t=t.replace(m.re,()=>{count++;return m.ph;});} it.textContent=t;
  }
  let out=new XMLSerializer().serializeToString(doc);
  out=out.replace(/(\bw:author=")[^"]*"/g,'$1Autor"').replace(/(\bw:initials=")[^"]*"/g,'$1A"');   // autoři revizí a komentářů
  if(!/^<\?xml/.test(out)) out='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+out;
  return {xml:out,count};
}
const DOCX_TEXT_PARTS=/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments\w*)\.xml$/;
async function anonymizeDocx(buf,pairs){
  const xmlEsc=v=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const matchers=buildMatchers(pairs), rawMatchers=buildMatchers(pairs.map(p=>({original:xmlEsc(p.original||""),placeholder:p.placeholder}))), entries=unzipEntries(buf), enc=new TextEncoder(), dec=new TextDecoder();
  let total=0;
  for(const en of entries){
    let xml=null;
    if(DOCX_TEXT_PARTS.test(en.name)){const r=anonymizeWordXml(dec.decode(await inflate(en)),matchers);xml=r.xml;total+=r.count;}
    else if(en.name==="docProps/core.xml") xml=dec.decode(await inflate(en)).replace(/(<(dc:creator|cp:lastModifiedBy)>)[^<]*(<\/\2>)/g,"$1$3");
    else if(en.name==="docProps/app.xml") xml=dec.decode(await inflate(en)).replace(/(<(Company|Manager)>)[^<]*(<\/\2>)/g,"$1$3");
    else if(en.name==="word/people.xml") xml=dec.decode(await inflate(en)).replace(/(\bw15:author=")[^"]*"/g,'$1Autor"');
    // všechny ostatní XML části (odkazy v .rels, grafy, diagramy, vlastní XML…) — náhrada v surovém XML
    else if(/\.(xml|rels)$/i.test(en.name)){const raw=dec.decode(await inflate(en));let t=raw;
      for(const m of rawMatchers){m.re.lastIndex=0;t=t.replace(m.re,()=>{total++;return m.ph;});} if(t!==raw) xml=t;}
    if(xml!==null){const b=enc.encode(xml);Object.assign(en,{method:0,data:b,csize:b.length,usize:b.length,crc:crc32(b)});}
  }
  return {blob:zipEntries(entries),count:total};
}

// text částí, které mammoth nevrací (záhlaví, zápatí, komentáře) — přidá se do vstupu,
// aby se v nich hledaly osobní údaje stejně jako v těle dokumentu
async function docxExtraText(buf){
  const dec=new TextDecoder(), parts=[];
  for(const en of unzipEntries(buf)){
    if(!/^word\/(header\d*|footer\d*|comments)\.xml$/.test(en.name)) continue;
    const doc=new DOMParser().parseFromString(dec.decode(await inflate(en)),"application/xml");
    for(const p of Array.from(doc.getElementsByTagNameNS(DOCX_W,"p"))){
      const t=Array.from(p.getElementsByTagNameNS(DOCX_W,"t")).filter(x=>nearestP(x)===p).map(x=>x.textContent).join("").trim();
      if(t&&!parts.includes(t)) parts.push(t);
    }
  }
  return parts.join("\n");
}
