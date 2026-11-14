"use strict";
/* site.js — sdílené chování všech stránek: přepínač den/noc, plynulý scroll (Lenis),
   jemné odhalení bloků při scrollu ([data-reveal]). */
(function(){
  const root=document.documentElement;
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── den / noc / podle systému ──
  const buttons=[...document.querySelectorAll(".theme button")];
  function setTheme(t){
    if(t==="light"||t==="dark") root.setAttribute("data-theme",t); else root.removeAttribute("data-theme");
    buttons.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.t===t)));
    try{ localStorage.setItem("theme",t); }catch(e){}
    document.dispatchEvent(new CustomEvent("themechange"));
  }
  let saved="system"; try{ saved=localStorage.getItem("theme")||"system"; }catch(e){}
  buttons.forEach(b=>{ b.setAttribute("aria-pressed",String(b.dataset.t===saved)); b.addEventListener("click",()=>setTheme(b.dataset.t)); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>document.dispatchEvent(new CustomEvent("themechange")));

  // ── plynulý scroll ──
  if(window.Lenis && !reduce){
    try{
      const lenis=new Lenis({lerp:.085});
      window.siteLenis=lenis;
      (function raf(t){ lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
    }catch(e){}
  }

  // ── otázky: z <details> udělá seznam otázek + kartu s odpovědí pevné výšky,
  //    takže otevření odpovědi stránku neprodlouží ani nic neposune.
  //    Bez JS zůstanou obyčejné <details> (a Google vidí všechny odpovědi).
  document.querySelectorAll(".faq").forEach((faq,fi)=>{
    const items=[...faq.querySelectorAll("details")]; if(items.length<2) return;
    const ui=document.createElement("div"); ui.className="faq-ui";
    const list=document.createElement("div"); list.className="faq-q"; list.setAttribute("role","tablist"); list.setAttribute("aria-orientation","vertical");
    const card=document.createElement("div"); card.className="faq-a";
    const btns=[], panes=[];
    items.forEach((d,i)=>{
      const q=d.querySelector("summary").textContent, a=d.querySelector("p").textContent, id="faq"+fi+"-"+i;
      const b=document.createElement("button"); b.type="button"; b.id=id+"-t"; b.textContent=q; b.setAttribute("role","tab"); b.setAttribute("aria-controls",id);
      const pane=document.createElement("div"); pane.id=id; pane.setAttribute("role","tabpanel"); pane.setAttribute("aria-labelledby",b.id);
      const h=document.createElement("h3"); h.textContent=q; const p=document.createElement("p"); p.textContent=a; pane.append(h,p);
      btns.push(b); panes.push(pane); list.appendChild(b); card.appendChild(pane);
    });
    const show=i=>{ btns.forEach((b,j)=>{ b.setAttribute("aria-selected",String(i===j)); b.tabIndex=i===j?0:-1; }); panes.forEach((p,j)=>p.classList.toggle("on",i===j)); };
    btns.forEach((b,i)=>{
      b.addEventListener("click",()=>show(i));
      b.addEventListener("keydown",e=>{ const k={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key]; if(!k) return;
        e.preventDefault(); const n=(i+k+btns.length)%btns.length; show(n); btns[n].focus(); });
    });
    show(0); ui.append(list,card); items[0].before(ui); faq.classList.add("enhanced");
  });

  // ── odhalení při scrollu: obsah je vidět i bez JS, animace jen přidává pohyb ──
  const items=document.querySelectorAll("[data-reveal]");
  if(!reduce && "IntersectionObserver" in window && items.length){
    const io=new IntersectionObserver(es=>es.forEach(en=>{
      if(!en.isIntersecting) return;
      const el=en.target, i=+(el.dataset.reveal||0);
      el.animate([{opacity:0,transform:"translateY(36px)"},{opacity:1,transform:"none"}],
        {duration:1100,delay:i*80,easing:"cubic-bezier(.16,1,.3,1)",fill:"backwards"});
      io.unobserve(el);
    }),{threshold:.15});
    items.forEach(el=>{ const r=el.getBoundingClientRect(); if(r.top>innerHeight) io.observe(el); });
  }
})();
