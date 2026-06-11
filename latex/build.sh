#!/usr/bin/env bash
# Build both CV versions from main.tex
# CV.pdf      — selected publications & top awards (\fullcvfalse, linked from website)
# CV-full.pdf — all publications & awards (\fullcvtrue)
set -e
cd "$(dirname "$0")"

echo "Building selected CV (CV.pdf)..."
latexmk -pdf -jobname=CV -interaction=nonstopmode main.tex

echo "Building full CV (CV-full.pdf)..."
sed 's/\\fullcvfalse/\\fullcvtrue/' main.tex > _full.tex
latexmk -pdf -jobname=CV-full -interaction=nonstopmode _full.tex
rm -f _full.tex _full.aux _full.log _full.fls _full.fdb_latexmk _full.out

echo "Cleaning intermediates..."
rm -f CV.aux CV.log CV.out CV.fls CV.fdb_latexmk \
       CV-full.aux CV-full.log CV-full.out \
       CV-full.fls CV-full.fdb_latexmk

echo "Done: CV.pdf ($(stat -f%z CV.pdf) bytes), CV-full.pdf ($(stat -f%z CV-full.pdf) bytes)"
