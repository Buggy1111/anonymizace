# Bezpečnost

## Hlášení zranitelnosti
Zranitelnost prosím **nehlaste veřejným issue**. Použijte
[soukromé hlášení na GitHubu](https://github.com/Buggy1111/anonymizace/security/advisories/new)
(Security → Report a vulnerability). Ozvu se do 7 dnů.

Zvlášť nás zajímá:
- **únik osobního údaje** — text, ve kterém anonymizace nechá jméno, rodné číslo, účet apod. čitelné,
- **zablokování prohlížeče** (ReDoS) — vstup, který anonymizaci výrazně zpomalí,
- jakýkoli síťový požadavek v lokálním režimu, který nesmí nic odeslat.

## Jak je web chráněný
- Žádný vlastní server ani databáze; lokální režim běží celý v prohlížeči.
- CSP: skripty jen z vlastní domény (+ hashované JSON-LD), síť jen na LINDAT (přesný režim).
- Všechny knihovny (pdf.js, mammoth, Lenis) i písma hostované na vlastní doméně, otisky ověřené.
- Automaticky: CodeQL, Dependabot, secret scanning s push protection.
