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
    const pill=document.createElement("span"); pill.className="faq-pill"; pill.setAttribute("aria-hidden","true"); list.prepend(pill);
    btns.forEach(b=>{ const i=document.createElement("i"); i.setAttribute("aria-hidden","true"); b.appendChild(i); });
    let cur=-1;
    const place=()=>{ const b=btns[cur]; if(!b) return; pill.style.transform=`translateY(${b.offsetTop}px)`; pill.style.height=b.offsetHeight+"px"; };
    const show=i=>{
      if(i===cur) return; const dir=i>cur?1:-1;
      card.style.setProperty("--dir",dir);
      panes.forEach((p,j)=>{ p.classList.toggle("out",j===cur); p.classList.toggle("on",i===j); });
      btns.forEach((b,j)=>{ b.setAttribute("aria-selected",String(i===j)); b.tabIndex=i===j?0:-1; });
      cur=i; place();
      // restart the countdown bar on the newly selected question
      const bar=btns[i].querySelector("i"); bar.style.animation="none"; void bar.offsetWidth; bar.style.animation="";
    };
    // samostatné střídání otázek, dokud je sekce vidět a nikdo na ni nesáhl
    let timer=0, touched=false, inView=false;
    const stop=()=>{ touched=true; faq.classList.remove("auto"); clearInterval(timer); };
    const tick=()=>{ if(!touched&&inView&&!document.hidden) show((cur+1)%btns.length); };
    btns.forEach((b,i)=>{
      b.addEventListener("click",()=>{ stop(); show(i); });
      b.addEventListener("keydown",e=>{ const k={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key]; if(!k) return;
        e.preventDefault(); stop(); const n=(i+k+btns.length)%btns.length; show(n); btns[n].focus(); });
    });
    card.addEventListener("pointerenter",()=>{ if(!touched){ clearInterval(timer); faq.classList.remove("auto"); } });
    card.addEventListener("pointerleave",()=>{ if(!touched&&inView){ faq.classList.add("auto"); const b=btns[cur].querySelector("i"); b.style.animation="none"; void b.offsetWidth; b.style.animation=""; clearInterval(timer); timer=setInterval(tick,6000); } });
    ui.append(list,card); items[0].before(ui); faq.classList.add("enhanced"); show(0);
    // výška karty = nejdelší odpověď (+ odsazení); drží se pevně, ať přepnutí nic neposune
    const fit=()=>{ const cs=getComputedStyle(card), pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
      card.style.height=(Math.max(...panes.map(p=>p.scrollHeight))+pad)+"px"; place(); };
    fit(); addEventListener("resize",fit); if(document.fonts) document.fonts.ready.then(fit);
    if(!reduce && "IntersectionObserver" in window){
      new IntersectionObserver(es=>es.forEach(en=>{ inView=en.isIntersecting;
        if(inView&&!touched){ faq.classList.add("auto"); const b=btns[cur].querySelector("i"); b.style.animation="none"; void b.offsetWidth; b.style.animation=""; clearInterval(timer); timer=setInterval(tick,6000); }
        else { clearInterval(timer); faq.classList.remove("auto"); }
      }),{threshold:.5}).observe(ui);
    }
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

// ── mobilní menu (hamburger) ──
(function(){
  const nav=document.querySelector(".site-nav"), btn=nav&&nav.querySelector(".menu"); if(!btn) return;
  const set=open=>{nav.classList.toggle("open-menu",open);btn.setAttribute("aria-expanded",String(open));btn.setAttribute("aria-label",open?"Zavřít menu":"Menu");};
  btn.addEventListener("click",()=>set(btn.getAttribute("aria-expanded")!=="true"));
  nav.querySelectorAll(".links a").forEach(a=>a.addEventListener("click",()=>set(false)));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")set(false);});
  document.addEventListener("click",e=>{if(!nav.contains(e.target))set(false);});
  matchMedia("(min-width:761px)").addEventListener("change",()=>set(false));
})();
