# Anonymizace (anonymizace.js.org)

České NLP nástroje online, zdarma a přímo v prohlížeči. Postaveno na akademických nástrojích [ÚFAL MFF UK](https://ufal.mff.cuni.cz/).

**Web:** https://anonymizace.js.org/

Doprovodný web k MCP serveru [anonymize-mcp](https://github.com/Buggy1111/anonymize-mcp) — pro lidi, kteří nechtějí řešit instalaci ani MCP.

![Ukázka: text se jmény a rodným číslem se při psaní nahrazuje značkami, falešný nález jde vrátit kliknutím a odpověď z AI se doplní původními údaji](docs/demo.gif)

**Co umí anonymizér** — vše běží ve vašem prohlížeči, nic se neodesílá (kromě volitelného přesného režimu přes ÚFAL):

- přes 20 druhů osobních údajů včetně slovenských (rodná čísla s kontrolou, IČO, účty, IBAN, částky v jakémkoli zápisu, spisové značky…)
- **PDF, Word, TXT i fotky a skeny** — OCR (Tesseract) přímo v prohlížeči, čeština a slovenština; PDF s heslem
- **Word ven se zachovaným formátováním** — bez autora ve vlastnostech a revizích; před stažením kontrola, že v souboru nezůstal žádný údaj
- **hromadně** — víc souborů najednou do ZIPu
- **výběr, co skrývat**, a **vrácení falešného nálezu** kliknutím na značku
- **odpověď z AI zpět s údaji** — vložíte odpověď ChatGPT/Claude se značkami a dostanete ji s původními jmény

## Nástroje

- **Anonymizace** — skryje osobní údaje (jména, rodná čísla, adresy, telefony, IČO, účty, peněžní částky v jakémkoli zápisu, e-maily, IP adresy, čísla pasů, řidičských průkazů a smluv, IČP/IČZ…) a nahradí je značkami (OSOBA1, CASTKA1…). Lokální offline režim i přesný NER. Vlastní stránka `anonymize.html`.

### Testy

`tests/engine.test.cjs` (`node tests/engine.test.cjs`) — 174 případů: díry, přetažení, reálné vzory dokumentů (jen smyšlené hodnoty) a ReDoS (data, verze, „Smlouva o dílo“ zůstávají).
`tests/e2e.cjs` — testy v prohlížeči na smyšlených souborech z `tests/fixtures/` (OCR po stránkách, neúplné dokumenty, DOCX, ZIP, 0 externích požadavků).
`tests/corpus.test.cjs` — společný smyšlený korpus (12 dokumentů, 68 údajů; stejný soubor má i anonymize-mcp), měří úniky a přetažení.
- **NER** — rozpoznávání pojmenovaných entit (NameTag).
- **Morfologie** — lemma, slovní druh, mluvnické kategorie (UDPipe).
- **Korektor** — oprava překlepů a diakritiky (Korektor).
- **Překlad** — strojový překlad mezi 7 jazyky (CUBBITT).

## Struktura

Statický web bez build kroku. Tři stránky, vzhled ve stylu Apple (den i noc):

```
index.html          — úvod: věta ze spisu, kterou při scrollu „skartuje" anonymizace,
                      dveře „Kam putuje váš text", živá ukázka, otázky
anonymize.html      — plný anonymizér (2 režimy, přes 20 druhů údajů, tabulka náhrad)
nastroje.html       — entity, morfologie, pravopis, překlad (deep-link přes #ner, #morf…)

css/fonts.css       — self-hosted Geist, Geist Mono, Inter (SIL OFL) — žádné Google Fonts
css/site.css        — sdílené tokeny, lišta, patička, pracovní plocha
css/landing.css     — úvodní stránka
css/tool.css        — anonymizér a nástroje
js/theme.js         — den/noc před vykreslením (bez probliknutí)
js/site.js          — přepínač vzhledu, plynulý scroll (vendor/lenis), odhalení při scrollu
js/landing.js       — skartovačka, dveře, nečinnost, živá ukázka
js/docx-anon.js     — anonymizovaný DOCX se zachovaným formátováním (ZIP přes DecompressionStream, bez knihoven)
js/extract-text.js  — čtení PDF/DOCX/TXT/obrázků (pdf.js, mammoth, Tesseract.js OCR — vše self-hosted v js/vendor/)
js/toolkit.js       — logika nástrojů
js/anonymize-engine.js — anonymizační logika (sdílí úvod i anonymizér)
js/anonymize-app.js — DOM vrstva anonymizéru
csp-hashes.mjs      — po úpravě JSON-LD spusť `node csp-hashes.mjs` (přepočítá CSP hashe)
```

## Jak to funguje

Texty jdou **přímo z prohlížeče** na veřejné akademické API ÚFAL LINDAT
(`https://lindat.mff.cuni.cz/services`). **Žádný vlastní backend, žádný API klíč;
web sám nic neukládá.** Podmínky ÚFAL ale dovolují zaslaná data použít ke zlepšení
jejich služeb — proto citlivé texty jen v lokálním režimu. Anonymizér navíc nabízí plně offline lokální mód, kde text
prohlížeč vůbec neopustí. Anonymizér má limit 500 000 znaků na dokument (i v dávce) a 20 MB na soubor; OCR zpracuje nejvýše 20 skenovaných stran jednoho PDF. Přesný režim odesílá text do NameTagu po částech do 15 000 znaků. Další jazykové nástroje na `nastroje.html` mají samostatný limit 20 000 znaků a 10 MB na soubor.

## Vývoj

Žádný build. Stačí libovolný statický server:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Konvence: ≤ 400 řádků na soubor, čistá separace logiky a DOM, žádný `innerHTML`
(jen DOM metody — XSS bezpečnost).

## Licence

Kód: [PolyForm Noncommercial 1.0.0](LICENSE.md) — volné použití, úpravy i šíření
pro nekomerční účely.

> Required Notice: Copyright Michal Bürgermeister (https://anonymizace.js.org)

NLP engine © ÚFAL MFF UK
([NameTag](https://ufal.mff.cuni.cz/nametag/3) ·
[UDPipe](https://ufal.mff.cuni.cz/udpipe/2) ·
[Korektor](https://ufal.mff.cuni.cz/korektor) ·
[CUBBITT](https://lindat.cz/translation)).
