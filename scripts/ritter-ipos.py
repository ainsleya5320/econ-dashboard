"""Rebuild data/folly/ritter-ipos.json from Jay Ritter's IPO statistics.

Table 9 of Ritter's "Initial Public Offerings: Updated Statistics" (University
of Florida) gives, for every year since 1980, the number of operating-company
IPOs, the share that are tech, the share with negative earnings in the twelve
months before going public, and mean first-day returns for the loss-makers and
the profitable ones. Stocks → Sin & Folly uses the negative-earnings share as a
folly gauge. Ritter only publishes the table as a PDF, updated each January, so
this script reads the PDF's text (pypdf) and checks the year rows add up to his
stated total before writing anything.

    python -I scripts/ritter-ipos.py

Needs pypdf (pip install pypdf). The PDF goes to a fresh temporary folder and
is deleted afterwards.
"""
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone

URL = 'https://site.warrington.ufl.edu/ritter/files/IPO-Statistics.pdf'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'folly', 'ritter-ipos.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def main():
    from pypdf import PdfReader

    tmp = tempfile.mkdtemp(prefix='ritter-')
    try:
        pdf = os.path.join(tmp, 'IPO-Statistics.pdf')
        req = urllib.request.Request(URL, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(pdf, 'wb') as f:
            f.write(r.read())
        pages = [p.extract_text() or '' for p in PdfReader(pdf).pages]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Table 9 is titled on one page and runs year by year on the next (the
    # contents page carries the title too, so anchor on the dated heading)
    start = next((i for i, t in enumerate(pages) if 'Table 9 (updated' in t and 'Negative Earnings' in t), None)
    if start is None:
        sys.exit('Table 9 (Fraction of IPOs with Negative Earnings) not found; the PDF layout changed')
    updated = re.search(r'Table 9 \(updated ([A-Za-z]+ \d+, \d{4})\)', pages[start])
    text = ' '.join(pages[start:start + 2])

    # Walk the tokens: a year, its IPO count, then the next four percentages
    # (tech share, negative-EPS share, first-day return for each group). A stray
    # number can sit between them where the PDF overlays a subtotal, so anything
    # without a % sign is skipped until four percentages are in hand.
    tokens = text.split()
    rows, i = {}, 0
    while i < len(tokens):
        t = tokens[i]
        if re.fullmatch(r'(19[89]\d|20\d\d)', t) and i + 1 < len(tokens) and re.fullmatch(r'[\d,]+', tokens[i + 1]):
            year, count, pcts, j = int(t), int(tokens[i + 1].replace(',', '')), [], i + 2
            while j < len(tokens) and len(pcts) < 4 and j < i + 12:
                m = re.fullmatch(r'(-?[\d.]+)%', tokens[j])
                if m:
                    pcts.append(float(m.group(1)))
                elif re.fullmatch(r'(19[89]\d|20\d\d)', tokens[j]):
                    break
                j += 1
            if len(pcts) == 4 and count > 0:
                rows[year] = {'y': year, 'n': count, 'tech': round(pcts[0] / 100, 4), 'neg': round(pcts[1] / 100, 4), 'retNeg': round(pcts[2] / 100, 4), 'retPos': round(pcts[3] / 100, 4)}
            i = j
            continue
        i += 1

    years = sorted(rows)
    total = re.search(r'1980-(\d{4})\s+([\d,]+)\s+\d+%', text.split('year-by-year')[-1]) or re.search(r'1980-(\d{4})\s+([\d,]+)', text)
    if not years or years[0] != 1980 or years != list(range(1980, years[-1] + 1)):
        sys.exit(f'year rows are not a clean 1980–present run: {years[:3]}…{years[-3:]}')
    if total and int(total.group(1)) == years[-1] and sum(rows[y]['n'] for y in years) != int(total.group(2).replace(',', '')):
        sys.exit(f"IPO counts sum to {sum(rows[y]['n'] for y in years)}, not Ritter's total {total.group(2)}")

    out = {
        'source': "Jay Ritter, Initial Public Offerings: Updated Statistics, Table 9 (University of Florida)",
        'url': URL,
        'tableUpdated': updated.group(1) if updated else None,
        'fetchedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'note': 'Operating-company IPOs (no penny stocks, units, ADRs, funds, SPACs, REITs, banks). neg = share with negative trailing EPS; retNeg/retPos = mean first-day return for each group.',
        'rows': [rows[y] for y in years],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {os.path.relpath(OUT)}: {years[0]}–{years[-1]}, {sum(rows[y]["n"] for y in years):,} IPOs (table updated {out["tableUpdated"]})')


if __name__ == '__main__':
    main()
