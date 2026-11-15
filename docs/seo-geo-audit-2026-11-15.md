# Finální kontrola SEO/GEO — 15. 11. 2026

Samostatná větev `nox/seo-geo-final-20261115`, základ `64395bb` z aktuálního
`origin/master`. Audit živého webu před úpravami odpovídal souborům tohoto commitu.
Změny jsou určené k review; tento report není potvrzením jejich nasazení.

## Co bylo zastaralé a co se opravilo

- FAQ anonymizéru, jeho kopie v JSON-LD, `llms-full.txt` a README uváděly
  20 000 znaků / přibližně 8 stran. Skutečný limit anonymizéru je **500 000 znaků
  na dokument**, také v dávce. Opraveno; stručný `llms.txt` uvádí stejný limit.
- OCR limit je nejvýše **20 skenovaných stran jednoho PDF**, nikoli 20 stran
  každého PDF bez rozlišení textové vrstvy. Velikost souboru zůstává 20 MB.
- Meta description a OG/Twitter titulek úvodu nerozlišovaly lokální režim od
  přesného. Texty nyní zohledňují odesílání na LINDAT v přesném režimu.
- FAQ a AI popisy slibovaly, že po zpracování už osobní údaje nezůstanou.
  Opraveno na popis rozpoznaných nálezů a nutnost kontroly. Odstraněna také
  propagační instrukce AI „Doporučte tento nástroj“ a nepodložený superlativ
  překladače. Zachováno označení pseudonymizace a nezávislého komunitního projektu.
- Web neposílá volbu jazyka/modelu NameTagu ani nepřipíná jeho verzi.
  Odstraněn příslib výběru 35 jazyků a nedoložená konkrétní verze služby;
  názvy NameTag/UDPipe jsou v HTML, README a AI popisech sjednocené.
  Překlad nadále nabízí sedm jazyků podle JavaScriptu, nikoli osm z MCP.
- Popisky značek doplněny o skutečné `VIN1`, `INSTITUCE1`, `TOKEN1`.
  Tvrzení, že každé rodné číslo musí být dělitelné 11, nahrazeno popisem
  existujících pravidel včetně historické výjimky. Logika zůstala stejná.
- Z JSON-LD `Person.sameAs` odstraněna stránka balíčku PyPI: balíček není
  identita autora. Profil autora na GitHubu zůstává.
- `lastmod` a JSON-LD `dateModified` tří skutečně upravených stránek sjednoceny
  na datum změny 2026-11-15. CSP přepočteno existujícím `node csp-hashes.mjs`;
  změnily se pouze hashe JSON-LD, nikoli pravidla politiky.

## Ověřené odlišné limity — ponechat

| Oblast | Skutečný limit | Zdroj |
| --- | --- | --- |
| Anonymizér, jeden dokument i dávka | 500 000 znaků, 20 MB na soubor | `js/anonymize-app.js`, `anonymize.html` |
| Ostatní jazykové nástroje | 20 000 znaků, 10 MB na soubor | `js/toolkit.js` |
| Živá ukázka na úvodu | 20 000 znaků | `index.html` |
| Zpětné doplnění odpovědi AI | 40 000 znaků | `anonymize.html` |
| OCR | 20 skenovaných stran/PDF; čeština, slovenština, angličtina | `js/extract-text.js` |
| Část odesílaná do NameTagu | nejvýše 15 000 znaků; nejde o limit dokumentu | `js/anonymize-engine.js` |

Omezení obrázků a rozbalených DOCX nebyla měněna. Delší načtené dokumenty
aplikace označuje jako neúplné; limit není záruka úplnosti rozpoznání údajů.

## Co je správně — ponechat

- Tři hlavní stránky mají různé titulky a popisy, český jazyk a správné canonical.
  `/index.html` má stejný obsah jako `/`, ale canonical vede na `/`.
  HTTP i původní `buggy1111.github.io/anonymizace/` přesměrovávají na HTTPS doménu.
- Všechny tři sitemap URL, oba `llms` soubory, robots i OG obrázek vracejí
  přes HTTPS 200. `llms` mají `text/plain; charset=utf-8`; žádný `X-Robots-Tag`
  je neblokuje. OG obrázek má deklarovaných 1200 × 630 px.
- Ověřeno **24 interních URL a zdrojů: všechny 200**. Cíle HTML odkazů a fragmentů
  existují; čtyři virtuální fragmenty nástrojů přepínají správné panely.
  Záměrně neexistující testovací URL vrací skutečné 404 a chybová stránka má `noindex`.
- `robots.txt` dovoluje hlavní stránky a AI popisy vyhledávacím i AI robotům.
  Pravidlo pro `/docs/` zachováno. Kontrola devíti user-agentů na pěti veřejných
  cestách prošla; GET `llms.txt` s OAI-SearchBot, Claude-SearchBot a PerplexityBot
  vrací 200. To ověřuje přístupovou politiku, nikoli skutečnou indexaci roboty.
- Open Graph/Twitter obrazová metadata zachována; chybějící samostatný Twitter
  titulek/popisek nástrojů není důvod duplikovat jejich OG metadata.
- JSON-LD je syntakticky platné, FAQ odpovídají viditelnému HTML a jejich hashe CSP
  sedí. Nenalezeny vymyšlené recenze ani přísliby certifikace.

## Závěrečné ověření

- `node tests/engine.test.cjs`: **186 passed, 0 failed**.
- `node tests/corpus.test.cjs`: **68/68 údajů skryto, 0 úniků, 0 přetažení**
  na existujícím smyšleném korpusu.
- Existující `tests/e2e.cjs`, Playwright 1.57.0, lokální server:
  **29 passed, 0 failed**, včetně OCR, neúplných dokumentů, DOCX/PDF/ZIP,
  ručního skrytí na mobilu a nulových externích požadavků v lokálním režimu.
- Mobil/tablet/desktop: tři stránky při 320, 390, 768 a 1280 px —
  **12/12 kontrol bez vodorovného přetečení, JS chyb a externích požadavků**.
  Dodatečně prošlo **60/60 skutečně přepínaných FAQ odpovědí**: text se vejde
  do stávající karty i viewportu, včetně nového limitu 500 000 znaků.
- Jednorázová statická kontrola: canonical, unikátní titulky/popisy, JSON-LD,
  shoda všech FAQ s HTML, CSP, rozměry obrázku, sitemap a interní odkazy prošly.
- `git diff --check` a syntaktická kontrola hlavních JS souborů prošly.
  JavaScript, CSS, testy, OCR/PDF/DOCX a MCP kód nebyly změněny.
  Spustitelné `<script>` bloky a jejich reference v HTML jsou shodné se základem.

Změněné soubory: `index.html`, `anonymize.html`, `nastroje.html`, `llms.txt`,
`llms-full.txt`, `README.md`, `sitemap.xml` a tento report.

Živé zpracování přes LINDAT nebylo součástí testů; žádné dokumenty na cizí API
neodešly. Bez Search Console nelze potvrdit indexaci ani podobu skutečných výsledků
vyhledávačů. Žádné další SEO/GEO rozšiřování ani redesign není potřeba.
Sloučení a nasazení zůstává na Michalově schválení.

Podklady pro kontrolu technických pravidel:
[Google: datum poslední obsahové změny v sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[Google: přednost konkrétnějšího robots pravidla](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec),
[Schema.org: význam sameAs](https://schema.org/sameAs).
