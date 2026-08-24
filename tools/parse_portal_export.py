#!/usr/bin/env python3
"""
parse_portal_export.py — turn an mr.gov.il export into compact JSON.

WHAT THESE FILES ARE
  Mercy exported the publication register from the procurement portal itself
  (mr.gov.il, מינהל הרכש הממשלתי) — פלט מכרזים / פלט פטורים. Measured
  2026-08-24 on the tenders export: rows 2009 → 2026, which SUPERSEDES the
  data.gov.il register (frozen at 2021-01-31) for both history and present.
  This is Origin B's primary form, obtained through a browser because the
  portal, like foi.gov.il, does not serve robots.

THE FORMAT, as found (do not "fix" the file to match the label):
  The .xls extension is a lie twice over — the content is SpreadsheetML 2003
  XML, and its declaration says encoding="utf-16" while the bytes are UTF-8
  with a BOM. Excel forgives both; parsers must be told.

WHAT THIS WRITES
  {source_file, exported (file mtime, ISO), columns: [portal's own header
  spellings], rows: [[...]], counts} — every column, every row, nothing
  renamed, nothing dropped, empty cells as "". Rows-as-arrays because the
  exemptions export runs to hundreds of MB and repeating Hebrew keys per row
  would double it. NOT combined with anything (Mercy's rule, 2026-08-24).

usage:
  parse_portal_export.py "פלט מכרזים_B.xls" out.json
"""
import datetime, json, os, re, sys, tempfile
import xml.etree.ElementTree as ET


def clean_copy(src, dst):
    """Write a copy that tells the truth: BOM stripped, declaration fixed.
       The exemptions export is 456 MB — everything downstream must STREAM,
       so the fix is a one-pass byte patch, not a load-and-replace."""
    with open(src, "rb") as i, open(dst, "wb") as o:
        first = i.read(1 << 16)
        if first[:2] in (b"\xff\xfe", b"\xfe\xff"):
            raise SystemExit("%s really is utf-16 — this patch path is for the "
                             "utf-8-with-a-lying-declaration files; handle it "
                             "explicitly rather than guessing" % src)
        if first[:3] == b"\xef\xbb\xbf":
            first = first[3:]
        first = first.replace(b'encoding="utf-16"', b'encoding="utf-8"', 1)
        o.write(first)
        while True:
            b = i.read(1 << 22)
            if not b:
                break
            o.write(b)


def rows_of(path):
    """One row at a time, elements freed as they pass — constant memory."""
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag.endswith("}Row"):
            yield [(d.text or "").strip()
                   for d in el.iter() if d.tag.endswith("}Data")]
            el.clear()


DATE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})")     # the portal writes DD.MM.YYYY


def convert(src, out, log=print):
    tmp = tempfile.NamedTemporaryFile(suffix=".xml", delete=False)
    tmp.close()
    try:
        clean_copy(src, tmp.name)
        it = rows_of(tmp.name)
        header = next(it, None)
        if not header:
            raise SystemExit("%s has no rows at all" % os.path.basename(src))
        pub_col = next((i for i, h in enumerate(header)
                        if "תאריך פרסום" in h), None)

        count, years, newest = 0, {}, ""
        with open(out, "w", encoding="utf-8") as fh:
            fh.write('{"source_file":%s,' % json.dumps(os.path.basename(src),
                                                       ensure_ascii=False))
            fh.write('"source":"mr.gov.il export, downloaded by hand '
                     '(the portal does not serve robots)",')
            fh.write('"exported":"%s",' % datetime.datetime.fromtimestamp(
                os.path.getmtime(src)).strftime("%Y-%m-%d"))
            fh.write('"columns":%s,' % json.dumps(header, ensure_ascii=False))
            fh.write('"rows":[')
            for vals in it:
                vals += [""] * (len(header) - len(vals))   # ragged: pad, never drop
                vals = vals[:len(header)]
                if count:
                    fh.write(",")
                fh.write(json.dumps(vals, ensure_ascii=False,
                                    separators=(",", ":")))
                count += 1
                if pub_col is not None:
                    m = DATE.match(vals[pub_col])
                    if m:
                        years[m.group(3)] = years.get(m.group(3), 0) + 1
                        iso = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
                        if iso > newest:
                            newest = iso
            fh.write('],"counts":%s}' % json.dumps(
                {"rows": count, "by_publication_year": dict(sorted(years.items())),
                 "newest_publication": newest}, ensure_ascii=False))
    finally:
        os.unlink(tmp.name)
    log("%s: %d rows · %d columns · פרסום %s → %s · %.1f MB"
        % (os.path.basename(src), count, len(header),
           min(years) if years else "?", newest or "?",
           os.path.getsize(out) / 1e6))
    return {"rows": count, "columns": header, "newest": newest}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: parse_portal_export.py <export.xls> <out.json>")
    convert(sys.argv[1], sys.argv[2])
