"use strict";
/* =====================================================================
   bills.js — ONE way to show a bill (or a law) anywhere on the site:
   ראשי's "bills in committee", the votes tab, the bills tab (Mercy: change
   it here and all three change). Load after common.js. Plain globals.

   A closed row: ▸ + the name in two voices + one quiet line.
   An opened row, always in this order (Mercy's vote-panel order, 2026-08-22,
   made the rule for every bill): מגישים → סוג · שלב · ועדה · תאריך · חוק
   מושפע → ההחלטה + how the factions voted (a vote) / the legislative
   journey (a bill) → מסמכים רשמיים, last. A view passes what it has; an
   empty part is simply not drawn.
   ===================================================================== */

/* a law or bill name, whole — but in two voices for the eye (Mercy): the
   words up to the first "(" / "[" or the Hebrew year are what it is about
   (bold); from there on — the amendment number, the subject in brackets,
   "התשפ"ו–2026" — the same name, regular and one step smaller. Never cut. */
function splitName(n) {
  const s = String(n || "").trim();
  const cut = [s.indexOf("("), s.indexOf("["), s.search(/,?\s*(התש|תש)[֐-׿"'״׳]*\s*[–-]?\s*\d{4}\s*$/),
    s.search(/,\s*\d{4}\s*$/)].filter(i => i > 0);
  const at = cut.length ? Math.min(...cut) : -1;
  if (at < 3) return [s, ""];
  return [s.slice(0, at).trim(), s.slice(at).replace(/^,\s*/, "").trim()];
}
function nameHtml(n) {
  const [core, tail] = splitName(n);
  return `<span class="core">${esc(core)}</span>` + (tail ? ` <span class="tail">${esc(tail)}</span>` : "");
}

/* a bill's own page: /bill/<BillID>/ — the number only (Mercy); the worker 301s
   any other spelling */
const billLink = b => "/bill/" + (+b.i) + "/";

/* "label: value" — the label bold (Mercy). key = a string key; empty value → nothing */
// a <div>, not a <p>: a value may hold a fold (<details>), which a <p> can't contain
const kv = (key, valueHtml) => valueHtml ? `<div class="kv"><b>${esc(t(key))}:</b> ${valueHtml}</div>` : "";

/* the closed row's head — the caller wraps it in its own clickable element */
function rowHeadHtml(open, name, lineHtml) {
  return `<span class="nm"><span class="chev" aria-hidden="true">${open ? "▾" : "▸"}</span>${nameHtml(name)}</span>` +
    (lineHtml ? `<span class="line">${lineHtml}</span>` : "");
}

/* who proposed it — Mercy's rule: up to four names in full; more → HOW MANY,
   and a click opens the whole list. Never some names + "ועוד 15": the one
   you look for is exactly the one that ends up hidden. */
function proposersHtml(names, isGov, toggleCall, open, linkFn) {
  const list = (names || []).filter(Boolean);
  const show = linkFn || esc;
  if (!list.length) return isGov ? kv("bBy", esc(t("bGov"))) : "";
  if (list.length <= 4) return kv("bBy", list.map(show).join(", "));
  return kv("bBy", esc(t("bCount").replace("{n}", list.length)) +
    ` <button class="votechip" type="button" onclick="event.stopPropagation();${toggleCall}">${esc(t(open ? "bHide" : "bShowAll"))}</button>` +
    (open ? `<span class="names" style="display:block;margin-top:4px">${list.map(show).join(", ")}</span>` : ""));
}

/* the bill's type in words — "ממשלתית" / "פרטית" / "ועדה" → one wording site-wide */
function billTypeWord(subType) {
  const s = String(subType || "");
  return s ? t(/ממשלת/.test(s) ? "bTyGov" : /ועד/.test(s) ? "bTyCommittee" : "bTyPrivate") : "";
}

/* which law(s) it changes: links to their pages when known (one law or a
   list — an omnibus bill changes dozens: ≤4 in full, more → the count with
   the whole list one tap away), else in words */
function affectsHtml(law, amends) {
  const list = (Array.isArray(law) ? law : law ? [law] : []).filter(l => l && l.i);
  const link = l => `<a class="golink" href="/law/${+l.i}/">${esc(l.n || "")}</a>`;
  if (list.length && list.length <= 4) return list.map(link).join(" · ");
  if (list.length) return `<details class="inline"><summary>${esc(t("bLawsCount").replace("{n}", list.length))}</summary>${list.map(link).join(" · ")}</details>`;
  if (amends === true) return esc(t("bAmends"));
  if (amends === false) return esc(t("bNewLaw"));
  return "";
}
/* a bill amends an existing law — by the Knesset's naming convention
   ("(תיקון…)", "חוק לתיקון…"); "(תיקוני חקיקה)" in a NEW law's name is not it */
const amendsByName = n => /\(תיקון|^(הצעת )?חוק לתיקון/.test(String(n || ""));

/* the opened panel, in the one order. o = {proposers, type, stage, committee,
   date, affects, decision, factions, journey, published, docs} — html pieces,
   already escaped; missing ones are skipped */
function billPanelHtml(o) {
  return [
    o.proposers || "",
    kv("bType", o.type), kv("bStage", o.stage), kv("bCommittee", o.committee),
    kv("bDate", o.date), kv("bAffects", o.affects),
    kv("bDecision", o.decision),
    o.factions ? `<p class="bsec">${esc(t("bFactions"))}</p>${o.factions}` : "",
    o.journey ? `<p class="bsec">${esc(t("bJourney"))}</p>${o.journey}` : "",
    kv("bPublished", o.published),
    o.docs ? `<p class="bsec">${esc(t("bDocs"))}</p><p class="kv">${o.docs}</p>` : "",
  ].join("");
}

/* official documents — straight to the Knesset's own files, one per kind */
function docLinksHtml(docs) {
  const seen = {};
  return (docs || [])
    .filter(d => d.ApplicationDesc === "PDF" && d.FilePath)
    .filter(d => seen[d.GroupTypeDesc] ? false : (seen[d.GroupTypeDesc] = true))
    .slice(0, 6)
    .map(d => `<a class="doclink" href="${esc(d.FilePath)}" target="_blank" rel="noopener">${esc(d.GroupTypeDesc || "PDF")} ⇗</a>`)
    .join(" · ");
}

/* the laws a PASSED bill made or changed (KNS_LawBinding LawID = BillID →
   every IsraelLawID, then their names in one call). Cached per bill; null =
   none (still pending, or not a law bill). onReady redraws when it arrives. */
const _lawOfBill = {};
function lawOfBill(billId, onReady) {
  const id = +billId;
  if (!id) return null;
  if (id in _lawOfBill) return _lawOfBill[id] === "loading" ? null : _lawOfBill[id];
  _lawOfBill[id] = "loading";
  const P = "https://knesset.gov.il/Odata/ParliamentInfo.svc/";
  (async () => {
    try {
      const b = await viaRelay(P + `KNS_LawBinding()?$filter=LawID eq ${id} and LawTypeID eq 2&$select=IsraelLawID&$top=100&$format=json`);
      const ids = [...new Set(((b && b.value) || []).map(r => r.IsraelLawID).filter(Boolean))];
      if (!ids.length) { _lawOfBill[id] = null; }
      else {
        const names = {};
        for (let k = 0; k < ids.length; k += 15) {      // the OData URL stays short: 15 ids a call
          const q = ids.slice(k, k + 15).map(x => "IsraelLawID eq " + x).join(" or ");
          const l = await viaRelay(P + `KNS_IsraelLaw()?$filter=${q}&$select=IsraelLawID,Name&$format=json`);
          ((l && l.value) || []).forEach(r => { names[r.IsraelLawID] = r.Name; });
        }
        _lawOfBill[id] = ids.map(i => ({ i, n: names[i] || "" }));
      }
    } catch (e) { _lawOfBill[id] = null; }
    if (typeof onReady === "function") onReady();
  })();
  return null;
}
