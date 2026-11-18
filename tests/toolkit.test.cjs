// Deterministic UI regression: long morphology results can be dragged at any row.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const BASE=process.env.TOOLKIT_BASE||'http://localhost:8765/nastroje.html#morf';
const result=Array.from({length:200},(_,i)=>`${i+1}\tpoložka\tpoložka\tNOUN\t_\tAnimacy=Inan|Case=Nom|Gender=Fem|Number=Sing\t0\troot\t_\t_`).join('\n');

(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function load(p){
      await p.route('**/udpipe/api/process',r=>r.fulfill({json:{result},headers:{'Access-Control-Allow-Origin':'*'}}));
      await p.goto(BASE);
      await p.locator('#morf-go').click();
      await p.waitForFunction(()=>document.querySelectorAll('#morf-out tbody tr').length===200);
    }
    await load(page);
    const out=page.locator('#morf-out');
    assert(await page.locator('#morf-help').isVisible());
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(BASE).origin});
    async function copySelection(){
      const selected=await page.evaluate(()=>getSelection().toString());
      assert(selected.includes('položka'));
      await page.keyboard.press('ControlOrMeta+C');
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),selected,'Ctrl+C must copy the selected result');
    }
    async function point(row){
      const cell=page.locator('#morf-out tbody tr').nth(row).locator('td').first();
      await out.evaluate(e=>{e.scrollLeft=0;});
      await cell.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600); // hash navigation and scrollIntoView can still be scrolling
      const box=await cell.boundingBox();
      return {x:box.x+20,y:box.y+box.height/2};
    }
    for(const row of [0,80,160]){
      const pos=await point(row);
      assert(await out.evaluate(e=>e.scrollWidth>e.clientWidth));
      assert(await out.evaluate(e=>e.getBoundingClientRect().bottom>innerHeight),'bottom scrollbar must be offscreen');
      await page.mouse.move(pos.x,pos.y);await page.mouse.down();
      await page.mouse.move(pos.x-180,pos.y,{steps:12});
      assert(await out.evaluate(e=>e.scrollLeft>50),'drag left must reveal right columns');
      await page.mouse.up();
      assert.equal(await out.evaluate(e=>e.classList.contains('dragging')),false);
      const left=await out.evaluate(e=>e.scrollLeft);
      await page.mouse.move(pos.x+50,pos.y);
      assert.equal(await out.evaluate(e=>e.scrollLeft),left,'release outside must stop dragging');
      await page.mouse.down();await page.mouse.move(pos.x+150,pos.y,{steps:10});await page.mouse.up();
      assert((await out.evaluate(e=>e.scrollLeft))<left,'drag right must return toward first columns');
    }
    const pos=await point(80);
    await page.mouse.dblclick(pos.x,pos.y);
    assert.match(await page.evaluate(()=>getSelection().toString()),/položka/,'double click must select a word');
    await copySelection();
    await page.keyboard.down('Shift');
    await page.mouse.move(pos.x,pos.y);await page.mouse.down();
    await page.mouse.move(pos.x+180,pos.y+80,{steps:12});await page.mouse.up();
    await page.keyboard.up('Shift');
    assert.equal(await out.evaluate(e=>e.scrollLeft),0,'Shift drag must preserve native selection');
    assert(await page.evaluate(()=>getSelection().toString().length>0));
    assert.match(await page.evaluate(()=>getSelection().toString()),/\n/,'Shift drag must select across rows');
    await copySelection();
    await page.mouse.move(pos.x,pos.y);await page.mouse.down({button:'right'});
    await page.mouse.move(pos.x-80,pos.y,{steps:8});await page.mouse.up({button:'right'});
    assert.equal(await out.evaluate(e=>e.scrollLeft),0,'right button must not drag');
    await page.keyboard.press('Escape');
    await out.evaluate(e=>e.addEventListener('gotpointercapture',ev=>e.releasePointerCapture(ev.pointerId),{once:true}));
    await page.mouse.move(pos.x,pos.y);await page.mouse.down();
    await page.mouse.move(pos.x-60,pos.y,{steps:6});
    const stopped=await out.evaluate(e=>e.scrollLeft);
    await page.mouse.move(pos.x-120,pos.y,{steps:6});await page.mouse.up();
    assert.equal(await out.evaluate(e=>e.scrollLeft),stopped,'lost capture must stop dragging');
    await out.evaluate(e=>{e.scrollLeft=0;e.focus();});
    await page.keyboard.press('ArrowRight');await page.waitForTimeout(250);
    assert(await out.evaluate(e=>e.scrollLeft>0),'keyboard scrolling must work');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const touchPage=await mobile.newPage();
    await load(touchPage);
    const touchOut=touchPage.locator('#morf-out');
    await touchPage.locator('#morf-out td').first().scrollIntoViewIfNeeded();
    await touchPage.waitForTimeout(600);
    const box=await touchPage.locator('#morf-out td').first().boundingBox();
    const session=await mobile.newCDPSession(touchPage);
    const start={x:box.x+180,y:box.y+15};
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    for(let i=1;i<=8;i++){
      await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x-i*20,y:start.y}]});
      await touchPage.waitForTimeout(25);
    }
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await touchPage.waitForFunction(()=>document.getElementById('morf-out').scrollLeft>50);
    assert.equal(await touchOut.evaluate(e=>e.classList.contains('dragging')),false);
    assert(await touchPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS: dragging at three rows, both directions, outside release, lost capture, text selection, keyboard and native touch scrolling');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
